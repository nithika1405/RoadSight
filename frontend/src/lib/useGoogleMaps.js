import { useEffect, useState } from 'react'

let loaderPromise = null

/**
 * Loads the Google Maps JavaScript API exactly once.
 * Resolves with `window.google.maps`, or rejects when no key is configured.
 */
export function loadGoogleMaps(apiKey) {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  if (window.google?.maps) return Promise.resolve(window.google.maps)
  if (!apiKey) return Promise.reject(new Error('missing-api-key'))
  if (loaderPromise) return loaderPromise

  loaderPromise = new Promise((resolve, reject) => {
    const callbackName = '__roadsightGoogleMapsReady'
    window[callbackName] = () => {
      delete window[callbackName]
      if (window.google?.maps) resolve(window.google.maps)
      else reject(new Error('Google Maps failed to initialise'))
    }

    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey,
    )}&loading=async&callback=${callbackName}`
    script.async = true
    script.defer = true
    script.onerror = () => {
      loaderPromise = null
      reject(new Error('Could not reach the Google Maps script'))
    }
    document.head.appendChild(script)
  })

  return loaderPromise
}

export function useGoogleMaps(apiKey) {
  const [state, setState] = useState(() =>
    typeof window !== 'undefined' && window.google?.maps
      ? { maps: window.google.maps, status: 'ready', error: null }
      : { maps: null, status: 'loading', error: null },
  )

  useEffect(() => {
    if (!apiKey) return undefined
    let active = true
    loadGoogleMaps(apiKey)
      .then((maps) => {
        if (active) setState({ maps, status: 'ready', error: null })
      })
      .catch((error) => {
        if (active) setState({ maps: null, status: 'error', error: error.message })
      })
    return () => {
      active = false
    }
  }, [apiKey])

  // No key configured: derive the disabled state during render.
  if (!apiKey) return { maps: null, status: 'disabled', error: null }

  return state
}

export function googleMapsApiKey() {
  return (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim()
}
