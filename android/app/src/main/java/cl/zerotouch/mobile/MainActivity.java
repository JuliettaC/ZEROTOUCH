package cl.zerotouch.mobile;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.text.InputType;
import android.content.pm.PackageManager;
import android.os.*;
import android.provider.Settings;
import android.view.View;
import android.widget.*;
import java.util.ArrayList;

/** Native proof UI. Camera/control starts only after a visible, explicit user action. */
public final class MainActivity extends Activity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private TextView status, modeStatus;
    private EditText server, user, password;
    private Button refreshButton;
    private final java.util.concurrent.ExecutorService network = java.util.concurrent.Executors.newSingleThreadExecutor();
    private static ApiClient api;            // cookie de sesión solo en memoria del proceso
    private static String apiServer, apiUser;
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
        help.setText("1. Concede cámara y notificaciones.\n2. Activa ZeroTouch en Accesibilidad.\n3. Inicia observación y coloca la mano frente a la cámara.\n4. Activa control. Muestra la palma abierta y luego sostén uno de los gestos de la lista «Gestos vigentes». Abre la mano entre un gesto y otro.\n\nLa detección continúa al abrir otra app. Pausa o detén desde la notificación. Perder la mano pausa el control; reactívalo aquí.\n\nLas imágenes se procesan en el teléfono y no se guardan. No hay puntero ni toques: solo las acciones de la lista.");
        help.setTextSize(17); panel.addView(help);
        addModeSection(panel);
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
    /**
     * «Modo desde la cuenta»: lee (solo lectura) el primer modo con plataforma «movil» de la API del PC.
     * La contraseña no se guarda y se borra del campo tras iniciar sesión; la cookie vive en memoria.
     * Si falla, se mantiene lo que ya estaba aplicado y se dice; nunca se simula un éxito.
     */
    private void addModeSection(LinearLayout panel) {
        TextView title = new TextView(this); title.setText("\nModo desde la cuenta (solo lectura)"); title.setTextSize(20); panel.addView(title);
        SharedPreferences prefs = getSharedPreferences("zerotouch", MODE_PRIVATE);
        String lan = BuildConfig.ZT_LAN_HOST;
        TextView note = new TextView(this); note.setTextSize(15);
        note.setText(lan.isEmpty()
            ? "Esta APK no permite HTTP sin cifrar: solo un servidor https. Para el PC de la demo, compílala con -PztLanHost=<IP del PC>."
            : "HTTP sin cifrar permitido solo hacia " + lan + " (IP con que se compiló la APK).");
        panel.addView(note);
        server = field(panel, "Servidor, p. ej. http://192.168.1.20:3000", prefs.getString("server", lan.isEmpty() ? "" : "http://" + lan + ":3000"), InputType.TYPE_TEXT_VARIATION_URI);
        user = field(panel, "Usuario o correo", prefs.getString("user", ""), InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        password = field(panel, "Contraseña (no se guarda)", "", InputType.TYPE_TEXT_VARIATION_PASSWORD);
        refreshButton = new Button(this); refreshButton.setText("Actualizar modo"); refreshButton.setOnClickListener(v -> refreshMode()); panel.addView(refreshButton);
        modeStatus = new TextView(this); modeStatus.setTextSize(17); modeStatus.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        panel.addView(modeStatus);
        showMode(null);
    }
    private EditText field(LinearLayout panel, String hint, String value, int variation) {
        EditText edit = new EditText(this); edit.setHint(hint); edit.setText(value); edit.setSingleLine(true);
        edit.setInputType(InputType.TYPE_CLASS_TEXT | variation); panel.addView(edit); return edit;
    }
    private void showMode(String problem) {
        String text = (problem == null ? "" : "No se actualizó: " + problem + "\nSigue aplicado lo anterior.\n\n")
            + CameraGestureService.configuredSource + "\n\nGestos vigentes:\n" + CameraGestureService.configuredActions().describe();
        modeStatus.setText(text);
    }
    private void refreshMode() {
        final String url = server.getText().toString().trim(), name = user.getText().toString().trim(), secret = password.getText().toString();
        final String normalized;
        try { normalized = ApiClient.normalize(url); }
        catch (ApiClient.ApiException bad) { showMode(bad.getMessage()); return; }
        getSharedPreferences("zerotouch", MODE_PRIVATE).edit().putString("server", normalized).putString("user", name).apply();
        if (api == null || !normalized.equals(apiServer) || !name.equals(apiUser)) {
            try { api = new ApiClient(normalized); apiServer = normalized; apiUser = name; }
            catch (ApiClient.ApiException bad) { showMode(bad.getMessage()); return; }
        }
        final ApiClient client = api;
        refreshButton.setEnabled(false); modeStatus.setText("Consultando la API…");
        network.execute(() -> {
            ModeLoader.Result result = ModeLoader.load(client, name, secret);
            handler.post(() -> {
                refreshButton.setEnabled(true);
                if (!result.ok) { showMode(result.message); return; }
                password.setText("");
                String time = new java.text.SimpleDateFormat("HH:mm", java.util.Locale.ROOT).format(new java.util.Date());
                boolean paused = CameraGestureService.applyActions(result.actions, result.message + " (" + time + ")");
                showMode(null);
                if (paused) Toast.makeText(this, "Control pausado para cambiar de modo. Reactívalo cuando quieras.", Toast.LENGTH_LONG).show();
            });
        });
    }
    @Override protected void onDestroy() { network.shutdownNow(); super.onDestroy(); }
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
