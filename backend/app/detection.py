"""Computer-vision pothole detection engine.

Pipeline (per frame):

    BGR -> grayscale -> CLAHE illumination normalisation -> Gaussian blur
        -> black-hat morphology (isolates dark blobs smaller than the kernel)
        -> Otsu threshold + morphological open/close
        -> contour extraction -> geometric/intensity feature filters
        -> severity regression (0..100) -> greedy NMS

The scoring model is a deliberately transparent weighted feature model so that
every number shown in the UI can be explained to a road engineer.  Swapping in
a trained detector (YOLO/ONNX) only requires re-implementing
:func:`detect_potholes` - the rest of the app consumes :class:`Detection`
objects and does not care where they came from.
"""

from __future__ import annotations

import base64
import math
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import cv2
import numpy as np

from .geo import severity_from_score

SEVERITY_ORDER = ("low", "medium", "high", "critical")

# BGR, kept in sync with the frontend palette.
SEVERITY_COLORS_BGR: dict[str, tuple[int, int, int]] = {
    "low": (176, 230, 62),       # #3ee6b0
    "medium": (1, 179, 245),     # #f5b301
    "high": (26, 122, 255),      # #ff7a1a
    "critical": (85, 45, 255),   # #ff2d55
}

DEFAULT_MAX_WIDTH = 1280
WORK_MAX_WIDTH = 960  # detection runs on a downscaled copy for speed


@dataclass
class Detection:
    """A single pothole candidate expressed in normalised frame coordinates."""

    x: float
    y: float
    w: float
    h: float
    score: float
    severity: str
    confidence: float
    area_px: float
    diameter_cm: float
    depth_cm: float
    frame_index: int | None = None
    frame_time_s: float | None = None

    def as_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------------
# image helpers
# ---------------------------------------------------------------------------
def to_bgr(image: np.ndarray) -> np.ndarray:
    if image is None or image.size == 0:
        raise ValueError("empty image")
    if image.ndim == 2:
        return cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
    if image.shape[2] == 4:
        return cv2.cvtColor(image, cv2.COLOR_BGRA2BGR)
    return image


def read_image(path: str | Path) -> np.ndarray:
    data = np.fromfile(str(path), dtype=np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"Unsupported or corrupt image: {path}")
    return img


def resize_max(image: np.ndarray, max_width: int = DEFAULT_MAX_WIDTH) -> np.ndarray:
    h, w = image.shape[:2]
    if w <= max_width:
        return image
    scale = max_width / float(w)
    return cv2.resize(image, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)


