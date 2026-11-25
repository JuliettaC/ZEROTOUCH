"""Banco QA sintético del motor gestual de ZeroTouch (sin cámara).

Genera manos con un modelo cinemático simple (palma de frente a la cámara, dedos que se flexionan hacia
la cámara), en píxeles de una webcam 640x480 normalizados como MediaPipe (x/640, y/480), con:
- temblor por punto (σ en píxeles, mayor en las puntas), deriva lenta y ruido de profundidad z;
- cadencia de 15 o 30 FPS con variación, y cuadros sin mano;
- distancia a la cámara (tamaño de palma) y giro de la mano.

Mide el intérprete real (GestureInterpreter) con la configuración por defecto de la interfaz.
Los resultados son SINTÉTICOS: sirven para comparar versiones del motor, no prueban precisión con manos reales.

Uso (desde motor-local, ~2 min):  .venv/Scripts/python.exe -m tools.banco_qa
Resultados del QA del 19-11-2026 (antes / después) en docs/qa-comodidad-19-11.md.
"""

from __future__ import annotations

import math
import random
import statistics
import sys
from dataclasses import dataclass

from motor_local.config import EngineConfig
from motor_local.detector import HandLandmarks, Point3D
from motor_local.interpreter import GestureInterpreter

W, H = 640, 480
SCREEN_W, SCREEN_H = 1920, 1080

# Geometría de la mano en unidades de "longitud de palma" (muñeca -> base del medio = 1).
# y negativo = hacia arriba en la imagen.
MCP = {"index": (-0.33, -0.92), "middle": (0.0, -1.0), "ring": (0.27, -0.95), "pinky": (0.50, -0.84)}
BONES = {"index": (0.45, 0.27, 0.22), "middle": (0.50, 0.31, 0.24), "ring": (0.46, 0.29, 0.22), "pinky": (0.36, 0.22, 0.20)}
FINGER_IDX = {"index": (5, 6, 7, 8), "middle": (9, 10, 11, 12), "ring": (13, 14, 15, 16), "pinky": (17, 18, 19, 20)}
DIR = {"index": -0.10, "middle": 0.0, "ring": 0.08, "pinky": 0.18}  # abanico de los dedos (rad)


@dataclass
class Pose:
    """Flexión total de cada dedo (0 = extendido, 1 = plegado contra la palma) y pulgar."""

    index: float = 0.0
    middle: float = 0.0
    ring: float = 0.0
    pinky: float = 0.0
    thumb: str = "open"          # open | folded | up | down | pinch_index | pinch_middle
    pinch_gap: float = 0.0       # separación de la pinza, en palmas


POSES = {
    "abierta": Pose(),
    "relajada": Pose(index=0.15, middle=0.18, ring=0.2, pinky=0.22, thumb="open"),
    "puno": Pose(1, 1, 1, 1, "folded"),
    "dos_dedos": Pose(0, 0, 1, 1, "folded"),
    "tres_dedos": Pose(0, 0, 0, 1, "folded"),
    "indice_menique": Pose(0, 1, 1, 0, "folded"),
    "indice": Pose(0, 1, 1, 1, "folded"),
    "pulgar_arriba": Pose(1, 1, 1, 1, "up"),
    "pulgar_abajo": Pose(1, 1, 1, 1, "down"),
    "pulgar_menique": Pose(1, 1, 1, 0, "open"),
    "pinza": Pose(0.35, 0.1, 0.15, 0.2, "pinch_index"),
    "pinza_medio": Pose(0.0, 0.42, 0.2, 0.25, "pinch_middle"),
}


def _finger(name: str, curl: float) -> list[tuple[float, float, float]]:
    """Puntos MCP, PIP, DIP y punta: cada articulación se flexiona hacia la cámara (z negativo)."""
    bx, by = MCP[name]
    ang = DIR[name]
    pts = [(bx, by, 0.0)]
    x, y, z = bx, by, 0.0
    flex = 0.0
    for bone, joint in zip(BONES[name], (90.0, 100.0, 60.0)):
        flex += curl * math.radians(joint)          # MCP 90°, PIP 100°, DIP 60° en un puño
        planar = bone * math.cos(flex)
        x += planar * math.sin(ang)
        y -= planar * math.cos(ang)
        z -= bone * math.sin(flex)
        pts.append((x, y, z))
    return pts


