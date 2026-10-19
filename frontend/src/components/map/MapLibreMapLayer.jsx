import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

import { markerSize, severityMeta } from '../../lib/severity.js'
import { popupHtml } from './popupHtml.js'

const TILE_SOURCES = {
  dark: {
    label: 'Dark',
    url: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
  },
  streets: {
    label: 'Streets',
    url: 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
  },
  satellite: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri &copy; Maxar &copy; Earthstar',
  },
  topo: {
    label: 'Topo',
    url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap &copy; OpenTopoMap',
  },
}

export default function MapLibreMapLayer({
  groups = [],
  route,
  selectedKey,
  focus,
  center,
  zoom,
  intensity,
  fitSignal,
  onSelect,
  onMapClick,
  pickMode,
  tileLayer: tileLayerKey,
  onTileLayerChange,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])
  const popupsRef = useRef([])
  const clickRef = useRef(onMapClick)
  const selectRef = useRef(onSelect)
  const [isFullscreen, setIsFullscreen] = useState(false)

  clickRef.current = onMapClick
  selectRef.current = onSelect

  const activeTile = tileLayerKey && TILE_SOURCES[tileLayerKey] ? tileLayerKey : 'dark'

  // Initialize MapLibre Map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined

    const initialSource = TILE_SOURCES[activeTile]

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          'raster-tiles': {
            type: 'raster',
            tiles: [initialSource.url],
            tileSize: 256,
            attribution: initialSource.attribution,
          },
        },
        layers: [
          {
            id: 'simple-tile-layer',
            type: 'raster',
            source: 'raster-tiles',
            minzoom: 0,
            maxzoom: 22,
          },
        ],
      },
      center: [center?.lng ?? 77.5946, center?.lat ?? 12.9716],
      zoom: zoom || 12,
      attributionControl: { compact: true },
    })

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right')

    map.on('click', (e) => {
      clickRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng })
    })

    mapRef.current = map

    const resizeObserver = new ResizeObserver(() => {
      map.resize()
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []
      popupsRef.current.forEach((p) => p.remove())
      popupsRef.current = []
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Update tile source when activeTile changes
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const sourceConfig = TILE_SOURCES[activeTile]
    if (!sourceConfig) return

    const style = map.getStyle()
    if (style && style.sources && style.sources['raster-tiles']) {
      style.sources['raster-tiles'].tiles = [sourceConfig.url]
      style.sources['raster-tiles'].attribution = sourceConfig.attribution
      map.setStyle(style)
    }
  }, [activeTile])

  // Render markers and intensity circles
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Clear existing DOM markers & popups
    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []
    popupsRef.current.forEach((p) => p.remove())
    popupsRef.current = []

    // Remove existing GeoJSON source/layers for route & halos if any
    if (map.getSource('route-source')) {
      if (map.getLayer('route-layer')) map.removeLayer('route-layer')
      if (map.getLayer('route-casing')) map.removeLayer('route-casing')
      map.removeSource('route-source')
    }

    if (map.getSource('halos-source')) {
      if (map.getLayer('halos-layer')) map.removeLayer('halos-layer')
      map.removeSource('halos-source')
    }

    // Add Route Polyline if present
    const routePoints = (route?.points || []).filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
    if (routePoints.length >= 2) {
      const coords = routePoints.map((p) => [p.longitude, p.latitude])
      map.addSource('route-source', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coords },
        },
      })
      map.addLayer({
        id: 'route-casing',
        type: 'line',
        source: 'route-source',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': 'rgba(109,139,255,0.3)', 'line-width': 8 },
      })
      map.addLayer({
        id: 'route-layer',
        type: 'line',
        source: 'route-source',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#6d8bff', 'line-width': 3, 'line-opacity': 0.95 },
      })

      // Route stop markers
      routePoints.forEach((point, index) => {
        const el = document.createElement('div')
        el.className = 'rs-stop-dot'
        el.innerText = String(index + 1)
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([point.longitude, point.latitude])
          .addTo(map)
        markersRef.current.push(marker)
      })
    }

    // Render Pothole Group Markers
    groups.forEach((group) => {
      const meta = severityMeta(group.severity)
      const isSelected = group.key === selectedKey
      const size = markerSize(group.maxScore) + (group.count > 1 ? 4 : 0)
      const label = group.count > 1 ? group.count : Math.round(group.maxScore)

      const el = document.createElement('div')
      el.className = 'rs-marker'
      el.style.cssText = `--rs:${meta.color};--rs-soft:${meta.soft};width:${size}px;height:${size}px;background:${meta.color};${
        isSelected
          ? `box-shadow:0 0 0 4px ${meta.soft},0 0 0 6px ${meta.color},0 6px 16px rgba(0,0,0,0.55)`
          : `box-shadow:0 0 0 4px ${meta.soft},0 6px 16px rgba(0,0,0,0.55)`
      };cursor:pointer;border-radius:999px;display:grid;place-items:center;border:2px solid rgba(255,255,255,0.88);font-family:var(--font-mono);font-size:11px;font-weight:700;color:#08090f`
      el.innerText = String(label)

      const popup = new maplibregl.Popup({
        offset: 16,
        closeButton: true,
        maxWidth: '320px',
        className: 'rs-popup-wrapper',
      }).setHTML(popupHtml(group))

      popupsRef.current.push(popup)

      el.addEventListener('click', (e) => {
        e.stopPropagation()
        selectRef.current?.(group)
      })

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([group.lng, group.lat])
        .setPopup(popup)
        .addTo(map)

      markersRef.current.push(marker)
    })
  }, [groups, route, selectedKey, intensity])

  // Handle focus changes
  useEffect(() => {
    const map = mapRef.current
    if (!map || !focus) return
    map.flyTo({
      center: [focus.lng, focus.lat],
      zoom: Math.max(map.getZoom(), 16),
      essential: true,
    })
  }, [focus, selectedKey])

  // Handle fitSignal
  useEffect(() => {
    const map = mapRef.current
    if (!map || !fitSignal || !groups.length) return
    const bounds = new maplibregl.LngLatBounds()
    groups.forEach((g) => bounds.extend([g.lng, g.lat]))
    map.fitBounds(bounds, { padding: 48, maxZoom: 16, duration: 800 })
  }, [fitSignal, groups])

  // Handle pickMode cursor
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const canvas = map.getCanvas()
    if (canvas) {
      canvas.style.cursor = pickMode ? 'crosshair' : ''
    }
  }, [pickMode])

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current?.parentElement
    if (!el) return
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().then(() => setIsFullscreen(true)).catch(() => {})
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false)).catch(() => {})
    }
  }, [])

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />

      {/* Tile layer switcher */}
      <div className="absolute right-3 top-3 z-[1000] flex flex-col gap-1">
        <div className="flex gap-1 rounded-xl border border-white/10 bg-ink-950/90 p-1 backdrop-blur">
          {Object.entries(TILE_SOURCES).map(([key, config]) => (
            <button
              key={key}
              type="button"
              onClick={() => onTileLayerChange?.(key)}
              className={`rounded-lg px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition ${
                activeTile === key
                  ? 'bg-accent-500/25 text-accent-300 shadow-sm'
                  : 'text-mist-500 hover:bg-white/[0.06] hover:text-mist-300'
              }`}
            >
              {config.label}
            </button>
          ))}
        </div>

        {/* Fullscreen button */}
        <button
          type="button"
          onClick={toggleFullscreen}
          className="self-end rounded-lg border border-white/10 bg-ink-950/90 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-mist-500 backdrop-blur transition hover:bg-white/[0.06] hover:text-mist-300"
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? '⊡ Exit' : '⛶ Full'}
        </button>
      </div>

      <CoordinateDisplay mapRef={mapRef} />
    </div>
  )
}

function CoordinateDisplay({ mapRef }) {
  const [coords, setCoords] = useState(null)

  useEffect(() => {
    const map = mapRef.current
    if (!map) return undefined
    const handler = (e) => setCoords({ lat: e.lngLat.lat.toFixed(6), lng: e.lngLat.lng.toFixed(6) })
    const clearHandler = () => setCoords(null)
    map.on('mousemove', handler)
    map.on('mouseout', clearHandler)
    return () => {
      map.off('mousemove', handler)
      map.off('mouseout', clearHandler)
    }
  }, [mapRef])

  if (!coords) return null
  return (
    <div className="absolute bottom-8 left-3 z-[1000] rounded-lg border border-white/10 bg-ink-950/85 px-2.5 py-1 font-mono text-[10px] text-mist-500 backdrop-blur">
      {coords.lat}, {coords.lng}
    </div>
  )
}
