use crate::bridge::BridgeError;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        mpsc::{self, Receiver, RecvTimeoutError},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

/// Plazo para que el motor confirme STOP y termine por sí mismo (cierre cooperativo).
/// Solo si vence se termina el proceso a la fuerza; en ese caso no se garantiza que el
/// bloque `finally` de Python libere la cámara ni los botones.
pub const STOP_TIMEOUT: Duration = Duration::from_secs(3);
/// Plazo para recibir el ACK de un comando antes de considerarlo no confirmado.
pub const ACK_TIMEOUT: Duration = Duration::from_secs(3);
const STOP_POLL: Duration = Duration::from_millis(25);
/// Eventos de aplicación conservados para que la interfaz los consuma por secuencia.
const RECENT_EVENTS: usize = 32;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub running: bool,
    pub camera_open: bool,
    pub camera_index: u32,
    pub preferred_hand: String,
    pub mirror_camera: bool,
    pub active_bounds: Vec<f64>,
    pub mode: String, // "OBSERVATION" | "CONTROL"
    pub paused: bool,
    pub emergency_stopped: bool,
    pub hotkey_active: bool,
    pub hand_detected: bool,
    pub handedness: String,
    pub confidence: u32,
    pub gesture: String,
    pub last_event: String,
    pub pointer_armed: bool,
    pub precision: bool,
    pub airswipe: bool,
    pub tracing: bool,
    pub gaze: Value,
    pub window_result: String,
    pub pinch_distance_px: u32,
    pub pinch_ratio: f64,
    pub cursor_x: f64,
    pub cursor_y: f64,
    pub raw_anchor_x: f64,
    pub raw_anchor_y: f64,
    pub landmarks: Vec<Vec<f64>>,
    pub fps: f64,
    pub latency_ms: f64,
    pub total_clicks: u32,
    pub total_scrolls: u32,
    /// Última configuración que el motor confirmó haber aplicado (READY o ACK de SET_CONFIG/LOAD_EXPORT).
    pub applied_config: Value,
    /// Secuencia del último evento de aplicación recibido y los últimos eventos (TIMER, PRECISION,
    /// NAVIGATION, AIRSWIPE_TRACE, CONFIRM/CANCEL/BACK/FORWARD con el teclado abierto, GAZE_CALIBRATED).
    pub event_seq: u64,
    pub recent_events: Vec<Value>,
    pub message: String,
}

impl Default for EngineStatus {
    fn default() -> Self {
        Self {
            running: false,
            camera_open: false,
            camera_index: 0,
            preferred_hand: "RIGHT".into(),
            mirror_camera: true,
            active_bounds: vec![0.18, 0.82, 0.24, 0.84],
            mode: "OBSERVATION".into(),
            paused: false,
            emergency_stopped: false,
            hotkey_active: false,
            hand_detected: false,
            handedness: "NINGUNA".into(),
            confidence: 0,
            gesture: "NONE".into(),
            last_event: "NONE".into(),
            pointer_armed: false,
            precision: false,
            airswipe: false,
            tracing: false,
            gaze: json!({ "state": "desactivado", "holding": false }),
            window_result: "NONE".into(),
            pinch_distance_px: 0,
            pinch_ratio: 1.0,
            cursor_x: 0.5,
            cursor_y: 0.5,
            raw_anchor_x: 0.5,
            raw_anchor_y: 0.5,
            landmarks: Vec::new(),
            fps: 0.0,
            latency_ms: 0.0,
            total_clicks: 0,
            total_scrolls: 0,
            applied_config: Value::Null,
            event_seq: 0,
            recent_events: Vec::new(),
            message: "Motor gestual detenido. Cámara apagada.".into(),
        }
    }
}