def hand_points(pose: Pose) -> list[tuple[float, float, float]]:
    p: list[tuple[float, float, float]] = [(0.0, 0.0, 0.0)] * 21
    p[0] = (0.0, 0.0, 0.0)
    fingers = {n: _finger(n, getattr(pose, n)) for n in FINGER_IDX}
    for n, idxs in FINGER_IDX.items():
        for i, pt in zip(idxs, fingers[n]):
            p[i] = pt
    cmc = (-0.30, -0.18, 0.0)
    if pose.thumb == "open":
        mcp, ip, tip = (-0.58, -0.36, -0.05), (-0.82, -0.50, -0.08), (-1.04, -0.62, -0.10)
    elif pose.thumb == "folded":
        mcp, ip, tip = (-0.42, -0.42, -0.10), (-0.28, -0.60, -0.22), (-0.10, -0.66, -0.30)
    elif pose.thumb == "up":
        mcp, ip, tip = (-0.45, -0.45, -0.05), (-0.50, -0.80, -0.08), (-0.52, -1.10, -0.10)
    elif pose.thumb == "down":
        mcp, ip, tip = (-0.45, -0.25, -0.05), (-0.50, 0.10, -0.08), (-0.52, 0.42, -0.10)
    else:
        target = fingers["index" if pose.thumb == "pinch_index" else "middle"][3]
        tx, ty, tz = target
        tip = (tx - 0.05 - pose.pinch_gap, ty + 0.02, tz)
        mcp = (-0.50, -0.40, -0.05)
        ip = ((mcp[0] + tip[0]) / 2 - 0.06, (mcp[1] + tip[1]) / 2, (mcp[2] + tip[2]) / 2)
    p[1], p[2], p[3], p[4] = cmc, mcp, ip, tip
    return p


class Camera:
    """Proyecta la mano a coordenadas normalizadas de MediaPipe con ruido de webcam."""

    def __init__(self, rng: random.Random, palm_px: float = 80.0, jitter_px: float = 1.6, z_noise: float = 0.012,
                 roll_deg: float = 0.0, dropout: float = 0.03) -> None:
        self.rng = rng
        self.palm_px = palm_px          # longitud de palma en píxeles (≈ 45 cm: 85 px; ≈ 70 cm: 55 px)
        self.jitter_px = jitter_px
        self.z_noise = z_noise
        self.roll = math.radians(roll_deg)
        self.dropout = dropout
        self.drift = [0.0, 0.0]

    def frame(self, pose: Pose, cx_px: float, cy_px: float) -> HandLandmarks | None:
        if self.rng.random() < self.dropout:
            return None
        self.drift[0] = 0.92 * self.drift[0] + self.rng.gauss(0, 0.35)
        self.drift[1] = 0.92 * self.drift[1] + self.rng.gauss(0, 0.35)
        cr, sr = math.cos(self.roll), math.sin(self.roll)
        lms = []
        for i, (x, y, z) in enumerate(hand_points(pose)):
            rx, ry = x * cr - y * sr, x * sr + y * cr
            tip = i in (4, 8, 12, 16, 20)
            j = self.jitter_px * (1.6 if tip else 1.0)
            px = cx_px + rx * self.palm_px + self.drift[0] + self.rng.gauss(0, j)
            py = cy_px + ry * self.palm_px + self.drift[1] + self.rng.gauss(0, j)
            pz = z * self.palm_px / W + self.rng.gauss(0, self.z_noise)
            lms.append(Point3D(px / W, py / H, pz))
        return HandLandmarks(landmarks=lms, handedness="Right", confidence=0.92 + self.rng.uniform(-0.04, 0.04))


