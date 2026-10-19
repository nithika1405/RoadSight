"""Shared pytest fixtures.

The environment is patched *before* the application is imported so the test
suite always runs against a throw-away SQLite file and never touches the real
survey database.
"""

from __future__ import annotations

import os
import pathlib
import sys
import tempfile

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

TMP_DIR = pathlib.Path(tempfile.mkdtemp(prefix="pothole-tests-"))
os.environ["POTHOLE_DATA_DIR"] = str(TMP_DIR)
os.environ["POTHOLE_UPLOAD_DIR"] = str(TMP_DIR / "uploads")
os.environ["POTHOLE_THUMB_DIR"] = str(TMP_DIR / "thumbnails")
os.environ["POTHOLE_DATABASE_URL"] = f"sqlite:///{(TMP_DIR / 'test.db').as_posix()}"
os.environ["POTHOLE_AUTOSEED"] = "0"

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.database import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Pothole  # noqa: E402


@pytest.fixture(scope="session")
def client():
    Base.metadata.create_all(bind=engine)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def empty_db():
    """Wipe the pothole table before a test that asserts on totals."""
    with SessionLocal() as session:
        session.query(Pothole).delete()
        session.commit()
    yield


SAMPLE_POTHOLE = {
    "latitude": 12.9716,
    "longitude": 77.5946,
    "road_name": "Outer Ring Road",
    "ward": "Ward 84 - Bellandur",
    "address": "Outer Ring Road, Bellandur, Bengaluru",
    "severity": "high",
    "severity_score": 71.5,
    "confidence": 0.82,
    "diameter_cm": 62.0,
    "depth_cm": 8.4,
    "status": "pending",
    "source_type": "manual",
    "notes": "pytest fixture",
}


def synthetic_road_image(
    width: int = 960,
    height: int = 540,
    blobs=((0.22, 0.62, 90, 60), (0.58, 0.74, 64, 44), (0.80, 0.55, 46, 34)),
    noise_sigma: float = 6.0,
) -> np.ndarray:
    """Render a grey asphalt plate with dark elliptical craters."""
    rng = np.random.default_rng(7)
    base = np.full((height, width, 3), 148, dtype=np.uint8)
    noise = rng.normal(0, noise_sigma, (height, width, 1)).astype(np.int16)
    image = np.clip(base.astype(np.int16) + noise, 0, 255).astype(np.uint8)

    for cx, cy, ax, ay in blobs:
        cv2.ellipse(
            image,
            (int(cx * width), int(cy * height)),
            (ax, ay),
            0,
            0,
            360,
            (46, 46, 50),
            -1,
            lineType=cv2.LINE_AA,
        )
    return cv2.GaussianBlur(image, (5, 5), 0)


def encode_png(image: np.ndarray) -> bytes:
    ok, buffer = cv2.imencode(".png", image)
    assert ok
    return buffer.tobytes()


def write_synthetic_video(path: pathlib.Path, seconds: float = 3.0, fps: int = 12, size=(640, 360)) -> bool:
    """Write a short MJPG/AVI clip; returns False when the codec is unavailable."""
    width, height = size
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), fps, (width, height))
    if not writer.isOpened():
        return False

    frames = int(seconds * fps)
    for index in range(frames):
        shift = int(20 * np.sin(index / max(1, frames) * np.pi * 2))
        image = synthetic_road_image(
            width,
            height,
            blobs=((0.30, 0.65, 60, 40), (0.70, 0.72, 46, 32)),
        )
        matrix = np.float32([[1, 0, shift], [0, 1, shift // 2]])
        frame = cv2.warpAffine(image, matrix, (width, height), borderMode=cv2.BORDER_REPLICATE)
        writer.write(frame)
    writer.release()
    return path.exists() and path.stat().st_size > 0


@pytest.fixture(scope="session")
def road_image_bytes() -> bytes:
    return encode_png(synthetic_road_image())


@pytest.fixture(scope="session")
def flat_image_bytes() -> bytes:
    flat = np.full((480, 640, 3), 150, dtype=np.uint8)
    return encode_png(flat)


@pytest.fixture(scope="session")
def video_bytes() -> bytes | None:
    path = TMP_DIR / "synthetic-road.avi"
    if not write_synthetic_video(path):
        return None
    return path.read_bytes()
