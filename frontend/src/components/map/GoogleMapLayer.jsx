import { useEffect, useRef } from 'react'

import { haloOpacity, haloRadius, markerSize, severityMeta } from '../../lib/severity.js'
import { DARK_MAP_STYLE } from './googleDarkStyle.js'
import { popupHtml } from './popupHtml.js'

function markerIcon(maps, group) {
  const meta = severityMeta(group.severity)
  const size = markerSize(group.maxScore) + (group.count > 1 ? 4 : 0)
  const label = group.count > 1 ? String(group.count) : String(Math.round(group.maxScore))
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 1.5}" fill="${meta.color}" stroke="#ffffff" stroke-width="2"/>
<text x="50%" y="53%" dominant-baseline="middle" text-anchor="middle" font-family="monospace" font-size="${Math.round(
    size * 0.4,
  )}" font-weight="700" fill="#08090f">${label}</text>
</svg>`
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new maps.Size(size, size),
    anchor: new maps.Point(size / 2, size / 2),
  }
}

/**
 * Imperative Google Maps layer: severity-coloured markers, colour-intensity
 * halos, route overlay and map-click picking.
 */
export default function GoogleMapLayer({
  maps,
  groups,
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
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const infoRef = useRef(null)
  const overlaysRef = useRef([])
  const routeRef = useRef([])
  const clickRef = useRef(onMapClick)
  const selectRef = useRef(onSelect)
  clickRef.current = onMapClick
  selectRef.current = onSelect

  useEffect(() => {
    if (!maps || !containerRef.current || mapRef.current) return undefined

    const map = new maps.Map(containerRef.current, {
      center: { lat: center.lat, lng: center.lng },
      zoom,
      styles: DARK_MAP_STYLE,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      backgroundColor: '#0a0c15',
      clickableIcons: false,
      gestureHandling: 'greedy',
    })

    mapRef.current = map
    infoRef.current = new maps.InfoWindow({ maxWidth: 300 })
    map.addListener('click', (event) => {
      clickRef.current?.({ lat: event.latLng.lat(), lng: event.latLng.lng() })
    })

    return () => {
      infoRef.current?.close()
      overlaysRef.current.forEach((overlay) => overlay.setMap?.(null))
      overlaysRef.current = []
      routeRef.current.forEach((overlay) => overlay.setMap?.(null))
      routeRef.current = []
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maps])

  // markers + intensity halos
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    overlaysRef.current.forEach((overlay) => overlay.setMap?.(null))
    overlaysRef.current = []

    groups.forEach((group) => {
      const meta = severityMeta(group.severity)

      if (intensity) {
        overlaysRef.current.push(
          new maps.Circle({
            center: { lat: group.lat, lng: group.lng },
            radius: haloRadius(group.maxScore),
            strokeColor: meta.color,
            strokeOpacity: 0.45,
            strokeWeight: 1,
            fillColor: meta.color,
            fillOpacity: haloOpacity(group.maxScore),
            clickable: false,
            map,
          }),
        )
      }

      const marker = new maps.Marker({
        position: { lat: group.lat, lng: group.lng },
        icon: markerIcon(maps, group),
        title: `${group.count} pothole(s) · ${meta.label} · ${Math.round(group.maxScore)}/100`,
        zIndex: Math.round(group.maxScore) + (group.count > 1 ? 200 : 0),
        map,
      })

      marker.addListener('click', () => {
        infoRef.current.setContent(popupHtml(group))
        infoRef.current.open({ anchor: marker, map })
        selectRef.current?.(group)
      })

      overlaysRef.current.push(marker)
    })
  }, [maps, groups, intensity])

  // route overlay
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    routeRef.current.forEach((overlay) => overlay.setMap?.(null))
    routeRef.current = []

    const points = (route?.points || []).filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
    if (points.length < 2) return

    const path = points.map((point) => ({ lat: point.latitude, lng: point.longitude }))

    routeRef.current.push(
      new maps.Polyline({
        path,
        geodesic: true,
        strokeColor: '#6d8bff',
        strokeOpacity: 0.95,
        strokeWeight: 4,
        map,
      }),
    )

    points.forEach((point, index) => {
      routeRef.current.push(
        new maps.Marker({
          position: { lat: point.latitude, lng: point.longitude },
          label: { text: String(index + 1), color: '#060a18', fontSize: '10px', fontWeight: '700' },
          icon: {
            path: maps.SymbolPath.CIRCLE,
            scale: 9,
            fillColor: '#9db0ff',
            fillOpacity: 1,
            strokeColor: '#05060c',
            strokeWeight: 2,
          },
          zIndex: 900 + index,
          map,
        }),
      )
    })
  }, [maps, route])

  // focus the selected cluster
  useEffect(() => {
    const map = mapRef.current
    if (!map || !focus) return
    map.panTo({ lat: focus.lat, lng: focus.lng })
    if (map.getZoom() < 16) map.setZoom(17)
  }, [focus, selectedKey])

  // explicit "fit to data" requests
  useEffect(() => {
    const map = mapRef.current
    if (!map || !fitSignal) return
    if (!groups.length) return

    const bounds = new maps.LatLngBounds()
    groups.forEach((group) => bounds.extend({ lat: group.lat, lng: group.lng }))
    map.fitBounds(bounds, 64)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSignal])

  // keep the cursor meaningful while in pick mode
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.setOptions({ draggableCursor: pickMode ? 'crosshair' : undefined })
  }, [pickMode])

  return <div ref={containerRef} className="h-full w-full" />
}
