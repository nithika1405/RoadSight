"""Unit + integration tests for the computer-vision detection engine."""

from __future__ import annotations

import numpy as np
import pytest

from app.detection import (
    annotate,
    detect_potholes,
    encode_jpeg_b64,
    non_max_suppression,
    Detection,
    exif_gps,
)
from app.geo import haversine_km, severity_from_score
from conftest import encode_png, synthetic_road_image

DETECT_IMAGE = "/api/detect/image"
DETECT_VIDEO = "/api/detect/video"


# ---------------------------------------------------------------------------
# engine level
# ---------------------------------------------------------------------------
def test_severity_bands():
    assert severity_from_score(10) == "low"
    assert severity_from_score(40) == "medium"
    assert severity_from_score(65) == "high"
    assert severity_from_score(95) == "critical"


def test_haversine_matches_known_distance():
    # Bengaluru -> Chennai is roughly 290 km
    distance = haversine_km(12.9716, 77.5946, 13.0827, 80.2707)
    assert 280 < distance < 300


def test_detector_finds_synthetic_craters():
    image = synthetic_road_image()
    detections = detect_potholes(image)
    assert len(detections) >= 2

    for det in detections:
        assert 0.0 <= det.x <= 1.0 and 0.0 <= det.y <= 1.0
        assert 0.0 < det.w <= 1.0 and 0.0 < det.h <= 1.0
        assert det.x + det.w <= 1.001
        assert 0.0 <= det.score <= 100.0
        assert det.severity in {"low", "medium", "high", "critical"}
        assert det.confidence > 0


def test_detector_ignores_featureless_plate():
    flat = np.full((480, 640, 3), 150, dtype=np.uint8)
    assert detect_potholes(flat) == []


def test_detector_respects_min_score_and_max_detections():
    image = synthetic_road_image()
    assert detect_potholes(image, min_score=99.9) == []

    capped = detect_potholes(image, max_detections=1)
    assert len(capped) <= 1


def test_non_max_suppression_keeps_best_overlapping_box():
    strong = Detection(0.1, 0.1, 0.2, 0.2, 90.0, "critical", 0.9, 100.0, 10.0, 5.0)
    weak = Detection(0.11, 0.11, 0.2, 0.2, 40.0, "medium", 0.5, 100.0, 10.0, 5.0)
    far = Detection(0.7, 0.7, 0.2, 0.2, 60.0, "high", 0.7, 100.0, 10.0, 5.0)

    kept = non_max_suppression([weak, strong, far])
    assert strong in kept
    assert weak not in kept
    assert far in kept


def test_annotate_and_encode_roundtrip():
    image = synthetic_road_image()
    detections = detect_potholes(image)
    rendered = annotate(image, detections, title="test")
    assert rendered.shape == image.shape
    assert rendered.dtype == np.uint8
    assert not np.array_equal(rendered, image)

    payload = encode_jpeg_b64(rendered)
    assert payload.startswith("data:image/jpeg;base64,")


def test_exif_gps_missing_returns_none(tmp_path):
    path = tmp_path / "plain.png"
    path.write_bytes(encode_png(synthetic_road_image(320, 240)))
    assert exif_gps(path) is None


