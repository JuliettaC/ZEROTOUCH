package cl.zerotouch.mobile;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * JVM tests for reading the mobile mode from the API: JSON parsing (with responses captured from the
 * real backend, see docs/movil-contrato.md), address validation, cookie handling, the full flow against
 * a fake HTTP server, and the safe reconfiguration of GestureGate. No Android runtime.
 */
public final class ModeLoaderTest {
    private static int checks;
    private static void check(boolean condition, String name) { checks++; if (!condition) throw new AssertionError(name); }
    private static boolean throwsIllegal(Runnable r) { try { r.run(); return false; } catch (IllegalArgumentException e) { return true; } }
    private static String rejected(String url) {
        try { ApiClient.normalize(url); return null; } catch (ApiClient.ApiException e) { return e.code; }
    }

    /** Fake API: one verified user, real captured bodies for the reads. */
    static final class FakeApi {
        final HttpServer server;
        final AtomicInteger logins = new AtomicInteger(), gets = new AtomicInteger();
        volatile String perfiles, modos, gestos;
        volatile boolean expireOnce, garbage;
        volatile String validSession = "zt_session=abc123";
        FakeApi(String perfiles, String modos, String gestos) throws IOException {
            this.perfiles = perfiles; this.modos = modos; this.gestos = gestos;
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/api/v1/", this::handle);
            server.start();
        }
        String url() { return "http://127.0.0.1:" + server.getAddress().getPort(); }
        void handle(HttpExchange ex) throws IOException {
            String path = ex.getRequestURI().getPath();
            String body = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            if (path.equals("/api/v1/auth/login") && ex.getRequestMethod().equals("POST")) {
                logins.incrementAndGet();
                Map<String, Object> login = MiniJson.object(MiniJson.parse(body), "login");
                if ("demo_movil".equals(login.get("nombre_usuario")) && "Receta-Demo-2026".equals(login.get("contrasena"))) {
                    ex.getResponseHeaders().add("Set-Cookie", validSession + "; Max-Age=28800; Path=/api/v1; HttpOnly; SameSite=Strict");
                    send(ex, 200, "{\"data\":{\"usuario\":{\"id\":\"x\"},\"csrf_token\":\"t\"}}");
                } else send(ex, 401, "{\"error\":\"CREDENCIALES_INVALIDAS\",\"mensaje\":\"Correo, usuario o contraseña incorrectos.\"}");
                return;
            }
            gets.incrementAndGet();
            if (!ex.getRequestMethod().equals("GET")) { send(ex, 405, "{}"); return; }
            String cookie = ex.getRequestHeaders().getFirst("Cookie");
            if (expireOnce) { expireOnce = false; validSession = "zt_session=renovada" + logins.get(); }
            if (!validSession.equals(cookie)) { send(ex, 401, "{\"error\":\"SESION_INVALIDA\",\"mensaje\":\"Inicia sesión.\"}"); return; }
            if (garbage) { send(ex, 200, "<html>proxy</html>"); return; }
            if (path.equals("/api/v1/perfiles")) send(ex, 200, perfiles);
            else if (path.matches("/api/v1/perfiles/[^/]+/modos")) send(ex, 200, modos);
            else if (path.matches("/api/v1/modos/[^/]+/gestos")) send(ex, 200, gestos);
            else send(ex, 404, "{\"error\":\"RUTA_NO_ENCONTRADA\",\"mensaje\":\"No existe.\"}");
        }
        static void send(HttpExchange ex, int status, String body) throws IOException {
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            ex.getResponseHeaders().add("Content-Type", "application/json; charset=utf-8");
            ex.sendResponseHeaders(status, bytes.length);
            try (OutputStream out = ex.getResponseBody()) { out.write(bytes); }
        }
    }