class Session:
    def __init__(self, fps: float = 30.0, seed: int = 1, config: EngineConfig | None = None, **cam) -> None:
        self.rng = random.Random(seed)
        self.cam = Camera(self.rng, **cam)
        self.interp = GestureInterpreter(config or EngineConfig.from_dict({}))
        self.fps = fps
        self.t = 0.0
        self.events: list[tuple[float, str, dict]] = []
        self.cursor: list[tuple[float, float, float]] = []

    def run(self, ms: float, pose: Pose | str, cx: float = 320, cy: float = 250, to: tuple[float, float] | None = None) -> None:
        if isinstance(pose, str):
            pose = POSES[pose]
        start = self.t
        x0, y0 = cx, cy
        while self.t < start + ms:
            frac = (self.t - start) / ms
            x, y = (x0 + (to[0] - x0) * frac, y0 + (to[1] - y0) * frac) if to else (x0, y0)
            hand = self.cam.frame(pose, x, y)
            for e in self.interp.process_frame(hand, now_ms=self.t):
                self.events.append((self.t, e.type, e.payload))
                if e.type == "MOVE_CURSOR":
                    self.cursor.append((self.t, e.payload["x"] * SCREEN_W, e.payload["y"] * SCREEN_H))
            self.t += 1000.0 / self.fps * self.rng.uniform(0.85, 1.15)

    def arm(self, cx: float = 320, cy: float = 250) -> float:
        start = self.t
        while not self.interp.pointer_armed and self.t - start < 5000:
            self.run(33, "abierta", cx, cy)
        return self.t - start

    def count(self, kind: str, since: float = 0.0) -> int:
        return sum(1 for t, k, _ in self.events if k == kind and t >= since)


# ------------------------------------------------------------------ mediciones

DIST = {"45cm": 85.0, "70cm": 55.0, "90cm": 42.0}


def m_jitter(fps: float, palm_px: float) -> float:
    """Temblor del cursor con la mano quieta (desviación típica, px de pantalla 1920x1080)."""
    s = Session(fps=fps, seed=7, palm_px=palm_px, dropout=0.0)
    s.arm()
    s.run(800, "abierta")
    t0 = s.t
    s.run(3000, "abierta")
    xs = [x for t, x, _ in s.cursor if t >= t0]
    ys = [y for t, _, y in s.cursor if t >= t0]
    # El cursor solo se informa cuando supera la zona muerta: se reconstruye la posición mantenida.
    if len(xs) < 2:
        return 0.0
    return round(math.hypot(statistics.pstdev(xs), statistics.pstdev(ys)), 1)


def m_reach(palm_px: float) -> tuple[float, float]:
    """Fracción del ancho/alto de la imagen que hay que recorrer con la mano para cruzar la pantalla."""
    cfg = EngineConfig.from_dict({})
    interp = GestureInterpreter(cfg)
    lo = hi = None
    for i in range(0, 1001):
        x = i / 1000
        nx, _ = interp._map_to_screen_norm(x, 0.5)
        if nx > 0.0 and lo is None:
            lo = x
        if nx >= 1.0 and hi is None:
            hi = x
    lo_y = hi_y = None
    for i in range(0, 1001):
        y = i / 1000
        _, ny = interp._map_to_screen_norm(0.5, y)
        if ny > 0.0 and lo_y is None:
            lo_y = y
        if ny >= 1.0 and hi_y is None:
            hi_y = y
    return round((hi or 1) - (lo or 0), 3), round((hi_y or 1) - (lo_y or 0), 3), (lo_y, hi_y)


def m_clicks(fps: float, palm_px: float, n: int = 40, close_ms: float = 140.0, seed: int = 3) -> dict:
    s = Session(fps=fps, seed=seed, palm_px=palm_px)
    s.arm()
    s.run(500, "relajada")
    since = s.t
    for _ in range(n):
        s.run(close_ms, "pinza")
        s.run(650, "relajada")
    return {"clics": s.count("LEFT_CLICK", since), "arrastres": s.count("START_DRAG", since), "de": n}


def m_false_clicks(fps: float, palm_px: float, seconds: float = 20.0, seed: int = 5) -> dict:
    """Mover el cursor con la mano relajada (dedos semiflexionados) sin intención de clic."""
    s = Session(fps=fps, seed=seed, palm_px=palm_px)
    s.arm()
    since = s.t
    rng = random.Random(seed)
    x, y = 320, 250
    for _ in range(int(seconds * 1000 / 400)):
        nx, ny = 320 + rng.uniform(-120, 120), 250 + rng.uniform(-90, 90)
        s.run(400, "relajada", x, y, to=(nx, ny))
        x, y = nx, ny
    return {k: s.count(k, since) for k in ("LEFT_CLICK", "RIGHT_CLICK", "START_DRAG", "SCROLL", "PAUSE", "PRECISION", "BACK", "FORWARD")}


