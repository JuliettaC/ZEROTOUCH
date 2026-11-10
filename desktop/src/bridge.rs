use reqwest::{blocking::Client, Method};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use zeroize::Zeroizing;

const DEFAULT_BACKEND_BASE: &str = "http://127.0.0.1:3000";
const SESSION_TTL_SECS: u64 = 8 * 3600;
const SESSION_IDLE_SECS: u64 = 1800;

#[derive(Debug, Clone, Serialize)]
pub struct BridgeError {
    pub code: String,
    pub message: String,
}

fn error(code: &str, message: &str) -> BridgeError {
    BridgeError {
        code: code.into(),
        message: message.into(),
    }
}

type Result<T> = std::result::Result<T, BridgeError>;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Credentials {
    #[serde(alias = "username")]
    pub nombre_usuario: String,
    #[serde(alias = "password")]
    pub contrasena: String,
}

/// Registro y vinculación de correo: mismos tres campos; cualquier otro (p. ej. rol) se rechaza.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Registration {
    #[serde(alias = "username")]
    pub nombre_usuario: String,
    #[serde(alias = "email")]
    pub correo: String,
    #[serde(alias = "password")]
    pub contrasena: String,
}

/// Reenvío de verificación y recuperación de contraseña: solo el correo.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmailRequest {
    #[serde(alias = "email")]
    pub correo: String,
}

/// Respuestas genéricas de cuenta: solo se reenvía al WebView el estado y un mensaje acotado.
fn account_notice(value: &Value) -> Value {
    let mensaje: String = value["data"]["mensaje"]
        .as_str()
        .unwrap_or("Revisa tu correo para continuar.")
        .chars()
        .take(300)
        .collect();
    match value["data"]["estado_verificacion"].as_str() {
        Some("pendiente") => json!({ "estado_verificacion": "pendiente", "mensaje": mensaje }),
        _ => json!({ "mensaje": mensaje }),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ProfileInput {
    #[serde(alias = "nombre")]
    pub name: String,
    #[serde(default, alias = "descripcion")]
    pub description: String,
    #[serde(default)]
    pub version: Option<u64>,
    #[serde(default)]
    #[allow(dead_code)]
    pub gaze: Option<bool>,
    #[serde(default)]
    #[allow(dead_code)]
    pub proximity: Option<bool>,
}

fn default_sensitivity() -> u8 {
    65
}
fn default_stability() -> u8 {
    40
}
fn default_pinch_tolerance() -> u8 {
    50
}
fn default_true() -> bool {
    true
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ContextInput {
    #[serde(alias = "nombre")]
    pub name: String,
    #[serde(default = "default_sensitivity", alias = "sensibilidad_puntero")]
    pub sensitivity: u8,
    #[serde(default = "default_stability", alias = "estabilizacion_puntero")]
    pub stability: u8,
    #[serde(default = "default_pinch_tolerance", alias = "tolerancia_micro_pinza")]
    pub pinch_tolerance: u8,
    #[serde(default = "default_true", alias = "desk_rest_habilitado")]
    pub desk_rest: bool,
    #[serde(default = "default_true")]
    #[allow(dead_code)]
    pub pinch: bool,
    #[serde(default = "default_true")]
    #[allow(dead_code)]
    pub scroll: bool,
    #[serde(default)]
    pub version: Option<u64>,
}

struct Session {
    cookie: Zeroizing<String>,
    csrf: Zeroizing<String>,
    started: Instant,
    last_used: Instant,
}

pub struct Bridge {
    client: Client,
    base: String,
    session: Option<Session>,
}

pub fn validate_loopback_base(raw: &str) -> Result<String> {
    let trimmed = raw.trim().trim_end_matches('/');
    let rest = if let Some(r) = trimmed.strip_prefix("http://") {
        r
    } else if let Some(r) = trimmed.strip_prefix("https://") {
        r
    } else {
        return Err(error(
            "INVALID_CONFIG",
            "El servidor local debe usar protocolo http:// o https://.",
        ));
    };
    if rest.contains('/') || rest.contains('?') || rest.contains('#') || rest.contains('@') {
        return Err(error(
            "INVALID_CONFIG",
            "La dirección base del servidor no debe contener rutas ni credenciales.",
        ));
    }
    let (host, port_opt) = match rest.rsplit_once(':') {
        Some((h, p)) => (h, Some(p)),
        None => (rest, None),
    };
    if host != "127.0.0.1" && host != "localhost" && host != "[::1]" {
        return Err(error(
            "INVALID_CONFIG",
            "El transporte nativo solo permite conexión local (loopback).",
        ));
    }
    if let Some(p) = port_opt {
        let port: u16 = p
            .parse()
            .map_err(|_| error("INVALID_CONFIG", "Puerto local inválido."))?;
        if port == 0 {
            return Err(error("INVALID_CONFIG", "Puerto local inválido."));
        }
    }
    Ok(trimmed.to_string())
}

fn build_http_client() -> Result<Client> {
    Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10))
        .connect_timeout(Duration::from_secs(3))
        .build()
        .map_err(|_| error("TRANSPORT_INIT", "No se pudo inicializar el cliente HTTP nativo."))
}

pub fn parse_session_cookie(header: &str, require_secure: bool) -> Result<String> {
    let parts: Vec<&str> = header.split(';').map(str::trim).collect();
    let first = parts
        .first()
        .copied()
        .ok_or_else(|| error("SESION_INVALIDA", "Cookie de sesión vacía."))?;
    let raw_token = first
        .strip_prefix("zt_session=")
        .ok_or_else(|| error("SESION_INVALIDA", "Cookie zt_session ausente."))?;
    if raw_token.len() != 43
        || !raw_token
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(error(
            "SESION_INVALIDA",
            "Formato de token de sesión inválido.",
        ));
    }
    let attrs: Vec<String> = parts[1..].iter().map(|s| s.to_ascii_lowercase()).collect();
    if !attrs.iter().any(|a| a == "httponly") {
        return Err(error(
            "SESION_INVALIDA",
            "La cookie de sesión debe ser HttpOnly.",
        ));
    }
    if !attrs.iter().any(|a| a == "samesite=strict") {
        return Err(error(
            "SESION_INVALIDA",
            "La cookie de sesión debe declarar SameSite=Strict.",
        ));
    }
    if !attrs.iter().any(|a| a == "path=/api/v1") {
        return Err(error(
            "SESION_INVALIDA",
            "La cookie de sesión debe tener Path=/api/v1.",
        ));
    }
    if require_secure && !attrs.iter().any(|a| a == "secure") {
        return Err(error(
            "SESION_INVALIDA",
            "La cookie de sesión en HTTPS debe declarar Secure.",
        ));
    }
    Ok(first.to_string())
}

