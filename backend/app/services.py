"""Shared helpers for creating / serialising pothole records."""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from .models import Pothole


def create_pothole(db: Session, **fields) -> Pothole:
    """Insert a pothole and assign its human readable reference code."""
    pothole = Pothole(ref_code=f"TMP-{uuid.uuid4().hex[:10]}", **fields)
    db.add(pothole)
    db.flush()  # populate the primary key
    pothole.ref_code = f"PH-{100000 + pothole.id}"
    db.flush()
    return pothole