#[cfg(windows)]
struct Job(windows_sys::Win32::Foundation::HANDLE);
#[cfg(windows)]
unsafe impl Send for Job {}
#[cfg(windows)]
impl Job {
    fn attach(child: &Child) -> Result<Self, BridgeError> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::JobObjects::*;
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return Err(BridgeError {
                    code: "PROCESS_SECURITY".into(),
                    message: "No se pudo aislar el motor gestual.".into(),
                });
            }
            let job = Self(handle);
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                std::mem::size_of_val(&limits) as u32,
            ) == 0
                || AssignProcessToJobObject(handle, child.as_raw_handle() as _) == 0
            {
                return Err(BridgeError {
                    code: "PROCESS_SECURITY".into(),
                    message: "No se pudo asociar el motor gestual al contenedor de proceso.".into(),
                });
            }
            Ok(job)
        }
    }
}
#[cfg(windows)]
impl Drop for Job {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}
#[cfg(not(windows))]
struct Job;
#[cfg(not(windows))]
impl Job {
    fn attach(_: &Child) -> Result<Self, BridgeError> {
        Ok(Self)
    }
}

struct RunningProcess {
    child: Child,
    stdin: ChildStdin,
    acks: Receiver<Value>,
    _job: Job,
}

pub struct GestureEngineManager {
    motor_dir: PathBuf,
    process: Option<RunningProcess>,
    status: Arc<Mutex<EngineStatus>>,
    next_id: u64,
}

/// Espera a que el proceso termine dentro del plazo. Devuelve true si terminó.
fn wait_for_exit(child: &mut Child, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(STOP_POLL),
            _ => return false,
        }
    }
}

/// Orden de búsqueda del motor: ejecutable empaquetado (distribución), entorno virtual del clon,
/// Python 3.11 del usuario y, por último, `python` en el PATH.
pub fn find_engine_launcher(motor_dir: &Path) -> (PathBuf, Vec<String>) {
    let bundled = motor_dir.join("zerotouch-motor").join(if cfg!(windows) { "zerotouch-motor.exe" } else { "zerotouch-motor" });
    if bundled.is_file() {
        return (bundled, Vec::new());
    }
    let module_args = vec!["-u".to_string(), "-m".to_string(), "motor_local.main".to_string()];
    let local = motor_dir.join(".venv").join(if cfg!(windows) {
        "Scripts/python.exe"
    } else {
        "bin/python"
    });
    if local.is_file() {
        return (local, module_args);
    }
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        let candidate = PathBuf::from(local_app_data)
            .join("Programs")
            .join("Python")
            .join("Python311")
            .join("python.exe");
        if candidate.exists() {
            return (candidate, module_args);
        }
    }
    (PathBuf::from("python"), module_args)
}