fn sanitize_user(user: &Value) -> Result<Value> {
    let id = user["id"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| error("SERVICE_RESPONSE", "Identidad de usuario incompleta."))?;
    let nombre_usuario = user["nombre_usuario"]
        .as_str()
        .or_else(|| user["username"].as_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| error("SERVICE_RESPONSE", "Nombre de usuario ausente."))?;
    let rol = user["rol"].as_str().unwrap_or("user");
    let estado = user["estado"].as_str().unwrap_or("activo");
    let correo_verificado = user["correo_verificado"].as_bool().unwrap_or(false);
    Ok(json!({
        "id": id,
        "nombre_usuario": nombre_usuario,
        "username": nombre_usuario,
        "rol": rol,
        "estado": estado,
        "correo_verificado": correo_verificado,
    }))
}

impl Bridge {
    pub fn new() -> Result<Self> {
        let configured = std::env::var("ZEROTOUCH_BACKEND_URL")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_BACKEND_BASE.to_string());
        Self::with_base(&configured)
    }

    pub fn with_base(base_url: &str) -> Result<Self> {
        let base = validate_loopback_base(base_url)?;
        let client = build_http_client()?;
        Ok(Self {
            client,
            base,
            session: None,
        })
    }

    fn request(
        &mut self,
        method: Method,
        route: &str,
        body: Option<Value>,
        authenticated: bool,
    ) -> Result<(Value, Option<String>)> {
        let mut req = self
            .client
            .request(method.clone(), format!("{}{}", self.base, route));

        if authenticated {
            let expired = self
                .session
                .as_ref()
                .map(|s| {
                    s.started.elapsed() >= Duration::from_secs(SESSION_TTL_SECS)
                        || s.last_used.elapsed() >= Duration::from_secs(SESSION_IDLE_SECS)
                })
                .unwrap_or(true);
            if expired {
                self.session = None;
                return Err(error("SESION_INVALIDA", "Inicia sesión."));
            }
            let s = self.session.as_ref().unwrap();
            req = req.header("Cookie", s.cookie.as_str());
            if !matches!(method, Method::GET | Method::HEAD | Method::OPTIONS) {
                req = req.header("X-CSRF-Token", s.csrf.as_str());
            }
        }

        if let Some(value) = body {
            let text = value.to_string();
            if text.len() > 16384 {
                return Err(error("CUERPO_EXCESIVO", "El cuerpo supera 16 KB."));
            }
            req = req.header("Content-Type", "application/json").body(text);
        }

        let response = req.send().map_err(|_| {
            error(
                "SERVICE_OFFLINE",
                "El servidor de autenticación no está disponible. ZeroTouch continúa funcionando en Modo Local.",
            )
        })?;

        let status = response.status();
        let cookie = response
            .headers()
            .get("set-cookie")
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);

        let mut bytes = Vec::new();
        use std::io::Read;
        response
            .take(1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| error("SERVICE_RESPONSE", "Respuesta del servidor incompleta."))?;
        if bytes.len() > 1024 * 1024 {
            return Err(error(
                "SERVICE_RESPONSE",
                "Respuesta del servidor demasiado grande.",
            ));
        }

        let value = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes)
                .map_err(|_| error("SERVICE_RESPONSE", "Respuesta JSON inválida del servidor."))?
        };

        if !status.is_success() {
            if status.as_u16() == 401 {
                self.session = None;
            }
            let code = value["error"]
                .as_str()
                .or_else(|| value["error"]["code"].as_str())
                .unwrap_or("REQUEST_FAILED");
            let msg = value["mensaje"]
                .as_str()
                .or_else(|| value["error"]["message"].as_str())
                .unwrap_or("No se pudo completar la operación.");
            return Err(error(code, msg));
        }

        if let Some(s) = self.session.as_mut() {
            s.last_used = Instant::now();
        }
        Ok((value, cookie))
    }

    /// 202: la cuenta queda pendiente de verificar el correo; no se inicia sesión.
    pub fn register(&mut self, c: Registration) -> Result<Value> {
        let (value, _) = self.request(
            Method::POST,
            "/api/v1/auth/registro",
            Some(json!({
                "nombre_usuario": c.nombre_usuario,
                "correo": c.correo,
                "contrasena": c.contrasena
            })),
            false,
        )?;
        Ok(account_notice(&value))
    }

    pub fn resend_verification(&mut self, e: EmailRequest) -> Result<Value> {
        let (value, _) = self.request(
            Method::POST,
            "/api/v1/auth/verificacion/reenviar",
            Some(json!({ "correo": e.correo })),
            false,
        )?;
        Ok(account_notice(&value))
    }

    pub fn forgot_password(&mut self, e: EmailRequest) -> Result<Value> {
        let (value, _) = self.request(
            Method::POST,
            "/api/v1/auth/contrasena/olvido",
            Some(json!({ "correo": e.correo })),
            false,
        )?;
        Ok(account_notice(&value))
    }

    /// Cuentas sin correo confirmado (heredadas o con un error al registrarse).
    pub fn link_email(&mut self, c: Registration) -> Result<Value> {
        let (value, _) = self.request(
            Method::POST,
            "/api/v1/auth/correo",
            Some(json!({
                "nombre_usuario": c.nombre_usuario,
                "contrasena": c.contrasena,
                "correo": c.correo
            })),
            false,
        )?;
        Ok(account_notice(&value))
    }

    pub fn login(&mut self, c: Credentials) -> Result<Value> {
        if self.session.is_some() {
            let _ = self.logout();
            self.session = None;
        }
        let (value, cookie_header) = self.request(
            Method::POST,
            "/api/v1/auth/login",
            Some(json!({
                "nombre_usuario": c.nombre_usuario,
                "contrasena": c.contrasena
            })),
            false,
        )?;
        let raw_cookie = cookie_header.ok_or_else(|| {
            error(
                "SESION_INVALIDA",
                "El servidor no entregó una cookie de sesión.",
            )
        })?;
        let token = parse_session_cookie(&raw_cookie, self.base.starts_with("https://"))?;
        let csrf = value["data"]["csrf_token"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or_else(|| error("CSRF_INVALIDO", "El servidor no entregó el token CSRF."))?;
        let user = sanitize_user(&value["data"]["usuario"])?;
        self.session = Some(Session {
            cookie: Zeroizing::new(token),
            csrf: Zeroizing::new(csrf.into()),
            started: Instant::now(),
            last_used: Instant::now(),
        });
        Ok(user)
    }

    pub fn account(&mut self) -> Result<Value> {
        let (value, _) = self.request(Method::GET, "/api/v1/auth/me", None, true)?;
        if let Some(csrf) = value["data"]["csrf_token"].as_str().filter(|s| !s.is_empty()) {
            if let Some(session) = self.session.as_mut() {
                session.csrf = Zeroizing::new(csrf.into());
            }
        }
        sanitize_user(&value["data"]["usuario"])
    }

    pub fn logout(&mut self) -> Result<Value> {
        if self.session.is_none() {
            return Ok(Value::Null);
        }
        let result = self.request(Method::POST, "/api/v1/auth/logout", None, true);
        self.session = None;
        result.map(|_| Value::Null)
    }

    pub fn profiles(&mut self, offset: u32) -> Result<Value> {
        self.request(
            Method::GET,
            &format!("/api/v1/perfiles?limite=100&offset={offset}"),
            None,
            true,
        )
        .map(|r| r.0)
    }

    pub fn create_profile(&mut self, p: ProfileInput) -> Result<Value> {
        self.request(
            Method::POST,
            "/api/v1/perfiles",
            Some(profile_payload(&p, None)),
            true,
        )
        .map(|r| r.0)
    }

    pub fn update_profile(&mut self, id: String, p: ProfileInput) -> Result<Value> {
        let clean_id = valid_id(&id)?;
        let version = match p.version {
            Some(v) => v,
            None => {
                let (existing, _) = self.request(
                    Method::GET,
                    &format!("/api/v1/perfiles/{clean_id}"),
                    None,
                    true,
                )?;
                existing["data"]["version"].as_u64().unwrap_or(1)
            }
        };
        self.request(
            Method::PATCH,
            &format!("/api/v1/perfiles/{clean_id}"),
            Some(profile_payload(&p, Some(version))),
            true,
        )
        .map(|r| r.0)
    }

    pub fn delete_profile(&mut self, id: String) -> Result<Value> {
        let clean_id = valid_id(&id)?;
        self.request(
            Method::DELETE,
            &format!("/api/v1/perfiles/{clean_id}"),
            None,
            true,
        )
        .map(|r| r.0)
    }

    pub fn contexts(&mut self, profile_id: String, offset: u32) -> Result<Value> {
        let clean_id = valid_id(&profile_id)?;
        self.request(
            Method::GET,
            &format!("/api/v1/perfiles/{clean_id}/modos?limite=100&offset={offset}"),
            None,
            true,
        )
        .map(|r| r.0)
    }

    pub fn create_context(&mut self, profile_id: String, c: ContextInput) -> Result<Value> {
        let clean_id = valid_id(&profile_id)?;
        self.request(
            Method::POST,
            &format!("/api/v1/perfiles/{clean_id}/modos"),
            Some(context_payload(&c, None)),
            true,
        )
        .map(|r| r.0)
    }

    pub fn update_context(&mut self, id: String, c: ContextInput) -> Result<Value> {
        let clean_id = valid_id(&id)?;
        let version = match c.version {
            Some(v) => v,
            None => {
                let (existing, _) = self.request(
                    Method::GET,
                    &format!("/api/v1/modos/{clean_id}"),
                    None,
                    true,
                )?;
                existing["data"]["version"].as_u64().unwrap_or(1)
            }
        };
        self.request(
            Method::PATCH,
            &format!("/api/v1/modos/{clean_id}"),
            Some(context_payload(&c, Some(version))),
            true,
        )
        .map(|r| r.0)
    }

    pub fn delete_context(&mut self, id: String) -> Result<Value> {
        let clean_id = valid_id(&id)?;
        self.request(
            Method::DELETE,
            &format!("/api/v1/modos/{clean_id}"),
            None,
            true,
        )
        .map(|r| r.0)
    }
}

