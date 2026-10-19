"""Pothole CRUD, analytics, CSV export and route planning."""

from __future__ import annotations

import csv
import datetime as dt
import io
import math
from collections import Counter

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..events import broker
from ..geo import haversine_km, nearest_neighbour_route, route_length_km
from ..models import SEVERITIES, STATUSES, Pothole
from ..schemas import (
    PotholeCreate,
    PotholeListOut,
    PotholeOut,
    PotholeUpdate,
    RouteOut,
    SeriesPoint,
    SeverityBucket,
    StatsOut,
)
from ..services import create_pothole

router = APIRouter(prefix="/api/potholes", tags=["potholes"])

SORTABLE = {
    "severity_score": Pothole.severity_score,
    "detected_at": Pothole.detected_at,
    "id": Pothole.id,
    "confidence": Pothole.confidence,
    "diameter_cm": Pothole.diameter_cm,
}

CSV_COLUMNS = [
    ("ref_code", "Reference"),
    ("id", "ID"),
    ("latitude", "Latitude"),
    ("longitude", "Longitude"),
    ("severity", "Severity"),
    ("severity_score", "Severity score"),
    ("confidence", "Confidence"),
    ("status", "Status"),
    ("road_name", "Road"),
    ("ward", "Ward"),
    ("address", "Address"),
    ("diameter_cm", "Diameter (cm)"),
    ("depth_cm", "Depth (cm)"),
    ("area_px", "Area (px)"),
    ("source_type", "Source"),
    ("frame_time_s", "Video timestamp (s)"),
    ("detected_at", "Detected at"),
    ("notes", "Notes"),
]


def _csv_list(value: str | None) -> list[str]:
    if not value:
        return []
    return [part.strip().lower() for part in value.split(",") if part.strip()]


def _apply_filters(
    stmt,
    *,
    q: str | None = None,
    severity: str | None = None,
    status: str | None = None,
    source_type: str | None = None,
    road: str | None = None,
    ward: str | None = None,
    min_score: float | None = None,
    max_score: float | None = None,
    date_from: dt.datetime | None = None,
    date_to: dt.datetime | None = None,
    lat: float | None = None,
    lng: float | None = None,
    radius_km: float | None = None,
):
    severities = [s for s in _csv_list(severity) if s in SEVERITIES]
    statuses = [s for s in _csv_list(status) if s in STATUSES]
    sources = [s for s in _csv_list(source_type) if s in ("image", "video", "manual")]

    if severities:
        stmt = stmt.where(Pothole.severity.in_(severities))
    if statuses:
        stmt = stmt.where(Pothole.status.in_(statuses))
    if sources:
        stmt = stmt.where(Pothole.source_type.in_(sources))
    if road:
        stmt = stmt.where(Pothole.road_name.ilike(f"%{road}%"))
    if ward:
        stmt = stmt.where(Pothole.ward.ilike(f"%{ward}%"))
    if min_score is not None:
        stmt = stmt.where(Pothole.severity_score >= min_score)
    if max_score is not None:
        stmt = stmt.where(Pothole.severity_score <= max_score)
    if date_from is not None:
        stmt = stmt.where(Pothole.detected_at >= date_from)
    if date_to is not None:
        stmt = stmt.where(Pothole.detected_at <= date_to)
    if q:
        needle = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                Pothole.ref_code.ilike(needle),
                Pothole.road_name.ilike(needle),
                Pothole.address.ilike(needle),
                Pothole.ward.ilike(needle),
                Pothole.notes.ilike(needle),
                Pothole.severity.ilike(needle),
            )
        )
    if lat is not None and lng is not None and radius_km:
        # cheap bounding box prefilter; exact haversine applied by the caller
        dlat = radius_km / 111.32
        dlng = radius_km / max(0.01, 111.32 * abs(math.cos(math.radians(lat))))
        stmt = stmt.where(
            Pothole.latitude.between(lat - dlat, lat + dlat),
            Pothole.longitude.between(lng - dlng, lng + dlng),
        )
    return stmt


