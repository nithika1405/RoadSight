"""Runtime configuration.

Every value can be overridden with an environment variable so the same code
runs unchanged in dev, test and production.
"""

from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent  # .../backend


def _env_path(name: str, default: Path) -> Path:
    raw = os.getenv(name)
    path = Path(raw).expanduser() if raw else default
    path.mkdir(parents=True, exist_ok=True)
    return path


DATA_DIR = _env_path("POTHOLE_DATA_DIR", BASE_DIR / "data")
UPLOAD_DIR = _env_path("POTHOLE_UPLOAD_DIR", DATA_DIR / "uploads")
THUMB_DIR = _env_path("POTHOLE_THUMB_DIR", DATA_DIR / "thumbnails")

DATABASE_URL = os.getenv("POTHOLE_DATABASE_URL", f"sqlite:///{(DATA_DIR / 'potholes.db').as_posix()}")

# Comma separated list of allowed origins for the React dev server.
CORS_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "POTHOLE_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173",
    ).split(",")
    if o.strip()
]

MAX_IMAGE_BYTES = int(os.getenv("POTHOLE_MAX_IMAGE_BYTES", str(15 * 1024 * 1024)))
MAX_VIDEO_BYTES = int(os.getenv("POTHOLE_MAX_VIDEO_BYTES", str(200 * 1024 * 1024)))

ALLOWED_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"}
ALLOWED_VIDEO_EXT = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"}

# Default map centre used when the client does not supply one (Bengaluru, IN).
DEFAULT_CENTER = (
    float(os.getenv("POTHOLE_DEFAULT_LAT", "12.9716")),
    float(os.getenv("POTHOLE_DEFAULT_LNG", "77.5946")),
)
