import { useCallback, useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

import { haloOpacity, haloRadius, markerSize, severityMeta } from '../../lib/severity.js'
import { popupHtml } from './popupHtml.js'

const TILE_LAYERS = {
  dark: {
    label: 'Dark',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attrib: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: 'abcd',
  },
  streets: {
    label: 'Streets',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attrib: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: 'abcd',
  },
  satellite: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attrib: '&copy; Esri &copy; Maxar &copy; Earthstar',
    subdomains: '',
  },
  topo: {
    label: 'Topo',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attrib: '&copy; OpenStreetMap &copy; OpenTopoMap',
    subdomains: 'abc',
  },
}

function markerHtml(group, size) {
  const meta = severityMeta(group.severity)
  const label = group.count > 1 ? group.count : Math.round(group.maxScore)
  const isSelected = group._selected
  const ringStyle = isSelected ? `box-shadow:0 0 0 4px ${meta.soft},0 0 0 6px ${meta.color},0 6px 16px rgba(0,0,0,0.55)` : `box-shadow:0 0 0 4px ${meta.soft},0 6px 16px rgba(0,0,0,0.55)`
  return `<div class="rs-marker" style="--rs:${meta.color};--rs-soft:${meta.soft};width:${size}px;height:${size}px;background:${meta.color};${ringStyle};transition:transform 0.15s ease">${label}</div>`
}

function buildIcon(group) {
  const size = markerSize(group.maxScore) + (group.count > 1 ? 4 : 0)
  return L.divIcon({
    className: 'rs-marker-wrap',
    html: markerHtml(group, size),
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  })
}

/**
 * Key-free Leaflet map with the same contract as GoogleMapLayer.
 * Supports multiple tile layers, fullscreen, and enhanced interactions.
 */