def _radius_filter(rows: list[Pothole], lat, lng, radius_km) -> list[Pothole]:
    if lat is None or lng is None or not radius_km:
        return rows
    return [r for r in rows if haversine_km(lat, lng, r.latitude, r.longitude) <= radius_km]


# ---------------------------------------------------------------------------
# collection
# ---------------------------------------------------------------------------
@router.get("", response_model=PotholeListOut)
def list_potholes(
    q: str | None = Query(None, description="Free-text search"),
    severity: str | None = Query(None, description="Comma separated: low,medium,high,critical"),
    status: str | None = Query(None, description="Comma separated: pending,inspected,repaired"),
    source_type: str | None = None,
    road: str | None = None,
    ward: str | None = None,
    min_score: float | None = Query(None, ge=0, le=100),
    max_score: float | None = Query(None, ge=0, le=100),
    date_from: dt.datetime | None = None,
    date_to: dt.datetime | None = None,
    lat: float | None = None,
    lng: float | None = None,
    radius_km: float | None = Query(None, gt=0),
    sort: str = Query("severity_score", pattern="|".join(SORTABLE)),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    limit: int = Query(500, ge=1, le=5000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    stmt = _apply_filters(
        select(Pothole),
        q=q, severity=severity, status=status, source_type=source_type, road=road, ward=ward,
        min_score=min_score, max_score=max_score, date_from=date_from, date_to=date_to,
        lat=lat, lng=lng, radius_km=radius_km,
    )
    column = SORTABLE[sort]
    stmt = stmt.order_by(column.desc() if order == "desc" else column.asc())

    if lat is not None and lng is not None and radius_km:
        rows = _radius_filter(list(db.scalars(stmt).all()), lat, lng, radius_km)
        total = len(rows)
        page = rows[offset : offset + limit]
    else:
        total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
        page = list(db.scalars(stmt.limit(limit).offset(offset)).all())

    return PotholeListOut(
        total=total,
        limit=limit,
        offset=offset,
        items=[PotholeOut.model_validate(p) for p in page],
    )


@router.get("/stats", response_model=StatsOut)
def stats(
    q: str | None = None,
    severity: str | None = None,
    status: str | None = None,
    source_type: str | None = None,
    road: str | None = None,
    ward: str | None = None,
    min_score: float | None = Query(None, ge=0, le=100),
    date_from: dt.datetime | None = None,
    date_to: dt.datetime | None = None,
    days: int = Query(14, ge=1, le=180, description="Length of the trend series"),
    db: Session = Depends(get_db),
):
    stmt = _apply_filters(
        select(Pothole),
        q=q, severity=severity, status=status, source_type=source_type, road=road, ward=ward,
        min_score=min_score, date_from=date_from, date_to=date_to,
    )
    rows = list(db.scalars(stmt).all())

    severity_counter = Counter(r.severity for r in rows)
    status_counter = Counter(r.status for r in rows)
    severity_scores: dict[str, list[float]] = {s: [] for s in SEVERITIES}
    for row in rows:
        severity_scores.setdefault(row.severity, []).append(row.severity_score)

    def _bucket(counter: Counter, keys: tuple[str, ...]) -> list[SeverityBucket]:
        out = []
        for key in keys:
            scores = severity_scores.get(key, [])
            out.append(
                SeverityBucket(
                    severity=key,
                    count=int(counter.get(key, 0)),
                    avg_score=round(sum(scores) / len(scores), 1) if scores else 0.0,
                )
            )
        return out

    today = dt.datetime.now(dt.timezone.utc).date()
    day_counts = Counter()
    day_score: dict[str, list[float]] = {}
    hour_counts = Counter()
    hour_score: dict[int, list[float]] = {}
    ward_counts = Counter()
    ward_scores: dict[str, list[float]] = {}

    for row in rows:
        stamp = row.detected_at
        if stamp is None:
            continue
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=dt.timezone.utc)
        key = stamp.date().isoformat()
        day_counts[key] += 1
        day_score.setdefault(key, []).append(row.severity_score)
        hour_counts[stamp.hour] += 1
        hour_score.setdefault(stamp.hour, []).append(row.severity_score)
        if row.ward:
            ward_counts[row.ward] += 1
            ward_scores.setdefault(row.ward, []).append(row.severity_score)

    by_day = []
    for offset in range(days - 1, -1, -1):
        key = (today - dt.timedelta(days=offset)).isoformat()
        scores = day_score.get(key, [])
        by_day.append(
            SeriesPoint(
                label=key,
                count=int(day_counts.get(key, 0)),
                avg_score=round(sum(scores) / len(scores), 1) if scores else 0.0,
            )
        )

    by_hour = [
        SeriesPoint(
            label=f"{hour:02d}:00",
            count=int(hour_counts.get(hour, 0)),
            avg_score=(
                round(sum(hour_score[hour]) / len(hour_score[hour]), 1) if hour_score.get(hour) else 0.0
            ),
        )
        for hour in range(24)
    ]

    by_ward = [
        SeriesPoint(
            label=name,
            count=int(count),
            avg_score=round(sum(ward_scores.get(name, [])) / max(1, len(ward_scores.get(name, []))), 1),
        )
        for name, count in ward_counts.most_common(8)
    ]

    highest = sorted(rows, key=lambda r: r.severity_score, reverse=True)[:6]
    lats = [r.latitude for r in rows]
    lngs = [r.longitude for r in rows]

    return StatsOut(
        total=len(rows),
        pending=int(status_counter.get("pending", 0)),
        inspected=int(status_counter.get("inspected", 0)),
        repaired=int(status_counter.get("repaired", 0)),
        critical=int(severity_counter.get("critical", 0)),
        avg_severity_score=round(sum(r.severity_score for r in rows) / len(rows), 1) if rows else 0.0,
        avg_confidence=round(sum(r.confidence for r in rows) / len(rows), 3) if rows else 0.0,
        highest_risk=[PotholeOut.model_validate(r) for r in highest],
        by_severity=_bucket(severity_counter, SEVERITIES),
        by_status=_bucket(status_counter, STATUSES),
        by_day=by_day,
        by_ward=by_ward,
        by_hour=by_hour,
        bbox=(
            {"min_lat": min(lats), "max_lat": max(lats), "min_lng": min(lngs), "max_lng": max(lngs)}
            if rows
            else None
        ),
    )


@router.get("/export.csv")
def export_csv(
    q: str | None = None,
    severity: str | None = None,
    status: str | None = None,
    source_type: str | None = None,
    road: str | None = None,
    ward: str | None = None,
    min_score: float | None = Query(None, ge=0, le=100),
    max_score: float | None = Query(None, ge=0, le=100),
    date_from: dt.datetime | None = None,
    date_to: dt.datetime | None = None,
    sort: str = Query("severity_score", pattern="|".join(SORTABLE)),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    db: Session = Depends(get_db),
):
    stmt = _apply_filters(
        select(Pothole),
        q=q, severity=severity, status=status, source_type=source_type, road=road, ward=ward,
        min_score=min_score, max_score=max_score, date_from=date_from, date_to=date_to,
    )
    column = SORTABLE[sort]
    rows = list(db.scalars(stmt.order_by(column.desc() if order == "desc" else column.asc())).all())

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([header for _, header in CSV_COLUMNS])
    for row in rows:
        writer.writerow(
            [
                row.ref_code,
                row.id,
                f"{row.latitude:.6f}",
                f"{row.longitude:.6f}",
                row.severity,
                f"{row.severity_score:.1f}",
                f"{row.confidence:.2f}",
                row.status,
                row.road_name or "",
                row.ward or "",
                row.address or "",
                f"{row.diameter_cm:.1f}",
                f"{row.depth_cm:.1f}",
                f"{row.area_px:.0f}",
                row.source_type,
                "" if row.frame_time_s is None else f"{row.frame_time_s:.2f}",
                row.detected_at.isoformat() if row.detected_at else "",
                row.notes or "",
            ]
        )
    buffer.seek(0)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    filename = f"potholes-{stamp}.csv"
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Total-Rows": str(len(rows)),
        },
    )


