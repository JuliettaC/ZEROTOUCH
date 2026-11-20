package cl.zerotouch.mobile;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/**
 * Cliente HTTP de solo lectura para la API ZeroTouch (/api/v1). Java estándar, sin Android: se prueba
 * en la JVM contra un servidor falso. La cookie de sesión vive solo en memoria y la contraseña nunca
 * se guarda. Solo hace login y GET: el teléfono no modifica perfiles ni modos.
 */
public final class ApiClient {
    /** Error de la API o de la red con un código estable y un mensaje para la persona usuaria. */
    public static final class ApiException extends Exception {
        public final int status;
        public final String code;
        public ApiException(int status, String code, String message) { super(message); this.status = status; this.code = code; }
    }

    static final int CONNECT_TIMEOUT_MS = 4000, READ_TIMEOUT_MS = 6000, MAX_BODY = 512 * 1024;
    private final String base;
    private String cookie;

    public ApiClient(String serverUrl) throws ApiException {
        this.base = normalize(serverUrl) + "/api/v1";
    }

    public boolean hasSession() { return cookie != null; }
    public void forgetSession() { cookie = null; }

    /**
     * Valida la dirección del servidor: https a cualquier host, o http solo a una IPv4 privada
     * (10/8, 172.16/12, 192.168/16) o a loopback. Devuelve esquema://host:puerto sin barra final.
     */
    public static String normalize(String serverUrl) throws ApiException {
        URI uri;
        try { uri = new URI(serverUrl == null ? "" : serverUrl.trim()); }
        catch (URISyntaxException bad) { throw new ApiException(0, "DIRECCION_INVALIDA", "La dirección del servidor no es válida."); }
        String scheme = uri.getScheme(), host = uri.getHost();
        String path = uri.getRawPath() == null ? "" : uri.getRawPath();
        if (scheme == null || host == null || uri.getRawUserInfo() != null || uri.getRawQuery() != null
                || uri.getRawFragment() != null || !(path.isEmpty() || path.equals("/")))
            throw new ApiException(0, "DIRECCION_INVALIDA", "Escribe solo esquema, IP y puerto, por ejemplo http://192.168.1.20:3000");
        scheme = scheme.toLowerCase();
        if (scheme.equals("http") && !isPrivateOrLoopbackIpv4(host))
            throw new ApiException(0, "HTTP_NO_PERMITIDO", "HTTP sin cifrar solo se permite hacia una IP de la red local; usa https para otro servidor.");
        if (!scheme.equals("http") && !scheme.equals("https"))
            throw new ApiException(0, "DIRECCION_INVALIDA", "La dirección debe empezar por http:// o https://");
        return scheme + "://" + host + (uri.getPort() > 0 ? ":" + uri.getPort() : "");
    }

    static boolean isPrivateOrLoopbackIpv4(String host) {
        String[] parts = host.split("\\.", -1);
        if (parts.length != 4) return false;
        int[] o = new int[4];
        for (int i = 0; i < 4; i++) {
            if (!parts[i].matches("\\d{1,3}")) return false;
            o[i] = Integer.parseInt(parts[i]);
            if (o[i] > 255) return false;
        }
        return o[0] == 10 || o[0] == 127 || (o[0] == 172 && o[1] >= 16 && o[1] <= 31) || (o[0] == 192 && o[1] == 168);
    }

    /** POST /auth/login. Guarda la cookie zt_session en memoria. */
    public void login(String user, String password) throws ApiException {
        if (user == null || user.trim().isEmpty() || password == null || password.isEmpty())
            throw new ApiException(0, "DATOS_INCOMPLETOS", "Escribe usuario y contraseña.");
        String body = "{\"nombre_usuario\":" + MiniJson.quote(user.trim()) + ",\"contrasena\":" + MiniJson.quote(password) + "}";
        cookie = null;
        Response response = send("POST", "/auth/login", body);
        if (response.status != 200) throw failure(response);
        String session = sessionCookie(response.setCookies);
        if (session == null) throw new ApiException(response.status, "SIN_COOKIE", "El servidor no devolvió una sesión.");
        cookie = session;
    }