fn apply_telemetry(st: &mut EngineStatus, val: &Value) {
    st.running = val["running"].as_bool().unwrap_or(true);
    st.camera_open = val["cameraOpen"].as_bool().unwrap_or(st.camera_open);
    if let Some(ci) = val["cameraIndex"].as_u64() {
        st.camera_index = ci as u32;
    }
    if let Some(ph) = val["preferredHand"].as_str() {
        st.preferred_hand = ph.to_string();
    }
    if let Some(mc) = val["mirrorCamera"].as_bool() {
        st.mirror_camera = mc;
    }
    if let Some(ab) = val["activeBounds"].as_array() {
        let bounds: Vec<f64> = ab.iter().filter_map(|v| v.as_f64()).collect();
        if bounds.len() == 4 {
            st.active_bounds = bounds;
        }
    }
    if let Some(m) = val["mode"].as_str() {
        st.mode = m.to_string();
    }
    if let Some(p) = val["paused"].as_bool() {
        st.paused = p;
    }
    if let Some(es) = val["emergencyStopped"].as_bool() {
        st.emergency_stopped = es;
    }
    if let Some(h) = val["hotkeyActive"].as_bool() {
        st.hotkey_active = h;
    }
    if let Some(hd) = val["handDetected"].as_bool() {
        st.hand_detected = hd;
        if !hd {
            st.landmarks.clear();
        }
    }
    if let Some(h) = val["handedness"].as_str() {
        st.handedness = h.to_string();
    }
    if let Some(c) = val["confidence"].as_u64() {
        st.confidence = c as u32;
    }
    if let Some(g) = val["gesture"].as_str() {
        st.gesture = g.to_string();
    }
    if let Some(le) = val["lastEvent"].as_str() {
        st.last_event = le.to_string();
    }
    if let Some(v) = val["pointerArmed"].as_bool() {
        st.pointer_armed = v;
    }
    if let Some(v) = val["precision"].as_bool() {
        st.precision = v;
    }
    if let Some(v) = val["airswipe"].as_bool() {
        st.airswipe = v;
    }
    if let Some(v) = val["tracing"].as_bool() {
        st.tracing = v;
    }
    if val["gaze"].is_object() {
        st.gaze = val["gaze"].clone();
    }
    if let Some(w) = val["windowResult"].as_str() {
        st.window_result = w.to_string();
    }
    if let Some(pd) = val["pinchDistancePx"].as_u64() {
        st.pinch_distance_px = pd as u32;
    }
    if let Some(pr) = val["pinchRatio"].as_f64() {
        st.pinch_ratio = pr;
    }
    if let Some(cx) = val["cursorX"].as_f64() {
        st.cursor_x = cx;
    }
    if let Some(cy) = val["cursorY"].as_f64() {
        st.cursor_y = cy;
    }
    if let Some(rax) = val["rawAnchorX"].as_f64() {
        st.raw_anchor_x = rax;
    }
    if let Some(ray) = val["rawAnchorY"].as_f64() {
        st.raw_anchor_y = ray;
    }
    if let Some(lms_arr) = val["landmarks"].as_array() {
        let mut parsed = Vec::with_capacity(lms_arr.len());
        for pt in lms_arr {
            if let Some(coords) = pt.as_array() {
                if coords.len() >= 2 {
                    if let (Some(x), Some(y)) = (coords[0].as_f64(), coords[1].as_f64()) {
                        parsed.push(vec![x, y]);
                    }
                }
            }
        }
        st.landmarks = parsed;
    }
    if let Some(fps) = val["fps"].as_f64() {
        st.fps = fps;
    }
    if let Some(lat) = val["latencyMs"].as_f64() {
        st.latency_ms = lat;
    }
    if let Some(tc) = val["totalClicks"].as_u64() {
        st.total_clicks = tc as u32;
    }
    if let Some(ts) = val["totalScrolls"].as_u64() {
        st.total_scrolls = ts as u32;
    }
    if val["config"].is_object() {
        st.applied_config = val["config"].clone();
    }
    if let Some(msg) = val["message"].as_str() {
        st.message = msg.to_string();
    } else if st.camera_open {
        st.message = if st.mode == "CONTROL" {
            "Control real del SO activo (Parada rápida: Ctrl+Alt+Z)".into()
        } else {
            "Modo Simulación activo (sin mover el cursor del SO)".into()
        };
    }
}

impl GestureEngineManager {
    pub fn new(motor_dir: PathBuf) -> Self {
        Self {
            motor_dir,
            process: None,
            status: Arc::new(Mutex::new(EngineStatus::default())),
            next_id: 0,
        }
    }

    fn check_alive(&mut self) {
        if let Some(proc) = self.process.as_mut() {
            if let Ok(Some(_)) = proc.child.try_wait() {
                self.process = None;
                if let Ok(mut st) = self.status.lock() {
                    st.running = false;
                    st.camera_open = false;
                    st.hand_detected = false;
                    st.landmarks.clear();
                    st.mode = "OBSERVATION".into();
                    st.airswipe = false;
                    st.tracing = false;
                    st.pointer_armed = false;
                }
            }
        }
    }

    pub fn get_status(&mut self) -> EngineStatus {
        self.check_alive();
        self.status
            .lock()
            .map(|s| s.clone())
            .unwrap_or_default()
    }

    pub fn start(&mut self, config: Option<Value>) -> Result<EngineStatus, BridgeError> {
        self.check_alive();
        if self.process.is_some() {
            if let Some(cfg) = config {
                self.update_config(cfg)?;
            }
            return Ok(self.get_status());
        }

        if !self.motor_dir.exists() {
            return Err(BridgeError {
                code: "ENGINE_MISSING".into(),
                message: "No se encontró el motor gestual (carpeta motor-local o ejecutable empaquetado).".into(),
            });
        }

        let (launcher, args) = find_engine_launcher(&self.motor_dir);
        let mut cmd = Command::new(launcher);
        cmd.args(args)
            .current_dir(&self.motor_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());

        // La configuración inicial viaja como argumento: el motor la aplica al arrancar, sin esperar un ACK.
        if let Some(cfg) = config.as_ref() {
            cmd.arg("--config-json").arg(cfg.to_string());
        }

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

        let mut child = cmd.spawn().map_err(|_| BridgeError {
            code: "ENGINE_START".into(),
            message: "No se pudo iniciar el motor gestual local (Python o ejecutable empaquetado ausente).".into(),
        })?;

        let job = match Job::attach(&child) {
            Ok(j) => j,
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(e);
            }
        };

