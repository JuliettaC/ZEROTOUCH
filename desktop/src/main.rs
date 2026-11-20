#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod engine;

use bridge::{Bridge, BridgeError, ContextInput, Credentials, EmailRequest, GesturesInput, ProfileInput, Registration};
use engine::{resolve_motor_dir, EngineStatus, GestureEngineManager};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tauri::Manager;

type Shared = Arc<Mutex<Result<Bridge, BridgeError>>>;
type SharedEngine = Arc<Mutex<GestureEngineManager>>;

const MAIN_WINDOW: &str = "main";
/// Teclado Air-Swipe: ventana no activable y siempre visible, para escribir en otra aplicación.
const AIRSWIPE_WINDOW: &str = "airswipe";

fn err(code: &str, message: &str) -> BridgeError {
    BridgeError {
        code: code.into(),
        message: message.into(),
    }
}

/// Solo las dos ventanas de la aplicación (origen https://tauri.localhost) pueden invocar comandos.
fn verify_origin(window: &tauri::WebviewWindow) -> Result<(), BridgeError> {
    let label_ok = window.label() == MAIN_WINDOW || window.label() == AIRSWIPE_WINDOW;
    let origin_ok = window
        .url()
        .ok()
        .map(|u| u.origin().ascii_serialization())
        == Some("https://tauri.localhost".into());
    if !label_ok || !origin_ok {
        return Err(err("FORBIDDEN", "Origen no autorizado."));
    }
    Ok(())
}

macro_rules! endpoint {
    ($name:ident $(, $arg:ident : $ty:ty)*) => {
        #[tauri::command]
        async fn $name(window: tauri::WebviewWindow, state: tauri::State<'_, Shared>, $($arg:$ty),*) -> Result<Value,BridgeError> {
            verify_origin(&window)?;
            let shared=state.inner().clone();
            tauri::async_runtime::spawn_blocking(move|| {
                let mut state=shared.lock().map_err(|_|BridgeError{code:"SERVICE_OFFLINE".into(),message:"Reinicia ZEROTOUCH.".into()})?;
                match state.as_mut() {Ok(bridge)=>bridge.$name($($arg),*),Err(e)=>Err(e.clone())}
            }).await.map_err(|_|BridgeError{code:"SERVICE_OFFLINE".into(),message:"El servicio local se interrumpió.".into()})?
        }
    }
}
endpoint!(register, c:Registration);
endpoint!(resend_verification, e:EmailRequest);
endpoint!(forgot_password, e:EmailRequest);
endpoint!(link_email, c:Registration);
endpoint!(login, c:Credentials);
endpoint!(account);
endpoint!(logout);
endpoint!(backend_info);
endpoint!(profiles, offset:u32);
endpoint!(create_profile, p:ProfileInput, idempotency_key:Option<String>);
endpoint!(update_profile, id:String, p:ProfileInput);
endpoint!(delete_profile, id:String, if_match:String);
endpoint!(contexts, profile_id:String, offset:u32);
endpoint!(create_context, profile_id:String, c:ContextInput, idempotency_key:Option<String>);
endpoint!(update_context, id:String, c:ContextInput);
endpoint!(delete_context, id:String, if_match:String);
endpoint!(mode_gestures, id:String);
endpoint!(set_mode_gestures, id:String, g:GesturesInput);
endpoint!(capabilities);

async fn with_engine<T: Send + 'static>(
    engine: SharedEngine,
    operation: impl FnOnce(&mut GestureEngineManager) -> Result<T, BridgeError> + Send + 'static,
) -> Result<T, BridgeError> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut mgr = engine
            .lock()
            .map_err(|_| err("ENGINE_LOCK", "No se pudo acceder al motor gestual."))?;
        operation(&mut mgr)
    })
    .await
    .map_err(|_| err("ENGINE_ERROR", "Fallo al comunicarse con el motor gestual."))?
}