def encode_jpeg_b64(image: np.ndarray, quality: int = 82) -> str:
    ok, buf = cv2.imencode(".jpg", image, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        raise ValueError("failed to encode image")
    return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode("ascii")


def exif_gps(path: str | Path) -> dict | None:
    """Return {"latitude": .., "longitude": ..} when the photo carries EXIF GPS."""
    try:
        from PIL import ExifTags, Image

        with Image.open(path) as im:
            exif = im.getexif()
            if not exif:
                return None
            gps = exif.get_ifd(ExifTags.IFD.GPSInfo)
        if not gps:
            return None

        def _rational(value) -> float:
            try:
                return float(value)
            except TypeError:
                return float(value[0]) / float(value[1] or 1)

        def _dms(values, ref) -> float:
            deg, minutes, seconds = (_rational(v) for v in values)
            out = deg + minutes / 60.0 + seconds / 3600.0
            return -out if ref in ("S", "W") else out

        if 2 not in gps or 4 not in gps:
            return None
        return {
            "latitude": round(_dms(gps[2], gps.get(1, "N")), 7),
            "longitude": round(_dms(gps[4], gps.get(3, "E")), 7),
        }
    except Exception:  # pragma: no cover - any EXIF oddity is non fatal
        return None


# ---------------------------------------------------------------------------
# core detector
# ---------------------------------------------------------------------------
def _iou(a: Detection, b: Detection) -> float:
    ax1, ay1, ax2, ay2 = a.x, a.y, a.x + a.w, a.y + a.h
    bx1, by1, bx2, by2 = b.x, b.y, b.x + b.w, b.y + b.h
    ix = max(0.0, min(ax2, bx2) - max(ax1, bx1))
    iy = max(0.0, min(ay2, by2) - max(ay1, by1))
    inter = ix * iy
    if inter <= 0:
        return 0.0
    union = a.w * a.h + b.w * b.h - inter
    return inter / union if union > 0 else 0.0


def non_max_suppression(dets: list[Detection], iou_threshold: float = 0.35) -> list[Detection]:
    kept: list[Detection] = []
    for cand in sorted(dets, key=lambda d: d.score, reverse=True):
        if all(_iou(cand, k) <= iou_threshold for k in kept):
            kept.append(cand)
    return kept


def _interior_ring(mask: np.ndarray, kernel: np.ndarray) -> np.ndarray:
    """Ring of pixels immediately surrounding a binary mask."""
    dilated = cv2.dilate(mask, kernel, iterations=2)
    return cv2.subtract(dilated, mask)


def detect_potholes(
    image: np.ndarray,
    *,
    pixels_per_meter: float = 60.0,
    min_score: float = 26.0,
    max_detections: int = 15,
    min_area_ratio: float = 0.00045,
    max_area_ratio: float = 0.12,
    sky_skip_ratio: float = 0.10,
    min_contrast: float = 0.05,
) -> list[Detection]:
    """Detect pothole candidates in a single frame.

    Dark regions are found by comparing the frame against a heavily blurred
    copy of itself (a local illumination model), which keeps the detector
    scale-invariant - a 20 px and a 400 px wide pothole respond equally well.
    """
    bgr, _ = _prepare(image, WORK_MAX_WIDTH)
    h, w = bgr.shape[:2]
    frame_area = float(h * w)

    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)

    # Local background estimate: positive where a pixel is darker than its
    # neighbourhood, which is exactly how a pothole presents itself.  Two
    # scales are combined so both small patches and large craters respond.
    fine_sigma = max(5.0, min(h, w) * 0.05)
    coarse_sigma = max(12.0, min(h, w) * 0.30)
    fine = cv2.subtract(cv2.GaussianBlur(blurred, (0, 0), fine_sigma), blurred)
    coarse = cv2.subtract(cv2.GaussianBlur(blurred, (0, 0), coarse_sigma), blurred)
    darkness = cv2.max(fine, coarse)

    otsu, _ = cv2.threshold(darkness, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    threshold = max(float(otsu), 9.0)
    _, binary = cv2.threshold(darkness, threshold, 255, cv2.THRESH_BINARY)

    round_k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, round_k, iterations=2)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, round_k, iterations=1)

    edges = cv2.Canny(blurred, 60, 160)
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    candidates: list[Detection] = []
    ring_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))

    for contour in contours:
        area = float(cv2.contourArea(contour))
        ratio = area / frame_area
        if ratio < min_area_ratio or ratio > max_area_ratio:
            continue

        x, y, bw, bh = cv2.boundingRect(contour)
        if bw < 8 or bh < 8:
            continue
        if (y + bh / 2) < h * sky_skip_ratio:
            continue

        aspect = bw / float(bh)
        if aspect < 0.2 or aspect > 5.0:
            continue

        perimeter = float(cv2.arcLength(contour, True))
        circularity = (4.0 * math.pi * area / (perimeter ** 2)) if perimeter > 0 else 0.0
        circularity = max(0.0, min(1.0, circularity))

        hull_area = float(cv2.contourArea(cv2.convexHull(contour)))
        solidity = (area / hull_area) if hull_area > 0 else 0.0
        if solidity < 0.55:
            continue

        mask = np.zeros(gray.shape, dtype=np.uint8)
        cv2.drawContours(mask, [contour], -1, 255, thickness=-1)
        inside = cv2.mean(blurred, mask=mask)[0]
        ring = _interior_ring(mask, ring_kernel)
        ring_pixels = int(cv2.countNonZero(ring))
        if ring_pixels < 25:
            continue
        outside = cv2.mean(blurred, mask=ring)[0]

        contrast = max(0.0, (outside - inside) / 255.0)
        if contrast < min_contrast:
            continue

        roi = edges[y : y + bh, x : x + bw]
        edge_density = float(np.count_nonzero(roi)) / float(max(1, roi.size))

        score = 100.0 * (
            0.42 * min(1.0, contrast / 0.28)
            + 0.22 * min(1.0, ratio / 0.018)
            + 0.14 * min(1.0, max(0.0, (circularity - 0.25) / 0.45))
            + 0.12 * solidity
            + 0.10 * min(1.0, edge_density / 0.16)
        )
        # implausibly large blobs are usually shadows or lane markings, not craters
        if ratio > 0.05:
            score *= max(0.25, math.sqrt(0.05 / ratio))
        score = round(max(0.0, min(100.0, score)), 1)
        if score < min_score:
            continue

        confidence = min(0.99, 0.34 + 0.6 * (score / 100.0) + 0.08 * min(1.0, ratio / 0.01))
        equivalent_diameter_px = 2.0 * math.sqrt(area / math.pi)
        diameter_cm = round(equivalent_diameter_px / max(1.0, pixels_per_meter) * 100.0, 1)
        depth_cm = round(1.2 + (score / 100.0) * 12.0, 1)

        candidates.append(
            Detection(
                x=round(x / w, 5),
                y=round(y / h, 5),
                w=round(bw / w, 5),
                h=round(bh / h, 5),
                score=score,
                severity=severity_from_score(score),
                confidence=round(confidence, 3),
                area_px=round(area, 1),
                diameter_cm=diameter_cm,
                depth_cm=depth_cm,
            )
        )

    kept = non_max_suppression(candidates, iou_threshold=0.35)
    return kept[:max_detections]


