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
    /// manual | oficina | accesibilidad | personalizado (se valida en el backend).
    #[serde(default)]
    pub categoria: Option<String>,
    /// asistencia_mirada_habilitada del modo (la asistencia real depende además del equipo).
    #[serde(default, alias = "asistencia_mirada_habilitada")]
    pub gaze_assist: bool,
    /// Lista completa de asignaciones gesto -> acción (semántica de PUT /modos/:id/gestos). Con ella la creación o
    /// la edición del modo y de sus asignaciones es UNA sola solicitud atómica con una sola subida de versión.
    /// Solo debe enviarse a un servidor que anuncie `servidor.modo_con_asignaciones`.
    #[serde(default)]
    pub gestos: Option<Vec<GestureAssignment>>,
    #[serde(default)]
    pub version: Option<u64>,
}

/// Asignación gesto -> acción tal como la recibe PUT /modos/:id/gestos.
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GestureAssignment {
    pub gesto_codigo: String,
    pub accion_codigo: String,
    pub habilitado: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GesturesInput {
    pub version: u64,
    pub gestos: Vec<GestureAssignment>,
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

/// Destinos permitidos del transporte nativo:
/// - `http://` únicamente hacia loopback (desarrollo local);
/// - `https://` hacia un nombre de host o dirección con puerto opcional (servicio remoto), con
///   validación de certificados por las raíces de Mozilla incorporadas (webpki-roots).
/// Nunca rutas, consultas, fragmentos ni credenciales en la dirección base.
pub fn validate_loopback_base(raw: &str) -> Result<String> {
    let trimmed = raw.trim().trim_end_matches('/');
    let (secure, rest) = if let Some(r) = trimmed.strip_prefix("http://") {
        (false, r)
    } else if let Some(r) = trimmed.strip_prefix("https://") {
        (true, r)
    } else {
        return Err(error(
            "INVALID_CONFIG",
            "El servidor debe usar protocolo http:// (solo local) o https://.",
        ));
    };
    if rest.is_empty() || rest.contains('/') || rest.contains('?') || rest.contains('#') || rest.contains('@') || rest.contains(char::is_whitespace) {
        return Err(error(
            "INVALID_CONFIG",
            "La dirección base del servidor no debe contener rutas ni credenciales.",
        ));
    }
    let (host, port_opt) = if rest.starts_with('[') {
        match rest.rsplit_once("]:") {
            Some((h, p)) => (format!("{h}]"), Some(p)),
            None => (rest.to_string(), None),
        }
    } else {
        match rest.rsplit_once(':') {
            Some((h, p)) => (h.to_string(), Some(p)),
            None => (rest.to_string(), None),
        }
    };
    let loopback = host == "127.0.0.1" || host == "localhost" || host == "[::1]";
    if !secure && !loopback {
        return Err(error(
            "INVALID_CONFIG",
            "Sin HTTPS, el transporte nativo solo permite conexión local (loopback).",
        ));
    }
    if host.is_empty() || !host.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '[' | ']' | ':')) {
        return Err(error("INVALID_CONFIG", "Nombre de host inválido."));
    }
    if let Some(p) = port_opt {
        let port: u16 = p
            .parse()
            .map_err(|_| error("INVALID_CONFIG", "Puerto inválido."))?;
        if port == 0 {
            return Err(error("INVALID_CONFIG", "Puerto inválido."));
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
        self.request_with_headers(method, route, body, authenticated, &[])
    }

    /// Igual que `request`, con encabezados fijos adicionales (p. ej. `If-Match` del borrado condicional).
    fn request_with_headers(
        &mut self,
        method: Method,
        route: &str,
        body: Option<Value>,
        authenticated: bool,
        extra_headers: &[(&str, &str)],
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

        for (name, value) in extra_headers {
            req = req.header(*name, *value);
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
        // `Idempotent-Replayed: true`: el servidor devolvió el resultado original de una creación ya hecha.
        let replayed = response
            .headers()
            .get("idempotent-replayed")
            .and_then(|v| v.to_str().ok())
            == Some("true");

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

        let mut value = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes)
                .map_err(|_| error("SERVICE_RESPONSE", "Respuesta JSON inválida del servidor."))?
        };
        if replayed && status.is_success() {
            if let Some(object) = value.as_object_mut() {
                object.insert("repetida".into(), Value::Bool(true));
            }
        }

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

    /// Crea un perfil. Con `idempotency_key` (UUID v7) la creación es idempotente: repetirla con el mismo
    /// cuerpo devuelve el resultado original (con `repetida: true`) sin crear otro perfil.
    pub fn create_profile(
        &mut self,
        p: ProfileInput,
        idempotency_key: Option<String>,
    ) -> Result<Value> {
        let key = idempotency_key.as_deref().map(valid_idempotency_key).transpose()?;
        let headers = idempotency_headers(key.as_deref());
        self.request_with_headers(
            Method::POST,
            "/api/v1/perfiles",
            Some(profile_payload(&p, None)),
            true,
            &headers,
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

    /// Borrado condicional: el backend solo borra (con sus modos y asignaciones) si `if_match` coincide con
    /// el ETag de agregado del perfil; si cambió responde 412 PRECONDICION_FALLIDA y no toca nada.
    pub fn delete_profile(&mut self, id: String, if_match: String) -> Result<Value> {
        let clean_id = valid_id(&id)?;
        let etag = valid_etag(&if_match)?;
        self.request_with_headers(
            Method::DELETE,
            &format!("/api/v1/perfiles/{clean_id}"),
            None,
            true,
            &[("If-Match", etag.as_str())],
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

    /// Crea un modo bajo el perfil. La clave de idempotencia queda ligada también al perfil padre.
    pub fn create_context(
        &mut self,
        profile_id: String,
        c: ContextInput,
        idempotency_key: Option<String>,
    ) -> Result<Value> {
        let clean_id = valid_id(&profile_id)?;
        check_assignments(&c)?;
        let key = idempotency_key.as_deref().map(valid_idempotency_key).transpose()?;
        let headers = idempotency_headers(key.as_deref());
        self.request_with_headers(
            Method::POST,
            &format!("/api/v1/perfiles/{clean_id}/modos"),
            Some(context_payload(&c, None)),
            true,
            &headers,
        )
        .map(|r| r.0)
    }

    pub fn update_context(&mut self, id: String, c: ContextInput) -> Result<Value> {
        let clean_id = valid_id(&id)?;
        check_assignments(&c)?;
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

    /// Borrado condicional del modo: solo procede si `if_match` coincide con su ETag actual (412 si cambió).
    pub fn delete_context(&mut self, id: String, if_match: String) -> Result<Value> {
        let clean_id = valid_id(&id)?;
        let etag = valid_etag(&if_match)?;
        self.request_with_headers(
            Method::DELETE,
            &format!("/api/v1/modos/{clean_id}"),
            None,
            true,
            &[("If-Match", etag.as_str())],
        )
        .map(|r| r.0)
    }

    /// Configuración efectiva del modo (GET /modos/:id/gestos): exportación formato 1 sin credenciales.
    pub fn mode_gestures(&mut self, id: String) -> Result<Value> {
        let clean_id = valid_id(&id)?;
        self.request(
            Method::GET,
            &format!("/api/v1/modos/{clean_id}/gestos"),
            None,
            true,
        )
        .map(|r| r.0)
    }

    /// Reemplaza las asignaciones del modo (PUT /modos/:id/gestos) con la versión conocida.
    pub fn set_mode_gestures(&mut self, id: String, g: GesturesInput) -> Result<Value> {
        let clean_id = valid_id(&id)?;
        if g.gestos.len() > MAX_ASSIGNMENTS {
            return Err(error("DATOS_INVALIDOS", "Demasiadas asignaciones."));
        }
        self.request(
            Method::PUT,
            &format!("/api/v1/modos/{clean_id}/gestos"),
            Some(json!({ "version": g.version, "gestos": g.gestos })),
            true,
        )
        .map(|r| r.0)
    }

    /// Contrato de capacidades publicado por el backend (GET /capacidades).
    pub fn capabilities(&mut self) -> Result<Value> {
        self.request(Method::GET, "/api/v1/capacidades", None, true).map(|r| r.0)
    }

    /// Describe el destino configurado (sin secretos): local o remoto, y si usa HTTPS.
    pub fn backend_info(&mut self) -> Result<Value> {
        let secure = self.base.starts_with("https://");
        let host = self.base.trim_start_matches("https://").trim_start_matches("http://");
        let local = host.starts_with("127.0.0.1") || host.starts_with("localhost") || host.starts_with("[::1]");
        Ok(json!({ "base": self.base, "https": secure, "local": local, "sesion": self.session.is_some() }))
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

/// ETag fuerte del backend para el borrado condicional: una sola cadena entre comillas dobles de 16 a 64
/// caracteres base64url. Sin ella no se envía ningún DELETE: la interfaz nunca borra sin precondición.
fn valid_etag(value: &str) -> Result<String> {
    let inner = value
        .strip_prefix('"')
        .and_then(|v| v.strip_suffix('"'))
        .unwrap_or("");
    if (16..=64).contains(&inner.len())
        && inner
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        Ok(value.to_string())
    } else {
        Err(error(
            "DATOS_INVALIDOS",
            "Se requiere el ETag (If-Match) del recurso que se va a borrar.",
        ))
    }
}

/// Clave de idempotencia: UUID v7 canónico (minúsculas y con guiones). Cualquier otra forma se rechaza antes de
/// enviar nada: el servidor la rechazaría igual y una clave mal formada nunca debe viajar como si protegiera.
fn valid_idempotency_key(key: &str) -> Result<String> {
    let invalid = || {
        error(
            "DATOS_INVALIDOS",
            "La clave de idempotencia debe ser un UUID v7 en minúsculas.",
        )
    };
    let parsed = uuid::Uuid::parse_str(key).map_err(|_| invalid())?;
    if parsed.get_version_num() != 7 || parsed.hyphenated().to_string() != key {
        return Err(invalid());
    }
    Ok(key.to_string())
}

fn idempotency_headers(key: Option<&str>) -> Vec<(&'static str, &str)> {
    key.map(|k| vec![("Idempotency-Key", k)]).unwrap_or_default()
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
    let categoria = match c.categoria.as_deref() {
        Some(value @ ("manual" | "oficina" | "accesibilidad" | "personalizado")) => value,
        _ => "personalizado",
    };
    let mut obj = json!({
        "nombre": c.name,
        "categoria": categoria,
        "plataforma": "pc",
        "sensibilidad_puntero": c.sensitivity.min(100),
        "estabilizacion_puntero": c.stability.min(100),
        "tolerancia_micro_pinza": c.pinch_tolerance.min(100),
        "desk_rest_habilitado": c.desk_rest,
        "asistencia_mirada_habilitada": c.gaze_assist,
        "activacion_contextual_movil": false,
    });
    if let Some(v) = version {
        obj["version"] = json!(v);
    }
    if let Some(gestos) = &c.gestos {
        obj["gestos"] = json!(gestos);
    }
    obj
}

/// Gestos del contrato (contracts/capacidades.json): 8 desde que se retiraron barridos, pulgares y precisión
/// (24-11-2026). Nunca se envían más asignaciones que gestos; el backend valida el resto.
const MAX_ASSIGNMENTS: usize = 8;

/// Como en `set_mode_gestures`: nunca más de MAX_ASSIGNMENTS asignaciones (una por gesto).
fn check_assignments(c: &ContextInput) -> Result<()> {
    if c.gestos.as_ref().is_some_and(|g| g.len() > MAX_ASSIGNMENTS) {
        return Err(error("DATOS_INVALIDOS", "Demasiadas asignaciones."));
    }
    Ok(())
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

    /// ETag vigente de un recurso, leído directamente (el puente no expone encabezados de respuesta).
    fn etag_of(bridge: &Bridge, route: &str) -> String {
        let session = bridge.session.as_ref().unwrap();
        let response = bridge
            .client
            .get(format!("{}{}", bridge.base, route))
            .header("Cookie", session.cookie.as_str())
            .send()
            .unwrap();
        assert!(response.status().is_success(), "GET {route}");
        response
            .headers()
            .get("etag")
            .expect("el backend debe entregar ETag")
            .to_str()
            .unwrap()
            .to_string()
    }

    /// UUID v7 con la hora actual en los 48 bits altos, como el que genera la interfaz (el crate no activa `v7`).
    fn uuid_v7_now() -> String {
        let ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let hex = format!("{ms:012x}");
        let random = uuid::Uuid::new_v4().simple().to_string();
        format!(
            "{}-{}-7{}-8{}-{}",
            &hex[..8],
            &hex[8..12],
            &random[..3],
            &random[3..6],
            &random[6..18]
        )
    }

    fn sample_profile(name: &str) -> ProfileInput {
        ProfileInput {
            name: name.into(),
            description: "Prueba de idempotencia".into(),
            version: None,
            gaze: None,
            proximity: None,
        }
    }

    fn sample_context(name: &str) -> ContextInput {
        ContextInput {
            name: name.into(),
            sensitivity: 60,
            stability: 40,
            pinch_tolerance: 50,
            desk_rest: false,
            pinch: true,
            scroll: true,
            categoria: None,
            gaze_assist: false,
            gestos: None,
            version: None,
        }
    }

    #[test]
    fn idempotency_key_must_be_a_canonical_uuid_v7() {
        let good = uuid_v7_now();
        assert_eq!(valid_idempotency_key(&good).unwrap(), good);
        assert_eq!(good.len(), 36);
        for bad in [
            uuid::Uuid::new_v4().to_string(),
            good.to_uppercase(),
            good.replace('-', ""),
            format!("{good}x"),
            format!("{good}\r\nX-Inyectado: 1"),
            String::new(),
            "no-es-uuid".to_string(),
        ] {
            assert_eq!(
                valid_idempotency_key(&bad).unwrap_err().code,
                "DATOS_INVALIDOS",
                "{bad:?}"
            );
        }
        assert!(idempotency_headers(None).is_empty());
        assert_eq!(idempotency_headers(Some(&good)), vec![("Idempotency-Key", good.as_str())]);
    }

    #[test]
    fn conditional_delete_requires_a_strong_etag() {
        let valid = "\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\"";
        assert_eq!(valid_etag(valid).unwrap(), valid);
        for bad in [
            "",
            "*",
            "sin-comillas-sin-comillas-sin-comillas",
            "W/\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\"",
            "\"corto\"",
            "\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\", \"BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB\"",
            "\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\r\nX-Inyectado: 1\"",
        ] {
            assert_eq!(valid_etag(bad).unwrap_err().code, "DATOS_INVALIDOS", "{bad:?}");
        }
        // Sin sesión ni ETag válido no se llega a enviar nada.
        let mut bridge = Bridge::with_base("http://127.0.0.1:9").unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        assert_eq!(
            bridge.delete_profile(id.clone(), "x".into()).unwrap_err().code,
            "DATOS_INVALIDOS"
        );
        assert_eq!(
            bridge.delete_context(id, "x".into()).unwrap_err().code,
            "DATOS_INVALIDOS"
        );
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
        assert!(validate_loopback_base("http://example.com").is_err(), "sin HTTPS solo loopback");
        assert!(validate_loopback_base("https://example.com").is_ok(), "remoto solo con HTTPS");
        assert!(validate_loopback_base("https://api.ejemplo.test:8443").is_ok());
        assert!(validate_loopback_base("https://user:pw@example.com").is_err());
        assert!(validate_loopback_base("https://example.com/api/v1").is_err());
        assert!(validate_loopback_base("ftp://example.com").is_err());
        assert!(validate_loopback_base("http://127.0.0.1:3000/api/v1").is_err());
        assert!(validate_loopback_base("http://127.0.0.1:3000").is_ok());
        assert!(validate_loopback_base("http://[::1]:3000").is_ok());
        assert!(serde_json::from_value::<GesturesInput>(json!({"version": 1, "gestos": [{"gesto_codigo": "micro_pinza", "accion_codigo": "clic", "habilitado": true, "shell": "calc"}]})).is_err());
        assert!(serde_json::from_value::<ContextInput>(json!({"name": "x", "categoria": "manual", "gazeAssist": true})).is_ok());
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

        // 3b. An unverified account cannot sign in; with the right password it is told to confirm
        let pending = bridge.login(credentials("tauri_demo_user")).unwrap_err();
        assert_eq!(pending.code, "CUENTA_NO_VERIFICADA");
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

        // 4b. Sign in with the email instead of the user name
        let by_email = bridge
            .login(Credentials {
                nombre_usuario: "tauri_demo_user@ejemplo.test".into(),
                contrasena: "Ejemplo ficticio de acceso 2026!".into(),
            })
            .unwrap();
        assert_eq!(by_email["nombre_usuario"], "tauri_demo_user");

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
            .create_profile(
                ProfileInput {
                    name: "Perfil Tauri".into(),
                    description: "Sincronizado desde Tauri".into(),
                    version: None,
                    gaze: None,
                    proximity: None,
                },
                None,
            )
            .unwrap();
        let profile_id = created_profile["data"]["id"].as_str().unwrap().to_string();
        assert!(created_profile.get("repetida").is_none(), "sin clave no hay repetición");

        // 7b. Creación idempotente de un perfil y de un modo, de extremo a extremo contra el backend real.
        let key = uuid_v7_now();
        let idem_profile = bridge
            .create_profile(sample_profile("Perfil idempotente"), Some(key.clone()))
            .unwrap();
        assert!(idem_profile.get("repetida").is_none(), "la primera vez se crea");
        let idem_id = idem_profile["data"]["id"].as_str().unwrap().to_string();
        let replay = bridge
            .create_profile(sample_profile("Perfil idempotente"), Some(key.clone()))
            .unwrap();
        assert_eq!(replay["repetida"], true, "la repetición se marca");
        assert_eq!(replay["data"]["id"], idem_profile["data"]["id"]);
        assert_eq!(replay["data"]["version"], idem_profile["data"]["version"]);
        let clash = bridge
            .create_profile(sample_profile("Otro nombre"), Some(key.clone()))
            .unwrap_err();
        assert_eq!(clash.code, "IDEMPOTENCIA_CONFLICTO");
        let listed = bridge.profiles(0).unwrap();
        assert_eq!(listed["data"].as_array().unwrap().len(), 2, "no se creó un tercer perfil");

        let mode_key = uuid_v7_now();
        let idem_mode = bridge
            .create_context(idem_id.clone(), sample_context("Modo idempotente"), Some(mode_key.clone()))
            .unwrap();
        let mode_replay = bridge
            .create_context(idem_id.clone(), sample_context("Modo idempotente"), Some(mode_key.clone()))
            .unwrap();
        assert_eq!(mode_replay["repetida"], true);
        assert_eq!(mode_replay["data"]["id"], idem_mode["data"]["id"]);
        assert_eq!(
            bridge.contexts(idem_id.clone(), 0).unwrap()["data"].as_array().unwrap().len(),
            1,
            "un solo modo pese a la repetición"
        );
        // La clave del modo queda ligada a su perfil padre: usarla en otro perfil es un conflicto.
        let wrong_parent = bridge
            .create_context(profile_id.clone(), sample_context("Modo idempotente"), Some(mode_key))
            .unwrap_err();
        assert_eq!(wrong_parent.code, "IDEMPOTENCIA_CONFLICTO");

        // Una clave mal formada ni siquiera se envía (el contador de perfiles no cambia).
        for bad in [uuid::Uuid::new_v4().to_string(), key.to_uppercase(), "no-es-uuid".into(), String::new()] {
            assert_eq!(
                bridge
                    .create_profile(sample_profile("No debe crearse"), Some(bad))
                    .unwrap_err()
                    .code,
                "DATOS_INVALIDOS"
            );
        }
        assert_eq!(bridge.profiles(0).unwrap()["data"].as_array().unwrap().len(), 2);
        // Limpieza del perfil idempotente (borra también su modo) con el ETag vigente.
        let idem_tag = etag_of(&bridge, &format!("/api/v1/perfiles/{idem_id}"));
        bridge.delete_profile(idem_id, idem_tag).unwrap();

        // Tamper with CSRF token in memory -> mutation must fail with 403 CSRF_INVALIDO
        let valid_csrf = bridge.session.as_ref().unwrap().csrf.clone();
        bridge.session.as_mut().unwrap().csrf = Zeroizing::new("token_csrf_invalido".into());
        let profile_tag = etag_of(&bridge, &format!("/api/v1/perfiles/{profile_id}"));
        let csrf_err = bridge
            .delete_profile(profile_id.clone(), profile_tag)
            .unwrap_err();
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
                    categoria: None,
                    gaze_assist: false,
                    gestos: None,
                    version: None,
                },
                None,
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
                    categoria: None,
                    gaze_assist: false,
                    gestos: None,
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

        // 7c. Mutación conjunta: el modo y sus asignaciones en UNA solicitud atómica y UNA sola subida de versión.
        let caps = bridge.capabilities().unwrap();
        assert_eq!(caps["data"]["servidor"]["modo_con_asignaciones"], true);
        let catalog = caps["data"]["gestos"].as_object().unwrap().clone();
        let assignments = |disabled: &str| -> Vec<GestureAssignment> {
            let mut codes: Vec<&String> = catalog.keys().collect();
            codes.sort();
            codes
                .into_iter()
                .map(|code| GestureAssignment {
                    gesto_codigo: code.clone(),
                    accion_codigo: catalog[code]["predeterminada"].as_str().unwrap().to_string(),
                    habilitado: code != disabled,
                })
                .collect()
        };
        let joint = bridge
            .create_context(
                profile_id.clone(),
                ContextInput {
                    gestos: Some(assignments("micro_pinza")),
                    ..sample_context("Modo conjunto")
                },
                None,
            )
            .unwrap();
        let joint_id = joint["data"]["id"].as_str().unwrap().to_string();
        assert_eq!(joint["data"]["version"], 1, "creado con sus asignaciones: versión 1");
        let effective = bridge.mode_gestures(joint_id.clone()).unwrap();
        assert_eq!(effective["data"]["modo"]["version"], 1);
        let micro = effective["data"]["gestos"]
            .as_array()
            .unwrap()
            .iter()
            .find(|g| g["gesto_codigo"] == "micro_pinza")
            .unwrap()
            .clone();
        assert_eq!(micro["habilitado"], false);
        assert_eq!(micro["asignacion_version"], 1);
        // Edición conjunta: campos y asignaciones juntos, una sola subida de versión.
        let edited = bridge
            .update_context(
                joint_id.clone(),
                ContextInput {
                    version: Some(1),
                    gestos: Some(assignments("palma_abierta")),
                    ..sample_context("Modo conjunto editado")
                },
            )
            .unwrap();
        assert_eq!(edited["data"]["version"], 2, "antes eran dos solicitudes y dos subidas");
        // Una asignación inválida rechaza TODO: ni el nombre ni las asignaciones ni la versión cambian.
        let mut invalid_list = assignments("micro_pinza");
        invalid_list[0].accion_codigo = "no_existe".into();
        let rejected = bridge
            .update_context(
                joint_id.clone(),
                ContextInput {
                    version: Some(2),
                    gestos: Some(invalid_list),
                    ..sample_context("No debe aplicarse")
                },
            )
            .unwrap_err();
        assert_eq!(rejected.code, "DATOS_INVALIDOS");
        let unchanged = bridge.mode_gestures(joint_id.clone()).unwrap();
        assert_eq!(unchanged["data"]["modo"]["version"], 2);
        assert_eq!(unchanged["data"]["modo"]["nombre"], "Modo conjunto editado");
        // Más asignaciones que gestos ni siquiera se envían.
        let mut too_many = assignments("micro_pinza");
        too_many.push(GestureAssignment {
            gesto_codigo: "extra".into(),
            accion_codigo: "sin_accion".into(),
            habilitado: true,
        });
        assert_eq!(
            bridge
                .update_context(
                    joint_id.clone(),
                    ContextInput {
                        version: Some(2),
                        gestos: Some(too_many),
                        ..sample_context("Tampoco")
                    },
                )
                .unwrap_err()
                .code,
            "DATOS_INVALIDOS"
        );
        let joint_tag = etag_of(&bridge, &format!("/api/v1/modos/{joint_id}"));
        bridge.delete_context(joint_id, joint_tag).unwrap();

        // Borrado condicional: sin ETag válido no se envía nada y un ETag obsoleto no borra.
        let bogus = "\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\"".to_string();
        assert_eq!(
            bridge
                .delete_profile(profile_id.clone(), "sin-etag".into())
                .unwrap_err()
                .code,
            "DATOS_INVALIDOS"
        );
        assert_eq!(
            bridge
                .delete_profile(profile_id.clone(), bogus.clone())
                .unwrap_err()
                .code,
            "PRECONDICION_FALLIDA"
        );
        assert_eq!(
            bridge
                .delete_context(mode_id.clone(), bogus)
                .unwrap_err()
                .code,
            "PRECONDICION_FALLIDA"
        );
        assert!(etag_of(&bridge, &format!("/api/v1/modos/{mode_id}")).starts_with('"'));

        // Clean up mode and profile con el ETag vigente
        let mode_tag = etag_of(&bridge, &format!("/api/v1/modos/{mode_id}"));
        bridge.delete_context(mode_id, mode_tag).unwrap();
        let profile_tag = etag_of(&bridge, &format!("/api/v1/perfiles/{profile_id}"));
        bridge.delete_profile(profile_id, profile_tag).unwrap();

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
