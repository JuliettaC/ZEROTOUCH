#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod engine;

use bridge::{Bridge, BridgeError, ContextInput, Credentials, ProfileInput};
use engine::{resolve_motor_dir, EngineStatus, GestureEngineManager};
use serde_json::Value;
use std::sync::{Arc, Mutex};
use tauri::Manager;

type Shared = Arc<Mutex<Result<Bridge, BridgeError>>>;
type SharedEngine = Arc<Mutex<GestureEngineManager>>;

fn verify_origin(window: &tauri::WebviewWindow) -> Result<(), BridgeError> {
    if window.label() != "main"
        || window
            .url()
            .ok()
            .map(|u| u.origin().ascii_serialization())
            != Some("https://tauri.localhost".into())
    {
        return Err(BridgeError {
            code: "FORBIDDEN".into(),
            message: "Origen no autorizado.".into(),
        });
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
endpoint!(register, c:Credentials);
endpoint!(login, c:Credentials);
endpoint!(account);
endpoint!(logout);
endpoint!(profiles, offset:u32);
endpoint!(create_profile, p:ProfileInput);
endpoint!(update_profile, id:String, p:ProfileInput);
endpoint!(delete_profile, id:String);
endpoint!(contexts, profile_id:String, offset:u32);
endpoint!(create_context, profile_id:String, c:ContextInput);
endpoint!(update_context, id:String, c:ContextInput);
endpoint!(delete_context, id:String);

#[tauri::command]
async fn engine_start(
    window: tauri::WebviewWindow,
    engine: tauri::State<'_, SharedEngine>,
    config: Option<Value>,
) -> Result<EngineStatus, BridgeError> {
    verify_origin(&window)?;
    let shared = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut mgr = shared.lock().map_err(|_| BridgeError {
            code: "ENGINE_LOCK".into(),
            message: "No se pudo acceder al motor gestual.".into(),
        })?;
        mgr.start(config)
    })
    .await
    .map_err(|_| BridgeError {
        code: "ENGINE_ERROR".into(),
        message: "Fallo al iniciar el motor gestual.".into(),
    })?
}

#[tauri::command]
async fn engine_stop(
    window: tauri::WebviewWindow,
    engine: tauri::State<'_, SharedEngine>,
) -> Result<EngineStatus, BridgeError> {
    verify_origin(&window)?;
    let shared = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut mgr = shared.lock().map_err(|_| BridgeError {
            code: "ENGINE_LOCK".into(),
            message: "No se pudo acceder al motor gestual.".into(),
        })?;
        Ok(mgr.stop())
    })
    .await
    .map_err(|_| BridgeError {
        code: "ENGINE_ERROR".into(),
        message: "Fallo al detener el motor gestual.".into(),
    })?
}

#[tauri::command]
async fn engine_status(
    window: tauri::WebviewWindow,
    engine: tauri::State<'_, SharedEngine>,
) -> Result<EngineStatus, BridgeError> {
    verify_origin(&window)?;
    let shared = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut mgr = shared.lock().map_err(|_| BridgeError {
            code: "ENGINE_LOCK".into(),
            message: "No se pudo acceder al motor gestual.".into(),
        })?;
        Ok(mgr.get_status())
    })
    .await
    .map_err(|_| BridgeError {
        code: "ENGINE_ERROR".into(),
        message: "Fallo al consultar el estado del motor gestual.".into(),
    })?
}

#[tauri::command]
async fn engine_update_config(
    window: tauri::WebviewWindow,
    engine: tauri::State<'_, SharedEngine>,
    config: Value,
) -> Result<EngineStatus, BridgeError> {
    verify_origin(&window)?;
    let shared = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut mgr = shared.lock().map_err(|_| BridgeError {
            code: "ENGINE_LOCK".into(),
            message: "No se pudo acceder al motor gestual.".into(),
        })?;
        mgr.update_config(config)
    })
    .await
    .map_err(|_| BridgeError {
        code: "ENGINE_ERROR".into(),
        message: "Fallo al actualizar la configuración del motor gestual.".into(),
    })?
}

#[tauri::command]
async fn engine_set_mode(
    window: tauri::WebviewWindow,
    engine: tauri::State<'_, SharedEngine>,
    mode: String,
) -> Result<EngineStatus, BridgeError> {
    verify_origin(&window)?;
    let shared = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut mgr = shared.lock().map_err(|_| BridgeError {
            code: "ENGINE_LOCK".into(),
            message: "No se pudo acceder al motor gestual.".into(),
        })?;
        mgr.set_mode(mode)
    })
    .await
    .map_err(|_| BridgeError {
        code: "ENGINE_ERROR".into(),
        message: "Fallo al cambiar el modo del motor gestual.".into(),
    })?
}

#[tauri::command]
async fn engine_set_paused(
    window: tauri::WebviewWindow,
    engine: tauri::State<'_, SharedEngine>,
    paused: bool,
) -> Result<EngineStatus, BridgeError> {
    verify_origin(&window)?;
    let shared = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut mgr = shared.lock().map_err(|_| BridgeError {
            code: "ENGINE_LOCK".into(),
            message: "No se pudo acceder al motor gestual.".into(),
        })?;
        mgr.set_paused(paused)
    })
    .await
    .map_err(|_| BridgeError {
        code: "ENGINE_ERROR".into(),
        message: "Fallo al pausar o reanudar el motor gestual.".into(),
    })?
}

#[tauri::command]
async fn engine_load_export(
    window: tauri::WebviewWindow,
    engine: tauri::State<'_, SharedEngine>,
    document: Value,
    runtime: Option<Value>,
) -> Result<Value, BridgeError> {
    verify_origin(&window)?;
    let shared = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut mgr = shared.lock().map_err(|_| BridgeError {
            code: "ENGINE_LOCK".into(),
            message: "No se pudo acceder al motor gestual.".into(),
        })?;
        mgr.load_export(document, runtime)
    })
    .await
    .map_err(|_| BridgeError {
        code: "ENGINE_ERROR".into(),
        message: "Fallo al cargar la configuración en el motor gestual.".into(),
    })?
}

fn main() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            let motor_dir = resolve_motor_dir(&manifest_dir);
            app.manage(Arc::new(Mutex::new(Bridge::new())));
            app.manage(Arc::new(Mutex::new(GestureEngineManager::new(motor_dir))));
            Ok(())
        })
        .on_page_load(|window, payload| {
            #[cfg(feature = "vertical-smoke")]
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                let _ = window.eval(include_str!("../tests/vertical-smoke.js"));
            }
            #[cfg(not(feature = "vertical-smoke"))]
            let _ = (window, payload);
        })
        .invoke_handler(tauri::generate_handler![
            register,
            login,
            account,
            logout,
            profiles,
            create_profile,
            update_profile,
            delete_profile,
            contexts,
            create_context,
            update_context,
            delete_context,
            engine_start,
            engine_stop,
            engine_status,
            engine_update_config,
            engine_set_mode,
            engine_set_paused,
            engine_load_export
        ])
        .build(tauri::generate_context!())
        .expect("No se pudo iniciar ZEROTOUCH");
    app.run(|handle, event| {
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
