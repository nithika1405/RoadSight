"""AI detection endpoints: image + video analysis with GPS geotagging."""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..config import DEFAULT_CENTER, THUMB_DIR
from ..database import get_db
from ..detection import analyze_image_file, analyze_video_file, save_thumbnail
from ..events import broker
from ..geo import interpolate
from ..models import Pothole
from ..schemas import BBox, DetectionItem, DetectionResult, FrameDetections
from ..services import create_pothole
from ..storage import media_url, persist_upload_sync, thumb_url

router = APIRouter(prefix="/api/detect", tags=["detection"])


def _resolve_coordinates(
    latitude: float | None,
    longitude: float | None,
    fallback: dict | None,
) -> tuple[float, float, str]:
    if latitude is not None and longitude is not None:
        return latitude, longitude, "manual"
    if fallback:
        return fallback["latitude"], fallback["longitude"], "exif"
    return DEFAULT_CENTER[0], DEFAULT_CENTER[1], "default"


def _persist_detections(
    db: Session,
    *,
    detections: list[dict],
    lat: float,
    lng: float,
    lat_end: float | None,
    lng_end: float | None,
    duration_s: float | None,
    road_name: str | None,
    ward: str | None,
    address: str | None,
    source_type: str,
    media: str | None,
    thumb: str | None,
    detected_at: dt.datetime,
) -> list[dict]:
    """Write detections to the database and return serialisable descriptors."""
    created: list[dict] = []

    for index, det in enumerate(detections):
        d_lat, d_lng = lat, lng
        if lat_end is not None and lng_end is not None and duration_s:
            fraction = (det.get("frame_time_s") or 0.0) / max(0.001, duration_s)
            d_lat, d_lng = interpolate(lat, lng, lat_end, lng_end, fraction)

        pothole = create_pothole(
            db,
            latitude=round(d_lat, 7),
            longitude=round(d_lng, 7),
            address=address,
            road_name=road_name,
            ward=ward,
            severity=det["severity"],
            severity_score=det["score"],
            confidence=det["confidence"],
            area_px=det["area_px"],
            diameter_cm=det["diameter_cm"],
            depth_cm=det["depth_cm"],
            bbox_x=det["x"],
            bbox_y=det["y"],
            bbox_w=det["w"],
            bbox_h=det["h"],
            frame_index=det.get("frame_index"),
            frame_time_s=det.get("frame_time_s"),
            status="pending",
            source_type=source_type,
            media_url=media_url(media),
            thumbnail_url=thumb_url(thumb),
            detected_at=detected_at,
        )
        created.append(
            {
                "index": index,
                "severity": det["severity"],
                "severity_score": det["score"],
                "confidence": det["confidence"],
                "area_px": det["area_px"],
                "diameter_cm": det["diameter_cm"],
                "depth_cm": det["depth_cm"],
                "bbox": BBox(x=det["x"], y=det["y"], w=det["w"], h=det["h"]),
                "latitude": pothole.latitude,
                "longitude": pothole.longitude,
                "frame_index": det.get("frame_index"),
                "frame_time_s": det.get("frame_time_s"),
                "pothole_id": pothole.id,
                "ref_code": pothole.ref_code,
            }
        )

    return created


def _broadcast(created: list[dict], road_name: str | None) -> None:
    if not created:
        return
    broker.publish(
        "detection.batch",
        {
            "count": len(created),
            "road_name": road_name,
            "potholes": [c for c in created],
        },
    )


def _build_items(
    detections: list[dict],
    created: list[dict],
    fallback_lat: float | None,
    fallback_lng: float | None,
) -> list[DetectionItem]:
    """Merge raw detector output with the records that were persisted."""
    by_index = {c["index"]: c for c in created}
    items: list[DetectionItem] = []
    for idx, det in enumerate(detections):
        saved = by_index.get(idx, {})
        items.append(
            DetectionItem(
                index=idx,
                severity=det["severity"],
                severity_score=det["score"],
                confidence=det["confidence"],
                area_px=det["area_px"],
                diameter_cm=det["diameter_cm"],
                depth_cm=det["depth_cm"],
                bbox=BBox(x=det["x"], y=det["y"], w=det["w"], h=det["h"]),
                latitude=saved.get("latitude", fallback_lat),
                longitude=saved.get("longitude", fallback_lng),
                frame_index=det.get("frame_index"),
                frame_time_s=det.get("frame_time_s"),
                pothole_id=saved.get("pothole_id"),
                ref_code=saved.get("ref_code"),
            )
        )
    return items


def _frame_detections(frames: list[dict]) -> list[FrameDetections]:
    """Time-indexed detections used by the frontend playback overlay."""
    out: list[FrameDetections] = []
    for frame in frames:
        items: list[DetectionItem] = []
        for idx, det in enumerate(frame.get("detections", [])):
            items.append(
                DetectionItem(
                    index=idx,
                    severity=det["severity"],
                    severity_score=det["score"],
                    confidence=det["confidence"],
                    area_px=det["area_px"],
                    diameter_cm=det["diameter_cm"],
                    depth_cm=det["depth_cm"],
                    bbox=BBox(x=det["x"], y=det["y"], w=det["w"], h=det["h"]),
                    frame_index=det.get("frame_index"),
                    frame_time_s=det.get("frame_time_s"),
                )
            )
        out.append(FrameDetections(time_s=frame["time_s"], detections=items))
    return out