def m_click_drift(fps: float, palm_px: float, seed: int = 9) -> float:
    """Cuánto se mueve el cursor (px) entre que empieza la pinza y el clic."""
    s = Session(fps=fps, seed=seed, palm_px=palm_px, dropout=0.0)
    s.arm()
    drifts = []
    for _ in range(15):
        s.run(500, "relajada")
        before = s.cursor[-1] if s.cursor else None
        s.run(140, "pinza")
        s.run(300, "relajada")
        clicks = [t for t, k, _ in s.events if k == "LEFT_CLICK"]
        if before and clicks:
            at = [c for c in s.cursor if c[0] <= clicks[-1]]
            if at:
                drifts.append(math.hypot(at[-1][1] - before[1], at[-1][2] - before[2]))
    return round(statistics.median(drifts), 1) if drifts else -1.0


def m_poses(fps: float, palm_px: float, seed: int = 11) -> dict:
    """Mantener cada postura 1,5 s: eventos que produce (quieta, sin moverse)."""
    out = {}
    for name in ("puno", "dos_dedos", "tres_dedos", "indice_menique", "pulgar_arriba", "pulgar_abajo", "pulgar_menique", "pinza_medio", "indice"):
        s = Session(fps=fps, seed=seed, palm_px=palm_px, config=EngineConfig.from_dict({}))
        s.arm()
        s.run(300, "relajada")
        since = s.t
        s.run(1500, name)
        s.run(400, "relajada")
        ev = [k for t, k, _ in s.events if t >= since and k not in ("MOVE_CURSOR", "TRACKING_LOST")]
        out[name] = sorted(set(ev)) or ["-"]
        out[name + " (postura)"] = s.interp.telemetry.gesture
    return out


def m_arming(fps: float, palm_px: float) -> dict:
    s = Session(fps=fps, seed=13, palm_px=palm_px)
    first = s.arm()
    s.run(300, "relajada")
    # Bajar la mano 3,5 s (fuera de cuadro) y volver: ¿hay que re-armar?
    s.cam.dropout = 1.0
    s.run(3500, "relajada")
    s.cam.dropout = 0.03
    rearm_needed = not s.interp.pointer_armed
    # Mano relajada (no del todo abierta) al volver: ¿arma?
    s.interp.pointer_armed = False
    t0 = s.t
    s.run(2000, "relajada")
    return {"armado_ms": round(first), "rearmar_tras_3.5s": rearm_needed, "arma_con_mano_relajada": s.interp.pointer_armed}


def m_latency(fps: float, palm_px: float) -> float:
    """ms desde que la mano salta 60 px a la derecha hasta que el cursor recorre el 90 %."""
    s = Session(fps=fps, seed=17, palm_px=palm_px, dropout=0.0)
    s.arm()
    s.run(800, "abierta")
    x0 = s.cursor[-1][1]
    t0 = s.t
    s.run(1500, "abierta", 380, 250)
    xs = [(t, x) for t, x, _ in s.cursor if t >= t0]
    final = xs[-1][1]
    for t, x in xs:
        if abs(x - x0) >= 0.9 * abs(final - x0):
            return round(t - t0)
    return -1


def m_slow(fps: float, palm_px: float) -> tuple[float, float]:
    """Movimiento lento y preciso: la mano avanza 12 px en 1,5 s. Devuelve (px de pantalla recorridos por el
    cursor, error final respecto a la posición sin asentar) para ver que el cursor no se queda pegado."""
    s = Session(fps=fps, seed=47, palm_px=palm_px, dropout=0.0)
    s.arm(); s.run(800, "abierta")
    x0 = s.cursor[-1][1]
    s.run(1500, "abierta", 320, 250, to=(332, 250)); s.run(600, "abierta", 332, 250)
    moved = s.cursor[-1][1] - x0
    nx, _ = s.interp._map_to_screen_norm(s.interp._compute_skeletal_anchor(s.cam.frame(POSES["abierta"], 332, 250).landmarks)[0], 0.5)
    return round(moved, 1), round(abs(s.cursor[-1][1] - nx * SCREEN_W), 1)


def m_sweep(fps: float, palm_px: float, config: EngineConfig | None = None) -> tuple[int, int, int]:
    """Barrido rápido de la mano hacia la derecha (0,22 de la imagen en 0,35 s), pausa, y vuelta.
    Devuelve (x del cursor al llegar, x tras volver, x inicial) en px de pantalla."""
    s = Session(fps=fps, seed=53, palm_px=palm_px, dropout=0.0, config=config)
    s.arm(); s.run(600, "abierta")
    x0 = s.cursor[-1][1]
    s.run(350, "abierta", 320, 250, to=(320 + 0.22 * W, 250)); s.run(500, "abierta", 320 + 0.22 * W, 250)
    x1 = s.cursor[-1][1]
    s.run(350, "abierta", 320 + 0.22 * W, 250, to=(320, 250)); s.run(500, "abierta", 320, 250)
    return round(x1), round(s.cursor[-1][1]), round(x0)