        let stdin = child.stdin.take().ok_or_else(|| BridgeError {
            code: "ENGINE_IPC".into(),
            message: "No se pudo abrir el canal de entrada del motor gestual.".into(),
        })?;

        let stdout = child.stdout.take().ok_or_else(|| BridgeError {
            code: "ENGINE_IPC".into(),
            message: "No se pudo abrir el canal de telemetría del motor gestual.".into(),
        })?;

        if let Ok(mut st) = self.status.lock() {
            *st = EngineStatus {
                running: true,
                camera_open: false,
                mode: "OBSERVATION".into(),
                message: "Iniciando cámara y MediaPipe en Modo Simulación…".into(),
                ..EngineStatus::default()
            };
        }

        let (ack_tx, ack_rx) = mpsc::channel::<Value>();
        let shared_status = self.status.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                if let Ok(val) = serde_json::from_str::<Value>(&line) {
                    let msg_type = val["type"].as_str().unwrap_or("");
                    if msg_type == "ACK" {
                        let _ = ack_tx.send(val);
                        continue;
                    }
                    if let Ok(mut st) = shared_status.lock() {
                        if msg_type == "READY" || msg_type == "TELEMETRY" {
                            apply_telemetry(&mut st, &val);
                        } else if msg_type == "EVENT" {
                            if let Some(seq) = val["seq"].as_u64() {
                                st.event_seq = seq;
                            }
                            st.recent_events.push(val.clone());
                            if st.recent_events.len() > RECENT_EVENTS {
                                let excess = st.recent_events.len() - RECENT_EVENTS;
                                st.recent_events.drain(0..excess);
                            }
                        } else if msg_type == "MODE_CHANGED" {
                            if let Some(m) = val["mode"].as_str() {
                                st.mode = m.to_string();
                            }
                            if let Some(p) = val["paused"].as_bool() {
                                st.paused = p;
                            }
                            if let Some(es) = val["emergencyStopped"].as_bool() {
                                st.emergency_stopped = es;
                            }
                        } else if msg_type == "STOPPED" || msg_type == "ERROR" {
                            st.running = false;
                            st.camera_open = false;
                            st.hand_detected = false;
                            st.landmarks.clear();
                            st.mode = "OBSERVATION".into();
                            st.airswipe = false;
                            st.tracing = false;
                            st.pointer_armed = false;
                            if let Some(msg) = val["message"].as_str() {
                                st.message = msg.to_string();
                            }
                        }
                    }
                }
            }
            if let Ok(mut st) = shared_status.lock() {
                st.running = false;
                st.camera_open = false;
                st.hand_detected = false;
                st.landmarks.clear();
                st.mode = "OBSERVATION".into();
                st.airswipe = false;
                st.tracing = false;
                st.pointer_armed = false;
            }
        });

        self.process = Some(RunningProcess {
            child,
            stdin,
            acks: ack_rx,
            _job: job,
        });

        Ok(self.get_status())
    }

    /// Envía un comando y espera su ACK por `id`. Un comando solo se considera aplicado si el
    /// motor responde ok=true; un rechazo se devuelve con el código que indica el motor.
    fn send_cmd(&mut self, mut payload: Value) -> Result<Value, BridgeError> {
        self.check_alive();
        self.next_id += 1;
        let id = self.next_id;
        payload["id"] = json!(id);
        let proc = self.process.as_mut().ok_or_else(|| BridgeError {
            code: "ENGINE_NOT_RUNNING".into(),
            message: "El motor gestual no está en ejecución.".into(),
        })?;
        let text = payload.to_string();
        writeln!(proc.stdin, "{text}").map_err(|_| BridgeError {
            code: "ENGINE_IPC".into(),
            message: "No se pudo enviar el comando al motor gestual.".into(),
        })?;
        let _ = proc.stdin.flush();

        let deadline = Instant::now() + ACK_TIMEOUT;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            match proc.acks.recv_timeout(remaining) {
                Ok(ack) if ack["id"].as_u64() == Some(id) => {
                    if ack["ok"].as_bool() == Some(true) {
                        return Ok(ack);
                    }
                    return Err(BridgeError {
                        code: ack["code"].as_str().unwrap_or("ENGINE_REJECTED").to_string(),
                        message: ack["message"]
                            .as_str()
                            .unwrap_or("El motor gestual rechazó el comando.")
                            .to_string(),
                    });
                }
                Ok(_) => continue, // ACK de otro comando: no es el que esperamos
                Err(RecvTimeoutError::Timeout) => {
                    return Err(BridgeError {
                        code: "ENGINE_TIMEOUT".into(),
                        message: "El motor gestual no confirmó el comando a tiempo.".into(),
                    })
                }
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(BridgeError {
                        code: "ENGINE_IPC".into(),
                        message: "El canal del motor gestual se cerró.".into(),
                    })
                }
            }
        }
    }

    fn remember_applied(&self, ack: &Value) {
        if ack["config"].is_object() {
            if let Ok(mut st) = self.status.lock() {
                st.applied_config = ack["config"].clone();
            }
        }
    }

    pub fn update_config(&mut self, config: Value) -> Result<EngineStatus, BridgeError> {
        if self.process.is_some() {
            let ack = self.send_cmd(json!({ "cmd": "SET_CONFIG", "config": config }))?;
            self.remember_applied(&ack);
        }
        Ok(self.get_status())
    }

    /// Carga una exportación de la API (formato 1). El motor valida todo el documento y solo
    /// devuelve su ACK si lo aplicó; un rechazo llega con el código que indica el motor.
    pub fn load_export(&mut self, document: Value, runtime: Option<Value>) -> Result<Value, BridgeError> {
        let ack = self.send_cmd(json!({ "cmd": "LOAD_EXPORT", "document": document, "runtime": runtime }))?;
        self.remember_applied(&ack);
        Ok(ack)
    }

    pub fn set_mode(&mut self, mode: String) -> Result<EngineStatus, BridgeError> {
        let normalized = if mode.eq_ignore_ascii_case("CONTROL") {
            "CONTROL"
        } else {
            "OBSERVATION"
        };
        self.send_cmd(json!({ "cmd": "SET_MODE", "mode": normalized }))?;
        if let Ok(mut st) = self.status.lock() {
            st.mode = normalized.into();
            if normalized == "CONTROL" {
                st.emergency_stopped = false;
                st.paused = false;
            }
        }
        Ok(self.get_status())
    }

    pub fn set_paused(&mut self, paused: bool) -> Result<EngineStatus, BridgeError> {
        self.send_cmd(json!({ "cmd": "SET_PAUSED", "paused": paused }))?;
        if let Ok(mut st) = self.status.lock() {
            st.paused = paused;
        }
        Ok(self.get_status())
    }

    /// Abre o cierra el modo teclado Air-Swipe en el motor (trazo con el índice, escritura permitida).
    pub fn set_airswipe(&mut self, active: bool) -> Result<EngineStatus, BridgeError> {
        self.send_cmd(json!({ "cmd": "AIRSWIPE", "active": active }))?;
        if let Ok(mut st) = self.status.lock() {
            st.airswipe = active;
        }
        Ok(self.get_status())
    }

    /// Escribe texto en la aplicación activa. El motor exige CONTROL y teclado abierto; el texto
    /// no se registra en ningún sitio.
    pub fn type_text(&mut self, text: String) -> Result<Value, BridgeError> {
        if text.is_empty() || text.chars().count() > 64 || text.chars().any(|c| c.is_control()) {
            return Err(BridgeError {
                code: "TEXT_INVALID".into(),
                message: "El texto debe ser imprimible y de hasta 64 caracteres.".into(),
            });
        }
        self.send_cmd(json!({ "cmd": "TYPE_TEXT", "text": text })).map(|_| json!({ "ok": true }))
    }

    pub fn press_key(&mut self, key: String) -> Result<Value, BridgeError> {
        if !matches!(key.as_str(), "backspace" | "enter" | "space") {
            return Err(BridgeError {
                code: "KEY_NOT_ALLOWED".into(),
                message: "Tecla no permitida.".into(),
            });
        }
        self.send_cmd(json!({ "cmd": "PRESS_KEY", "key": key })).map(|_| json!({ "ok": true }))
    }

    pub fn gaze_calibrate(&mut self) -> Result<Value, BridgeError> {
        self.send_cmd(json!({ "cmd": "GAZE_CALIBRATE" }))
    }

    /// Cierre cooperativo: envía STOP y espera hasta `STOP_TIMEOUT` a que el motor libere cámara y
    /// botones y termine. Solo si no termina a tiempo se fuerza la terminación del proceso.
    pub fn stop(&mut self) -> EngineStatus {
        if let Some(mut proc) = self.process.take() {
            let _ = writeln!(proc.stdin, r#"{{"cmd":"STOP"}}"#);
            let _ = proc.stdin.flush();
            if !wait_for_exit(&mut proc.child, STOP_TIMEOUT) {
                let _ = proc.child.kill();
                let _ = proc.child.wait();
            }
        }
        if let Ok(mut st) = self.status.lock() {
            *st = EngineStatus::default();
        }
        self.get_status()
    }
}