@router.post("/image", response_model=DetectionResult)
def detect_image(
    file: UploadFile = File(..., description="Road image (jpg/png/webp/tiff)"),
    latitude: float | None = Form(None),
    longitude: float | None = Form(None),
    road_name: str | None = Form(None),
    ward: str | None = Form(None),
    address: str | None = Form(None),
    auto_save: bool = Form(True),
    pixels_per_meter: float = Form(60.0, gt=1),
    min_score: float = Form(26.0, ge=0, le=100),
    db: Session = Depends(get_db),
):
    path, stem = persist_upload_sync(file, "image")

    try:
        analysis = analyze_image_file(
            path,
            pixels_per_meter=pixels_per_meter,
            min_score=min_score,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    lat, lng, origin = _resolve_coordinates(latitude, longitude, analysis.get("exif_gps"))
    thumb = save_thumbnail(analysis["annotated"], stem, THUMB_DIR)
    detected_at = dt.datetime.now(dt.timezone.utc)

    created: list[dict] = []
    if auto_save and analysis["detections"]:
        created = _persist_detections(
            db,
            detections=analysis["detections"],
            lat=lat,
            lng=lng,
            lat_end=None,
            lng_end=None,
            duration_s=None,
            road_name=road_name,
            ward=ward,
            address=address,
            source_type="image",
            media=path.name,
            thumb=thumb,
            detected_at=detected_at,
        )
        db.commit()
        _broadcast(created, road_name)

    detections = _build_items(analysis["detections"], created, lat, lng)

    return DetectionResult(
        kind="image",
        filename=path.name,
        width=analysis["width"],
        height=analysis["height"],
        frames_analyzed=1,
        processing_ms=analysis["processing_ms"],
        exif_gps=analysis.get("exif_gps"),
        detections=detections,
        frames=_frame_detections(analysis.get("frames", [])),
        annotated_image=analysis["annotated_image"],
        thumbnail_url=thumb_url(thumb),
        media_url=media_url(path.name),
        saved=bool(created),
    )


@router.post("/video", response_model=DetectionResult)
def detect_video(
    file: UploadFile = File(..., description="Road video (mp4/mov/avi/mkv/webm)"),
    latitude: float | None = Form(None),
    longitude: float | None = Form(None),
    end_latitude: float | None = Form(None),
    end_longitude: float | None = Form(None),
    road_name: str | None = Form(None),
    ward: str | None = Form(None),
    address: str | None = Form(None),
    auto_save: bool = Form(True),
    sample_interval_s: float = Form(0.5, gt=0, le=10),
    pixels_per_meter: float = Form(60.0, gt=1),
    min_score: float = Form(30.0, ge=0, le=100),
    db: Session = Depends(get_db),
):
    path, stem = persist_upload_sync(file, "video")

    try:
        analysis = analyze_video_file(
            path,
            sample_interval_s=sample_interval_s,
            pixels_per_meter=pixels_per_meter,
            min_score=min_score,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    lat, lng, _ = _resolve_coordinates(latitude, longitude, None)
    thumb = save_thumbnail(analysis["annotated"], stem, THUMB_DIR)
    detected_at = dt.datetime.now(dt.timezone.utc)

    created: list[dict] = []
    if auto_save and analysis["detections"]:
        created = _persist_detections(
            db,
            detections=analysis["detections"],
            lat=lat,
            lng=lng,
            lat_end=end_latitude,
            lng_end=end_longitude,
            duration_s=analysis.get("duration_s"),
            road_name=road_name,
            ward=ward,
            address=address,
            source_type="video",
            media=path.name,
            thumb=thumb,
            detected_at=detected_at,
        )
        db.commit()
        _broadcast(created, road_name)

    detections = _build_items(analysis["detections"], created, lat, lng)

    return DetectionResult(
        kind="video",
        filename=path.name,
        width=analysis["width"],
        height=analysis["height"],
        frames_analyzed=analysis["frames_analyzed"],
        duration_s=analysis["duration_s"],
        sample_interval_s=analysis.get("sample_interval_s"),
        processing_ms=analysis["processing_ms"],
        detections=detections,
        frames=_frame_detections(analysis.get("frames", [])),
        annotated_image=analysis["annotated_image"],
        thumbnail_url=thumb_url(thumb),
        media_url=media_url(path.name),
        saved=bool(created),
    )


@router.get("/limits")
def detection_limits():
    from ..config import ALLOWED_IMAGE_EXT, ALLOWED_VIDEO_EXT, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES

    return {
        "images": sorted(ALLOWED_IMAGE_EXT),
        "videos": sorted(ALLOWED_VIDEO_EXT),
        "max_image_mb": MAX_IMAGE_BYTES // (1024 * 1024),
        "max_video_mb": MAX_VIDEO_BYTES // (1024 * 1024),
        "default_center": {"lat": DEFAULT_CENTER[0], "lng": DEFAULT_CENTER[1]},
    }


@router.delete("/{pothole_id}", status_code=204)
def discard_detection(pothole_id: int, db: Session = Depends(get_db)):
    """Quick undo for a bad auto-saved detection."""
    pothole = db.get(Pothole, pothole_id)
    if pothole is None:
        raise HTTPException(status_code=404, detail="Detection not found")
    db.delete(pothole)
    db.commit()
    broker.publish("pothole.deleted", {"id": pothole_id})
    return None