@router.get("/route", response_model=RouteOut)
def build_route(
    ids: str | None = Query(None, description="Comma separated pothole ids"),
    severity: str | None = None,
    status: str | None = None,
    min_score: float | None = Query(None, ge=0, le=100),
    limit: int = Query(25, ge=1, le=200),
    start_lat: float | None = None,
    start_lng: float | None = None,
    avg_speed_kmh: float = Query(24.0, gt=1),
    db: Session = Depends(get_db),
):
    if ids:
        wanted = [int(i) for i in _csv_list(ids) if i.isdigit()]
        stmt = select(Pothole).where(Pothole.id.in_(wanted))
    else:
        stmt = _apply_filters(
            select(Pothole),
            severity=severity,
            status=status,
            min_score=min_score,
        ).order_by(Pothole.severity_score.desc())
    rows = list(db.scalars(stmt).all())
    if not rows:
        raise HTTPException(status_code=404, detail="No potholes match the route criteria")

    points = [
        {
            "id": r.id,
            "ref_code": r.ref_code,
            "latitude": r.latitude,
            "longitude": r.longitude,
            "severity": r.severity,
            "severity_score": r.severity_score,
        }
        for r in rows
    ]
    start = (
        {"latitude": start_lat, "longitude": start_lng}
        if start_lat is not None and start_lng is not None
        else None
    )
    ordered = nearest_neighbour_route(points, start)[:limit]
    distance = route_length_km(([start] if start else []) + ordered)
    for index, point in enumerate(ordered, start=1):
        point["sequence"] = index

    return RouteOut(
        distance_km=round(distance, 2),
        duration_min=round(distance / avg_speed_kmh * 60, 1),
        points=ordered,
        pothole_ids=[p["id"] for p in ordered],
    )


