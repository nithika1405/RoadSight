"""Small geo helpers shared by the routers."""

from __future__ import annotations

import math

EARTH_RADIUS_KM = 6371.0088


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two WGS84 points, in kilometres."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


def interpolate(lat1: float, lon1: float, lat2: float, lon2: float, fraction: float) -> tuple[float, float]:
    """Linear interpolation between two coordinates (good enough at street scale)."""
    f = max(0.0, min(1.0, fraction))
    return lat1 + (lat2 - lat1) * f, lon1 + (lon2 - lon1) * f


def nearest_neighbour_route(points: list[dict], start: dict | None = None) -> list[dict]:
    """Order arbitrary points into a short visiting route (greedy nearest neighbour).

    Each point is a dict with at least ``latitude`` / ``longitude``.
    """
    if not points:
        return []

    remaining = list(points)
    route: list[dict] = []

    current = start
    if current is None:
        current = remaining.pop(0)
        route.append(current)

    while remaining:
        idx = min(
            range(len(remaining)),
            key=lambda i: haversine_km(
                current["latitude"], current["longitude"],
                remaining[i]["latitude"], remaining[i]["longitude"],
            ),
        )
        current = remaining.pop(idx)
        route.append(current)

    return route


def route_length_km(route: list[dict]) -> float:
    return sum(
        haversine_km(route[i]["latitude"], route[i]["longitude"], route[i + 1]["latitude"], route[i + 1]["longitude"])
        for i in range(len(route) - 1)
    )


def severity_from_score(score: float) -> str:
    if score >= 78:
        return "critical"
    if score >= 58:
        return "high"
    if score >= 36:
        return "medium"
    return "low"