#[tauri::command]
async fn engine_start(window: tauri::WebviewWindow, engine: tauri::State<'_, SharedEngine>, config: Option<Value>) -> Result<EngineStatus, BridgeError> {
    verify_origin(&window)?;
    with_engine(engine.inner().clone(), move |mgr| mgr.start(config)).await
}

#[tauri::command]
async fn engine_stop(window: tauri::WebviewWindow, engine: tauri::State<'_, SharedEngine>) -> Result<EngineStatus, BridgeError> {
    verify_origin(&window)?;
    with_engine(engine.inner().clone(), |mgr| Ok(mgr.stop())).await
}

#[tauri::command]
async fn engine_status(window: tauri::WebviewWindow, engine: tauri::State<'_, SharedEngine>) -> Result<EngineStatus, BridgeError> {
    verify_origin(&window)?;
    with_engine(engine.inner().clone(), |mgr| Ok(mgr.get_status())).await
}

#[tauri::command]
async fn engine_update_config(window: tauri::WebviewWindow, engine: tauri::State<'_, SharedEngine>, config: Value) -> Result<EngineStatus, BridgeError> {
    verify_origin(&window)?;
    with_engine(engine.inner().clone(), move |mgr| mgr.update_config(config)).await
}

#[tauri::command]
async fn engine_set_mode(window: tauri::WebviewWindow, engine: tauri::State<'_, SharedEngine>, mode: String) -> Result<EngineStatus, BridgeError> {
    verify_origin(&window)?;
    with_engine(engine.inner().clone(), move |mgr| mgr.set_mode(mode)).await
}

#[tauri::command]
async fn engine_set_paused(window: tauri::WebviewWindow, engine: tauri::State<'_, SharedEngine>, paused: bool) -> Result<EngineStatus, BridgeError> {
    verify_origin(&window)?;
    with_engine(engine.inner().clone(), move |mgr| mgr.set_paused(paused)).await
}

#[tauri::command]
async fn engine_load_export(window: tauri::WebviewWindow, engine: tauri::State<'_, SharedEngine>, document: Value, runtime: Option<Value>) -> Result<Value, BridgeError> {
    verify_origin(&window)?;
    with_engine(engine.inner().clone(), move |mgr| mgr.load_export(document, runtime)).await
}

#[tauri::command]
async fn engine_airswipe(window: tauri::WebviewWindow, engine: tauri::State<'_, SharedEngine>, active: bool) -> Result<EngineStatus, BridgeError> {
    verify_origin(&window)?;
    with_engine(engine.inner().clone(), move |mgr| mgr.set_airswipe(active)).await
}

#[tauri::command]
async fn engine_type_text(window: tauri::WebviewWindow, engine: tauri::State<'_, SharedEngine>, text: String) -> Result<Value, BridgeError> {
    verify_origin(&window)?;
    with_engine(engine.inner().clone(), move |mgr| mgr.type_text(text)).await
}

#[tauri::command]
async fn engine_press_key(window: tauri::WebviewWindow, engine: tauri::State<'_, SharedEngine>, key: String) -> Result<Value, BridgeError> {
    verify_origin(&window)?;
    with_engine(engine.inner().clone(), move |mgr| mgr.press_key(key)).await
}

#[tauri::command]
async fn engine_gaze_calibrate(window: tauri::WebviewWindow, engine: tauri::State<'_, SharedEngine>) -> Result<Value, BridgeError> {
    verify_origin(&window)?;
    with_engine(engine.inner().clone(), |mgr| mgr.gaze_calibrate()).await
}

