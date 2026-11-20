package cl.zerotouch.mobile;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.graphics.Path;
import android.media.AudioManager;
import android.util.DisplayMetrics;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityEvent;

/**
 * Only the Android system can bind this service. No screen content is requested.
 * It executes only the allow-listed actions of {@link GestureActions}: Back, a vertical swipe and media keys.
 */
public final class GestureAccessibilityService extends AccessibilityService {
    private static GestureAccessibilityService connected;
    static boolean ready() { return connected != null; }
    static boolean perform(GestureActions.Action action) {
        GestureAccessibilityService service = connected;
        if (service == null || action == null) return false;
        switch (action) {
            case BACK: return service.performGlobalAction(GLOBAL_ACTION_BACK);
            case SCROLL_DOWN: return service.swipe(0.70f, 0.30f);
            case SCROLL_UP: return service.swipe(0.30f, 0.70f);
            case MEDIA_PLAY_PAUSE: return service.media(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE);
            case MEDIA_NEXT: return service.media(KeyEvent.KEYCODE_MEDIA_NEXT);
            default: return false;
        }
    }
    /** Vertical swipe in the middle of the screen, from fromY to toY (fractions of the height). */
    private boolean swipe(float fromY, float toY) {
        DisplayMetrics metrics = getResources().getDisplayMetrics();
        float x = metrics.widthPixels / 2f;
        Path path = new Path();
        path.moveTo(x, metrics.heightPixels * fromY);
        path.lineTo(x, metrics.heightPixels * toY);
        GestureDescription gesture = new GestureDescription.Builder()
            .addStroke(new GestureDescription.StrokeDescription(path, 0, 300)).build();
        return dispatchGesture(gesture, null, null);
    }
    /** Media key to whichever app holds the media session (video or music of the recipe). */
    private boolean media(int keyCode) {
        AudioManager audio = getSystemService(AudioManager.class);
        if (audio == null) return false;
        audio.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, keyCode));
        audio.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, keyCode));
        return true;
    }
    @Override protected void onServiceConnected() { connected = this; }
    @Override public void onAccessibilityEvent(AccessibilityEvent event) { /* No screen data retained. */ }
    @Override public void onInterrupt() { CameraGestureService.accessibilityLost(); }
    @Override public void onDestroy() {
        if (connected == this) connected = null;
        CameraGestureService.accessibilityLost(); super.onDestroy();
    }
}