# ---------------------------------------------------------------------------
# endpoint level
# ---------------------------------------------------------------------------
def test_detect_image_endpoint_saves_detections(client, empty_db, road_image_bytes):
    response = client.post(
        DETECT_IMAGE,
        files={"file": ("road.png", road_image_bytes, "image/png")},
        data={
            "latitude": "12.9716",
            "longitude": "77.5946",
            "road_name": "Outer Ring Road",
            "ward": "Ward 84 - Bellandur",
            "auto_save": "true",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["kind"] == "image"
    assert body["saved"] is True
    assert len(body["detections"]) >= 1
    assert body["annotated_image"].startswith("data:image/jpeg;base64,")
    assert body["thumbnail_url"].startswith("/thumbnails/")
    assert body["media_url"].startswith("/media/")
    assert body["processing_ms"] >= 0

    first = body["detections"][0]
    assert first["pothole_id"] is not None
    assert first["ref_code"].startswith("PH-")
    assert first["latitude"] == pytest.approx(12.9716)
    assert set(first["bbox"]) == {"x", "y", "w", "h"}

    stored = client.get("/api/potholes").json()
    assert stored["total"] == len(body["detections"])
    assert stored["items"][0]["source_type"] == "image"
    assert stored["items"][0]["status"] == "pending"

    # the annotated thumbnail is actually served
    thumb = client.get(body["thumbnail_url"])
    assert thumb.status_code == 200
    assert thumb.headers["content-type"] == "image/jpeg"


def test_detect_image_without_auto_save(client, empty_db, road_image_bytes):
    response = client.post(
        DETECT_IMAGE,
        files={"file": ("road.png", road_image_bytes, "image/png")},
        data={"latitude": "12.9716", "longitude": "77.5946", "auto_save": "false"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["saved"] is False
    assert client.get("/api/potholes").json()["total"] == 0
    assert len(body["detections"]) >= 1


def test_detect_image_falls_back_to_default_center(client, empty_db, road_image_bytes):
    response = client.post(
        DETECT_IMAGE,
        files={"file": ("road.png", road_image_bytes, "image/png")},
        data={"auto_save": "true"},
    )
    assert response.status_code == 200
    items = client.get("/api/potholes").json()["items"]
    assert items
    assert items[0]["latitude"] == pytest.approx(12.9716, abs=0.5)


def test_detect_rejects_unsupported_extension(client, empty_db, road_image_bytes):
    response = client.post(
        DETECT_IMAGE,
        files={"file": ("notes.txt", b"not an image", "text/plain")},
        data={"auto_save": "false"},
    )
    assert response.status_code == 415


def test_detect_rejects_corrupt_image(client, empty_db):
    response = client.post(
        DETECT_IMAGE,
        files={"file": ("broken.png", b"\x89PNG\r\n\x1a\n not really", "image/png")},
        data={"auto_save": "false"},
    )
    assert response.status_code == 422


def test_detect_limits_endpoint(client):
    body = client.get("/api/detect/limits").json()
    assert ".png" in body["images"]
    assert ".mp4" in body["videos"]
    assert body["max_image_mb"] > 0


def test_detect_video_endpoint_geotags_along_route(client, empty_db, video_bytes):
    if video_bytes is None:
        pytest.skip("MJPG encoder unavailable in this OpenCV build")

    response = client.post(
        DETECT_VIDEO,
        files={"file": ("road.avi", video_bytes, "video/x-msvideo")},
        data={
            "latitude": "12.9000",
            "longitude": "77.5000",
            "end_latitude": "12.9500",
            "end_longitude": "77.5500",
            "road_name": "Hosur Road",
            "sample_interval_s": "0.5",
            "auto_save": "true",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["kind"] == "video"
    assert body["frames_analyzed"] >= 2
    assert body["duration_s"] > 0
    assert len(body["detections"]) >= 1

    for det in body["detections"]:
        assert det["frame_time_s"] is not None
        assert 12.9 <= det["latitude"] <= 12.95
        assert 77.5 <= det["longitude"] <= 77.55

    stored = client.get("/api/potholes").json()
    assert stored["total"] == len(body["detections"])
    assert stored["items"][0]["source_type"] == "video"


def test_detect_image_returns_single_playback_frame(client, empty_db, road_image_bytes):
    """A still is exposed as one frame at t=0 so the overlay shares one code path."""
    response = client.post(
        DETECT_IMAGE,
        files={"file": ("road.png", road_image_bytes, "image/png")},
        data={"auto_save": "false"},
    )
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["sample_interval_s"] is None
    assert len(body["frames"]) == 1
    frame = body["frames"][0]
    assert frame["time_s"] == 0.0
    assert len(frame["detections"]) == len(body["detections"])
    for det in frame["detections"]:
        assert set(det["bbox"]) == {"x", "y", "w", "h"}


def test_detect_video_returns_time_indexed_frames(client, empty_db, video_bytes):
    if video_bytes is None:
        pytest.skip("MJPG encoder unavailable in this OpenCV build")

    response = client.post(
        DETECT_VIDEO,
        files={"file": ("road.avi", video_bytes, "video/x-msvideo")},
        data={"sample_interval_s": "0.5", "auto_save": "false"},
    )
    assert response.status_code == 200, response.text
    body = response.json()

    frames = body["frames"]
    assert len(frames) == body["frames_analyzed"] >= 2
    assert body["sample_interval_s"] == pytest.approx(0.5, abs=0.2)

    times = [frame["time_s"] for frame in frames]
    assert times == sorted(times)
    assert times[0] == 0.0

    # the overlay needs normalised boxes and a severity band on every sample
    assert any(frame["detections"] for frame in frames)
    for frame in frames:
        for det in frame["detections"]:
            assert 0.0 <= det["bbox"]["x"] <= 1.0
            assert 0.0 <= det["bbox"]["w"] <= 1.0
            assert det["severity"] in {"low", "medium", "high", "critical"}
            assert 0.0 <= det["confidence"] <= 1.0


def test_realtime_stream_status(client):
    body = client.get("/api/stream/status").json()
    assert "subscribers" in body
    assert "recent" in body


def test_broker_fans_out_events():
    import asyncio

    from app.events import EventBroker

    async def scenario():
        bus = EventBroker()
        bus.bind_loop(asyncio.get_running_loop())
        queue = bus.subscribe()
        bus.publish("pothole.created", {"ref_code": "PH-100001"})
        event = await asyncio.wait_for(queue.get(), timeout=1)
        bus.unsubscribe(queue)
        return event, bus.history()

    event, history = asyncio.run(scenario())
    assert event["type"] == "pothole.created"
    assert event["payload"]["ref_code"] == "PH-100001"
    assert history[-1]["seq"] == event["seq"]
    assert "event: pothole.created" in EventBroker.format_sse(event)


def test_pothole_creation_notifies_broker(client, empty_db):
    from app.events import broker

    before = len(broker.history())
    response = client.post(
        "/api/potholes",
        json={"latitude": 12.9, "longitude": 77.5, "severity": "high", "severity_score": 70},
    )
    assert response.status_code == 201
    payload = response.json()

    recent = broker.history()[before:]
    assert any(e["type"] == "pothole.created" and e["payload"]["pothole"]["id"] == payload["id"] for e in recent)

    client.delete(f"/api/potholes/{payload['id']}")
    assert any(e["type"] == "pothole.deleted" for e in broker.history()[before:])