/// Geometría del teclado Air-Swipe: centrado en la parte inferior (o superior, con `at_top`) del área
/// de trabajo del monitor principal. Ocupa ~55 % del ancho y como mucho ~1/3 del alto, para no tapar la
/// aplicación en la que se escribe. Se devuelve en píxeles físicos junto con el rectángulo del escritorio virtual, que es
/// el espacio en el que el motor expresa el cursor normalizado.
fn airswipe_geometry(app: &tauri::AppHandle, at_top: bool) -> Result<Value, BridgeError> {
    let monitor = app
        .primary_monitor()
        .map_err(|_| err("MONITOR", "No se pudo consultar el monitor principal."))?
        .ok_or_else(|| err("MONITOR", "No hay monitor principal."))?;
    let scale = monitor.scale_factor();
    let work = monitor.work_area();
    let work_w = work.size.width as f64;
    let work_h = work.size.height as f64;
    let width = (work_w * 0.55).clamp(560.0 * scale, 920.0 * scale).min(work_w);
    let height = (width * 0.34).clamp(200.0 * scale, 320.0 * scale).min(work_h * 0.36);
    let x = work.position.x as f64 + (work_w - width) / 2.0;
    let y = if at_top {
        work.position.y as f64 + 12.0 * scale
    } else {
        work.position.y as f64 + work_h - height - 12.0 * scale
    };
    let mut left = i32::MAX;
    let mut top = i32::MAX;
    let mut right = i32::MIN;
    let mut bottom = i32::MIN;
    for m in app.available_monitors().unwrap_or_default() {
        left = left.min(m.position().x);
        top = top.min(m.position().y);
        right = right.max(m.position().x + m.size().width as i32);
        bottom = bottom.max(m.position().y + m.size().height as i32);
    }
    if left == i32::MAX {
        left = monitor.position().x;
        top = monitor.position().y;
        right = left + monitor.size().width as i32;
        bottom = top + monitor.size().height as i32;
    }
    Ok(json!({
        "x": x.round(), "y": y.round(), "width": width.round(), "height": height.round(), "scale": scale,
        "screen": { "left": left, "top": top, "width": right - left, "height": bottom - top }
    }))
}

#[tauri::command]
async fn airswipe_window_open(window: tauri::WebviewWindow, app: tauri::AppHandle, edge: Option<String>) -> Result<Value, BridgeError> {
    verify_origin(&window)?;
    // `edge`: "top" o "bottom" mueve el teclado ya abierto (botón Subir/Bajar de la overlay).
    let at_top = edge.as_deref() == Some("top");
    let geometry = airswipe_geometry(&app, at_top)?;
    let scale = geometry["scale"].as_f64().unwrap_or(1.0);
    if let Some(existing) = app.get_webview_window(AIRSWIPE_WINDOW) {
        let _ = existing.set_position(tauri::PhysicalPosition::new(geometry["x"].as_f64().unwrap_or(0.0) as i32, geometry["y"].as_f64().unwrap_or(0.0) as i32));
        if edge.is_none() {
            let _ = existing.show();
        }
        return Ok(geometry);
    }
    tauri::WebviewWindowBuilder::new(&app, AIRSWIPE_WINDOW, tauri::WebviewUrl::App("index.html#airswipe".into()))
        .title("ZeroTouch · Air-Swipe")
        // Mismo origen que la ventana principal (https://tauri.localhost): comparte localStorage (latido del
        // teclado) y supera `verify_origin`. Sin esto la overlay cargaba en http:// y todos sus comandos fallaban.
        .use_https_scheme(true)
        .decorations(false)
        .always_on_top(true)
        // Ni activable ni con el foco al crearse: el texto debe seguir yendo a la aplicación que la persona usa.
        .focused(false)
        .focusable(false)
        .skip_taskbar(true)
        .resizable(false)
        .inner_size(geometry["width"].as_f64().unwrap_or(900.0) / scale, geometry["height"].as_f64().unwrap_or(320.0) / scale)
        .position(geometry["x"].as_f64().unwrap_or(0.0) / scale, geometry["y"].as_f64().unwrap_or(0.0) / scale)
        .build()
        .map_err(|_| err("AIRSWIPE_WINDOW", "No se pudo abrir el teclado Air-Swipe."))?;
    Ok(geometry)
}

