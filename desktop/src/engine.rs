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
pub const ACK_TIMEOUT: Duration = Duration::from_secs(2);
const STOP_POLL: Duration = Duration::from_millis(25);

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
    pub hand_detected: bool,
    pub handedness: String,
    pub confidence: u32,
    pub gesture: String,
    pub last_event: String,
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
            hand_detected: false,
            handedness: "NINGUNA".into(),
            confidence: 0,
            gesture: "NONE".into(),
            last_event: "NONE".into(),
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

fn find_python_binary(motor_dir: &Path) -> PathBuf {
    let local = motor_dir.join(".venv").join(if cfg!(windows) {
        "Scripts/python.exe"
    } else {
        "bin/python"
    });
    if local.is_file() {
        return local;
    }
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        let candidate = PathBuf::from(local_app_data)
            .join("Programs")
            .join("Python")
            .join("Python311")
            .join("python.exe");
        if candidate.exists() {
            return candidate;
        }
    }
    PathBuf::from("python")
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
                message: "No se encontró el directorio motor-local.".into(),
            });
        }

        let python_bin = find_python_binary(&self.motor_dir);
        let mut cmd = Command::new(python_bin);
        cmd.arg("-u")
            .arg("-m")
            .arg("motor_local.main")
            .current_dir(&self.motor_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

        let mut child = cmd.spawn().map_err(|_| BridgeError {
            code: "ENGINE_START".into(),
            message: "No se pudo iniciar Python para el motor gestual local.".into(),
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
                    if val["type"].as_str() == Some("ACK") {
                        let _ = ack_tx.send(val);
                        continue;
                    }
                    if let Ok(mut st) = shared_status.lock() {
                        let msg_type = val["type"].as_str().unwrap_or("");
                        if msg_type == "READY" || msg_type == "TELEMETRY" {
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
                            if let Some(msg) = val["message"].as_str() {
                                st.message = msg.to_string();
                            } else if st.camera_open {
                                st.message = if st.mode == "CONTROL" {
                                    "Control real del SO activo (Parada rápida: Ctrl+Alt+Z)".into()
                                } else {
                                    "Modo Simulación activo (sin mover el cursor del SO)".into()
                                };
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
            }
        });

        self.process = Some(RunningProcess {
            child,
            stdin,
            acks: ack_rx,
            _job: job,
        });

        if let Some(cfg) = config {
            // La configuración inicial solo cuenta si el motor la confirma con ACK.
            if let Err(err) = self.send_cmd(json!({ "cmd": "SET_CONFIG", "config": cfg })) {
                let _ = self.stop();
                return Err(err);
            }
        }

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

    pub fn update_config(&mut self, config: Value) -> Result<EngineStatus, BridgeError> {
        if self.process.is_some() {
            self.send_cmd(json!({ "cmd": "SET_CONFIG", "config": config }))?;
        }
        Ok(self.get_status())
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

pub fn resolve_motor_dir(manifest_dir: &Path) -> PathBuf {
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
}
