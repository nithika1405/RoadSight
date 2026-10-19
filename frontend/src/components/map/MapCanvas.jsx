import { useEffect } from 'react'

import { googleMapsApiKey, useGoogleMaps } from '../../lib/useGoogleMaps.js'
import GoogleMapLayer from './GoogleMapLayer.jsx'
import MapLibreMapLayer from './MapLibreMapLayer.jsx'

/**
 * Renders the Google Maps layer when VITE_GOOGLE_MAPS_API_KEY is configured,
 * otherwise transparently falls back to MapLibre GL JS (WebGL accelerated).
 * Both layers accept the same props.
 */
export default function MapCanvas({ preferGoogle = true, onEngineChange, tileLayer, onTileLayerChange, ...props }) {
  const apiKey = preferGoogle ? googleMapsApiKey() : ''
  const { maps } = useGoogleMaps(apiKey)
  const engine = maps ? 'google' : 'maplibre'

  useEffect(() => {
    onEngineChange?.(engine)
  }, [engine, onEngineChange])

  if (maps) return <GoogleMapLayer maps={maps} {...props} />
  return <MapLibreMapLayer tileLayer={tileLayer} onTileLayerChange={onTileLayerChange} {...props} />
}