export default function LeafletMapLayer({
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
  const routeRef = useRef([])
  const tileRef = useRef(null)
  const clickRef = useRef(onMapClick)
  const selectRef = useRef(onSelect)
  const [isFullscreen, setIsFullscreen] = useState(false)
  clickRef.current = onMapClick
  selectRef.current = onSelect

  const activeTile = tileLayerKey && TILE_LAYERS[tileLayerKey] ? tileLayerKey : 'dark'

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined

    const map = L.map(containerRef.current, {
      center: [center?.lat ?? 12.9716, center?.lng ?? 77.5946],
      zoom: zoom || 12,
      zoomControl: false,
      attributionControl: true,
      preferCanvas: false,
      zoomSnap: 0.5,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 90,
    })

    L.control.zoom({ position: 'bottomright' }).addTo(map)

    const tileConfig = TILE_LAYERS[activeTile]
    tileRef.current = L.tileLayer(tileConfig.url, {
      attribution: tileConfig.attrib,
      subdomains: tileConfig.subdomains || 'abcd',
      maxZoom: 20,
      detectRetina: true,
    }).addTo(map)

    map.on('click', (event) => {
      clickRef.current?.({ lat: event.latlng.lat, lng: event.latlng.lng })
    })

    mapRef.current = map

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize({ animate: false })
    })
    resizeObserver.observe(containerRef.current)
    requestAnimationFrame(() => map.invalidateSize())

    return () => {
      resizeObserver.disconnect()
      markersRef.current.forEach((layer) => layer.remove())
      routeRef.current.forEach((layer) => layer.remove())
      markersRef.current = []
      routeRef.current = []
      map.remove()
      mapRef.current = null
      tileRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // swap tile layer when activeTile changes
  useEffect(() => {
    const map = mapRef.current
    if (!map || !tileRef.current) return
    const tileConfig = TILE_LAYERS[activeTile]
    if (!tileConfig) return
    map.removeLayer(tileRef.current)
    tileRef.current = L.tileLayer(tileConfig.url, {
      attribution: tileConfig.attrib,
      subdomains: tileConfig.subdomains || 'abcd',
      maxZoom: 20,
      detectRetina: true,
    }).addTo(map)
    tileRef.current.bringToBack()
  }, [activeTile])

  // markers + intensity halos
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    markersRef.current.forEach((layer) => layer.remove())
    markersRef.current = []

    groups.forEach((group) => {
      const meta = severityMeta(group.severity)
      const isSelected = group.key === selectedKey

      if (intensity) {
        markersRef.current.push(
          L.circle([group.lat, group.lng], {
            radius: haloRadius(group.maxScore),
            color: meta.color,
            weight: 1,
            opacity: 0.45,
            fillColor: meta.color,
            fillOpacity: haloOpacity(group.maxScore),
            interactive: false,
          }).addTo(map),
        )
      }

      const annotatedGroup = { ...group, _selected: isSelected }
      const marker = L.marker([group.lat, group.lng], {
        icon: buildIcon(annotatedGroup),
        title: `${group.count} pothole(s) · ${meta.label} · ${Math.round(group.maxScore)}/100`,
        zIndexOffset: Math.round(group.maxScore) + (group.count > 1 ? 200 : 0) + (isSelected ? 500 : 0),
      })

      marker.bindPopup(popupHtml(group), { className: 'rs-popup', maxWidth: 320, autoPanPadding: [40, 40] })
      marker.on('click', () => selectRef.current?.(group))
      marker.addTo(map)
      markersRef.current.push(marker)
    })
  }, [groups, intensity, selectedKey])

  // route overlay
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    routeRef.current.forEach((layer) => layer.remove())
    routeRef.current = []

    const points = (route?.points || []).filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
    if (points.length < 2) return

    const path = points.map((point) => [point.latitude, point.longitude])

    routeRef.current.push(
      L.polyline(path, { color: 'rgba(109,139,255,0.3)', weight: 10, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(map),
    )
    routeRef.current.push(
      L.polyline(path, { color: '#6d8bff', weight: 3, opacity: 0.95, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(map),
    )

    points.forEach((point, index) => {
      routeRef.current.push(
        L.marker([point.latitude, point.longitude], {
          icon: L.divIcon({
            className: 'rs-stop',
            html: `<div class="rs-stop-dot">${index + 1}</div>`,
            iconSize: [22, 22],
            iconAnchor: [11, 11],
          }),
          zIndexOffset: 900 + index,
        }).addTo(map),
      )
    })
  }, [route])

  // focus the selected cluster
  useEffect(() => {
    const map = mapRef.current
    if (!map || !focus) return
    map.flyTo([focus.lat, focus.lng], Math.max(map.getZoom(), 16), { duration: 0.6 })
  }, [focus, selectedKey])

  // explicit "fit to data" requests
  useEffect(() => {
    const map = mapRef.current
    if (!map || !fitSignal) return
    if (!groups.length) return
    const bounds = L.latLngBounds(groups.map((group) => [group.lat, group.lng]))
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 16, animate: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSignal])

  // pick-mode cursor
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const container = map.getContainer()
    container.style.cursor = pickMode ? 'crosshair' : ''
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

  // re-invalidate on fullscreen toggle
  useEffect(() => {
    const map = mapRef.current
    if (map) setTimeout(() => map.invalidateSize({ animate: false }), 100)
  }, [isFullscreen])

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />

      {/* Tile layer switcher */}
      <div className="absolute right-3 top-3 z-[1000] flex flex-col gap-1">
        <div className="flex gap-1 rounded-xl border border-white/10 bg-ink-950/90 p-1 backdrop-blur">
          {Object.entries(TILE_LAYERS).map(([key, config]) => (
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

      {/* Coordinates display */}
      <CoordinateDisplay mapRef={mapRef} />
    </div>
  )
}

function CoordinateDisplay({ mapRef }) {
  const [coords, setCoords] = useState(null)

  useEffect(() => {
    const map = mapRef.current
    if (!map) return undefined
    const handler = (e) => setCoords({ lat: e.latlng.lat.toFixed(6), lng: e.latlng.lng.toFixed(6) })
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
