package cl.zerotouch.mobile;

import android.accessibilityservice.AccessibilityService;
import android.view.accessibility.AccessibilityEvent;

/** Only the Android system can bind this service. No screen content is requested. */
public final class GestureAccessibilityService extends AccessibilityService {
    private static GestureAccessibilityService connected;
    static boolean ready() { return connected != null; }
    static boolean back() { return connected != null && connected.performGlobalAction(GLOBAL_ACTION_BACK); }
    @Override protected void onServiceConnected() { connected = this; }
    @Override public void onAccessibilityEvent(AccessibilityEvent event) { /* No screen data retained. */ }
    @Override public void onInterrupt() { CameraGestureService.accessibilityLost(); }
    @Override public void onDestroy() {
        if (connected == this) connected = null;
        CameraGestureService.accessibilityLost(); super.onDestroy();
    }
}
