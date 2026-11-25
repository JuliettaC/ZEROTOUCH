"""Procesa LOCALMENTE los videos reales de cada gesto para las fichas de la interfaz (public/gestos/*.mp4).

Qué hace con cada video (sin subir nada a ningún servicio y sin generar contenido con IA):
  1. Conserva la duración y la velocidad: solo remuestrea a 30 fps constantes repitiendo o saltando el fotograma
     más cercano (nunca interpola). En «desplazar» une «hacia arriba» y «hacia abajo» con corte limpio.
  2. Quita el fondo: máscara anatómica de la mano y la muñeca guiada por los landmarks de MediaPipe Hands +
     MediaPipe Selfie Segmentation (en fotogramas con desenfoque de movimiento) + modelo cromático de piel del
     propio video, excluyendo cara/cuello (MediaPipe Face Detection), mangas y objetos cercanos. La máscara se
     afina con un filtro guiado, se suaviza en el tiempo (mediana de 3 fotogramas) y en el borde (≈2–3 px).
  3. Pone un fondo liso #e5e6ea (u opcionalmente un degradado #f4f4f6 → #e5e6ea).
  4. Ajusta color: exposición/contraste suaves, −18 % de saturación y balance hacia neutro/frío; contorno fino
     opcional #4f6857 al 60 %. La piel mantiene su tono natural sin teñirse.
  5. Mejora sin inventar detalle: reducción de ruido temporal (fastNlMeansDenoisingColoredMulti), unsharp
     moderado y estabilización por el fondo solo si la cámara tiembla de forma medible.
  6. Exporta MP4 H.264 yuv420p sin audio, 30 fps, faststart y < 1 MB (sube CRF hasta 28; si no entra, baja la
     altura de 540 a 480 px antes de bajar más la calidad).

El codificador es el ffmpeg local que trae imageio-ffmpeg (pip, dentro de motor-local/.venv).

Uso (desde motor-local):
  .venv/Scripts/python.exe -m tools.procesar_videos_gestos --nuevos "<carpeta clips nuevos>" \
      --antiguos "<carpeta clips antiguos>" --salida "../public/gestos" [--solo clic,mover] [--previa <dir>]

Las carpetas de entrada (videos con la cara de la persona usuaria) están fuera de Git; las rutas se pasan como
argumentos. --previa guarda hojas de control (fotogramas de la salida) para revisar restos de fondo.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from scipy.ndimage import gaussian_filter1d

FPS_SALIDA = 30
LIMITE_BYTES = 1_000_000
FONDO = (0xEA, 0xE6, 0xE5)  # BGR de #e5e6ea
FONDO_CLARO = (0xF6, 0xF4, 0xF4)  # BGR de #f4f4f6
CONTORNO = (0x57, 0x68, 0x4F)  # BGR de #4f6857

# (salida, carpeta, nombres candidatos de cada parte en orden). La primera variante que exista se usa.
TRABAJOS = [
    ("clic.mp4", "nuevos", [["click izquierdo_1.mp4", "click izquierdo.mp4"]]),
    ("clic-derecho.mp4", "nuevos", [["click derecho_1.mp4", "click derecho.mp4"]]),
    ("arrastrar.mp4", "nuevos", [["arrastrar_1.mp4", "arrastrar.mp4"]]),
    ("pausar.mp4", "nuevos", [["pausar - activar_1.mp4", "pausar - activar.mp4"]]),
    ("alt-tab.mp4", "nuevos", [["alt tab.mp4", "alt tab_1.mp4"]]),
    ("nueva-pestana.mp4", "nuevos", [["nueva pestaña_1.mp4", "nueva pestaña.mp4"]]),
    (
        "desplazar.mp4",
        "nuevos",
        [
            ["desplazamiento hacia arriba_1.mp4", "desplazamiento hacia arriba.mp4"],
            ["desplazamiento hacia abajo_1.mp4", "desplazamiento hacia abajo.mp4"],
        ],
    ),
    ("mover.mp4", "antiguos", [["mover cursor.mp4"]]),
]

# Cada segmento lleva un factor anatómico propio: el meñique es más fino que el pulgar o la palma.
HUESOS_RADIO = [
    (0, 1, 0.105), (1, 2, 0.098), (2, 3, 0.092), (3, 4, 0.086),
    (0, 5, 0.105), (5, 6, 0.090), (6, 7, 0.084), (7, 8, 0.078),
    (9, 10, 0.090), (10, 11, 0.084), (11, 12, 0.078),
    (13, 14, 0.086), (14, 15, 0.080), (15, 16, 0.074),
    (0, 17, 0.098), (17, 18, 0.076), (18, 19, 0.070), (19, 20, 0.065),
    (5, 9, 0.100), (9, 13, 0.100), (13, 17, 0.095),
]
PUNTAS_RADIO = [(3, 4, 0.084), (7, 8, 0.076), (11, 12, 0.076), (15, 16, 0.072), (19, 20, 0.064)]
PALMA = [0, 1, 2, 5, 9, 13, 17]


@dataclass
class Clip:
    fotogramas: list[np.ndarray]  # BGR a resolución de trabajo
    fps: float
    duracion: float


# ----------------------------------------------------------------------------------------------- lectura
def leer_video(ruta: Path, alto_trabajo: int) -> Clip:
    cap = cv2.VideoCapture(str(ruta))
    if not cap.isOpened():
        raise SystemExit(f"No se pudo abrir {ruta.name}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    fotos = []
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        h, w = fr.shape[:2]
        if h != alto_trabajo:
            fr = cv2.resize(fr, (round(w * alto_trabajo / h / 2) * 2, alto_trabajo), interpolation=cv2.INTER_AREA)
        fotos.append(fr)
    cap.release()
    if not fotos:
        raise SystemExit(f"{ruta.name} no tiene fotogramas")
    return Clip(fotos, fps, len(fotos) / fps)


# ------------------------------------------------------------------------------------------- detecciones
def detectar_manos(fotos: list[np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    """Devuelve ((N, 21, 2) en píxeles con huecos interpolados, máscara booleana de detección directa)."""
    import mediapipe as mp

    n = len(fotos)
    pts = np.full((n, 21, 2), np.nan, np.float32)
    with mp.solutions.hands.Hands(
        static_image_mode=False, max_num_hands=1, model_complexity=1,
        min_detection_confidence=0.4, min_tracking_confidence=0.4,
    ) as hands:
        for i, fr in enumerate(fotos):
            res = hands.process(cv2.cvtColor(fr, cv2.COLOR_BGR2RGB))
            if res.multi_hand_landmarks:
                h, w = fr.shape[:2]
                pts[i] = [(p.x * w, p.y * h) for p in res.multi_hand_landmarks[0].landmark]
    validos = ~np.isnan(pts[:, 0, 0])
    if not validos.any():
        raise SystemExit("MediaPipe no encontró la mano en ningún fotograma")
    idx = np.arange(n)
    plano = pts.reshape(n, -1)
    for c in range(plano.shape[1]):
        plano[:, c] = np.interp(idx, idx[validos], plano[validos, c])
    plano = gaussian_filter1d(plano, sigma=0.7, axis=0, mode="nearest")
    print(f"    mano detectada en {validos.sum()}/{n} fotogramas")
    return plano.reshape(n, 21, 2), validos


def detectar_caras(fotos: list[np.ndarray]) -> list[list[tuple[int, int, int, int]]]:
    import mediapipe as mp

    cajas = []
    with mp.solutions.face_detection.FaceDetection(model_selection=1, min_detection_confidence=0.4) as fd:
        for fr in fotos:
            h, w = fr.shape[:2]
            res = fd.process(cv2.cvtColor(fr, cv2.COLOR_BGR2RGB))
            lista = []
            for d in res.detections or []:
                b = d.location_data.relative_bounding_box
                x, y, bw, bh = b.xmin * w, b.ymin * h, b.width * w, b.height * h
                # caja ampliada: frente, pelo, orejas y cuello/escote tampoco deben quedar visibles
                lista.append((int(x - 0.45 * bw), int(y - 0.65 * bh), int(x + 1.45 * bw), int(y + 1.85 * bh)))
            cajas.append(lista)
    for i in range(len(cajas)):
        if not cajas[i]:
            vecinos = [cajas[j] for j in (i - 1, i + 1, i - 2, i + 2) if 0 <= j < len(cajas) and cajas[j]]
            if vecinos:
                cajas[i] = vecinos[0]
    return cajas


def detectar_silueta(fotos: list[np.ndarray]) -> list[np.ndarray]:
    import mediapipe as mp

    with mp.solutions.selfie_segmentation.SelfieSegmentation(model_selection=1) as ss:
        return [ss.process(cv2.cvtColor(fr, cv2.COLOR_BGR2RGB)).segmentation_mask for fr in fotos]


# ------------------------------------------------------------------------------------------- máscaras
def escala_mano(p: np.ndarray) -> float:
    return float(max(np.linalg.norm(p[0] - p[9]), 1.25 * np.linalg.norm(p[5] - p[17]), 8.0))


def dibujar_mano(shape, p: np.ndarray, factor_radio: float, margen_palma: float) -> np.ndarray:
    m = np.zeros(shape, np.uint8)
    s = escala_mano(p)
    for a, b, rb in HUESOS_RADIO:
        r = max(int(rb * s * factor_radio), 2)
        cv2.line(m, tuple(np.int32(p[a])), tuple(np.int32(p[b])), 255, 2 * r, cv2.LINE_AA)
    for a, b, rb in PUNTAS_RADIO:  # el landmark de la punta queda dentro de la yema: prolongar hacia la uña
        r = max(int(rb * s * factor_radio), 2)
        d = p[b] - p[a]
        d = d / (np.linalg.norm(d) + 1e-6)
        cv2.line(m, tuple(np.int32(p[b])), tuple(np.int32(p[b] + d * r * 0.95)), 255, 2 * r, cv2.LINE_AA)
    palma = np.zeros(shape, np.uint8)
    cv2.fillPoly(palma, [np.int32(cv2.convexHull(p[PALMA]))], 255)
    if margen_palma > 0:
        k = max(int(margen_palma * s), 1) * 2 + 1
        palma = cv2.dilate(palma, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    return cv2.bitwise_or(m, palma)


def zona_muneca(shape, p: np.ndarray) -> np.ndarray:
    """Cápsula corta desde la muñeca hacia el antebrazo: evita llegar al codo, mangas o pliegues lejanos."""
    m = np.zeros(shape, np.uint8)
    s = escala_mano(p)
    base = p[[5, 9, 13, 17]].mean(axis=0)
    u = p[0] - base
    u = u / (np.linalg.norm(u) + 1e-6)
    r = max(int(0.46 * np.linalg.norm(p[5] - p[17]) + 0.06 * s), 4)
    ini = p[0] - u * 0.10 * s
    for ang in (-16.0, 0.0, 16.0):
        rad = np.radians(ang)
        d = np.array([u[0] * np.cos(rad) - u[1] * np.sin(rad), u[0] * np.sin(rad) + u[1] * np.cos(rad)])
        fin = p[0] + d * 1.25 * s
        cv2.line(m, tuple(np.int32(ini)), tuple(np.int32(fin)), 255, 2 * r, cv2.LINE_AA)
    return m


def modelo_piel(fotos, pts, validos):
    """Media y covarianza de (Cr, Cb), rango de Y y croma mínimo rojizo Cr de la palma real."""
    muestras = []
    indices = np.where(validos)[0]
    paso = max(len(indices) // 25, 1)
    for i in indices[::paso]:
        p = pts[i]
        m = np.zeros(fotos[i].shape[:2], np.uint8)
        cv2.fillPoly(m, [np.int32(cv2.convexHull(p[[0, 1, 5, 9, 13, 17]]))], 255)
        m = cv2.erode(m, np.ones((9, 9), np.uint8))
        if (m > 0).sum() < 25:
            continue
        ycc = cv2.cvtColor(fotos[i], cv2.COLOR_BGR2YCrCb)
        muestras.append(ycc[m > 0])
    x = np.concatenate(muestras).astype(np.float32)
    media = x[:, 1:].mean(axis=0)
    cov = np.cov(x[:, 1:].T) + np.eye(2) * 3.5
    y_min, y_max = np.percentile(x[:, 0], [1, 99.5])
    cr_min = float(np.percentile(x[:, 1], 2)) - 4.0  # excluye tejidos crema/grises menos cálidos que la piel
    return media, np.linalg.inv(cov), max(y_min * 0.60, 28.0), min(y_max * 1.12 + 12.0, 255.0), cr_min


def prob_piel(fr, modelo) -> np.ndarray:
    media, icov, y_min, y_max, cr_min = modelo
    suave = cv2.GaussianBlur(fr, (5, 5), 0)
    ycc = cv2.cvtColor(suave, cv2.COLOR_BGR2YCrCb).astype(np.float32)
    d = ycc[..., 1:] - media
    d2 = np.einsum("...i,ij,...j->...", d, icov, d)
    p = np.clip((3.1 - np.sqrt(d2)) / 1.3, 0, 1)  # 1 si d < 1.8, 0 si d > 3.1
    # penaliza texturas rugosas de ropa tejida (alta desviación local de luminancia)
    y = ycc[..., 0]
    var_local = np.maximum(cv2.GaussianBlur(y * y, (7, 7), 0) - cv2.GaussianBlur(y, (7, 7), 0) ** 2, 0.0)
    liso = np.clip((22.0 - np.sqrt(var_local)) / 10.0, 0.0, 1.0)
    p *= (y > y_min) & (y < y_max) & (ycc[..., 1] > cr_min)
    return (p * (0.35 + 0.65 * liso)).astype(np.float32)


def rellenar_huecos(m: np.ndarray, area_max: float) -> np.ndarray:
    inv = cv2.bitwise_not(m)
    n, lab, st, _ = cv2.connectedComponentsWithStats(inv, 8)
    for k in range(1, n):
        x, y, w, h, a = st[k]
        borde = x == 0 or y == 0 or x + w >= m.shape[1] or y + h >= m.shape[0]
        if a < area_max and not borde:
            m[lab == k] = 255
    return m


def mascaras(fotos, pts, validos, caras, siluetas) -> list[np.ndarray]:
    modelo = modelo_piel(fotos, pts, validos)
    hay_caras = any(bool(c) for c in caras)
    alfas = []
    for fr, p, directo, cajas, sil in zip(fotos, pts, validos, caras, siluetas):
        shape = fr.shape[:2]
        s = escala_mano(p)
        nucleo = dibujar_mano(shape, p, 0.72, 0.0)
        previa = dibujar_mano(shape, p, 1.18 if directo else 1.55, 0.03 if directo else 0.08)
        muneca = zona_muneca(shape, p)
        piel = prob_piel(fr, modelo) > 0.48
        # cuando hay desenfoque de movimiento (sin detección directa) y SelfieSegmentation ve a la persona,
        # apoyamos la silueta de la mano evitando ropa oscura y fondo blanco
        if not directo and hay_caras:
            ycc = cv2.cvtColor(fr, cv2.COLOR_BGR2YCrCb)
            apoyo = (sil > 0.45) & (ycc[..., 0] > 70) & (ycc[..., 1] > modelo[4] - 5.0)
            piel = piel | (apoyo & (previa > 0))
        # si SelfieSegmentation tiene confianza alta en este cuadro, descarta objetos de pared (bolsos, pizarras)
        if float((sil > 0.5).mean()) > 0.05:
            en_persona = (sil > 0.20) | (dibujar_mano(shape, p, 1.02, 0.02) > 0)
            piel = piel & en_persona
        m = ((previa > 0) | (muneca > 0)) & piel
        mano_frente_cara = dibujar_mano(shape, p, 1.05, 0.0) > 0
        for x0, y0, x1, y1 in cajas:
            cara = np.zeros(shape, bool)
            cara[max(y0, 0):max(y1, 0), max(x0, 0):max(x1, 0)] = True
            m &= ~(cara & ~mano_frente_cara)
        if directo:
            m = m | (nucleo > 0)
        m = m.astype(np.uint8) * 255
        k = max(int(0.025 * s), 1) * 2 + 1
        elip = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, elip)
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, elip)
        n, lab, _, _ = cv2.connectedComponentsWithStats(m, 8)
        semilla = nucleo > 0 if (m[nucleo > 0] > 0).any() else previa > 0
        conservar = np.unique(lab[semilla & (m > 0)])
        m = np.isin(lab, conservar[conservar > 0]).astype(np.uint8) * 255
        m = rellenar_huecos(m, 0.004 * s * s)  # solo micro-poros internos, nunca espacios entre dedos
        a = cv2.ximgproc.guidedFilter(fr, m.astype(np.float32) / 255, max(int(0.035 * s), 3), 55.0)
        limite = cv2.dilate(m, np.ones((5, 5), np.uint8)) > 0
        alfas.append(np.clip(a, 0, 1) * limite)
    pila = np.stack(alfas)
    suave = pila.copy()
    if len(pila) >= 3:
        suave[1:-1] = np.median(np.stack([pila[:-2], pila[1:-1], pila[2:]]), axis=0)
    return list(suave)


# ------------------------------------------------------------------------------------------- estabilización
def medir_temblor(fotos, alfas) -> np.ndarray:
    """Trayectoria (dx, dy, da) de la cámara medida en el fondo."""
    tray = [np.zeros(3)]
    prev = cv2.cvtColor(fotos[0], cv2.COLOR_BGR2GRAY)
    for i in range(1, len(fotos)):
        cur = cv2.cvtColor(fotos[i], cv2.COLOR_BGR2GRAY)
        fondo_mask = cv2.dilate((alfas[i - 1] > 0.05).astype(np.uint8), np.ones((41, 41), np.uint8)) == 0
        pts = cv2.goodFeaturesToTrack(prev, 300, 0.01, 12, mask=fondo_mask.astype(np.uint8) * 255)
        dx = dy = da = 0.0
        if pts is not None and len(pts) >= 20:
            nxt, st, _ = cv2.calcOpticalFlowPyrLK(prev, cur, pts, None)
            ok = st.ravel() == 1
            if ok.sum() >= 15:
                mat, _ = cv2.estimateAffinePartial2D(pts[ok], nxt[ok], method=cv2.RANSAC)
                if mat is not None:
                    dx, dy, da = mat[0, 2], mat[1, 2], np.arctan2(mat[1, 0], mat[0, 0])
        tray.append(tray[-1] + [dx, dy, da])
        prev = cur
    return np.array(tray)


def estabilizar(fotos, alfas, factor_salida: float):
    tray = medir_temblor(fotos, alfas)
    suave = gaussian_filter1d(tray, sigma=6, axis=0, mode="nearest")
    corr = suave - tray
    temblor = float(np.sqrt((corr[:, :2] ** 2).sum(axis=1).mean()) * factor_salida)
    if temblor < 0.8:
        print(f"    temblor de cámara {temblor:.2f} px (salida): sin estabilizar")
        return fotos, alfas, temblor, False
    h, w = fotos[0].shape[:2]
    out_f, out_a = [], []
    for fr, a, (dx, dy, da) in zip(fotos, alfas, corr):
        c, s_ = np.cos(da), np.sin(da)
        mat = np.array([[c, -s_, dx], [s_, c, dy]], np.float32)
        out_f.append(cv2.warpAffine(fr, mat, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE))
        out_a.append(cv2.warpAffine(a, mat, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT))
    print(f"    temblor de cámara {temblor:.2f} px (salida): estabilizado")
    return out_f, out_a, temblor, True


# ------------------------------------------------------------------------------------------- color y salida
def preparar_color(fotos, alfas):
    """Parámetros constantes por video (sin parpadeo): ganancia de exposición y desplazamiento de a*, b*."""
    ls, abs_ = [], []
    for fr, a in zip(fotos[:: max(len(fotos) // 20, 1)], alfas[:: max(len(fotos) // 20, 1)]):
        px = cv2.cvtColor(fr, cv2.COLOR_BGR2LAB)[a > 0.9]
        if len(px):
            ls.append(px[:, 0])
            abs_.append(px[:, 1:])
    L = np.concatenate(ls).astype(np.float32)
    ab = np.concatenate(abs_).astype(np.float32) - 128
    med = float(np.median(L))
    gamma = float(np.clip(np.log(170 / 255) / np.log(max(med, 1) / 255), 0.75, 1.35))
    ab_med = ab.mean(axis=0) * 0.82  # −18 % de saturación (dentro del rango pedido 15–20 %)
    objetivo = np.array([11.0, 11.0])  # piel natural algo fría tras desaturar (unidades Lab de OpenCV)
    desplaz = (objetivo - ab_med) * 0.5 + np.array([0.0, -2.0])
    return gamma, desplaz


def corregir(fr, gamma, desplaz) -> np.ndarray:
    lab = cv2.cvtColor(fr, cv2.COLOR_BGR2LAB).astype(np.float32)
    L = 255 * (lab[..., 0] / 255) ** gamma
    L = 128 + (L - 128) * 1.08  # contraste suave
    borr = cv2.GaussianBlur(L, (0, 0), 1.1)
    L = L + 0.45 * (L - borr)  # unsharp moderado solo en luminancia
    lab[..., 0] = L
    lab[..., 1] = 128 + (lab[..., 1] - 128) * 0.82 + desplaz[0]
    lab[..., 2] = 128 + (lab[..., 2] - 128) * 0.82 + desplaz[1]
    return cv2.cvtColor(np.clip(lab, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)


def construir_fondo(h, w, degradado: bool) -> np.ndarray:
    if not degradado:
        return np.full((h, w, 3), FONDO, np.float32)
    t = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
    return (np.array(FONDO_CLARO, np.float32) * (1 - t) + np.array(FONDO, np.float32) * t) * np.ones((1, w, 1))


def componer(fotos, alfas, tam, degradado, contorno) -> list[np.ndarray]:
    w, h = tam
    peq = [cv2.resize(f, (w, h), interpolation=cv2.INTER_AREA) for f in fotos]
    alf = [cv2.resize(a, (w, h), interpolation=cv2.INTER_AREA) for a in alfas]
    gamma, desplaz = preparar_color(peq, alf)
    bg = construir_fondo(h, w, degradado)
    salida = []
    for i in range(len(peq)):
        lo, hi = max(i - 1, 0), min(i + 2, len(peq))
        ventana = peq[lo:hi]
        if len(ventana) == 3:
            limpio = cv2.fastNlMeansDenoisingColoredMulti(ventana, 1, 3, None, 3, 3, 5, 15)
        else:
            limpio = cv2.fastNlMeansDenoisingColored(peq[i], None, 3, 3, 5, 15)
        fg = corregir(limpio, gamma, desplaz).astype(np.float32)
        a = cv2.erode(alf[i], np.ones((3, 3), np.uint8))  # 1 px hacia dentro: sin halo del fondo viejo
        a = cv2.GaussianBlur(a, (0, 0), 1.0)  # feather ≈ 2–3 px
        dentro = (a > 0.96).astype(np.float32)
        num = cv2.GaussianBlur(fg * dentro[..., None], (0, 0), 3)
        den = cv2.GaussianBlur(dentro, (0, 0), 3)[..., None]
        fg = np.where(dentro[..., None] > 0, fg, num / np.maximum(den, 1e-3))
        fg = np.where(den > 1e-3, fg, limpio.astype(np.float32))
        out = fg * a[..., None] + bg * (1 - a[..., None])
        if contorno:
            anillo = np.clip(cv2.dilate(a, np.ones((3, 3), np.uint8)) - a, 0, 1) * 0.6
            out = out * (1 - anillo[..., None]) + np.array(CONTORNO, np.float32) * anillo[..., None]
        salida.append(np.clip(out + 0.5, 0, 255).astype(np.uint8))
    return salida


def remuestrear(fotos, duracion) -> list[np.ndarray]:
    """30 fps constantes con la MISMA duración: fotograma más cercano (repite o salta; nunca interpola)."""
    n_out = max(round(duracion * FPS_SALIDA), 1)
    n_in = len(fotos)
    return [fotos[min(int((k + 0.5) * n_in / n_out), n_in - 1)] for k in range(n_out)]


def codificar(fotos, destino: Path, crf: int) -> int:
    import imageio_ffmpeg

    h, w = fotos[0].shape[:2]
    cmd = [
        imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}", "-r", str(FPS_SALIDA), "-i", "-",
        "-an", "-c:v", "libx264", "-preset", "veryslow", "-crf", str(crf), "-profile:v", "high",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-map_metadata", "-1", str(destino),
    ]
    proc = subprocess.run(cmd, input=b"".join(f.tobytes() for f in fotos), capture_output=True)
    if proc.returncode != 0:
        raise SystemExit(proc.stderr.decode(errors="replace"))
    return destino.stat().st_size


def hoja_control(fotos, destino: Path):
    idx = np.linspace(0, len(fotos) - 1, 6).astype(int)
    tiles = [cv2.resize(fotos[i], (round(fotos[i].shape[1] * 360 / fotos[i].shape[0]), 360)) for i in idx]
    cv2.imwrite(str(destino), np.hstack(tiles))


# ------------------------------------------------------------------------------------------- principal
def procesar_parte(ruta: Path, alto_salida: int) -> tuple[list[np.ndarray], list[np.ndarray], float, dict]:
    cap = cv2.VideoCapture(str(ruta))
    w0, h0 = int(cap.get(3)), int(cap.get(4))
    cap.release()
    alto_trabajo = min(h0, alto_salida * 2)
    clip = leer_video(ruta, alto_trabajo)
    print(f"  {ruta.name}: {w0}x{h0}, {len(clip.fotogramas)} fotogramas, {clip.duracion:.2f} s")
    pts, validos = detectar_manos(clip.fotogramas)
    caras = detectar_caras(clip.fotogramas)
    siluetas = detectar_silueta(clip.fotogramas)
    alfas = mascaras(clip.fotogramas, pts, validos, caras, siluetas)
    fotos, alfas, temblor, estab = estabilizar(clip.fotogramas, alfas, alto_salida / alto_trabajo)
    return fotos, alfas, clip.duracion, {"temblor": temblor, "estabilizado": estab}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--nuevos", required=True, type=Path, help="carpeta con los clips nuevos ya recortados")
    ap.add_argument("--antiguos", required=True, type=Path, help="carpeta con «mover cursor.mp4»")
    ap.add_argument("--salida", required=True, type=Path, help="carpeta de destino (public/gestos)")
    ap.add_argument("--solo", default="", help="nombres de salida separados por coma (sin .mp4)")
    ap.add_argument("--previa", type=Path, help="carpeta para hojas de control JPG (fuera del repositorio)")
    ap.add_argument("--degradado", action="store_true", help="fondo #f4f4f6 → #e5e6ea en vez de liso")
    ap.add_argument("--sin-contorno", action="store_true", help="no dibujar el contorno #4f6857")
    args = ap.parse_args(argv)
    args.salida.mkdir(parents=True, exist_ok=True)
    if args.previa:
        args.previa.mkdir(parents=True, exist_ok=True)
    solo = {s.strip().removesuffix(".mp4") for s in args.solo.split(",") if s.strip()}
    carpetas = {"nuevos": args.nuevos, "antiguos": args.antiguos}
    resumen = []
    for salida, carpeta, partes in TRABAJOS:
        if solo and salida.removesuffix(".mp4") not in solo:
            continue
        rutas = []
        for candidatos in partes:
            ruta = next((carpetas[carpeta] / c for c in candidatos if (carpetas[carpeta] / c).exists()), None)
            if ruta is None:
                raise SystemExit(f"Falta {candidatos[0]} en {carpetas[carpeta]}")
            rutas.append(ruta)
        print(f"\n{salida}")
        destino = args.salida / salida
        hecho = False
        for alto in (540, 480):
            procesadas = [procesar_parte(r, alto) for r in rutas]
            ancho = None
            total, dur = [], 0.0
            for fotos, alfas, duracion, _ in procesadas:
                h, w = fotos[0].shape[:2]
                ancho = ancho or round(w * alto / h / 2) * 2
                comp = componer(fotos, alfas, (ancho, alto), args.degradado, not args.sin_contorno)
                total += remuestrear(comp, duracion)  # corte limpio entre partes, sin fundido
                dur += duracion
            for crf in (18, 20, 22, 24, 26, 28):
                peso = codificar(total, destino, crf)
                print(f"    {ancho}x{alto} CRF {crf}: {peso / 1024:.0f} KiB")
                if peso < LIMITE_BYTES:
                    hecho = True
                    break
            if hecho:
                break
        if not hecho:
            raise SystemExit(f"{salida} no entra en 1 MB ni a 480 px con CRF 28")
        if args.previa:
            hoja_control(total, args.previa / salida.replace(".mp4", ".jpg"))
        resumen.append((salida, len(total) / FPS_SALIDA, dur, f"{ancho}x{alto}", peso, crf,
                        [p[3]["temblor"] for p in procesadas], [p[3]["estabilizado"] for p in procesadas]))
    print("\nsalida | duración salida / origen | resolución | peso | CRF | temblor px | estabilizado")
    for r in resumen:
        print(f"{r[0]} | {r[1]:.2f} s / {r[2]:.2f} s | {r[3]} | {r[4] / 1024:.0f} KiB | {r[5]} | "
              f"{', '.join(f'{t:.2f}' for t in r[6])} | {r[7]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