@router.post("", response_model=PotholeOut, status_code=201)
def create_pothole_endpoint(payload: PotholeCreate, db: Session = Depends(get_db)):
    data = payload.model_dump(exclude_none=True)
    data.setdefault("detected_at", dt.datetime.now(dt.timezone.utc))
    pothole = create_pothole(db, **data)
    db.commit()
    db.refresh(pothole)
    out = PotholeOut.model_validate(pothole)
    broker.publish("pothole.created", {"pothole": out.model_dump(mode="json")})
    return out


@router.get("/{pothole_id}", response_model=PotholeOut)
def get_pothole(pothole_id: int, db: Session = Depends(get_db)):
    pothole = db.get(Pothole, pothole_id)
    if pothole is None:
        raise HTTPException(status_code=404, detail="Pothole not found")
    return PotholeOut.model_validate(pothole)


@router.patch("/{pothole_id}", response_model=PotholeOut)
def update_pothole(pothole_id: int, payload: PotholeUpdate, db: Session = Depends(get_db)):
    pothole = db.get(Pothole, pothole_id)
    if pothole is None:
        raise HTTPException(status_code=404, detail="Pothole not found")

    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    if not changes:
        raise HTTPException(status_code=400, detail="No fields supplied")

    score_changed = "severity_score" in changes
    for key, value in changes.items():
        setattr(pothole, key, value)
    if score_changed and "severity" not in changes:
        from ..geo import severity_from_score

        pothole.severity = severity_from_score(pothole.severity_score)
    pothole.updated_at = dt.datetime.now(dt.timezone.utc)

    db.commit()
    db.refresh(pothole)
    out = PotholeOut.model_validate(pothole)
    broker.publish("pothole.updated", {"pothole": out.model_dump(mode="json")})
    return out


@router.delete("/{pothole_id}", status_code=204)
def delete_pothole(pothole_id: int, db: Session = Depends(get_db)):
    pothole = db.get(Pothole, pothole_id)
    if pothole is None:
        raise HTTPException(status_code=404, detail="Pothole not found")
    db.delete(pothole)
    db.commit()
    broker.publish("pothole.deleted", {"id": pothole_id, "ref_code": pothole.ref_code})
    return None
