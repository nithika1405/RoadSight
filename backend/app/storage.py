"""Upload persistence helpers and static URL mapping."""

from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile

from .config import (
    ALLOWED_IMAGE_EXT,
    ALLOWED_VIDEO_EXT,
    MAX_IMAGE_BYTES,
    MAX_VIDEO_BYTES,
    THUMB_DIR,
    UPLOAD_DIR,
)

CHUNK = 1024 * 1024


def media_url(filename: str | None) -> str | None:
    return f"/media/{filename}" if filename else None


def thumb_url(filename: str | None) -> str | None:
    return f"/thumbnails/{filename}" if filename else None


async def persist_upload(file: UploadFile, kind: str) -> tuple[Path, str]:
    """Async variant kept for callers that already run on the event loop."""
    return persist_upload_sync(file, kind)


def persist_upload_sync(file: UploadFile, kind: str) -> tuple[Path, str]:
    """Stream an upload to disk, enforcing extension and size limits.

    Returns ``(path, stem)`` where *stem* is the unique generated file name.
    """
    allowed = ALLOWED_IMAGE_EXT if kind == "image" else ALLOWED_VIDEO_EXT
    max_bytes = MAX_IMAGE_BYTES if kind == "image" else MAX_VIDEO_BYTES

    original = Path(file.filename or "")
    ext = original.suffix.lower()
    if ext not in allowed:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported {kind} type '{ext or 'unknown'}'. Allowed: {', '.join(sorted(allowed))}",
        )

    stem = f"{kind}-{uuid.uuid4().hex[:12]}"
    destination = UPLOAD_DIR / f"{stem}{ext}"

    source = file.file
    try:
        source.seek(0)
    except Exception:  # pragma: no cover - non seekable stream
        pass

    size = 0
    try:
        with destination.open("wb") as handle:
            while True:
                chunk = source.read(CHUNK)
                if not chunk:
                    break
                size += len(chunk)
                if size > max_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail=f"File too large. Limit is {max_bytes // (1024 * 1024)} MB.",
                    )
                handle.write(chunk)
    except HTTPException:
        destination.unlink(missing_ok=True)
        raise
    except Exception as exc:  # pragma: no cover - disk errors
        destination.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Failed to store upload: {exc}") from exc

    if size == 0:
        destination.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")

    return destination, stem


def thumb_path(stem: str) -> Path:
    return THUMB_DIR / f"{stem}.jpg"
