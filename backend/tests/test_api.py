"""End-to-end tests for the pothole REST API."""

from __future__ import annotations

import csv
import io

from conftest import SAMPLE_POTHOLE

API = "/api/potholes"


def _create(client, **overrides) -> dict:
    payload = {**SAMPLE_POTHOLE, **overrides}
    response = client.post(API, json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def test_health_and_config(client):
    health = client.get("/api/health")
    assert health.status_code == 200
    body = health.json()
    assert body["status"] in {"ok", "degraded"}
    assert "total_potholes" in body
    assert body["version"]

    config = client.get("/api/config")
    assert config.status_code == 200
    payload = config.json()
    assert payload["severities"] == ["low", "medium", "high", "critical"]
    assert "default_center" in payload


def test_root_index(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "Pothole" in response.json()["name"]


def test_create_read_update_delete(client, empty_db):
    created = _create(client)
    assert created["ref_code"].startswith("PH-")
    assert created["severity"] == "high"
    assert created["id"] > 0

    fetched = client.get(f"{API}/{created['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["road_name"] == "Outer Ring Road"

    patched = client.patch(f"{API}/{created['id']}", json={"status": "inspected"})
    assert patched.status_code == 200
    assert patched.json()["status"] == "inspected"

    # severity is recomputed from the score when only the score changes
    rescored = client.patch(f"{API}/{created['id']}", json={"severity_score": 82.0})
    assert rescored.status_code == 200
    assert rescored.json()["severity"] == "critical"

    deleted = client.delete(f"{API}/{created['id']}")
    assert deleted.status_code == 204
    assert client.get(f"{API}/{created['id']}").status_code == 404


def test_validation_rejects_bad_payload(client, empty_db):
    response = client.post(API, json={**SAMPLE_POTHOLE, "latitude": 123.0})
    assert response.status_code == 422

    response = client.post(API, json={**SAMPLE_POTHOLE, "severity": "apocalyptic"})
    assert response.status_code == 422


def test_missing_pothole_returns_404(client, empty_db):
    assert client.get(f"{API}/999999").status_code == 404
    assert client.patch(f"{API}/999999", json={"status": "repaired"}).status_code == 404
    assert client.delete(f"{API}/999999").status_code == 404


def test_list_filters_search_and_pagination(client, empty_db):
    _create(client, road_name="Outer Ring Road", severity="critical", severity_score=88.0, status="pending")
    _create(client, road_name="Hosur Road", severity="low", severity_score=30.0, status="repaired")
    _create(client, road_name="Mysore Road", severity="medium", severity_score=48.0, status="pending")

    everything = client.get(API).json()
    assert everything["total"] == 3

    critical = client.get(f"{API}?severity=critical").json()
    assert critical["total"] == 1

    pending = client.get(f"{API}?status=pending").json()
    assert pending["total"] == 2

    multi = client.get(f"{API}?severity=low,medium").json()
    assert multi["total"] == 2

    searched = client.get(f"{API}?q=hosur").json()
    assert searched["total"] == 1
    assert searched["items"][0]["road_name"] == "Hosur Road"

    scored = client.get(f"{API}?min_score=60").json()
    assert scored["total"] == 1

    paged = client.get(f"{API}?limit=2&offset=0&sort=id&order=asc").json()
    assert len(paged["items"]) == 2
    assert paged["items"][0]["id"] < paged["items"][1]["id"]

    invalid_sort = client.get(f"{API}?sort=drop_table")
    assert invalid_sort.status_code == 422


def test_radius_filter(client, empty_db):
    _create(client, latitude=12.9716, longitude=77.5946)
    _create(client, latitude=13.5000, longitude=78.5000)

    near = client.get(f"{API}?lat=12.9716&lng=77.5946&radius_km=5").json()
    assert near["total"] == 1


def test_stats_aggregation(client, empty_db):
    _create(client, severity="critical", severity_score=90.0, status="pending")
    _create(client, severity="low", severity_score=28.0, status="repaired")
    _create(client, severity="low", severity_score=32.0, status="inspected")

    stats = client.get(f"{API}/stats").json()
    assert stats["total"] == 3
    assert stats["pending"] == 1
    assert stats["inspected"] == 1
    assert stats["repaired"] == 1
    assert stats["critical"] == 1
    assert stats["avg_severity_score"] == 50.0
    assert len(stats["by_severity"]) == 4
    assert len(stats["by_day"]) == 14
    assert len(stats["by_hour"]) == 24
    assert stats["highest_risk"][0]["severity_score"] == 90.0
    assert stats["bbox"]["min_lat"] <= stats["bbox"]["max_lat"]

    low_bucket = next(b for b in stats["by_severity"] if b["severity"] == "low")
    assert low_bucket["count"] == 2
    assert low_bucket["avg_score"] == 30.0

    filtered = client.get(f"{API}/stats?severity=low&days=7").json()
    assert filtered["total"] == 2
    assert len(filtered["by_day"]) == 7


def test_csv_export(client, empty_db):
    _create(client, road_name="Outer Ring Road", severity="critical", severity_score=88.0)
    _create(client, road_name="Hosur Road", severity="low", severity_score=30.0)

    response = client.get(f"{API}/export.csv")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "attachment" in response.headers["content-disposition"]
    assert response.headers["x-total-rows"] == "2"

    rows = list(csv.DictReader(io.StringIO(response.text)))
    assert len(rows) == 2
    assert rows[0]["Severity score"] == "88.0"
    assert rows[0]["Reference"].startswith("PH-")
    assert "Latitude" in rows[0]

    filtered = client.get(f"{API}/export.csv?severity=low")
    rows = list(csv.DictReader(io.StringIO(filtered.text)))
    assert len(rows) == 1
    assert rows[0]["Road"] == "Hosur Road"


def test_route_planning(client, empty_db):
    _create(client, latitude=12.9716, longitude=77.5946, severity_score=90.0)
    _create(client, latitude=12.9750, longitude=77.6000, severity_score=70.0)
    _create(client, latitude=12.9800, longitude=77.6100, severity_score=40.0)

    response = client.get(f"{API}/route?limit=3&start_lat=12.9700&start_lng=77.5900")
    assert response.status_code == 200
    body = response.json()
    assert len(body["points"]) == 3
    assert body["distance_km"] > 0
    assert body["duration_min"] > 0
    assert [p["sequence"] for p in body["points"]] == [1, 2, 3]
    assert len(body["pothole_ids"]) == 3

    assert client.get(f"{API}/route?min_score=99").status_code == 404
