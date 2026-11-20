package cl.zerotouch.mobile;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Lector JSON mínimo y sin dependencias (sirve igual en Android y en las pruebas JVM).
 * Objetos → LinkedHashMap, listas → ArrayList, números → Double, true/false → Boolean, null → null.
 * Rechaza texto sobrante y estructuras con más de 32 niveles: la API nunca devuelve más de 4.
 */
public final class MiniJson {
    private static final int MAX_DEPTH = 32;
    private final String text;
    private int pos;

    private MiniJson(String text) { this.text = text; }

    public static Object parse(String text) {
        if (text == null) throw new IllegalArgumentException("JSON vacío");
        MiniJson parser = new MiniJson(text);
        parser.space();
        Object value = parser.value(0);
        parser.space();
        if (parser.pos != text.length()) throw parser.error("texto sobrante");
        return value;
    }

    /** Cadena JSON entre comillas, con los escapes necesarios. */
    public static String quote(String value) {
        StringBuilder out = new StringBuilder("\"");
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '"': out.append("\\\""); break;
                case '\\': out.append("\\\\"); break;
                case '\n': out.append("\\n"); break;
                case '\r': out.append("\\r"); break;
                case '\t': out.append("\\t"); break;
                default:
                    if (c < 0x20) out.append(String.format("\\u%04x", (int) c));
                    else out.append(c);
            }
        }
        return out.append('"').toString();
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> object(Object value, String what) {
        if (!(value instanceof Map)) throw new IllegalArgumentException(what + ": se esperaba un objeto");
        return (Map<String, Object>) value;
    }

    @SuppressWarnings("unchecked")
    public static List<Object> list(Object value, String what) {
        if (!(value instanceof List)) throw new IllegalArgumentException(what + ": se esperaba una lista");
        return (List<Object>) value;
    }

    public static String string(Object value, String what) {
        if (!(value instanceof String)) throw new IllegalArgumentException(what + ": se esperaba texto");
        return (String) value;
    }

    private Object value(int depth) {
        if (depth > MAX_DEPTH) throw error("demasiado anidado");
        if (pos >= text.length()) throw error("fin inesperado");
        char c = text.charAt(pos);
        if (c == '{') return obj(depth);
        if (c == '[') return arr(depth);
        if (c == '"') return str();
        if (text.startsWith("true", pos)) { pos += 4; return Boolean.TRUE; }
        if (text.startsWith("false", pos)) { pos += 5; return Boolean.FALSE; }
        if (text.startsWith("null", pos)) { pos += 4; return null; }
        if (c == '-' || (c >= '0' && c <= '9')) return num();
        throw error("valor inesperado");
    }

    private Map<String, Object> obj(int depth) {
        Map<String, Object> map = new LinkedHashMap<>();
        pos++; space();
        if (peek('}')) { pos++; return map; }
        while (true) {
            space();
            if (!peek('"')) throw error("se esperaba una clave");
            String key = str();
            space(); expect(':'); space();
            map.put(key, value(depth + 1));
            space();
            if (peek(',')) { pos++; continue; }
            expect('}');
            return map;
        }
    }

    private List<Object> arr(int depth) {
        List<Object> list = new ArrayList<>();
        pos++; space();
        if (peek(']')) { pos++; return list; }
        while (true) {
            space();
            list.add(value(depth + 1));
            space();
            if (peek(',')) { pos++; continue; }
            expect(']');
            return list;
        }
    }

    private String str() {
        expect('"');
        StringBuilder out = new StringBuilder();
        while (true) {
            if (pos >= text.length()) throw error("cadena sin cerrar");
            char c = text.charAt(pos++);
            if (c == '"') return out.toString();
            if (c < 0x20) throw error("carácter de control en cadena");
            if (c != '\\') { out.append(c); continue; }
            if (pos >= text.length()) throw error("escape incompleto");
            char e = text.charAt(pos++);
            switch (e) {
                case '"': out.append('"'); break;
                case '\\': out.append('\\'); break;
                case '/': out.append('/'); break;
                case 'b': out.append('\b'); break;
                case 'f': out.append('\f'); break;
                case 'n': out.append('\n'); break;
                case 'r': out.append('\r'); break;
                case 't': out.append('\t'); break;
                case 'u':
                    if (pos + 4 > text.length()) throw error("escape \\u incompleto");
                    try { out.append((char) Integer.parseInt(text.substring(pos, pos + 4), 16)); }
                    catch (NumberFormatException bad) { throw error("escape \\u inválido"); }
                    pos += 4; break;
                default: throw error("escape inválido");
            }
        }
    }

    private Double num() {
        int start = pos;
        if (peek('-')) pos++;
        while (pos < text.length() && "0123456789.eE+-".indexOf(text.charAt(pos)) >= 0) pos++;
        try { return Double.valueOf(text.substring(start, pos)); }
        catch (NumberFormatException bad) { throw error("número inválido"); }
    }

    private void space() { while (pos < text.length() && " \t\r\n".indexOf(text.charAt(pos)) >= 0) pos++; }
    private boolean peek(char c) { return pos < text.length() && text.charAt(pos) == c; }
    private void expect(char c) { if (!peek(c)) throw error("se esperaba '" + c + "'"); pos++; }
    private IllegalArgumentException error(String what) { return new IllegalArgumentException("JSON inválido (" + what + ") en la posición " + pos); }
}
