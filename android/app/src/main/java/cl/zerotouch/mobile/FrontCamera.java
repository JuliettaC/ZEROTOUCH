package cl.zerotouch.mobile;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.ImageFormat;
import android.graphics.Matrix;
import android.graphics.Rect;
import android.hardware.camera2.*;
import android.media.Image;
import android.media.ImageReader;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;
import android.util.Size;
import android.view.WindowManager;
import com.google.mediapipe.framework.image.BitmapImageBuilder;
import com.google.mediapipe.framework.image.MPImage;
import com.google.mediapipe.tasks.core.BaseOptions;
import com.google.mediapipe.tasks.components.containers.Category;
import com.google.mediapipe.tasks.vision.core.RunningMode;
import com.google.mediapipe.tasks.vision.gesturerecognizer.GestureRecognizer;
import java.nio.ByteBuffer;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.LongSupplier;

/** Camera2 capture and real, local MediaPipe inference. Never writes frames to disk. */
final class FrontCamera implements AutoCloseable {
    interface Listener {
        void result(long epoch, long captured, String gesture, float score, boolean hand);
        void error(String message);
    }
    private final Context context;
    private final Listener listener;
    private final LongSupplier epoch;
    private final HandlerThread cameraThread = new HandlerThread("zt-camera");
    private final ExecutorService inference = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean();
    private Handler cameraHandler;
    private volatile boolean closed;
    private CameraDevice camera;
    private CameraCaptureSession session;
    private ImageReader reader;
    private GestureRecognizer recognizer;
    private int sensorOrientation;

