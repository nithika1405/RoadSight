"""FastAPI application entry point."""

from __future__ import annotations

import asyncio
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError

from . import __version__
from .config import CORS_ORIGINS, DATABASE_URL, DEFAULT_CENTER, THUMB_DIR, UPLOAD_DIR
from .database import SessionLocal, init_db
from .events import broker
from .models import SEVERITIES, SOURCE_TYPES, STATUSES, Pothole
from .routers import detect, potholes, stream

STARTED_AT = time.time()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    broker.bind_loop(asyncio.get_running_loop())
    if os.getenv("POTHOLE_AUTOSEED", "1") not in ("0", "false", "False"):
        from .seed import seed_if_empty

        created = seed_if_empty()
        if created:
            print(f"[pothole] seeded {created} demo detections into an empty database")
    yield


app = FastAPI(
    title="Pothole Detection Platform API",
    version=__version__,
    description=(
        "Computer-vision pothole detection with GPS geotagging, analytics, "
        "CSV export and real-time SSE updates."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "X-Total-Rows"],
)

app.mount("/media", StaticFiles(directory=str(UPLOAD_DIR)), name="media")
app.mount("/thumbnails", StaticFiles(directory=str(THUMB_DIR)), name="thumbnails")

app.include_router(potholes.router)
app.include_router(detect.router)
app.include_router(stream.router)


@app.exception_handler(SQLAlchemyError)
async def _db_error(request: Request, exc: SQLAlchemyError):  # pragma: no cover
    return JSONResponse(status_code=500, content={"detail": f"Database error: {exc}"})


@app.get("/", tags=["meta"])
def index():
    return {
        "name": "Pothole Detection Platform API",
        "version": __version__,
        "docs": "/docs",
        "endpoints": [
            "GET  /api/health",
            "GET  /api/config",
            "GET  /api/potholes",
            "GET  /api/potholes/stats",
            "GET  /api/potholes/export.csv",
            "GET  /api/potholes/route",
            "POST /api/potholes",
            "PATCH /api/potholes/{id}",
            "DELETE /api/potholes/{id}",
            "POST /api/detect/image",
            "POST /api/detect/video",
            "GET  /api/stream/events",
        ],
    }


@app.get("/api/health")
def health():
    try:
        with SessionLocal() as session:
            total = session.scalar(select(func.count(Pothole.id))) or 0
        database = "ok"
    except Exception as exc:  # pragma: no cover
        total = 0
        database = f"error: {exc}"

    return {
        "status": "ok" if database == "ok" else "degraded",
        "version": __version__,
        "database": database,
        "total_potholes": int(total),
        "uptime_s": round(time.time() - STARTED_AT, 1),
        "stream_subscribers": broker.subscriber_count,
    }


@app.get("/api/config")
def client_config():
    from .config import ALLOWED_IMAGE_EXT, ALLOWED_VIDEO_EXT, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES

    return {
        "version": __version__,
        "default_center": {"lat": DEFAULT_CENTER[0], "lng": DEFAULT_CENTER[1]},
        "severities": list(SEVERITIES),
        "statuses": list(STATUSES),
        "source_types": list(SOURCE_TYPES),
        "severity_thresholds": {"low": 0, "medium": 36, "high": 58, "critical": 78},
        "uploads": {
            "images": sorted(ALLOWED_IMAGE_EXT),
            "videos": sorted(ALLOWED_VIDEO_EXT),
            "max_image_mb": MAX_IMAGE_BYTES // (1024 * 1024),
            "max_video_mb": MAX_VIDEO_BYTES // (1024 * 1024),
        },
        "database": DATABASE_URL,
    }