    /** GET autenticado; devuelve el JSON ya leído. */
    public Object get(String path) throws ApiException {
        if (cookie == null) throw new ApiException(401, "SESION_INVALIDA", "Inicia sesión.");
        Response response = send("GET", path, null);
        if (response.status == 401) cookie = null;
        if (response.status != 200) throw failure(response);
        return parse(response);
    }

    static String sessionCookie(List<String> setCookies) {
        if (setCookies == null) return null;
        for (String header : setCookies) {
            String first = header.split(";", 2)[0].trim();
            if (first.startsWith("zt_session=") && first.length() > "zt_session=".length()) return first;
        }
        return null;
    }

    private static final class Response {
        final int status; final String body; final List<String> setCookies;
        Response(int status, String body, List<String> setCookies) { this.status = status; this.body = body; this.setCookies = setCookies; }
    }

    private Response send(String method, String path, String body) throws ApiException {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(base + path).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setUseCaches(false);
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setRequestMethod(method);
            connection.setRequestProperty("Accept", "application/json");
            if (cookie != null) connection.setRequestProperty("Cookie", cookie);
            if (body != null) {
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                // Sin modo streaming: con él, la JVM no deja leer el cuerpo de un 401 (código de error de la API).
                try (OutputStream out = connection.getOutputStream()) { out.write(bytes); }
            }
            int status = connection.getResponseCode();
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            if (stream == null && status >= 400) {
                try { stream = connection.getInputStream(); } catch (IOException noBody) { stream = null; }
            }
            Map<String, List<String>> headers = connection.getHeaderFields();
            List<String> setCookies = null;
            for (Map.Entry<String, List<String>> entry : headers.entrySet())
                if (entry.getKey() != null && entry.getKey().equalsIgnoreCase("Set-Cookie")) setCookies = entry.getValue();
            return new Response(status, read(stream), setCookies);
        } catch (java.net.UnknownServiceException blocked) {
            // Android lo lanza cuando la política de red impide HTTP en claro hacia ese host.
            throw new ApiException(0, "HTTP_BLOQUEADO", "Android bloqueó HTTP hacia esa IP: la APK solo lo permite hacia la IP con que se compiló (-PztLanHost).");
        } catch (java.net.SocketTimeoutException slow) {
            throw new ApiException(0, "SIN_CONEXION", "El servidor no respondió a tiempo. ¿Mismo Wi-Fi/hotspot y LAN_HOST activo en el PC?");
        } catch (IOException offline) {
            throw new ApiException(0, "SIN_CONEXION", "No se pudo conectar con el servidor. ¿Mismo Wi-Fi/hotspot y LAN_HOST activo en el PC?");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String read(InputStream stream) throws IOException {
        if (stream == null) return "";
        try (InputStream in = stream) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int n;
            while ((n = in.read(buffer)) != -1) {
                if (out.size() + n > MAX_BODY) throw new IOException("respuesta demasiado grande");
                out.write(buffer, 0, n);
            }
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }

    private static Object parse(Response response) throws ApiException {
        try { return MiniJson.parse(response.body); }
        catch (IllegalArgumentException bad) { throw new ApiException(response.status, "RESPUESTA_INVALIDA", "El servidor respondió algo que no es JSON de ZeroTouch."); }
    }

    private static ApiException failure(Response response) {
        String code = "HTTP_" + response.status, message = "El servidor respondió " + response.status + ".";
        try {
            Map<String, Object> error = MiniJson.object(MiniJson.parse(response.body), "error");
            if (error.get("error") instanceof String) code = (String) error.get("error");
            if (error.get("mensaje") instanceof String) message = (String) error.get("mensaje");
        } catch (IllegalArgumentException notJson) { /* se queda el mensaje genérico */ }
        return new ApiException(response.status, code, message);
    }
}
