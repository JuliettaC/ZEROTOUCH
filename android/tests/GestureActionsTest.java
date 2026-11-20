package cl.zerotouch.mobile;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/** JVM tests for the gesture allow-list and its use by GestureGate. No Android runtime. */
public final class GestureActionsTest {
    private static int checks;
    private static void check(boolean condition, String name) {
        checks++; if (!condition) throw new AssertionError(name);
    }
    private static String frame(GestureGate gate, long t, String gesture) {
        return gate.frame(gate.epoch(), t, t + 10, gesture, 0.95f, true, true);
    }
    /** Arms the gate, shows an open palm, then holds {@code gesture}; returns what fired. */
    private static String holdAfterPalm(GestureGate gate, long t, String gesture) {
        for (long u = t; u <= t + 300; u += 100) frame(gate, u, "Open_Palm");
        String fired = null;
        for (long u = t + 400; u <= t + 1100 && fired == null; u += 50) fired = frame(gate, u, gesture);
        return fired;
    }
    private static GestureGate armed(GestureActions actions) {
        GestureGate gate = new GestureGate(actions.gestures()); gate.start(); frame(gate, 50, "Open_Palm");
        check(gate.enable(60, true), "explicit activation"); return gate;
    }

    public static void main(String[] args) {
        GestureActions d = GestureActions.defaults();
        check(d.actionFor("Victory") == GestureActions.Action.SCROLL_DOWN, "two fingers scroll down");
        check(d.actionFor("Pointing_Up") == GestureActions.Action.SCROLL_UP, "index up scrolls up");
        check(d.actionFor("Thumb_Down") == GestureActions.Action.BACK, "thumb down goes back");
        check(d.actionFor("Thumb_Up") == GestureActions.Action.MEDIA_PLAY_PAUSE, "thumb up toggles media");
        check(d.actionFor("Open_Palm") == null, "open palm never acts");
        check(d.actionFor("Closed_Fist") == null, "fist does not act on the phone");
        check(d.actionFor("ILoveYou") == null && d.actionFor("") == null && d.actionFor(null) == null, "unknown ignored");

        boolean refused = false;
        try { new GestureGate(Set.of("Open_Palm")); } catch (IllegalArgumentException e) { refused = true; }
        check(refused, "open palm cannot be actionable");

        // Each allowed gesture fires exactly once per hold and only after a palm.
        for (String g : d.gestures()) {
            GestureGate gate = armed(d);
            String early = null;
            for (long t = 100; t <= 900 && early == null; t += 50) early = frame(gate, t, g);
            check(early == null, g + " needs a palm first");
            String fired = holdAfterPalm(gate, 1000, g);
            check(g.equals(fired), g + " fires after palm and hold");
            String again = null;
            for (long t = 2200; t <= 3000 && again == null; t += 50) again = frame(gate, t, g);
            check(again == null, g + " does not repeat while held");
        }
        // A gesture outside the allow-list never fires.
        GestureGate gate = armed(d);
        check(holdAfterPalm(gate, 100, "Closed_Fist") == null, "fist not in allow-list");
        check(holdAfterPalm(gate, 1500, "ILoveYou") == null, "ILoveYou not in allow-list");
        // Switching gesture mid-hold restarts the hold.
        gate = armed(d);
        for (long u = 100; u <= 400; u += 100) frame(gate, u, "Open_Palm");
        frame(gate, 500, "Victory"); frame(gate, 900, "Victory");
        check(frame(gate, 1000, "Pointing_Up") == null, "changed gesture restarts hold");
        // Observation never fires, even with an allowed gesture.
        GestureGate observing = new GestureGate(d.gestures()); observing.start();
        check(holdAfterPalm(observing, 100, "Victory") == null, "observation never acts");

        // Catalog mapping from a downloaded mode.
        Map<String, String> mode = new HashMap<>();
        mode.put("dos_dedos", "desplazar");
        mode.put("pulgar_arriba", "atras");
        mode.put("pulgar_abajo", "multimedia_siguiente");
        GestureActions c = GestureActions.fromCatalog(mode);
        check(c.actionFor("Victory") == GestureActions.Action.SCROLL_DOWN, "catalog keeps scroll");
        check(c.actionFor("Thumb_Up") == GestureActions.Action.BACK, "catalog reassigns thumb up");
        check(c.actionFor("Thumb_Down") == GestureActions.Action.MEDIA_NEXT, "catalog reassigns thumb down");
        mode.put("pulgar_arriba", "confirmar");
        mode.remove("dos_dedos");
        c = GestureActions.fromCatalog(mode);
        check(c.actionFor("Thumb_Up") == null, "unsupported action disables, never substitutes");
        check(c.actionFor("Victory") == null && c.actionFor("Pointing_Up") == null, "disabled two fingers disables scrolling");
        check(GestureActions.fromCatalog(new HashMap<>()).gestures().isEmpty(), "empty mode enables nothing");
        check(GestureActions.mobileAction("cancelar") == GestureActions.Action.BACK, "cancel is back");
        check(GestureActions.mobileAction("temporizador_iniciar") == null, "timer unsupported on phone");
        System.out.println("PASS: " + checks + " gesture allow-list assertions (JVM only)");
    }
}
