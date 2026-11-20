package cl.zerotouch.mobile;

/**
 * Pure safety policy. All times are monotonic milliseconds; no Android dependencies.
 * Only gestures in the allow-list can fire, once per hold, and only after an open palm.
 */
public final class GestureGate {
    public enum State { STOPPED, OBSERVATION, CONTROL, PAUSED, ERROR }
    public static final long MAX_AGE_MS = 350, MAX_GAP_MS = 300, HOLD_MS = 650, RELEASE_MS = 300;
    private State state = State.STOPPED;
    private long epoch, lastFrame = -1, since = -1;
    private boolean tracked, released;
    private String candidate = "";
    private java.util.Set<String> actionable;

    public GestureGate(java.util.Set<String> actionable) {
        this.actionable = checked(actionable);
    }
    private static java.util.Set<String> checked(java.util.Set<String> actionable) {
        if (actionable.contains("Open_Palm")) throw new IllegalArgumentException("Open_Palm is the release gesture");
        return java.util.Collections.unmodifiableSet(new java.util.HashSet<>(actionable));
    }

    /**
     * Replaces the allow-list (a mode downloaded from the API). Refused during CONTROL: the caller must
     * pause first, so a new mapping never takes effect mid-gesture. Bumps the epoch, so results already
     * in flight are discarded, and clears any partial hold.
     */
    public synchronized boolean reconfigure(java.util.Set<String> next) {
        if (state == State.CONTROL) return false;
        actionable = checked(next);
        epoch++; reset(); return true;
    }
    public synchronized java.util.Set<String> actionable() { return actionable; }

    public synchronized State state() { return state; }
    public synchronized long epoch() { return epoch; }
    private void reset() { since = -1; candidate = ""; released = false; }
    public synchronized void start() {
        epoch++; state = State.OBSERVATION; tracked = false; lastFrame = -1; reset();
    }
    public synchronized boolean enable(long now, boolean accessibilityReady) {
        if ((state != State.OBSERVATION && state != State.PAUSED) || !accessibilityReady
                || !tracked || lastFrame < 0 || now < lastFrame || now - lastFrame > MAX_AGE_MS) return false;
        epoch++; state = State.CONTROL; reset(); return true;
    }
    public synchronized void pause() {
        if (state == State.STOPPED || state == State.ERROR) return;
        epoch++; state = State.PAUSED; reset();
    }
    public synchronized void stop() { epoch++; state = State.STOPPED; tracked = false; reset(); }
    public synchronized void fail() { epoch++; state = State.ERROR; tracked = false; reset(); }
    public synchronized void expire(long now) {
        if (lastFrame >= 0 && now - lastFrame > MAX_AGE_MS) {
            tracked = false;
            if (state == State.CONTROL) pause();
            reset();
        }
    }
    /** Returns the gesture that fired (one of the allow-list), or null. */
    public synchronized String frame(long token, long captured, long now, String gesture,
            float score, boolean hand, boolean accessibilityReady) {
        if (token != epoch || state == State.STOPPED || state == State.ERROR) return null;
        if (captured <= lastFrame || captured > now || now - captured > MAX_AGE_MS) {
            tracked = false; if (state == State.CONTROL) pause(); reset(); return null;
        }
        if (lastFrame >= 0 && captured - lastFrame > MAX_GAP_MS) reset();
        lastFrame = captured;
        tracked = hand;
        if (!hand || !accessibilityReady) {
            if (state == State.CONTROL) pause();
            reset(); return null;
        }
        if (state != State.CONTROL) return null;
        String accepted = Float.isFinite(score) && score >= 0.8f ? gesture : "";
        if (!accepted.equals(candidate)) { candidate = accepted; since = captured; }
        if ("Open_Palm".equals(accepted) && captured - since >= RELEASE_MS) released = true;
        if (actionable.contains(accepted) && released && captured - since >= HOLD_MS) {
            released = false; since = captured; return accepted;
        }
        return null;
    }
}
