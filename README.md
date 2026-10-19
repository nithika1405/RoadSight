# RoadSight — Pothole Detection Platform

An end-to-end pothole detection and road-condition intelligence platform.

- **Backend** — FastAPI + SQLAlchemy + OpenCV detection engine (images **and** video),
  SQLite storage, CSV export, route optimisation and real-time Server-Sent Events.
- **Frontend** — React 19 + Vite + Tailwind CSS v4 + Recharts + Leaflet, with an
  optional **Google Maps** layer. Severity-coloured markers whose **size, halo radius
  and halo opacity scale with the pothole's severity score** ("colour intensity").

---

## Table of contents

1. [Feature tour](#feature-tour)
2. [Architecture](#architecture)
3. [Prerequisites](#prerequisites)
4. [Quick start (Windows PowerShell)](#quick-start-windows-powershell)
5. [Google Maps key (optional)](#google-maps-key-optional)
6. [Configuration reference](#configuration-reference)
7. [API reference](#api-reference)
8. [How detection & scoring work](#how-detection--scoring-work)
9. [Project structure](#project-structure)
10. [Testing & linting](#testing--linting)
11. [Troubleshooting](#troubleshooting)

---

## Feature tour

### Dashboard (`/`)
- KPI tiles: **total potholes**, **pending**, **inspected/repaired**, **critical**, **average severity**.
- Charts: 21-day trend (count + average score, dual axis), status distribution pie,
  severity mix bars, worst wards, per-hour risk profile.
- Recent detections feed and highest-risk list — every row deep-links to the map.

### AI detection (`/detect`)
- Drag-and-drop **image** or **video** upload with type/size validation.
- Tunable detector settings (minimum score, pixels-per-metre calibration,
  video sampling interval, auto-save toggle).
- Geotag the capture by **clicking the map**, using **"Use my GPS"**, or letting the
  backend read **EXIF GPS** from the photo. Videos take a start **and** end point and
  the backend **interpolates GPS per sampled frame** along the drive.
- Results panel with an annotated frame (bounding boxes + severity legend),
  per-detection scores and one-click "show on map" / discard.

### Interactive map (`/map`)
- Potholes rendered at their **real recorded GPS coordinates**, clustered by location.
- **Severity-coloured markers with intensity halos** — marker size, halo radius
  (metres) and halo opacity all grow with the severity score.
- Search, severity/status/source filters, minimum-score slider, road/ward filters,
  max-marker cap, and a **colour-intensity toggle**.
- Route overlays (optimised visit order from your highest-risk potholes),
  click-to-add a pothole, cluster details, delete, and **filtered CSV export**.
- Live updates over SSE — new detections appear without a refresh.

### Records (`/records`)
- Sortable, paginated data table with the same filters as the map.
- Detail drawer for triage: severity, status, notes and image preview.

---

## Architecture

```
┌──────────────────────────┐        /api, /media, /thumbnails        ┌───────────────────────────┐
│  React 19 + Vite (5173)  │  ─────────  dev proxy  ───────────────▶ │  FastAPI + Uvicorn (8000) │
│  Recharts · Leaflet/Maps │                                          │  SQLAlchemy · OpenCV      │
└──────────────────────────┘  ◀──── SSE /api/stream/events ────────  └───────────────────────────┘
                                                                                 │
                                                                        SQLite + uploads/
                                                                        thumbnails on disk
```

| Layer     | Technology |
|-----------|------------|
| API       | FastAPI 0.115, Uvicorn 0.34, Pydantic v2 |
| Data      | SQLAlchemy 2.0 (typed `Mapped`) + SQLite |
| Vision    | OpenCV 4.10 (headless), NumPy, Pillow (EXIF GPS) |
| Realtime  | Server-Sent Events via an in-process pub/sub broker |
| UI        | React 19.2, Vite 8, Tailwind CSS v4, react-router-dom 7 |
| Charts    | Recharts 3 |
| Maps      | Leaflet 1.9 / CARTO dark tiles (default) with an optional Google Maps JS API layer |
| Tests     | pytest 8 + FastAPI `TestClient` (28 tests) |

---

## Prerequisites

| Tool | Minimum | Notes |
|------|---------|-------|
| Windows | 10 / 11 | Commands below are PowerShell |
| Python | **3.10** | `py -3.10` or `py -3` — the venv already present is 3.10 |
| Node.js | **20 LTS** | Ships with npm 10+ |
| Git | any | optional |

---

## Quick start (Windows PowerShell)

> Open **two** PowerShell windows: one for the backend, one for the frontend.

### 1. Backend — create venv, install, run

```powershell
# From the repository root
cd "d:\trae ai\backend"

# Create the virtual environment (skip if backend\.venv already exists)
py -3 -m venv .venv

# Activate it for this shell session
.\.venv\Scripts\Activate.ps1

# Install pinned dependencies
python -m pip install --upgrade pip
pip install -r requirements.txt

# Run the API with auto-reload on http://127.0.0.1:8000
python -m uvicorn app.main:app --reload --port 8000
```

If PowerShell blocks activation with an execution-policy error, run this once
(no admin rights needed) and retry:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

To run **without activating** the venv (e.g. in CI or a one-off command), call the
interpreter directly:

```powershell
cd "d:\trae ai\backend"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

On first boot the API creates `backend\data\potholes.db` and, because the database is
empty, **auto-seeds 150 demo detections** so every screen has data immediately. Set
`$env:POTHOLE_AUTOSEED = "0"` before starting to skip seeding.

Confirm it is up:

```powershell
curl.exe http://127.0.0.1:8000/api/health
```

- Swagger UI — <http://127.0.0.1:8000/docs>
- Health — <http://127.0.0.1:8000/api/health>

### 2. Frontend — install and run

```powershell
# From the repository root (second PowerShell window)
cd "d:\trae ai\frontend"

# Install dependencies (only needed once / after package.json changes)
npm install

# Optional: create your local env file
Copy-Item .env.example .env.local

# Start the dev server on http://localhost:5173
npm run dev
```

Open **<http://localhost:5173>** — the Vite dev server proxies `/api`, `/media` and
`/thumbnails` to the backend on port 8000, so no CORS or URL juggling is required.

### 3. Production build (optional)

```powershell
cd "d:\trae ai\frontend"
npm run build          # emits frontend\dist\
npm run preview        # serves the build on http://localhost:4173
```

> `npm run preview` serves static assets only; it does **not** proxy `/api`.
> For a built bundle talking to a remote API, set `VITE_API_BASE_URL` in
> `frontend\.env.local` to the backend origin and rebuild.

---

## Google Maps key (optional)

The map works with **zero configuration** — it defaults to Leaflet with dark CARTO
tiles, so markers, halos, popups, route overlays and exports all work out of the box.

To switch to **Google Maps**:

1. In the [Google Cloud Console](https://console.cloud.google.com/) enable the
   **Maps JavaScript API**.
2. Create an API key and (recommended) restrict it to `http://localhost:5173/*`.
3. Create `frontend\.env.local`:

   ```ini
   VITE_GOOGLE_MAPS_API_KEY=YOUR_KEY_HERE
   ```
4. Restart `npm run dev`. The map HUD shows the active engine
   (`Google Maps` vs `Leaflet`); the Google layer applies a dark style and uses the
   same severity markers and intensity halos.

---

## Configuration reference

### Backend (`backend\.env` or PowerShell env vars)

| Variable | Default | Purpose |
|----------|---------|---------|
| `POTHOLE_DATABASE_URL` | `sqlite:///backend/data/potholes.db` | SQLAlchemy URL |
| `POTHOLE_DATA_DIR` | `backend\data` | Root for uploads/thumbnails/DB |
| `POTHOLE_UPLOAD_DIR` | `<data>\uploads` | Original uploads |
| `POTHOLE_THUMB_DIR` | `<data>\thumbnails` | Generated thumbnails |
| `POTHOLE_MAX_IMAGE_BYTES` | `15728640` (15 MB) | Image upload cap |
| `POTHOLE_MAX_VIDEO_BYTES` | `209715200` (200 MB) | Video upload cap |
| `POTHOLE_CORS_ORIGINS` | localhost:5173/4173 | Comma-separated allow-list |
| `POTHOLE_DEFAULT_LAT` / `POTHOLE_DEFAULT_LNG` | `12.9716` / `77.5946` | Map fallback centre (Bengaluru) |
| `POTHOLE_AUTOSEED` | `1` | Set `0` to skip demo seeding |

Set them in PowerShell for the current session, e.g.:

```powershell
$env:POTHOLE_AUTOSEED = "0"
```

### Frontend (`frontend\.env.local`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `VITE_API_BASE_URL` | empty | Empty = use the dev proxy; set an absolute URL for a remote API |
| `VITE_GOOGLE_MAPS_API_KEY` | empty | Enables the Google Maps layer |
| `VITE_PROXY_TARGET` | `http://127.0.0.1:8000` | Dev-proxy target for `/api`, `/media`, `/thumbnails` |

---

## API reference

Interactive docs: <http://127.0.0.1:8000/docs>

| Method | Path | Description |
|--------|------|-------------|
| `GET`   | `/api/health` | Status, version, DB state, pothole count, SSE subscribers |
| `GET`   | `/api/config` | Default map centre, severities/statuses, upload limits, thresholds |
| `GET`   | `/api/potholes` | Filtered, sorted, paginated list (see below) |
| `POST`  | `/api/potholes` | Manually register a pothole |
| `GET`   | `/api/potholes/stats` | Aggregates: totals, averages, by severity/status/day/ward/hour, bbox |
| `GET`   | `/api/potholes/route` | Ordered visit route over high-severity potholes (distance in km) |
| `GET`   | `/api/potholes/export.csv` | CSV of the current filter set (`X-Total-Rows` header) |
| `PATCH` | `/api/potholes/{id}` | Update severity, status, notes, location… |
| `DELETE`| `/api/potholes/{id}` | Delete a pothole |
| `POST`  | `/api/detect/image` | Analyse an image; returns detections + annotated frame |
| `POST`  | `/api/detect/video` | Sample, analyse and geotag a video along its route |
| `GET`   | `/api/detect/limits` | Upload extensions and size caps |
| `DELETE`| `/api/detect/{id}` | Discard a saved detection |
| `GET`   | `/api/stream/events` | **SSE** stream: `detection.batch`, `pothole.created/updated/deleted` |
| `GET`   | `/api/stream/status` | Current subscriber count |

**`GET /api/potholes` query parameters** — `q`, `severity` (csv), `status` (csv),
`source_type`, `road`, `ward`, `min_score`, `max_score`, `date_from`, `date_to`,
`lat`, `lng`, `radius_km`, `sort` (default `severity_score`), `order` (`desc`),
`limit` (≤500), `offset`.

Example export:

```powershell
curl.exe -L -o "critical.csv" "http://127.0.0.1:8000/api/potholes/export.csv?severity=critical"
```

---

## How detection & scoring work

The pipeline is deliberately transparent so every UI number is explainable:

```
BGR → grayscale → CLAHE (illumination normalisation) → Gaussian blur
    → multi-scale local background subtraction (fine σ + coarse σ)
    → Otsu threshold → morphological close/open
    → contour extraction → geometric & intensity filters
    → weighted severity regression (0..100) → greedy NMS (IoU 0.35)
```

Severity score (0–100) is a weighted blend of contrast, area ratio, circularity,
solidity and edge density, with damping for implausibly large blobs. Bounding boxes
are stored **normalised** (0–1) so they render at any resolution.

| Severity | Score band | Marker colour |
|----------|-----------|---------------|
| low      | 0–35      | `#3ee6b0` |
| medium   | 36–57     | `#f5b301` |
| high     | 58–77     | `#ff7a1a` |
| critical | 78–100    | `#ff2d55` |

**Colour intensity** — marker size, halo radius (in metres) and halo opacity are all
linear in the score, so a 95 ⚑ pothole is visibly larger and more opaque than a 40 one.

Swapping in a trained model (YOLO/ONNX) only means re-implementing
`detect_potholes()` in `backend\app\detection.py` — the rest of the app consumes the
`Detection` dataclass and is detector-agnostic.

---

## Project structure

```
d:\trae ai\
├─ backend\
│  ├─ app\
│  │  ├─ main.py            # FastAPI app, lifespan, CORS, static mounts
│  │  ├─ config.py          # env-driven settings
│  │  ├─ database.py        # engine, session, init_db
│  │  ├─ models.py          # Pothole ORM model
│  │  ├─ schemas.py         # Pydantic v2 request/response models
│  │  ├─ detection.py       # OpenCV detection engine (images + video)
│  │  ├─ geo.py             # haversine, interpolation, severity bands
│  │  ├─ events.py          # SSE pub/sub broker
│  │  ├─ seed.py            # demo data for an empty DB
│  │  ├─ services.py        # create/update helpers + ref codes
│  │  ├─ storage.py         # upload persistence and media URLs
│  │  └─ routers\
│  │     ├─ potholes.py     # list/stats/route/export/CRUD
│  │     ├─ detect.py       # image + video analysis
│  │     └─ stream.py       # SSE endpoints
│  ├─ data\                 # sqlite DB, uploads\, thumbnails\  (git-ignored)
│  ├─ tests\                # pytest suite (28 tests)
│  ├─ requirements.txt
│  └─ pytest.ini
└─ frontend\
   ├─ src\
   │  ├─ main.jsx           # entry: Router → Providers → App
   │  ├─ App.jsx            # routes
   │  ├─ index.css          # Tailwind v4 @theme tokens + map CSS
   │  ├─ components\
   │  │  ├─ Layout.jsx      # shell, nav, live badge
   │  │  ├─ Ui.jsx          # StatTile, Card, Chip, Switch…
   │  │  ├─ Toast.jsx       # toast provider
   │  │  └─ map\
   │  │     ├─ MapCanvas.jsx        # engine switch (Google → Leaflet)
   │  │     ├─ GoogleMapLayer.jsx   # Google Maps JS API layer
   │  │     ├─ LeafletMapLayer.jsx  # key-free fallback layer
   │  │     ├─ googleDarkStyle.js
   │  │     └─ popupHtml.js         # shared popup markup
   │  ├─ lib\
   │  │  ├─ api.js          # typed fetch client
   │  │  ├─ hooks.js        # useApi / async helpers
   │  │  ├─ store.jsx       # app data provider (config, revision)
   │  │  ├─ useRealtime.js  # SSE subscription
   │  │  ├─ useGoogleMaps.js# dynamic Maps JS loader
   │  │  ├─ severity.js     # colours, labels, thresholds
   │  │  └─ format.js       # number/date/byte formatters
   │  └─ pages\
   │     ├─ Dashboard.jsx
   │     ├─ Detect.jsx
   │     ├─ MapView.jsx
   │     └─ Records.jsx
   ├─ public\               # favicon, icons
   ├─ .env.example
   ├─ vite.config.js        # React + Tailwind plugins, dev proxy
   └─ package.json
```

---

## Testing & linting

### Backend tests (28 tests)

```powershell
cd "d:\trae ai\backend"
.\.venv\Scripts\python.exe -m pytest -q
```

Verbose / focused runs:

```powershell
.\.venv\Scripts\python.exe -m pytest -v
.\.venv\Scripts\python.exe -m pytest tests\test_detection.py -q
```

### Frontend lint & build

```powershell
cd "d:\trae ai\frontend"
npm run lint       # oxlint
npm run build      # production bundle → dist\
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Activate.ps1 cannot be loaded…` | `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`, retry |
| `Vite` port 5173 busy | Vite auto-increments to 5174; ensure the new port is in `POTHOLE_CORS_ORIGINS` or rely on the dev proxy |
| Dashboard shows no data | Backend not running / wrong port — check `curl.exe http://127.0.0.1:8000/api/health` |
| `net::ERR_ABORTED` in the console on first load | Expected: React 19 StrictMode double-invokes effects in dev and the first request is aborted; the retained request succeeds |
| Map is grey / tiles missing | Offline — the map needs internet access for tiles (CARTO or Google) |
| Upload rejected | Check the extension and size against `GET /api/detect/limits` (15 MB images, 200 MB video) |
| Want a clean database | Stop the API, delete `backend\data\potholes.db`, restart (it re-seeds 150 rows) |

---

## License

Provided as-is for demonstration and evaluation purposes.