def m_moving(fps: float, palm_px: float) -> dict:
    out = {}
    s = Session(fps=fps, seed=19, palm_px=palm_px)
    s.arm(); s.run(300, "relajada"); s.run(250, "dos_dedos"); since = s.t
    s.run(900, "dos_dedos", 320, 250, to=(320, 250 + 1.5 * palm_px))
    out["desplazar 1,5 palmas (muescas)"] = sum(abs(p.get("dy", 0)) for t, k, p in s.events if k == "SCROLL" and t >= since)
    s = Session(fps=fps, seed=23, palm_px=palm_px)
    s.arm(); s.run(300, "relajada"); s.run(250, "pulgar_menique"); since = s.t
    s.run(1200, "pulgar_menique", 320, 250, to=(320, 250 + 2.2 * palm_px))
    out["pestañas al bajar 2,2 palmas (esperado 4)"] = s.count("NEXT_TAB", since)
    s = Session(fps=fps, seed=29, palm_px=palm_px)
    s.arm(); s.run(300, "relajada"); since = s.t
    s.run(1000, "pinza", 320, 250, to=(400, 300)); s.run(400, "relajada", 400, 300)
    out["pinza sostenida (arrastre/suelta/clic)"] = (s.count("START_DRAG", since), s.count("END_DRAG", since), s.count("LEFT_CLICK", since))
    s = Session(fps=fps, seed=31, palm_px=palm_px)
    s.arm(); s.run(300, "relajada"); since = s.t
    s.run(1200, "pinza_medio"); s.run(400, "relajada")
    out["pinza medio larga (clic derecho, esperado 0)"] = s.count("RIGHT_CLICK", since)
    s = Session(fps=fps, seed=37, palm_px=palm_px)
    s.arm(); s.run(300, "relajada"); since = s.t
    for _ in range(10):
        s.run(150, "pinza_medio"); s.run(600, "relajada")
    out["10 pinzas con el medio (clics derechos)"] = (s.count("RIGHT_CLICK", since), s.count("LEFT_CLICK", since))
    out["10 puños (pausas+reanudar / arrastres)"] = m_fists(fps, palm_px)
    return out


def m_fists(fps: float, palm_px: float) -> tuple[int, int]:
    s = Session(fps=fps, seed=41, palm_px=palm_px)
    s.arm()
    since = s.t
    for _ in range(10):
        s.run(300, "relajada")
        # cerrar la mano en 150 ms pasando por posturas intermedias
        for k in range(5):
            f = (k + 1) / 5
            s.run(30, Pose(f, f, f, f, "folded" if f > 0.5 else "open"))
        s.run(900, "puno")
        s.run(500, "relajada")
    return s.count("PAUSE", since) + s.count("RESUME", since), s.count("START_DRAG", since)


def report() -> None:
    print("== Alcance (fracción de la imagen para cruzar la pantalla, config por defecto) ==")
    print(m_reach(85))
    for fps in (30.0, 15.0):
        for label, palm in DIST.items():
            print(f"\n== {fps:.0f} FPS, mano a {label} (palma {palm:.0f} px) ==")
            print("temblor cursor quieto (px):", m_jitter(fps, palm))
            print("clic: deriva mediana (px):", m_click_drift(fps, palm))
            print("40 pinzas de 140 ms:", m_clicks(fps, palm))
            print("20 s moviendo sin intención:", {k: v for k, v in m_false_clicks(fps, palm).items() if v})
            print("latencia cursor 90 % (ms):", m_latency(fps, palm))
            print("movimiento lento 12 px cámara (px recorridos, error final px):", m_slow(fps, palm))
            print("armado:", m_arming(fps, palm))
            for k, v in m_moving(fps, palm).items():
                print(f"   {k}: {v}")
            for k, v in m_poses(fps, palm).items():
                if not k.endswith("(postura)"):
                    print(f"   quieta {k}: {v}")


if __name__ == "__main__":
    report()