fn valid_id(id: &str) -> Result<String> {
    let u =
        uuid::Uuid::parse_str(id).map_err(|_| error("DATOS_INVALIDOS", "Se requiere UUID v4."))?;
    if u.get_version_num() != 4 {
        return Err(error("DATOS_INVALIDOS", "Se requiere UUID v4."));
    }
    Ok(u.to_string())
}

fn profile_payload(p: &ProfileInput, version: Option<u64>) -> Value {
    let mut obj = json!({
        "nombre": p.name,
        "descripcion": p.description,
    });
    if let Some(v) = version {
        obj["version"] = json!(v);
    }
    obj
}

fn context_payload(c: &ContextInput, version: Option<u64>) -> Value {
    let mut obj = json!({
        "nombre": c.name,
        "categoria": "personalizado",
        "plataforma": "pc",
        "sensibilidad_puntero": c.sensitivity.min(100),
        "estabilizacion_puntero": c.stability.min(100),
        "tolerancia_micro_pinza": c.pinch_tolerance.min(100),
        "desk_rest_habilitado": c.desk_rest,
        "asistencia_mirada_habilitada": false,
        "activacion_contextual_movil": false,
    });
    if let Some(v) = version {
        obj["version"] = json!(v);
    }
    obj
}

impl Drop for Bridge {
    fn drop(&mut self) {
        if self.session.is_some() {
            let _ = self.logout();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        io::{BufRead, BufReader},
        path::PathBuf,
        process::{Child, Command, Stdio},
    };

    fn credentials(name: &str) -> Credentials {
        Credentials {
            nombre_usuario: name.into(),
            contrasena: "Ejemplo ficticio de acceso 2026!".into(),
        }
    }

    fn registration(name: &str) -> Registration {
        Registration {
            nombre_usuario: name.into(),
            correo: format!("{}@ejemplo.test", name.to_ascii_lowercase()),
            contrasena: "Ejemplo ficticio de acceso 2026!".into(),
        }
    }

    fn resolve_hito2_repo_root() -> PathBuf {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent().expect("desktop debe estar dentro del proyecto").to_path_buf();
        assert!(root.join("backend/src/routes/authRoutes.js").is_file());
        assert!(root.join("db/schema.sql").is_file());
        root
    }

    struct TestBackend {
        child: Child,
        base: String,
        db_path: PathBuf,
        temp_dir: PathBuf,
    }

    impl TestBackend {
        fn start() -> Self {
            let root = resolve_hito2_repo_root();
            let temp_dir =
                std::env::temp_dir().join(format!("zt-hito2-tauri-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&temp_dir).unwrap();
            let db_path = temp_dir.join("test-hito2.sqlite");

            // Initialize the Hito 2 SQLite schema (v2) using backend/scripts/init-db.js
            let init_out = Command::new("node")
                .arg(root.join("backend/scripts/init-db.js"))
                .current_dir(&root)
                .env("DATABASE_PATH", &db_path)
                .output()
                .expect("No se pudo ejecutar init-db.js");
            assert!(
                init_out.status.success(),
                "Falló la inicialización de SQLite Hito 2: {}",
                String::from_utf8_lossy(&init_out.stderr)
            );
            assert!(db_path.exists(), "El archivo SQLite no fue creado");

            // Start backend/src/server.js on an ephemeral loopback port
            let mut child = Command::new("node")
                .arg(root.join("backend/src/server.js"))
                .current_dir(&root)
                .env("DATABASE_PATH", &db_path)
                .env("HOST", "127.0.0.1")
                .env("PORT", "0")
                .env("NODE_ENV", "test")
                .env("APP_ORIGIN", "http://127.0.0.1:3000")
                .env("SESSION_TTL_SECONDS", "28800")
                // Development mail transport: messages are written as .eml in the temp folder.
                .env("MAIL_TRANSPORT", "archivo")
                .env("MAIL_OUTBOX_DIR", temp_dir.join("correo-saliente"))
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .expect("No se pudo iniciar backend/src/server.js");

            let stdout = child.stdout.take().unwrap();
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            reader
                .read_line(&mut line)
                .expect("No se recibió salida del servidor Hito 2");
            // Expected line: "ZeroTouch API lista en puerto <PORT>"
            let port: u16 = line
                .trim()
                .rsplit(' ')
                .next()
                .and_then(|p| p.parse().ok())
                .expect("No se pudo leer el puerto del servidor Hito 2");

            Self {
                child,
                base: format!("http://127.0.0.1:{port}"),
                db_path,
                temp_dir,
            }
        }

        /// Reads the single-use token from the .eml written by the backend (shared Node helper)
        /// and confirms the email through the same endpoint the account page uses.
        fn verify_email(&self, client: &Client, to: &str) {
            let root = resolve_hito2_repo_root();
            let out = Command::new("node")
                .current_dir(root.join("backend"))
                .args([
                    "--input-type=module",
                    "-e",
                    "import { tokenFromOutbox } from './test/helpers/correo.js'; process.stdout.write(await tokenFromOutbox(process.argv[1], process.argv[2]));",
                ])
                .arg(self.temp_dir.join("correo-saliente"))
                .arg(to)
                .output()
                .unwrap();
            assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
            let token = String::from_utf8(out.stdout).unwrap();
            assert_eq!(token.len(), 43);
            let res = client
                .post(format!("{}/api/v1/auth/verificacion", self.base))
                .header("Content-Type", "application/json")
                .body(json!({ "token": token }).to_string())
                .send()
                .unwrap();
            assert_eq!(res.status().as_u16(), 200);
        }

        fn query_user_count(&self, username: &str) -> u64 {
            let root = resolve_hito2_repo_root();
            let out = Command::new("node")
                .current_dir(root.join("backend"))
                .args([
                    "-e",
                    "const Database=require('better-sqlite3');const db=new Database(process.argv[1],{readonly:true});const row=db.prepare('SELECT count(*) AS n, rol, estado, contrasena_hash FROM usuarios WHERE nombre_usuario=?').get(process.argv[2]);console.log(JSON.stringify(row));db.close();",
                ])
                .arg(&self.db_path)
                .arg(username)
                .output()
                .unwrap();
            assert!(out.status.success());
            let v: Value = serde_json::from_slice(&out.stdout).unwrap();
            if v["n"].as_u64().unwrap_or(0) > 0 {
                assert_eq!(v["rol"], "user");
                assert_eq!(v["estado"], "activo");
                assert!(v["contrasena_hash"]
                    .as_str()
                    .unwrap_or("")
                    .starts_with("$argon2id$"));
            }
            v["n"].as_u64().unwrap_or(0)
        }
    }

    impl Drop for TestBackend {
        fn drop(&mut self) {
            let _ = self.child.kill();
            let _ = self.child.wait();
            let _ = fs::remove_dir_all(&self.temp_dir);
        }
    }

    #[test]
    fn command_bodies_and_loopback_restrictions_are_enforced() {
        assert!(serde_json::from_value::<Credentials>(
            json!({"nombre_usuario":"user","contrasena":"secret","url":"https://example.com"})
        )
        .is_err());
        assert!(serde_json::from_value::<Credentials>(
            json!({"nombre_usuario":"user","contrasena":"secret","rol":"admin"})
        )
        .is_err());
        assert!(serde_json::from_value::<Registration>(
            json!({"nombre_usuario":"user","correo":"a@b.cl","contrasena":"secret","rol":"admin"})
        )
        .is_err());
        assert!(serde_json::from_value::<EmailRequest>(
            json!({"correo":"a@b.cl","url":"https://example.com"})
        )
        .is_err());
        // Only the status and a bounded message reach the WebView.
        let notice = account_notice(&json!({"data":{"estado_verificacion":"pendiente","mensaje":"x".repeat(1000),"token":"secreto"}}));
        assert_eq!(notice["mensaje"].as_str().unwrap().len(), 300);
        assert!(notice.get("token").is_none());
        assert!(valid_id("https://example.com").is_err());
        assert!(validate_loopback_base("https://example.com").is_err());
        assert!(validate_loopback_base("http://127.0.0.1:3000/api/v1").is_err());
        assert!(validate_loopback_base("http://127.0.0.1:3000").is_ok());
    }

    #[test]
    fn offline_first_unavailable_backend_does_not_crash() {
        // Connect to an unused loopback port
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);

        let mut bridge = Bridge::with_base(&format!("http://127.0.0.1:{port}")).unwrap();
        // Calling account without session returns SESION_INVALIDA immediately
        assert_eq!(bridge.account().unwrap_err().code, "SESION_INVALIDA");
        // Calling register/login while backend is offline returns SERVICE_OFFLINE without panicking
        let reg_err = bridge.register(registration("offline_user")).unwrap_err();
        assert_eq!(reg_err.code, "SERVICE_OFFLINE");
        let login_err = bridge.login(credentials("offline_user")).unwrap_err();
        assert_eq!(login_err.code, "SERVICE_OFFLINE");

        // Verify local gesture engine control remains accessible without login or backend
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let motor_dir = crate::engine::resolve_motor_dir(&manifest);
        let mut engine = crate::engine::GestureEngineManager::new(motor_dir);
        let st = engine.get_status();
        assert!(!st.running);
        assert_eq!(st.mode, "OBSERVATION");
        let updated = engine
            .update_config(json!({
                "preferredHand": "LEFT",
                "sensitivity": 75,
                "stability": 55,
                "pinchTolerance": 60,
                "deskRest": true
            }))
            .unwrap();
        assert!(!updated.running);
        assert_eq!(updated.mode, "OBSERVATION");
        let stopped = engine.stop();
        assert!(!stopped.running);
    }

    #[test]
    fn hito2_auth_crud_csrf_and_sqlite_integration() {
        let server = TestBackend::start();
        let mut bridge = Bridge::with_base(&server.base).unwrap();

        // 1. Register a new account from Tauri Bridge: pending email verification, no account data
        let reg = bridge.register(registration("tauri_demo_user")).unwrap();
        assert_eq!(reg["estado_verificacion"], "pendiente");
        assert!(reg.get("id").is_none());
        assert!(reg.get("csrf_token").is_none());
        assert!(reg.get("contrasena_hash").is_none());

        // 2. Confirm the account is stored in the new Hito 2 SQLite database with Argon2id
        assert_eq!(server.query_user_count("tauri_demo_user"), 1);

        // 3. Reject duplicate usernames (409 USUARIO_DUPLICADO)
        let dup = bridge
            .register(Registration {
                correo: "otro@ejemplo.test".into(),
                ..registration("TAURI_DEMO_USER")
            })
            .unwrap_err();
        assert_eq!(dup.code, "USUARIO_DUPLICADO");

        // 3b. An unverified account cannot sign in; the error is the generic one
        let pending = bridge.login(credentials("tauri_demo_user")).unwrap_err();
        assert_eq!(pending.code, "CREDENCIALES_INVALIDAS");
        assert!(bridge.session.is_none());

        // 3c. Resend and recovery answer generically, even for unknown addresses
        let resent = bridge
            .resend_verification(EmailRequest { correo: "nadie@ejemplo.test".into() })
            .unwrap();
        assert!(resent["mensaje"].as_str().unwrap().starts_with("Si existe"));
        assert!(bridge
            .forgot_password(EmailRequest { correo: "nadie@ejemplo.test".into() })
            .is_ok());

        // 3d. Confirm the email with the link received (development .eml outbox)
        server.verify_email(&bridge.client, "tauri_demo_user@ejemplo.test");
        let linked = bridge.link_email(registration("tauri_demo_user")).unwrap_err();
        assert_eq!(linked.code, "CUENTA_YA_VERIFICADA");

        // 4. Reject incorrect passwords (401 CREDENCIALES_INVALIDAS)
        let bad_login = bridge
            .login(Credentials {
                nombre_usuario: "tauri_demo_user".into(),
                contrasena: "Contraseña incorrecta 2026!".into(),
            })
            .unwrap_err();
        assert_eq!(bad_login.code, "CREDENCIALES_INVALIDAS");
        assert!(bridge.session.is_none());

        // 5. Log in successfully
        let logged = bridge.login(credentials("tauri_demo_user")).unwrap();
        assert_eq!(logged["nombre_usuario"], "tauri_demo_user");
        assert_eq!(logged["correo_verificado"], true);
        assert!(logged.get("csrf_token").is_none());
        assert!(bridge.session.is_some());

        // 6. Restore the authenticated session using GET /api/v1/auth/me
        let me = bridge.account().unwrap();
        assert_eq!(me["id"], logged["id"]);
        assert_eq!(me["nombre_usuario"], "tauri_demo_user");
        assert!(me.get("csrf_token").is_none());

        // 7. Verify CSRF protection and profile/mode synchronization in SQLite
        let created_profile = bridge
            .create_profile(ProfileInput {
                name: "Perfil Tauri".into(),
                description: "Sincronizado desde Tauri".into(),
                version: None,
                gaze: None,
                proximity: None,
            })
            .unwrap();
        let profile_id = created_profile["data"]["id"].as_str().unwrap().to_string();

        // Tamper with CSRF token in memory -> mutation must fail with 403 CSRF_INVALIDO
        let valid_csrf = bridge.session.as_ref().unwrap().csrf.clone();
        bridge.session.as_mut().unwrap().csrf = Zeroizing::new("token_csrf_invalido".into());
        let csrf_err = bridge.delete_profile(profile_id.clone()).unwrap_err();
        assert_eq!(csrf_err.code, "CSRF_INVALIDO");
        bridge.session.as_mut().unwrap().csrf = valid_csrf;

        // Create and list a mode (modo_uso) under the profile
        let created_mode = bridge
            .create_context(
                profile_id.clone(),
                ContextInput {
                    name: "Modo Escritorio".into(),
                    sensitivity: 72,
                    stability: 48,
                    pinch_tolerance: 55,
                    desk_rest: true,
                    pinch: true,
                    scroll: true,
                    version: None,
                },
            )
            .unwrap();
        let mode_id = created_mode["data"]["id"].as_str().unwrap().to_string();
        let modes = bridge.contexts(profile_id.clone(), 0).unwrap();
        assert_eq!(modes["data"][0]["nombre"], "Modo Escritorio");
        assert_eq!(modes["data"][0]["sensibilidad_puntero"], 72);

        // Update mode and profile (atomic version increment in Hito 2 backend)
        bridge
            .update_context(
                mode_id.clone(),
                ContextInput {
                    name: "Modo Escritorio Editado".into(),
                    sensitivity: 80,
                    stability: 50,
                    pinch_tolerance: 60,
                    desk_rest: false,
                    pinch: true,
                    scroll: true,
                    version: None,
                },
            )
            .unwrap();
        bridge
            .update_profile(
                profile_id.clone(),
                ProfileInput {
                    name: "Perfil Tauri Editado".into(),
                    description: "Actualizado".into(),
                    version: None,
                    gaze: None,
                    proximity: None,
                },
            )
            .unwrap();

        // Clean up mode and profile
        bridge.delete_context(mode_id).unwrap();
        bridge.delete_profile(profile_id).unwrap();

        // 8. Log out successfully (POST /api/v1/auth/logout with Cookie + X-CSRF-Token)
        bridge.logout().unwrap();
        assert!(bridge.session.is_none());

        // Subsequent /auth/me must fail with SESION_INVALIDA
        assert_eq!(bridge.account().unwrap_err().code, "SESION_INVALIDA");

        // 9. Verify backend rejects unauthorized Origin header (403 ORIGEN_DENEGADO)
        let bad_origin_res = bridge
            .client
            .post(format!("{}/api/v1/auth/login", server.base))
            .header("Origin", "https://tauri.localhost")
            .header("Content-Type", "application/json")
            .body(
                json!({
                    "nombre_usuario": "tauri_demo_user",
                    "contrasena": "Ejemplo ficticio de acceso 2026!"
                })
                .to_string(),
            )
            .send()
            .unwrap();
        assert_eq!(bad_origin_res.status().as_u16(), 403);
    }
}
