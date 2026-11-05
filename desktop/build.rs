fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "register",
            "login",
            "account",
            "logout",
            "profiles",
            "create_profile",
            "update_profile",
            "delete_profile",
            "contexts",
            "create_context",
            "update_context",
            "delete_context",
            "engine_start",
            "engine_stop",
            "engine_status",
            "engine_update_config",
            "engine_set_mode",
            "engine_set_paused",
        ]),
    ))
    .expect("No se pudo generar la política de comandos");
}
