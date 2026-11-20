package cl.zerotouch.mobile;

/** Executable JVM regression tests; no Android runtime, camera or system input. */
public final class GestureGateTest {
    private static int checks;
    private static void check(boolean condition, String name) {
        checks++; if (!condition) throw new AssertionError(name);
    }
    private static boolean frame(GestureGate gate, long t, String gesture) {
        return gate.frame(gate.epoch(), t, t + 10, gesture, 0.95f, true, true);
    }
    private static GestureGate armed() {
        GestureGate gate = new GestureGate(); gate.start(); frame(gate, 100, "Open_Palm");
        check(gate.enable(110, true), "explicit activation with recent hand"); return gate;
    }
    private static void release(GestureGate gate, long t) {
        check(!frame(gate, t, "Open_Palm"), "open palm is not an action");
        frame(gate, t + 150, "Open_Palm"); frame(gate, t + 300, "Open_Palm");
    }
    public static void main(String[] args) {
        GestureGate gate = new GestureGate();
        check(!frame(gate, 1, "Closed_Fist"), "stopped blocks input");
        gate.start();
        check(!gate.enable(1, true), "no activation without hand");
        for (long t = 100; t <= 1500; t += 100) check(!frame(gate, t, "Closed_Fist"), "observation never injects");
        check(!gate.enable(1510, false), "accessibility required");
        check(!gate.enable(2000, true), "fresh hand required");
        gate = armed();
        for (long t = 200; t <= 1000; t += 100) check(!frame(gate, t, "Closed_Fist"), "must show open palm after enabling");
        release(gate, 1100);
        for (long t = 1500; t < 2200; t += 100) check(!frame(gate, t, "Closed_Fist"), "hold duration");
        check(frame(gate, 2200, "Closed_Fist"), "one real action request after hold");
        for (long t = 2300; t <= 3500; t += 100) check(!frame(gate, t, "Closed_Fist"), "no per-frame repetition");
        release(gate, 3600);
        for (long t = 4000; t < 4700; t += 100) frame(gate, t, "Closed_Fist");
        check(frame(gate, 4700, "Closed_Fist"), "second action after release");
        long oldEpoch = gate.epoch(); gate.pause();
        check(!gate.frame(oldEpoch, 4800, 4810, "Closed_Fist", 1, true, true), "old result after pause discarded");
        check(!frame(gate, 4900, "Closed_Fist"), "paused blocks");
        check(gate.enable(4910, true), "explicit resume");
        gate.frame(gate.epoch(), 5000, 5010, "", 0, false, true);
        check(gate.state() == GestureGate.State.PAUSED, "tracking loss pauses");
        check(!gate.enable(5020, true), "lost hand cannot resume");
        frame(gate, 5100, "Open_Palm");
        check(gate.state() == GestureGate.State.PAUSED, "hand return does not auto-resume");
        gate = armed(); release(gate, 200); frame(gate, 600, "Closed_Fist");
        gate.expire(1100);
        check(gate.state() == GestureGate.State.PAUSED, "watchdog handles silent camera stall");
        gate = armed();
        check(!gate.frame(gate.epoch(), 200, 1000, "Closed_Fist", 1, true, true), "late inference rejected");
        check(gate.state() == GestureGate.State.PAUSED, "late inference pauses");
        gate = armed();
        gate.frame(gate.epoch(), 200, 210, "Open_Palm", 1, true, false);
        check(gate.state() == GestureGate.State.PAUSED, "accessibility loss pauses");
        gate = armed(); release(gate, 200);
        for (long t = 600; t < 1600; t += 100)
            check(!gate.frame(gate.epoch(), t, t, "Closed_Fist", Float.NaN, true, true), "nonfinite confidence blocked");
        gate = armed(); release(gate, 200); frame(gate, 600, "Closed_Fist");
        check(!frame(gate, 1000, "Closed_Fist"), "gap resets hold and release");
        for (long t = 1100; t < 2000; t += 100) check(!frame(gate, t, "Closed_Fist"), "gap cannot finish old gesture");
        gate = armed(); long token = gate.epoch(); gate.stop(); gate.start();
        check(!gate.frame(token, 200, 210, "Closed_Fist", 1, true, true), "old session cannot act after restart");
        gate.fail();
        check(!gate.enable(220, true), "error cannot activate");
        check(!frame(gate, 230, "Open_Palm"), "error ignores results");
        System.out.println("PASS: " + checks + " safety assertions (JVM only)");
    }
}
