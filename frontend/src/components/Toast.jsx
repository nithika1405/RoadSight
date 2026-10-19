import { useCallback, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'

import { ToastContext } from '../lib/toastContext.js'

const ICONS = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
}

const TONES = {
  success: { border: 'rgba(62, 230, 176, 0.45)', color: '#3ee6b0' },
  error: { border: 'rgba(255, 45, 85, 0.5)', color: '#ff2d55' },
  info: { border: 'rgba(109, 139, 255, 0.5)', color: '#9db0ff' },
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const counter = useRef(0)

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  const push = useCallback(
    (message, tone = 'info', ttl = 4200) => {
      counter.current += 1
      const id = counter.current
      setToasts((prev) => [...prev.slice(-4), { id, message, tone }])
      if (ttl) setTimeout(() => dismiss(id), ttl)
      return id
    },
    [dismiss],
  )

  const value = useMemo(
    () => ({
      toast: push,
      success: (message) => push(message, 'success'),
      error: (message) => push(message, 'error', 6500),
      info: (message) => push(message, 'info'),
      dismiss,
    }),
    [push, dismiss],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[9999] flex w-[min(360px,92vw)] flex-col gap-2">
        {toasts.map((toast) => {
          const Icon = ICONS[toast.tone] || Info
          const tone = TONES[toast.tone] || TONES.info
          return (
            <div
              key={toast.id}
              className="pointer-events-auto flex items-start gap-3 rounded-xl px-3.5 py-3 text-sm animate-fade-up"
              style={{
                background: 'rgba(14, 17, 28, 0.96)',
                border: `1px solid ${tone.border}`,
                boxShadow: '0 22px 45px -24px rgba(0,0,0,0.95)',
              }}
            >
              <Icon size={16} style={{ color: tone.color, marginTop: 2, flexShrink: 0 }} />
              <p className="flex-1 leading-snug text-mist-100">{toast.message}</p>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="text-mist-500 transition hover:text-white"
                aria-label="Dismiss notification"
              >
                <X size={14} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
