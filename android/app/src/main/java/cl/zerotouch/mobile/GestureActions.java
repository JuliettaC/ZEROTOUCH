package cl.zerotouch.mobile;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * Lista blanca gesto → acción del teléfono. Lógica pura, sin Android, con pruebas JVM.
 * Los nombres de gesto son las categorías del modelo MediaPipe GestureRecognizer. Cualquier otro gesto,
 * o una acción del catálogo que el teléfono no sabe ejecutar, queda deshabilitado: nunca se sustituye
 * en silencio por otra acción.
 */
public final class GestureActions {
    public enum Action {
        BACK("Volver"), SCROLL_DOWN("Desplazar hacia abajo"), SCROLL_UP("Desplazar hacia arriba"),
        MEDIA_PLAY_PAUSE("Reproducir / pausar"), MEDIA_NEXT("Siguiente pista");
        public final String label;
        Action(String label) { this.label = label; }
    }

    /** Categoría de MediaPipe → código de gesto del catálogo compartido con el escritorio. */
    public static final Map<String, String> CATALOG_GESTURE;
    static {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("Thumb_Up", "pulgar_arriba");
        m.put("Thumb_Down", "pulgar_abajo");
        m.put("Victory", "dos_dedos");
        m.put("Pointing_Up", "modo_precision");
        CATALOG_GESTURE = Collections.unmodifiableMap(m);
    }

    private final Map<String, Action> byGesture;

    private GestureActions(Map<String, Action> byGesture) {
        this.byGesture = Collections.unmodifiableMap(new LinkedHashMap<>(byGesture));
    }

    /**
     * Valores del teléfono cuando no hay un modo descargado. Pensados para leer una receta:
     * dos dedos (✌) baja, índice arriba (☝) sube, pulgar abajo vuelve, pulgar arriba reproduce o pausa.
     */
    public static GestureActions defaults() {
        Map<String, Action> m = new LinkedHashMap<>();
        m.put("Victory", Action.SCROLL_DOWN);
        m.put("Pointing_Up", Action.SCROLL_UP);
        m.put("Thumb_Down", Action.BACK);
        m.put("Thumb_Up", Action.MEDIA_PLAY_PAUSE);
        return new GestureActions(m);
    }

    /**
     * Aplica las asignaciones de un modo descargado de la API (código de gesto → código de acción).
     * Solo los pulgares son reasignables en el teléfono; dos dedos activa o desactiva los dos
     * desplazamientos. Un gesto ausente o con acción no soportada queda deshabilitado.
     *
     * @param assignments código de gesto del catálogo → código de acción, solo los habilitados
     */
    public static GestureActions fromCatalog(Map<String, String> assignments) {
        Map<String, Action> m = new LinkedHashMap<>();
        if ("desplazar".equals(assignments.get("dos_dedos"))) {
            m.put("Victory", Action.SCROLL_DOWN);
            m.put("Pointing_Up", Action.SCROLL_UP);
        }
        for (String gesture : new String[] {"Thumb_Up", "Thumb_Down"}) {
            Action action = mobileAction(assignments.get(CATALOG_GESTURE.get(gesture)));
            if (action != null) m.put(gesture, action);
        }
        return new GestureActions(m);
    }

    /** Acción del catálogo → acción del teléfono, o null si el teléfono no la sabe ejecutar. */
    static Action mobileAction(String catalogAction) {
        if (catalogAction == null) return null;
        switch (catalogAction) {
            case "atras": case "cancelar": return Action.BACK;
            case "multimedia_play_pause": return Action.MEDIA_PLAY_PAUSE;
            case "multimedia_siguiente": return Action.MEDIA_NEXT;
            default: return null;
        }
    }

    private static final Map<String, String> GESTURE_LABEL;
    static {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("Victory", "✌ dos dedos");
        m.put("Pointing_Up", "☝ índice arriba");
        m.put("Thumb_Down", "👎 pulgar abajo");
        m.put("Thumb_Up", "👍 pulgar arriba");
        GESTURE_LABEL = Collections.unmodifiableMap(m);
    }

    /** Una línea por gesto del teléfono, incluidos los deshabilitados, para mostrar en pantalla. */
    public String describe() {
        StringBuilder out = new StringBuilder();
        for (Map.Entry<String, String> entry : GESTURE_LABEL.entrySet()) {
            Action action = byGesture.get(entry.getKey());
            if (out.length() > 0) out.append('\n');
            out.append(entry.getValue()).append(": ").append(action == null ? "deshabilitado" : action.label);
        }
        return out.toString();
    }

    public Action actionFor(String gesture) { return gesture == null ? null : byGesture.get(gesture); }
    public Set<String> gestures() { return byGesture.keySet(); }
    public Map<String, Action> asMap() { return byGesture; }
}