def _prepare(image: np.ndarray, max_width: int) -> tuple[np.ndarray, float]:
    bgr = to_bgr(image)
    h, w = bgr.shape[:2]
    if w <= max_width:
        return bgr, 1.0
    scale = max_width / float(w)
    return cv2.resize(bgr, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA), scale


# ---------------------------------------------------------------------------
# visualisation
# ---------------------------------------------------------------------------
def annotate(image: np.ndarray, detections: list[Detection], title: str | None = None) -> np.ndarray:
    canvas = image.copy()
    h, w = canvas.shape[:2]
    thickness = max(2, int(round(min(h, w) / 320)))

    for det in detections:
        x1 = int(det.x * w)
        y1 = int(det.y * h)
        x2 = int((det.x + det.w) * w)
        y2 = int((det.y + det.h) * h)
        colour = SEVERITY_COLORS_BGR.get(det.severity, (255, 255, 255))

        # soft fill so the severity is readable at a glance
        overlay = canvas.copy()
        cv2.rectangle(overlay, (x1, y1), (x2, y2), colour, thickness=-1)
        cv2.addWeighted(overlay, 0.16, canvas, 0.84, 0, canvas)

        cv2.rectangle(canvas, (x1, y1), (x2, y2), colour, thickness, lineType=cv2.LINE_AA)

        label = f"{det.severity.upper()} {det.score:.0f}"
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        pad = 4
        top = max(0, y1 - th - 2 * pad)
        cv2.rectangle(canvas, (x1, top), (x1 + tw + 2 * pad, top + th + 2 * pad), colour, -1)
        cv2.putText(
            canvas,
            label,
            (x1 + pad, top + th + pad - 1),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (12, 12, 16),
            1,
            cv2.LINE_AA,
        )

    if title:
        cv2.putText(canvas, title, (12, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2, cv2.LINE_AA)
    return canvas


# ---------------------------------------------------------------------------
# file level analysis
# ---------------------------------------------------------------------------
def analyze_image_file(
    path: str | Path,
    *,
    pixels_per_meter: float = 60.0,
    min_score: float = 26.0,
    max_detections: int = 15,
) -> dict:
    started = time.perf_counter()
    image = resize_max(read_image(path), DEFAULT_MAX_WIDTH)
    detections = detect_potholes(
        image,
        pixels_per_meter=pixels_per_meter,
        min_score=min_score,
        max_detections=max_detections,
    )
    h, w = image.shape[:2]
    annotated = annotate(image, detections, title=f"{len(detections)} pothole(s) detected")
    return {
        "kind": "image",
        "width": w,
        "height": h,
        "frames_analyzed": 1,
        "duration_s": None,
        "processing_ms": int((time.perf_counter() - started) * 1000),
        "detections": [d.as_dict() for d in detections],
        # A still is a single "frame at t=0" so the frontend drives the image
        # overlay and the video playback overlay with the same code path.
        "frames": [{"time_s": 0.0, "detections": [d.as_dict() for d in detections]}],
        "annotated_image": encode_jpeg_b64(annotated),
        "frame": image,
        "annotated": annotated,
        "exif_gps": exif_gps(path),
    }


def analyze_video_file(
    path: str | Path,
    *,
    sample_interval_s: float = 0.5,
    pixels_per_meter: float = 60.0,
    min_score: float = 30.0,
    max_detections: int = 40,
    max_samples: int = 240,
    progress=None,
) -> dict:
    """Sample frames from a video and return de-duplicated pothole detections.

    Two views of the same analysis are produced:

    ``frames``
        Time-indexed, *un-deduplicated* detections - one entry per sampled
        timestamp.  This is what drives the playback overlay, so each crater
        only appears over the stretch of road where it was actually seen.
    ``detections``
        Globally de-duplicated craters, used for the registry and the summaries.

    ``progress`` is an optional ``callable(fraction: float)`` used to report
    decoding progress.
    """
    started = time.perf_counter()
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise ValueError("Could not decode the uploaded video (unsupported codec?)")

    fps = capture.get(cv2.CAP_PROP_FPS)
    if not fps or fps <= 0 or fps > 240:
        fps = 30.0
    total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    step = max(1, int(round(fps * max(0.2, sample_interval_s))))

    raw: list[Detection] = []
    frames: list[dict] = []
    best_frame: np.ndarray | None = None
    best_count = -1
    best_annotated: np.ndarray | None = None
    analysed = 0
    index = 0
    width = height = 0

    while analysed < max_samples:
        if not capture.grab():
            break
        if index % step == 0:
            ok, frame = capture.retrieve()
            if ok and frame is not None:
                frame = resize_max(frame, DEFAULT_MAX_WIDTH)
                height, width = frame.shape[:2]
                timestamp = index / fps
                frame_dets = detect_potholes(
                    frame,
                    pixels_per_meter=pixels_per_meter,
                    min_score=min_score,
                    max_detections=6,
                )
                for det in frame_dets:
                    det.frame_index = index
                    det.frame_time_s = round(timestamp, 2)
                raw.extend(frame_dets)
                frames.append(
                    {
                        "time_s": round(timestamp, 2),
                        "detections": [d.as_dict() for d in frame_dets],
                    }
                )
                analysed += 1
                if len(frame_dets) > best_count:
                    best_count = len(frame_dets)
                    best_frame = frame
                    best_annotated = annotate(frame, frame_dets)
                if progress and total_frames:
                    progress(min(1.0, index / float(total_frames)))
        index += 1

    duration_s = round((total_frames / fps) if total_frames else (index / fps), 2)
    capture.release()

    if width == 0:
        raise ValueError("No readable frames found in the uploaded video")

    unique = non_max_suppression(raw, iou_threshold=0.30)[:max_detections]
    unique.sort(key=lambda d: (d.frame_time_s or 0.0))
    if best_frame is None:
        best_frame = np.zeros((height, width, 3), dtype=np.uint8)
        best_annotated = best_frame

    return {
        "kind": "video",
        "width": width,
        "height": height,
        "frames_analyzed": analysed,
        "duration_s": duration_s,
        "sample_interval_s": round(step / fps, 3),
        "processing_ms": int((time.perf_counter() - started) * 1000),
        "detections": [d.as_dict() for d in unique],
        "frames": frames,
        "annotated_image": encode_jpeg_b64(best_annotated if best_annotated is not None else best_frame),
        "frame": best_frame,
        "annotated": best_annotated,
        "exif_gps": None,
    }


def save_thumbnail(image: np.ndarray, stem: str, directory: str | Path, max_width: int = 480) -> str:
    """Write a small JPEG preview and return its file name."""
    thumb = resize_max(image, max_width)
    out = Path(directory) / f"{stem}.jpg"
    ok, buf = cv2.imencode(".jpg", thumb, [int(cv2.IMWRITE_JPEG_QUALITY), 78])
    if ok:
        out.write_bytes(buf.tobytes())
    return out.name
