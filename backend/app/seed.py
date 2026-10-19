"""Demo data generator.

Creates a believable survey dataset: potholes are laid out along a handful of
road corridors (so the map shows realistic density along routes) with severity,
status and timestamps drawn from realistic distributions.

Usage::

    python -m app.seed --count 160 --reset
"""

from __future__ import annotations

import argparse
import random
import datetime as dt

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import DEFAULT_CENTER
from .database import SessionLocal, init_db
from .geo import interpolate
from .models import Pothole
from .services import create_pothole

CORRIDORS = [
    {"name": "Outer Ring Road", "ward": "Ward 84 - Bellandur", "start": (12.9250, 77.6762), "end": (12.9784, 77.6408)},
    {"name": "Hosur Road", "ward": "Ward 192 - Bommanahalli", "start": (12.8900, 77.6200), "end": (12.9600, 77.6100)},
    {"name": "Old Airport Road", "ward": "Ward 88 - Domlur", "start": (12.9600, 77.6400), "end": (12.9600, 77.7200)},
    {"name": "Tumkur Road", "ward": "Ward 38 - Peenya", "start": (13.0200, 77.5100), "end": (13.0600, 77.5500)},
    {"name": "Bannerghatta Road", "ward": "Ward 194 - HSR Layout", "start": (12.8800, 77.5950), "end": (12.9400, 77.6100)},
    {"name": "Mysore Road", "ward": "Ward 158 - Vijayanagar", "start": (12.9400, 77.5200), "end": (12.9600, 77.5600)},
    {"name": "Sarjapur Road", "ward": "Ward 150 - Bellandur", "start": (12.9200, 77.6800), "end": (12.8800, 77.7200)},
]

CITY = "Bengaluru"
# Draw severity from a fixed distribution so the console looks plausible.
SEVERITY_MIX = [("low", 0.26), ("medium", 0.36), ("high", 0.26), ("critical", 0.12)]
STATUS_MIX = [("pending", 0.64), ("inspected", 0.24), ("repaired", 0.12)]
SCORE_RANGES = {"low": (26, 36), "medium": (36, 58), "high": (58, 78), "critical": (78, 97)}


def _weighted(rng: random.Random, mix: list[tuple[str, float]]) -> str:
    threshold = rng.random()
    cumulative = 0.0
    for value, weight in mix:
        cumulative += weight
        if threshold <= cumulative:
            return value
    return mix[-1][0]


def seed_demo_data(
    db: Session,
    *,
    count: int = 150,
    days: int = 21,
    rng_seed: int = 20260101,
    center: tuple[float, float] | None = None,
) -> int:
    """Insert *count* demo potholes and return how many rows were created."""
    rng = random.Random(rng_seed)
    center = center or DEFAULT_CENTER
    now = dt.datetime.now(dt.timezone.utc)
    created = 0

    for _ in range(count):
        corridor = rng.choice(CORRIDORS)
        fraction = rng.random()
        lat, lng = interpolate(*corridor["start"], *corridor["end"], fraction)

        # lateral scatter so points sit on both sides of the centre line
        lat += rng.gauss(0, 0.00035)
        lng += rng.gauss(0, 0.00035)

        severity = _weighted(rng, SEVERITY_MIX)
        low, high = SCORE_RANGES[severity]
        score = round(rng.uniform(low, high), 1)

        detected_at = now - dt.timedelta(
            days=rng.uniform(0, days),
            hours=rng.uniform(0, 24),
            minutes=rng.uniform(0, 60),
        )

        create_pothole(
            db,
            latitude=round(lat, 7),
            longitude=round(lng, 7),
            address=f"{corridor['name']}, {corridor['ward'].split(' - ')[-1]}, {CITY}",
            road_name=corridor["name"],
            ward=corridor["ward"],
            severity=severity,
            severity_score=score,
            confidence=round(min(0.99, 0.45 + score / 190 + rng.uniform(-0.05, 0.06)), 3),
            area_px=round(rng.uniform(900, 26000), 1),
            diameter_cm=round(18 + score * 0.75 + rng.uniform(-6, 9), 1),
            depth_cm=round(1.2 + score * 0.12 + rng.uniform(-1, 2.5), 1),
            bbox_x=round(rng.uniform(0.05, 0.7), 4),
            bbox_y=round(rng.uniform(0.3, 0.8), 4),
            bbox_w=round(rng.uniform(0.08, 0.24), 4),
            bbox_h=round(rng.uniform(0.06, 0.2), 4),
            status=_weighted(rng, STATUS_MIX),
            source_type="video" if rng.random() < 0.45 else "image",
            frame_time_s=round(rng.uniform(0, 240), 2) if rng.random() < 0.45 else None,
            notes=rng.choice(
                [
                    "Reported by citizen app",
                    "Detected during routine survey",
                    "Water logging nearby",
                    "High traffic zone - schedule night repair",
                    None,
                    None,
                ]
            ),
            detected_at=detected_at,
            created_at=detected_at,
            updated_at=detected_at,
        )
        created += 1

    db.commit()
    return created


def seed_if_empty(count: int = 150) -> int:
    init_db()
    with SessionLocal() as session:
        existing = session.scalar(select(func.count(Pothole.id))) or 0
        if existing:
            return 0
        return seed_demo_data(session, count=count)


def main() -> None:  # pragma: no cover - CLI entry point
    parser = argparse.ArgumentParser(description="Seed the pothole database with demo data")
    parser.add_argument("--count", type=int, default=150, help="number of potholes to create")
    parser.add_argument("--days", type=int, default=21, help="spread detections over N days")
    parser.add_argument("--seed", type=int, default=20260101, help="random seed")
    parser.add_argument("--reset", action="store_true", help="delete every existing row first")
    args = parser.parse_args()

    init_db()
    with SessionLocal() as session:
        if args.reset:
            removed = session.query(Pothole).delete()
            session.commit()
            print(f"Removed {removed} existing rows")
        created = seed_demo_data(session, count=args.count, days=args.days, rng_seed=args.seed)
        total = session.scalar(select(func.count(Pothole.id))) or 0
    print(f"Created {created} demo potholes (total in database: {total})")


if __name__ == "__main__":  # pragma: no cover
    main()
