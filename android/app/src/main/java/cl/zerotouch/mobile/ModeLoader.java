package cl.zerotouch.mobile;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Descarga el modo móvil de la cuenta (solo lectura) y lo traduce con {@link GestureActions#fromCatalog}.
 * Recorre GET /perfiles → GET /perfiles/{id}/modos → GET /modos/{id}/gestos y usa el primer modo con
 * plataforma = "movil". Nunca inventa un resultado: sin modo móvil o ante cualquier error devuelve un fallo
 * con su motivo, y quien llama conserva lo que ya estaba aplicado.
 */
public final class ModeLoader {
    public static final class Result {
        public final boolean ok;
        public final GestureActions actions;   // null si !ok
        public final String modeName, profileName, message;
        public final int mobileModes;
        private Result(boolean ok, GestureActions actions, String modeName, String profileName, int mobileModes, String message) {
            this.ok = ok; this.actions = actions; this.modeName = modeName; this.profileName = profileName;
            this.mobileModes = mobileModes; this.message = message;
        }
        static Result failure(String message) { return new Result(false, null, null, null, 0, message); }
    }

    private ModeLoader() {}

    /** Inicia sesión si hace falta (o si la cookie caducó) y descarga el modo móvil. */
    public static Result load(ApiClient api, String user, String password) {
        try {
            if (!api.hasSession()) api.login(user, password);
            try { return fetch(api); }
            catch (ApiClient.ApiException expired) {
                if (expired.status != 401 || password == null || password.isEmpty()) throw expired;
                api.login(user, password);
                return fetch(api);
            }
        } catch (ApiClient.ApiException error) {
            return Result.failure(error.getMessage() + " [" + error.code + "]");
        } catch (IllegalArgumentException unexpected) {
            return Result.failure("Respuesta de la API con un formato inesperado: " + unexpected.getMessage());
        }
    }

    private static Result fetch(ApiClient api) throws ApiClient.ApiException {
        List<Object> profiles = MiniJson.list(MiniJson.object(api.get("/perfiles?limite=100&offset=0"), "perfiles").get("data"), "perfiles.data");
        String modeId = null, modeName = null, profileName = null;
        int mobile = 0;
        for (Object item : profiles) {
            Map<String, Object> profile = MiniJson.object(item, "perfil");
            String profileId = MiniJson.string(profile.get("id"), "perfil.id");
            List<Object> modes = MiniJson.list(MiniJson.object(api.get("/perfiles/" + pathId(profileId) + "/modos?limite=100&offset=0"), "modos").get("data"), "modos.data");
            for (Object m : modes) {
                Map<String, Object> mode = MiniJson.object(m, "modo");
                if (!"movil".equals(mode.get("plataforma"))) continue;
                mobile++;
                if (modeId == null) {
                    modeId = MiniJson.string(mode.get("id"), "modo.id");
                    modeName = MiniJson.string(mode.get("nombre"), "modo.nombre");
                    profileName = MiniJson.string(profile.get("nombre"), "perfil.nombre");
                }
            }
        }
        if (modeId == null)
            return Result.failure("La cuenta no tiene ningún modo con plataforma «movil». Créalo en el escritorio.");
        Object effective = api.get("/modos/" + pathId(modeId) + "/gestos");
        GestureActions actions = GestureActions.fromCatalog(enabledAssignments(effective));
        String note = mobile > 1 ? " (hay " + mobile + " modos móviles; se usa el primero)" : "";
        return new Result(true, actions, modeName, profileName, mobile, "Modo «" + modeName + "» del perfil «" + profileName + "» aplicado" + note + ".");
    }

    /** De la respuesta de GET /modos/{id}/gestos, solo las asignaciones habilitadas: gesto → acción. */
    static Map<String, String> enabledAssignments(Object response) {
        Map<String, Object> data = MiniJson.object(MiniJson.object(response, "gestos").get("data"), "gestos.data");
        Map<String, String> result = new LinkedHashMap<>();
        for (Object item : MiniJson.list(data.get("gestos"), "gestos.data.gestos")) {
            Map<String, Object> row = MiniJson.object(item, "gesto");
            if (!Boolean.TRUE.equals(row.get("habilitado"))) continue;
            result.put(MiniJson.string(row.get("gesto_codigo"), "gesto_codigo"), MiniJson.string(row.get("accion_codigo"), "accion_codigo"));
        }
        return result;
    }

    /** Los identificadores son UUID; cualquier otra cosa se rechaza antes de ponerla en la ruta. */
    static String pathId(String id) {
        if (!id.matches("[0-9a-fA-F-]{36}")) throw new IllegalArgumentException("identificador inesperado");
        return id;
    }
}
