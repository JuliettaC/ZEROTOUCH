package cl.zerotouch.mobile;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.*;
import android.provider.Settings;
import android.view.View;
import android.widget.*;
import java.util.ArrayList;

/** Native proof UI. Camera/control starts only after a visible, explicit user action. */
public final class MainActivity extends Activity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private TextView status;
    private final Runnable refresh = new Runnable() {
        @Override public void run() {
            status.setText(CameraGestureService.status + "\nAccesibilidad: " + (GestureAccessibilityService.ready() ? "conectada" : "no conectada"));
            handler.postDelayed(this, 250);
        }
    };
    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        LinearLayout panel = new LinearLayout(this); panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(24, 32, 24, 24);
        panel.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(24 + insets.getSystemWindowInsetLeft(), 24 + insets.getSystemWindowInsetTop(),
                24 + insets.getSystemWindowInsetRight(), 24 + insets.getSystemWindowInsetBottom()); return insets;
        });
        TextView title = new TextView(this); title.setText("ZeroTouch · Android\nPrueba de control por cámara frontal"); title.setTextSize(24); panel.addView(title);
        TextView help = new TextView(this);
        help.setText("1. Concede cámara y notificaciones.\n2. Activa ZeroTouch en Accesibilidad.\n3. Inicia observación y coloca la mano frente a la cámara.\n4. Activa control. Muestra palma abierta y luego mantén puño para Volver.\n\nLa detección continúa al abrir otra app. Pausa o detén desde la notificación. Perder la mano pausa el control; reactívalo aquí.\n\nLas imágenes se procesan en el teléfono y no se guardan. Esta prueba solo implementa Volver, no control completo del teléfono.");
        help.setTextSize(17); panel.addView(help);
        addButton(panel, "Conceder permisos", v -> permissions());
        addButton(panel, "Abrir ajustes de accesibilidad", v -> startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        addButton(panel, "Iniciar observación", v -> {
            if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) { permissions(); return; }
            try { startForegroundService(new Intent(this, CameraGestureService.class).setAction(CameraGestureService.START)); }
            catch (RuntimeException error) { CameraGestureService.status = "No se pudo iniciar el servicio desde esta pantalla."; }
        });
        addButton(panel, "Activar / reactivar control", v -> CameraGestureService.enableControl());
        addButton(panel, "Pausar", v -> CameraGestureService.pauseControl());
        addButton(panel, "DETENER CÁMARA Y CONTROL", v -> CameraGestureService.stopControl());
        status = new TextView(this); status.setTextSize(18); status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE); panel.addView(status);
        ScrollView scroll = new ScrollView(this); scroll.addView(panel); setContentView(scroll);
    }
    private void addButton(LinearLayout panel, String label, View.OnClickListener action) {
        Button button = new Button(this); button.setText(label); button.setOnClickListener(action); panel.addView(button);
    }
    private void permissions() {
        ArrayList<String> missing = new ArrayList<>();
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) missing.add(Manifest.permission.CAMERA);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) missing.add(Manifest.permission.POST_NOTIFICATIONS);
        if (!missing.isEmpty()) requestPermissions(missing.toArray(new String[0]), 7);
        else Toast.makeText(this, "Permisos concedidos. Inicia observación cuando quieras.", Toast.LENGTH_SHORT).show();
    }
    @Override protected void onResume() { super.onResume(); handler.post(refresh); }
    @Override protected void onPause() { handler.removeCallbacks(refresh); super.onPause(); }
}