    FrontCamera(Context context, LongSupplier epoch, Listener listener) {
        this.context = context; this.epoch = epoch; this.listener = listener;
    }
    void start() {
        cameraThread.start(); cameraHandler = new Handler(cameraThread.getLooper());
        inference.execute(() -> {
            try {
                recognizer = GestureRecognizer.createFromOptions(context,
                    GestureRecognizer.GestureRecognizerOptions.builder()
                        .setBaseOptions(BaseOptions.builder().setModelAssetPath("gesture_recognizer.task").build())
                        .setRunningMode(RunningMode.VIDEO).setNumHands(1)
                        .setMinHandDetectionConfidence(0.6f).setMinHandPresenceConfidence(0.6f)
                        .setMinTrackingConfidence(0.6f).build());
                if (!closed) cameraHandler.post(this::openCamera);
            } catch (RuntimeException | LinkageError error) { listener.error("No se pudo cargar el modelo local de gestos."); }
        });
    }
    @SuppressLint("MissingPermission")
    private void openCamera() {
        if (closed) return;
        try {
            CameraManager manager = context.getSystemService(CameraManager.class);
            String front = null;
            for (String id : manager.getCameraIdList()) {
                if (Integer.valueOf(CameraCharacteristics.LENS_FACING_FRONT).equals(
                        manager.getCameraCharacteristics(id).get(CameraCharacteristics.LENS_FACING))) { front = id; break; }
            }
            if (front == null) throw new IllegalStateException("No front camera");
            CameraCharacteristics characteristics = manager.getCameraCharacteristics(front);
            sensorOrientation = characteristics.get(CameraCharacteristics.SENSOR_ORIENTATION);
            Size[] sizes = characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
                .getOutputSizes(ImageFormat.YUV_420_888);
            Size size = Arrays.stream(sizes).filter(s -> s.getWidth() <= 640 && s.getHeight() <= 480)
                .max(Comparator.comparingInt(s -> s.getWidth() * s.getHeight()))
                .orElseThrow(() -> new IllegalStateException("No low resolution YUV stream"));
            reader = ImageReader.newInstance(size.getWidth(), size.getHeight(), ImageFormat.YUV_420_888, 3);
            reader.setOnImageAvailableListener(source -> {
                try { frameAvailable(source); }
                catch (RuntimeException error) { if (!closed) listener.error("Falló la lectura de cámara."); }
            }, cameraHandler);
            manager.openCamera(front, new CameraDevice.StateCallback() {
                @Override public void onOpened(CameraDevice device) {
                    if (closed) { device.close(); return; }
                    camera = device; configure();
                }
                @Override public void onDisconnected(CameraDevice device) { device.close(); listener.error("Cámara desconectada."); }
                @Override public void onError(CameraDevice device, int error) { device.close(); listener.error("Cámara no disponible o permiso retirado."); }
            }, cameraHandler);
        } catch (CameraAccessException | RuntimeException error) { listener.error("No se pudo abrir la cámara frontal. Revisa permiso y disponibilidad."); }
    }
    private void configure() {
        try {
            camera.createCaptureSession(Collections.singletonList(reader.getSurface()), new CameraCaptureSession.StateCallback() {
                @Override public void onConfigured(CameraCaptureSession configured) {
                    if (closed) { configured.close(); return; }
                    session = configured;
                    try {
                        CaptureRequest.Builder request = camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
                        request.addTarget(reader.getSurface());
                        request.set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO);
                        session.setRepeatingRequest(request.build(), null, cameraHandler);
                    } catch (CameraAccessException | RuntimeException error) { listener.error("No se pudo iniciar captura."); }
                }
                @Override public void onConfigureFailed(CameraCaptureSession configured) { listener.error("Formato de cámara no compatible."); }
            }, cameraHandler);
        } catch (CameraAccessException | RuntimeException error) { listener.error("Falló la sesión de cámara."); }
    }
    private void frameAvailable(ImageReader source) {
        if (closed) return;
        Image image = source.acquireLatestImage();
        if (image == null) return;
        if (!busy.compareAndSet(false, true)) { image.close(); return; }
        long captured = SystemClock.elapsedRealtime(), token = epoch.getAsLong();
        int display = context.getSystemService(WindowManager.class).getDefaultDisplay().getRotation() * 90;
        int rotation = (sensorOrientation + display) % 360;
        inference.execute(() -> {
            Bitmap bitmap = null, rotated = null;
            try {
                if (closed) return;
                bitmap = toBitmap(image);
                Matrix transform = new Matrix(); transform.postRotate(rotation);
                rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), transform, false);
                try (MPImage input = new BitmapImageBuilder(rotated).build()) {
                    var result = recognizer.recognizeForVideo(input, captured);
                    boolean hand = !result.landmarks().isEmpty();
                    Category category = result.gestures().isEmpty() || result.gestures().get(0).isEmpty()
                        ? null : result.gestures().get(0).get(0);
                    if (!closed) listener.result(token, captured, category == null ? "" : category.categoryName(),
                        category == null ? 0 : category.score(), hand);
                }
            } catch (RuntimeException | LinkageError error) { if (!closed) listener.error("Falló la detección local; control detenido."); }
            finally {
                image.close();
                if (rotated != null && rotated != bitmap) rotated.recycle();
                if (bitmap != null) bitmap.recycle();
                busy.set(false);
            }
        });
    }
    private static Bitmap toBitmap(Image image) {
        Rect crop = image.getCropRect(); int width = crop.width(), height = crop.height();
        Image.Plane[] planes = image.getPlanes();
        ByteBuffer y = planes[0].getBuffer(), u = planes[1].getBuffer(), v = planes[2].getBuffer();
        int[] pixels = new int[width * height];
        for (int row = 0; row < height; row++) for (int col = 0; col < width; col++) {
            int x = col + crop.left, yy = row + crop.top;
            int luminance = (y.get(yy * planes[0].getRowStride() + x * planes[0].getPixelStride()) & 255) - 16;
            int blue = (u.get(yy / 2 * planes[1].getRowStride() + x / 2 * planes[1].getPixelStride()) & 255) - 128;
            int red = (v.get(yy / 2 * planes[2].getRowStride() + x / 2 * planes[2].getPixelStride()) & 255) - 128;
            int c = Math.max(0, luminance) * 298;
            pixels[row * width + col] = 0xff000000 | (clamp((c + 409 * red + 128) >> 8) << 16)
                | (clamp((c - 100 * blue - 208 * red + 128) >> 8) << 8) | clamp((c + 516 * blue + 128) >> 8);
        }
        return Bitmap.createBitmap(pixels, width, height, Bitmap.Config.ARGB_8888);
    }
    private static int clamp(int value) { return Math.max(0, Math.min(255, value)); }
    @Override public void close() {
        if (closed) return;
        closed = true;
        cameraHandler.post(() -> {
            if (session != null) session.close();
            if (camera != null) camera.close();
            // Release the reader/model after the in-flight inference releases its image.
            inference.execute(() -> {
                if (reader != null) reader.close();
                if (recognizer != null) recognizer.close();
            });
            inference.shutdown(); cameraThread.quitSafely();
        });
    }
}
