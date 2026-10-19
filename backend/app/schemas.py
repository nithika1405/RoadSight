"""Pydantic schemas for the public API."""

from __future__ import annotations

import datetime as dt
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Severity = Literal["low", "medium", "high", "critical"]
Status = Literal["pending", "inspected", "repaired"]


class BBox(BaseModel):
    x: float
    y: float
    w: float
    h: float


class PotholeBase(BaseModel):
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    address: str | None = None
    road_name: str | None = None
    ward: str | None = None
    severity: Severity = "medium"
    severity_score: float = Field(50.0, ge=0, le=100)
    confidence: float = Field(0.5, ge=0, le=1)
    diameter_cm: float = Field(0.0, ge=0)
    depth_cm: float = Field(0.0, ge=0)
    status: Status = "pending"
    source_type: Literal["image", "video", "manual"] = "manual"
    notes: str | None = None
    detected_at: dt.datetime | None = None


class PotholeCreate(PotholeBase):
    """Payload for manually registering a pothole."""


class PotholeUpdate(BaseModel):
    status: Status | None = None
    severity: Severity | None = None
    severity_score: float | None = Field(None, ge=0, le=100)
    notes: str | None = None
    address: str | None = None
    road_name: str | None = None
    ward: str | None = None
    latitude: float | None = Field(None, ge=-90, le=90)
    longitude: float | None = Field(None, ge=-180, le=180)


class PotholeOut(PotholeBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ref_code: str
    area_px: float = 0.0
    bbox: BBox | None = None
    frame_index: int | None = None
    frame_time_s: float | None = None
    media_url: str | None = None
    thumbnail_url: str | None = None
    created_at: dt.datetime | None = None
    updated_at: dt.datetime | None = None

    @field_validator("detected_at", mode="before")
    @classmethod
    def _default_detected_at(cls, v):
        return v or dt.datetime.now(dt.timezone.utc)


class PotholeListOut(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[PotholeOut]


class SeverityBucket(BaseModel):
    severity: str
    count: int
    avg_score: float


class SeriesPoint(BaseModel):
    label: str
    count: int
    avg_score: float


class StatsOut(BaseModel):
    total: int
    pending: int
    inspected: int
    repaired: int
    critical: int
    avg_severity_score: float
    avg_confidence: float
    highest_risk: list[PotholeOut]
    by_severity: list[SeverityBucket]
    by_status: list[SeverityBucket]
    by_day: list[SeriesPoint]
    by_ward: list[SeriesPoint]
    by_hour: list[SeriesPoint]
    bbox: dict | None = None


class DetectionItem(BaseModel):
    index: int
    severity: Severity
    severity_score: float
    confidence: float
    area_px: float
    diameter_cm: float
    depth_cm: float
    bbox: BBox
    latitude: float | None = None
    longitude: float | None = None
    frame_index: int | None = None
    frame_time_s: float | None = None
    pothole_id: int | None = None
    ref_code: str | None = None


class FrameDetections(BaseModel):
    """Detections belonging to a single sampled timestamp of the media."""

    time_s: float
    detections: list[DetectionItem] = []


class DetectionResult(BaseModel):
    kind: Literal["image", "video"]
    filename: str
    width: int
    height: int
    frames_analyzed: int = 1
    duration_s: float | None = None
    sample_interval_s: float | None = None
    processing_ms: int
    exif_gps: dict | None = None
    detections: list[DetectionItem]
    frames: list[FrameDetections] = []
    annotated_image: str | None = None  # data:image/jpeg;base64,...
    thumbnail_url: str | None = None
    media_url: str | None = None
    saved: bool = False


class RouteOut(BaseModel):
    distance_km: float
    duration_min: float
    points: list[dict]
    pothole_ids: list[int]


class HealthOut(BaseModel):
    status: str
    version: str
    database: str
    total_potholes: int
    uptime_s: float
