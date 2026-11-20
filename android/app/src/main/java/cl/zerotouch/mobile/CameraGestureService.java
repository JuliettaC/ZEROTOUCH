package cl.zerotouch.mobile;

import android.Manifest;
import android.app.*;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.*;

public final class CameraGestureService extends Service {
    static final String START = "cl.zerotouch.START", PAUSE = "cl.zerotouch.PAUSE", STOP = "cl.zerotouch.STOP";
    private static final String CHANNEL = "gesture-control";
    private static final int NOTIFICATION = 12;
    private static CameraGestureService active;
    static String status = "Detenido. La cámara no está activa.";
    /** Asignaciones vigentes (por defecto o descargadas de la API) y de dónde salen; sobreviven al servicio. */
    private static volatile GestureActions configured = GestureActions.defaults();
    static volatile String configuredSource = "Valores por defecto del teléfono (sin modo de la API).";
    private GestureActions actions = configured;
    private final GestureGate gate = new GestureGate(actions.gestures());
    private final Handler main = new Handler(Looper.getMainLooper());
    private FrontCamera camera;
    private boolean finishing;
    private GestureGate.State notified;
    private String detection = "Esperando mano";

    static void enableControl() {
        if (active == null) return;
        boolean enabled = active.gate.enable(SystemClock.elapsedRealtime(), GestureAccessibilityService.ready());
        active.update(enabled ? "Control activado; muestra la palma y luego sostén un gesto." : "No se activó: requiere mano reciente y accesibilidad conectada.");
    }
    static GestureActions configuredActions() { return configured; }
    /**
     * Aplica un modo nuevo (hilo principal). Nunca durante CONTROL: si el control estaba activo se pausa
     * antes y la persona lo reactiva a mano. Devuelve true si tuvo que pausar.
     */
    static boolean applyActions(GestureActions next, String source) {
        configured = next; configuredSource = source;
        CameraGestureService service = active;
        if (service == null || service.finishing) return false;
        boolean wasControl = service.gate.state() == GestureGate.State.CONTROL;
        if (wasControl) service.gate.pause();
        if (!service.gate.reconfigure(next.gestures())) { service.finish("No se pudo aplicar el modo; control detenido.", true); return wasControl; }
        service.actions = next;
        service.update(wasControl ? "Modo nuevo aplicado; control en pausa: reactívalo." : "Modo nuevo aplicado.");
        return wasControl;
    }
    static void pauseControl() { if (active != null) { active.gate.pause(); active.update("Pausado por el usuario."); } }
    static void stopControl() { if (active != null) active.finish("Detenido por el usuario.", false); }
    static void accessibilityLost() {
        if (active != null) { active.gate.pause(); active.update("Accesibilidad interrumpida. Activa de nuevo el control cuando esté disponible."); }
    }
    @Override public void onCreate() { super.onCreate(); active = this; }
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? "" : intent.getAction();
        if (STOP.equals(action)) { finish("Detenido por el usuario.", false); return START_NOT_STICKY; }
        if (PAUSE.equals(action)) { pauseControl(); if (camera == null) stopSelf(); return START_NOT_STICKY; }
        if (!START.equals(action) || camera != null) { if (camera == null) stopSelf(); return START_NOT_STICKY; }
        try {
            if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED)
                throw new SecurityException("Camera permission missing");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (!manager.areNotificationsEnabled()) throw new SecurityException("Notifications required for stop control");
            manager.createNotificationChannel(new NotificationChannel(CHANNEL, "Control gestual y parada", NotificationManager.IMPORTANCE_LOW));
            if (manager.getNotificationChannel(CHANNEL).getImportance() == NotificationManager.IMPORTANCE_NONE)
                throw new SecurityException("Notification channel blocked");
            gate.start();
            if (Build.VERSION.SDK_INT >= 30) startForeground(NOTIFICATION, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA);
            else startForeground(NOTIFICATION, notification());
            camera = new FrontCamera(this, gate::epoch, new FrontCamera.Listener() {
                @Override public void result(long token, long captured, String gesture, float score, boolean hand) {
                    main.post(() -> {
                        if (finishing || token != gate.epoch()) return;
                        if (!environmentReady()) { finish("Permiso, notificación o pantalla no disponibles; control detenido.", true); return; }
                        String fired = gate.frame(token, captured, SystemClock.elapsedRealtime(), gesture, score, hand, GestureAccessibilityService.ready());
                        detection = hand ? "Mano detectada · " + gesture : "Sin mano: control bloqueado";
                        GestureActions.Action action = actions.actionFor(fired);
                        if (action != null) {
                            if (!GestureAccessibilityService.perform(action)) { gate.pause(); update("Android rechazó «" + action.label + "»; control pausado."); }
                            else update("Android aceptó «" + action.label + "». Abre la mano antes de repetir.");
                        } else update(detection);
                    });
                }
                @Override public void error(String message) { main.post(() -> { if (!finishing) finish(message, true); }); }
            });
            camera.start(); main.post(watchdog); update("Observación: detecta gestos sin controlar el teléfono.");
        } catch (RuntimeException error) { finish("No se inició: revisa cámara, notificaciones y que ZeroTouch esté visible.", true); }
        return START_NOT_STICKY;
    }
    private final Runnable watchdog = new Runnable() {
        @Override public void run() {
            if (finishing) return;
            if (!environmentReady()) { finish("Permiso retirado, pantalla bloqueada o notificación desactivada; reinicia desde ZeroTouch.", false); return; }
            GestureGate.State before = gate.state();
            gate.expire(SystemClock.elapsedRealtime());
            if (!GestureAccessibilityService.ready() && gate.state() == GestureGate.State.CONTROL) gate.pause();
            if (before != gate.state()) update("Sin seguimiento reciente o sin accesibilidad. Reactivación manual necesaria.");
            main.postDelayed(this, 150);
        }
    };
    private boolean environmentReady() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        NotificationChannel channel = manager.getNotificationChannel(CHANNEL);
        return checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
            && manager.areNotificationsEnabled() && channel != null && channel.getImportance() != NotificationManager.IMPORTANCE_NONE
            && getSystemService(PowerManager.class).isInteractive() && !getSystemService(KeyguardManager.class).isKeyguardLocked();
    }
    private void update(String message) {
        status = gate.state().name() + " · " + message;
        if (camera != null && !finishing && notified != gate.state()) {
            notified = gate.state(); getSystemService(NotificationManager.class).notify(NOTIFICATION, notification());
        }
    }
    private Notification notification() {
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent pause = PendingIntent.getService(this, 1, new Intent(this, CameraGestureService.class).setAction(PAUSE), PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getService(this, 2, new Intent(this, CameraGestureService.class).setAction(STOP), PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, CHANNEL).setSmallIcon(android.R.drawable.ic_menu_camera)
            .setContentTitle("ZeroTouch · " + gate.state().name())
            .setContentText("Cámara frontal activa. Puedes pausar o detener aquí.")
            .setContentIntent(open).setOngoing(true)
            .addAction(new Notification.Action.Builder(null, "Pausar", pause).build())
            .addAction(new Notification.Action.Builder(null, "Detener", stop).build()).build();
    }
    private void finish(String message, boolean failure) {
        if (finishing) return;
        finishing = true;
        if (failure) gate.fail(); else gate.stop();
        status = gate.state().name() + " · " + message;
        main.removeCallbacksAndMessages(null);
        if (camera != null) { camera.close(); camera = null; }
        stopForeground(STOP_FOREGROUND_REMOVE); stopSelf();
    }
    @Override public void onTaskRemoved(Intent rootIntent) { finish("Aplicación cerrada; cámara detenida.", false); }
    @Override public void onDestroy() {
        if (!finishing) finish("Servicio detenido por Android.", false);
        if (active == this) active = null;
        super.onDestroy();
    }
}
