import { useCallback, useEffect, useRef, useState } from 'react'

/** Declarative async data hook with abort handling and manual reload. */
export function useApi(fetcher, deps = [], { immediate = true, initial = null } = {}) {
  const [data, setData] = useState(initial)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(immediate)
  const [nonce, setNonce] = useState(0)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  useEffect(() => {
    if (!immediate) return undefined
    const controller = new AbortController()
    let active = true
    setLoading(true)
    Promise.resolve(fetcherRef.current(controller.signal))
      .then((result) => {
        if (!active) return
        setData(result)
        setError(null)
      })
      .catch((err) => {
        if (!active || err?.name === 'AbortError') return
        setError(err)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, immediate])

  const reload = useCallback(() => setNonce((value) => value + 1), [])

  return { data, error, loading, reload, setData }
}

export function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

/** Ticking clock used by relative timestamps. */
export function useTicker(intervalMs = 30000) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
}

export function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const raw = window.localStorage.getItem(key)
      return raw ? JSON.parse(raw) : initialValue
    } catch {
      return initialValue
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* storage disabled */
    }
  }, [key, value])

  return [value, setValue]
}