#[tauri::command]
async fn airswipe_window_close(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<Value, BridgeError> {
    verify_origin(&window)?;
    if let Some(existing) = app.get_webview_window(AIRSWIPE_WINDOW) {
        existing
            .close()
            .map_err(|_| err("AIRSWIPE_WINDOW", "No se pudo cerrar el teclado Air-Swipe."))?;
    }
    Ok(json!({ "closed": true }))
}

#[tauri::command]
async fn airswipe_window_rect(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<Value, BridgeError> {
    verify_origin(&window)?;
    let mut geometry = airswipe_geometry(&app, false)?;
    if let Some(existing) = app.get_webview_window(AIRSWIPE_WINDOW) {
        if let (Ok(pos), Ok(size)) = (existing.inner_position(), existing.inner_size()) {
            geometry["x"] = json!(pos.x);
            geometry["y"] = json!(pos.y);
            geometry["width"] = json!(size.width);
            geometry["height"] = json!(size.height);
        }
    }
    Ok(geometry)
}

fn main() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            // Instalación: el motor viaja como recurso (`bundle.resources` en tauri.conf.json).
            if let Ok(resource_dir) = app.path().resource_dir() {
                let bundled = resource_dir.join("motor-local");
                if bundled.exists() && std::env::var_os("ZEROTOUCH_MOTOR_DIR").is_none() {
                    std::env::set_var("ZEROTOUCH_MOTOR_DIR", bundled);
                }
            }
            let motor_dir = resolve_motor_dir(&manifest_dir);
            app.manage(Arc::new(Mutex::new(Bridge::new())));
            app.manage(Arc::new(Mutex::new(GestureEngineManager::new(motor_dir))));
            Ok(())
        })
        .on_page_load(|window, payload| {
            #[cfg(feature = "vertical-smoke")]
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) && window.label() == MAIN_WINDOW {
                let _ = window.eval(include_str!("../tests/vertical-smoke.js"));
            }
            #[cfg(not(feature = "vertical-smoke"))]
            let _ = (window, payload);
        })
        .invoke_handler(tauri::generate_handler![
            register,
            resend_verification,
            forgot_password,
            link_email,
            login,
            account,
            logout,
            backend_info,
            profiles,
            create_profile,
            update_profile,
            delete_profile,
            contexts,
            create_context,
            update_context,
            delete_context,
            mode_gestures,
            set_mode_gestures,
            capabilities,
            engine_start,
            engine_stop,
            engine_status,
            engine_update_config,
            engine_set_mode,
            engine_set_paused,
            engine_load_export,
            engine_airswipe,
            engine_type_text,
            engine_press_key,
            engine_gaze_calibrate,
            airswipe_window_open,
            airswipe_window_close,
            airswipe_window_rect
        ])
        .build(tauri::generate_context!())
        .expect("No se pudo iniciar ZEROTOUCH");
    app.run(|handle, event| {
        // La ventana principal es la raíz de la aplicación: al cerrarla se sale (y se detiene el motor) aunque siga
        // abierta la overlay del teclado. Sin esto el proceso, el motor y la cámara quedaban vivos sin ninguna
        // ventana principal desde la que controlarlos.
        if let tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::Destroyed, .. } = &event {
            if label == MAIN_WINDOW {
                handle.exit(0);
            }
        }
        if matches!(event, tauri::RunEvent::Exit) {
            let shared_engine = handle.state::<SharedEngine>();
            if let Ok(mut mgr) = shared_engine.lock() {
                mgr.stop();
            }
            let shared = handle.state::<Shared>();
            if let Ok(mut guard) = shared.lock() {
                let prior = std::mem::replace(
                    &mut *guard,
                    Err(BridgeError {
                        code: "CLOSED".into(),
                        message: "Aplicación cerrada.".into(),
                    }),
                );
                drop(prior);
            };
        }
    });
}
