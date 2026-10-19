import { useCallback, useEffect, useRef, useState } from 'react'

const EVENT_TYPES = ['pothole.created', 'pothole.updated', 'pothole.deleted', 'detection.batch']

/**
 * Subscribes to the backend SSE feed. Returns the live connection state and a
 * rolling buffer of the most recent events (newest first).
 */
export function useRealtime(url, { onEvent, enabled = true } = {}) {
  const [connected, setConnected] = useState(false)
  const [events, setEvents] = useState([])
  const handlerRef = useRef(onEvent)

  useEffect(() => {
    handlerRef.current = onEvent
  }, [onEvent])

  useEffect(() => {
    if (!enabled || !url || typeof window === 'undefined' || !('EventSource' in window)) {
      return undefined
    }

    let source
    let retryTimer
    let closed = false

    const connect = () => {
      if (closed) return
      source = new EventSource(url)

      source.onopen = () => setConnected(true)
      source.onerror = () => {
        setConnected(false)
        // EventSource auto-reconnects; nudge it after a short delay if it stalls.
        source.close()
        retryTimer = setTimeout(connect, 4000)
      }

      const handle = (event) => {
        let payload = {}
        try {
          payload = JSON.parse(event.data)
        } catch {
          payload = { raw: event.data }
        }
        setEvents((prev) => [payload, ...prev].slice(0, 50))
        handlerRef.current?.(payload)
      }

      EVENT_TYPES.forEach((type) => source.addEventListener(type, handle))
    }

    connect()

    return () => {
      closed = true
      clearTimeout(retryTimer)
      source?.close()
      setConnected(false)
    }
  }, [url, enabled])

  const clear = useCallback(() => setEvents([]), [])

  return { connected, events, clear }
}