impl Drop for GestureEngineManager {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

/// Directorio del motor: en desarrollo, `motor-local/` junto a `desktop/`; en una instalación,
/// la carpeta de recursos indicada por `ZEROTOUCH_MOTOR_DIR` (la establece main.rs).
pub fn resolve_motor_dir(manifest_dir: &Path) -> PathBuf {
    if let Some(configured) = std::env::var_os("ZEROTOUCH_MOTOR_DIR") {
        let candidate = PathBuf::from(configured);
        if candidate.exists() {
            return candidate;
        }
    }
    if let Some(parent) = manifest_dir.parent() {
        let candidate = parent.join("motor-local");
        if candidate.exists() {
            return candidate;
        }
    }
    manifest_dir.join("../motor-local")
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn wait_for_exit_reports_a_child_that_finishes_within_the_deadline() {
        let mut child = Command::new("cmd").args(["/C", "exit", "0"]).spawn().expect("cmd disponible");
        assert!(wait_for_exit(&mut child, Duration::from_secs(10)));
    }

    #[test]
    fn wait_for_exit_gives_up_at_the_deadline_so_the_caller_can_force_termination() {
        let mut child = Command::new("cmd")
            .args(["/C", "ping -n 30 127.0.0.1 > NUL"])
            .spawn()
            .expect("cmd disponible");
        let started = Instant::now();
        assert!(!wait_for_exit(&mut child, Duration::from_millis(300)));
        assert!(started.elapsed() < Duration::from_secs(5));
        let _ = child.kill();
        let _ = child.wait();
    }

    #[test]
    fn telemetry_events_and_applied_config_are_parsed() {
        let mut st = EngineStatus::default();
        apply_telemetry(&mut st, &json!({
            "type": "TELEMETRY", "running": true, "cameraOpen": true, "mode": "CONTROL", "pointerArmed": true,
            "precision": true, "airswipe": true, "tracing": false, "gaze": {"state": "presente", "holding": false},
            "hotkeyActive": true, "windowResult": "MINIMIZED"
        }));
        assert!(st.pointer_armed && st.precision && st.airswipe && st.hotkey_active);
        assert_eq!(st.gaze["state"], "presente");
        apply_telemetry(&mut st, &json!({ "type": "READY", "running": true, "config": {"sensitivity": 70, "gestos": {}} }));
        assert_eq!(st.applied_config["sensitivity"], 70);
        let mut mgr = GestureEngineManager::new(PathBuf::from("."));
        assert_eq!(mgr.type_text("con\nsalto".into()).unwrap_err().code, "TEXT_INVALID");
        assert_eq!(mgr.press_key("f4".into()).unwrap_err().code, "KEY_NOT_ALLOWED");
        assert_eq!(mgr.press_key("enter".into()).unwrap_err().code, "ENGINE_NOT_RUNNING");
    }
}
