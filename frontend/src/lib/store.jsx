import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from './api.js'
import { AppDataContext } from './appDataContext.js'
import { useApi } from './hooks.js'
import { useRealtime } from './useRealtime.js'

/**
 * App-wide data: backend config, health probe and the single SSE connection.
 *
 * Any realtime event bumps `revision` (debounced) so pages can add it to their
 * dependency list and refresh without opening their own stream.
 */
export function AppDataProvider({ children }) {
  const { data: config } = useApi(() => api.config(), [])
  const { data: health, reload: reloadHealth } = useApi(() => api.health(), [])
  const [revision, setRevision] = useState(0)
  const [lastEvent, setLastEvent] = useState(null)
  const [liveDetections, setLiveDetections] = useState(0)
  const flushRef = useRef(null)

  const bump = useCallback(() => {
    if (flushRef.current) return
    flushRef.current = setTimeout(() => {
      flushRef.current = null
      setRevision((value) => value + 1)
      reloadHealth()
    }, 1200)
  }, [reloadHealth])

  const { connected, events, clear } = useRealtime(api.streamUrl(), {
    onEvent: (event) => {
      setLastEvent(event)
      if (event.type === 'detection.batch') {
        setLiveDetections((value) => value + Number(event.payload?.count || 0))
      }
      if (event.type === 'pothole.created') setLiveDetections((value) => value + 1)
      bump()
    },
  })

  useEffect(() => () => clearTimeout(flushRef.current), [])

  useEffect(() => {
    const timer = setInterval(reloadHealth, 45000)
    return () => clearInterval(timer)
  }, [reloadHealth])

  const value = useMemo(
    () => ({
      config,
      health,
      revision,
      connected,
      events,
      clearEvents: clear,
      lastEvent,
      liveDetections,
      refresh: () => {
        setRevision((v) => v + 1)
        reloadHealth()
      },
    }),
    [config, health, revision, connected, events, clear, lastEvent, liveDetections, reloadHealth],
  )

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}