    public static void main(String[] args) throws Exception {
        Path fixtures = Path.of(args.length > 0 ? args[0] : "android/tests/fixtures");
        String perfiles = Files.readString(fixtures.resolve("perfiles.json"), StandardCharsets.UTF_8);
        String modos = Files.readString(fixtures.resolve("modos-perfil.json"), StandardCharsets.UTF_8);
        String gestos = Files.readString(fixtures.resolve("gestos-modo-movil.json"), StandardCharsets.UTF_8);

        // --- MiniJson
        Map<String, Object> o = MiniJson.object(MiniJson.parse(" {\"a\":[1,-2.5e1,true,false,null],\"b\":\"t\\u00e9l\\n\\\"x\\\"\",\"c\":{}} "), "o");
        List<Object> a = MiniJson.list(o.get("a"), "a");
        check(a.size() == 5 && a.get(0).equals(1.0) && a.get(1).equals(-25.0) && a.get(2).equals(true) && a.get(4) == null, "json array values");
        check("tél\n\"x\"".equals(o.get("b")), "json escapes and unicode");
        check(MiniJson.object(o.get("c"), "c").isEmpty(), "json empty object");
        check(throwsIllegal(() -> MiniJson.parse("{\"a\":1} x")), "json rejects trailing text");
        check(throwsIllegal(() -> MiniJson.parse("{\"a\":}")), "json rejects missing value");
        check(throwsIllegal(() -> MiniJson.parse("<html>")), "json rejects html");
        check(throwsIllegal(() -> MiniJson.parse("\"abc")), "json rejects open string");
        check(throwsIllegal(() -> MiniJson.parse("[".repeat(40) + "]".repeat(40))), "json depth limit");
        check(throwsIllegal(() -> MiniJson.parse("")), "json rejects empty");
        String tricky = "co\"mi\\lla\n\u0001ñ";
        check(tricky.equals(MiniJson.parse(MiniJson.quote(tricky))), "quote round trip");
        check("Receta en el teléfono".equals(MiniJson.object(MiniJson.list(MiniJson.object(MiniJson.parse(modos), "m").get("data"), "d").get(0), "m0").get("nombre")),
            "real response keeps accents");

        // --- Address validation: http only towards a private/loopback IPv4
        check(ApiClient.normalize("http://192.168.1.20:3000").equals("http://192.168.1.20:3000"), "lan http ok");
        check(ApiClient.normalize(" http://10.0.0.5:3000/ ").equals("http://10.0.0.5:3000"), "trailing slash and spaces");
        check(ApiClient.normalize("http://172.20.4.1:3000").equals("http://172.20.4.1:3000"), "172.16/12 ok");
        check(ApiClient.normalize("HTTPS://api.example.com").equals("https://api.example.com"), "https any host");
        check("HTTP_NO_PERMITIDO".equals(rejected("http://example.com:3000")), "http to a name refused");
        check("HTTP_NO_PERMITIDO".equals(rejected("http://8.8.8.8:3000")), "http to public ip refused");
        check("HTTP_NO_PERMITIDO".equals(rejected("http://172.32.0.1:3000")), "172.32 is public");
        check(rejected("http://192.168.1.300:3000") != null, "octet over 255");
        check(!ApiClient.isPrivateOrLoopbackIpv4("192.168.1.300") && !ApiClient.isPrivateOrLoopbackIpv4("192.168.1"), "ipv4 check strict");
        check("DIRECCION_INVALIDA".equals(rejected("ftp://192.168.1.2")), "other scheme refused");
        check("DIRECCION_INVALIDA".equals(rejected("http://192.168.1.2:3000/api/v1")), "path refused");
        check("DIRECCION_INVALIDA".equals(rejected("http://u:p@192.168.1.2:3000")), "userinfo refused");
        check("DIRECCION_INVALIDA".equals(rejected("192.168.1.2:3000")), "scheme required");
        check("DIRECCION_INVALIDA".equals(rejected("")), "empty refused");

        // --- Cookie
        check("zt_session=abc".equals(ApiClient.sessionCookie(List.of("otra=1; Path=/", "zt_session=abc; Path=/api/v1; HttpOnly"))), "session cookie found");
        check(ApiClient.sessionCookie(List.of("zt_session=; Max-Age=0")) == null, "empty cookie ignored");
        check(ApiClient.sessionCookie(null) == null, "no header");

        // --- Effective gestures (real captured response) → phone actions
        Map<String, String> enabled = ModeLoader.enabledAssignments(MiniJson.parse(gestos));
        check(enabled.size() == 13 && "multimedia_play_pause".equals(enabled.get("pulgar_arriba")) && "atras".equals(enabled.get("pulgar_abajo")), "real assignments read");
        GestureActions phone = GestureActions.fromCatalog(enabled);
        check(phone.actionFor("Thumb_Up") == GestureActions.Action.MEDIA_PLAY_PAUSE, "thumb up from API");
        check(phone.actionFor("Thumb_Down") == GestureActions.Action.BACK, "thumb down from API");
        check(phone.actionFor("Victory") == GestureActions.Action.SCROLL_DOWN && phone.actionFor("Pointing_Up") == GestureActions.Action.SCROLL_UP, "scroll from API");
        String disabledScroll = gestos.replace("\"accion_codigo\":\"desplazar\",\"habilitado\":true", "\"accion_codigo\":\"desplazar\",\"habilitado\":false");
        check(!disabledScroll.equals(gestos), "fixture edit applied");
        GestureActions noScroll = GestureActions.fromCatalog(ModeLoader.enabledAssignments(MiniJson.parse(disabledScroll)));
        check(noScroll.actionFor("Victory") == null && noScroll.actionFor("Pointing_Up") == null, "habilitado=false disables");
        check(noScroll.describe().contains("✌ dos dedos: deshabilitado") && noScroll.describe().contains("👍 pulgar arriba: Reproducir / pausar"), "describe lists disabled and enabled");
        check(throwsIllegal(() -> ModeLoader.enabledAssignments(MiniJson.parse("{\"data\":{\"gestos\":{}}}"))), "wrong shape rejected");
        check(throwsIllegal(() -> ModeLoader.pathId("../admin")), "path id must be a uuid");

        // --- Full flow against a fake server
        FakeApi fake = new FakeApi(perfiles, modos, gestos);
        try {
            ApiClient api = new ApiClient(fake.url());
            ModeLoader.Result ok = ModeLoader.load(api, "demo_movil", "Receta-Demo-2026");
            check(ok.ok && ok.actions != null, "mode loaded: " + ok.message);
            check("Receta en el teléfono".equals(ok.modeName) && "Cocina".equals(ok.profileName) && ok.mobileModes == 1, "first mobile mode chosen, pc mode skipped");
            check(ok.actions.actionFor("Thumb_Up") == GestureActions.Action.MEDIA_PLAY_PAUSE, "flow applies API mapping");
            check(fake.logins.get() == 1 && fake.gets.get() == 3, "one login, three reads");
            check(api.hasSession(), "cookie kept in memory");

            ModeLoader.Result again = ModeLoader.load(api, "demo_movil", "");
            check(again.ok && fake.logins.get() == 1, "refresh reuses the session without password");

            fake.expireOnce = true;
            ModeLoader.Result relogin = ModeLoader.load(api, "demo_movil", "Receta-Demo-2026");
            check(relogin.ok && fake.logins.get() == 2, "expired session re-logs in once");

            fake.expireOnce = true;
            ModeLoader.Result noPassword = ModeLoader.load(api, "demo_movil", "");
            check(!noPassword.ok && noPassword.actions == null && noPassword.message.contains("SESION_INVALIDA"), "expired without password fails, no fake success");

            ModeLoader.Result bad = ModeLoader.load(new ApiClient(fake.url()), "demo_movil", "mala-clave-1");
            check(!bad.ok && bad.message.contains("CREDENCIALES_INVALIDAS"), "wrong password reported");
            check(!ModeLoader.load(new ApiClient(fake.url()), "", "x").ok, "empty user refused locally");

            fake.modos = modos.replace("\"plataforma\":\"movil\"", "\"plataforma\":\"pc\"");
            ModeLoader.Result none = ModeLoader.load(new ApiClient(fake.url()), "demo_movil", "Receta-Demo-2026");
            check(!none.ok && none.actions == null && none.message.contains("movil"), "no mobile mode is a failure");
            fake.modos = modos;

            fake.garbage = true;
            ModeLoader.Result html = ModeLoader.load(new ApiClient(fake.url()), "demo_movil", "Receta-Demo-2026");
            check(!html.ok && html.message.contains("RESPUESTA_INVALIDA"), "non-json body is a failure");
            fake.garbage = false;

            fake.perfiles = "{\"data\":[{\"id\":\"no-es-uuid\",\"nombre\":\"x\"}],\"paginacion\":{}}";
            check(!ModeLoader.load(new ApiClient(fake.url()), "demo_movil", "Receta-Demo-2026").ok, "bad id is a failure");
            fake.perfiles = "{\"data\":[],\"paginacion\":{}}";
            check(!ModeLoader.load(new ApiClient(fake.url()), "demo_movil", "Receta-Demo-2026").ok, "no profiles is a failure");
        } finally {
            fake.server.stop(0);
        }
        // Server gone: connection refused → failure, never success.
        ModeLoader.Result offline = ModeLoader.load(new ApiClient(fake.url()), "demo_movil", "Receta-Demo-2026");
        check(!offline.ok && offline.message.contains("SIN_CONEXION"), "offline is reported");

        // --- GestureGate.reconfigure: never during CONTROL
        GestureGate gate = new GestureGate(GestureActions.defaults().gestures());
        gate.start();
        gate.frame(gate.epoch(), 50, 60, "Open_Palm", 0.95f, true, true);
        check(gate.enable(60, true), "control enabled");
        check(!gate.reconfigure(Set.of("Thumb_Up")), "refused during control");
        check(gate.actionable().equals(GestureActions.defaults().gestures()), "allow-list untouched while in control");
        long before = gate.epoch();
        gate.pause();
        check(gate.reconfigure(noScroll.gestures()), "accepted after pause");
        check(gate.epoch() > before + 1, "reconfigure bumps epoch");
        check(gate.state() == GestureGate.State.PAUSED, "reconfigure does not resume");
        check(gate.actionable().equals(noScroll.gestures()) && !gate.actionable().contains("Victory"), "new allow-list in place");
        long old = before;
        check(gate.frame(old, 70, 80, "Victory", 1, true, true) == null, "results from the old epoch discarded");
        check(throwsIllegal(() -> gate.reconfigure(Set.of("Open_Palm"))), "open palm still refused");
        // After resuming, a scroll gesture that the new mode disabled never fires.
        gate.frame(gate.epoch(), 100, 110, "Open_Palm", 0.95f, true, true);
        check(gate.enable(110, true), "resume after reconfigure");
        String fired = null;
        for (long t = 200; t <= 500; t += 100) gate.frame(gate.epoch(), t, t + 10, "Open_Palm", 0.95f, true, true);
        for (long t = 600; t <= 1500 && fired == null; t += 50) fired = gate.frame(gate.epoch(), t, t + 10, "Victory", 0.95f, true, true);
        check(fired == null, "disabled gesture does not fire after reconfigure");
        for (long t = 1600; t <= 1900; t += 100) gate.frame(gate.epoch(), t, t + 10, "Open_Palm", 0.95f, true, true);
        for (long t = 2000; t <= 2900 && fired == null; t += 50) fired = gate.frame(gate.epoch(), t, t + 10, "Thumb_Up", 0.95f, true, true);
        check("Thumb_Up".equals(fired), "enabled gesture fires after reconfigure");
        GestureGate stopped = new GestureGate(Set.of());
        check(stopped.reconfigure(Set.of("Thumb_Down")), "reconfigure while stopped");
        check(new GestureGate(GestureActions.fromCatalog(new HashMap<>()).gestures()).actionable().isEmpty(), "empty allow-list allowed");

        System.out.println("PASS: " + checks + " API mode-loading assertions (JVM only)");
    }
}
