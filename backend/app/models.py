"""ORM models."""

from __future__ import annotations

import datetime as dt

from sqlalchemy import DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base

SEVERITIES = ("low", "medium", "high", "critical")
STATUSES = ("pending", "inspected", "repaired")
SOURCE_TYPES = ("image", "video", "manual")


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


class Pothole(Base):
    __tablename__ = "potholes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ref_code: Mapped[str] = mapped_column(String(24), unique=True, index=True)

    # --- geo -------------------------------------------------------------
    latitude: Mapped[float] = mapped_column(Float, index=True)
    longitude: Mapped[float] = mapped_column(Float, index=True)
    address: Mapped[str | None] = mapped_column(String(255), default=None)
    road_name: Mapped[str | None] = mapped_column(String(160), default=None)
    ward: Mapped[str | None] = mapped_column(String(80), default=None)

    # --- detection -------------------------------------------------------
    severity: Mapped[str] = mapped_column(String(12), index=True, default="medium")
    severity_score: Mapped[float] = mapped_column(Float, index=True, default=50.0)
    confidence: Mapped[float] = mapped_column(Float, default=0.5)
    area_px: Mapped[float] = mapped_column(Float, default=0.0)
    diameter_cm: Mapped[float] = mapped_column(Float, default=0.0)
    depth_cm: Mapped[float] = mapped_column(Float, default=0.0)

    # normalised bounding box inside the source frame (0..1)
    bbox_x: Mapped[float | None] = mapped_column(Float, default=None)
    bbox_y: Mapped[float | None] = mapped_column(Float, default=None)
    bbox_w: Mapped[float | None] = mapped_column(Float, default=None)
    bbox_h: Mapped[float | None] = mapped_column(Float, default=None)
    frame_index: Mapped[int | None] = mapped_column(Integer, default=None)
    frame_time_s: Mapped[float | None] = mapped_column(Float, default=None)

    # --- workflow --------------------------------------------------------
    status: Mapped[str] = mapped_column(String(12), index=True, default="pending")
    source_type: Mapped[str] = mapped_column(String(12), default="image")
    media_url: Mapped[str | None] = mapped_column(String(255), default=None)
    thumbnail_url: Mapped[str | None] = mapped_column(String(255), default=None)
    notes: Mapped[str | None] = mapped_column(Text, default=None)

    detected_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), index=True, default=utcnow)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    @property
    def bbox(self) -> dict | None:
        if None in (self.bbox_x, self.bbox_y, self.bbox_w, self.bbox_h):
            return None
        return {"x": self.bbox_x, "y": self.bbox_y, "w": self.bbox_w, "h": self.bbox_h}
