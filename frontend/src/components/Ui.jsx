import { Loader2 } from 'lucide-react'

import { severityMeta, statusMeta, heat } from '../lib/severity.js'

export function SeverityBadge({ severity, score, compact = false }) {
  const meta = severityMeta(severity)
  return (
    <span
      className="chip"
      style={{ background: meta.soft, borderColor: meta.border, color: meta.color }}
      title={`${meta.label} severity · ${meta.hint}`}
    >
      <span className="badge-dot" />
      {meta.label}
      {!compact && score !== undefined && score !== null ? (
        <span className="mono opacity-80">{Number(score).toFixed(0)}</span>
      ) : null}
    </span>
  )
}

export function StatusPill({ status }) {
  const meta = statusMeta(status)
  return (
    <span className="chip" style={{ background: meta.soft, borderColor: 'transparent', color: meta.color }}>
      {meta.label}
    </span>
  )
}

export function ScoreBar({ score, height = 5, showValue = false }) {
  const value = Math.max(0, Math.min(100, Number(score) || 0))
  const color =
    value >= 78 ? '#ff2d55' : value >= 58 ? '#ff7a1a' : value >= 36 ? '#f5b301' : '#3ee6b0'
  return (
    <div className="flex items-center gap-2">
      <div
        className="relative flex-1 overflow-hidden rounded-full"
        style={{ height, background: 'rgba(255,255,255,0.08)' }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${heat(value) * 100}%`, background: color, boxShadow: `0 0 12px ${color}` }}
        />
      </div>
      {showValue ? <span className="mono w-9 text-right text-[11px] text-mist-300">{value.toFixed(0)}</span> : null}
    </div>
  )
}

export function StatTile({ label, value, hint, icon: Icon, tone = '#6d8bff', footer, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="stat-tile text-left transition hover:-translate-y-0.5 disabled:cursor-default"
      style={{ '--tile-glow': `${tone}55` }}
    >
      <div className="relative z-10 flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-mist-500">{label}</p>
          <p className="kpi-value mt-2" style={{ color: tone }}>
            {value}
          </p>
          {hint ? <p className="mt-1 text-[11px] text-mist-500">{hint}</p> : null}
        </div>
        {Icon ? (
          <span
            className="grid h-9 w-9 place-items-center rounded-xl"
            style={{ background: `${tone}22`, border: `1px solid ${tone}44` }}
          >
            <Icon size={16} style={{ color: tone }} />
          </span>
        ) : null}
      </div>
      {footer ? <div className="relative z-10 mt-3">{footer}</div> : null}
    </button>
  )
}

export function SectionHeading({ title, subtitle, action, icon: Icon }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        {Icon ? (
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.04]">
            <Icon size={16} className="text-accent-300" />
          </span>
        ) : null}
        <div>
          <h2 className="text-[15px] font-semibold text-mist-100">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-mist-500">{subtitle}</p> : null}
        </div>
      </div>
      {action}
    </div>
  )
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {Icon ? (
        <span className="grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/[0.04]">
          <Icon size={20} className="text-mist-500" />
        </span>
      ) : null}
      <div>
        <p className="text-sm font-semibold text-mist-100">{title}</p>
        {description ? <p className="mt-1 max-w-sm text-xs text-mist-500">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}

export function Spinner({ size = 16, className = '' }) {
  return <Loader2 size={size} className={`animate-spin ${className}`} />
}

export function LoadingBlock({ label = 'Loading data…', height = 180 }) {
  return (
    <div
      className="flex items-center justify-center gap-2 rounded-xl border border-white/5 bg-white/[0.02] text-xs text-mist-500"
      style={{ height }}
    >
      <Spinner />
      {label}
    </div>
  )
}

export function ErrorBlock({ error, onRetry }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-xl border border-sev-critical/40 bg-sev-critical/10 px-4 py-3 text-xs text-rose-200">
      <p className="font-semibold">Could not reach the API</p>
      <p className="text-rose-100/80">{String(error?.message || error)}</p>
      {onRetry ? (
        <button type="button" className="btn mt-1" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  )
}

export function KeyValue({ label, value, mono = false, tone }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-mist-500">{label}</span>
      <span className={`text-[13px] text-mist-100 ${mono ? 'mono' : ''}`} style={tone ? { color: tone } : undefined}>
        {value}
      </span>
    </div>
  )
}

export function Legend({ items }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-2 text-[11px] text-mist-300">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{
              background: item.color,
              boxShadow: `0 0 10px ${item.color}`,
              opacity: item.dim ? 0.45 : 1,
            }}
          />
          {item.label}
        </span>
      ))}
    </div>
  )
}

export function Switch({ checked, onChange, label, hint }) {
  return (
    <label className="flex cursor-pointer items-center gap-3">
      <span
        className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition"
        style={{ background: checked ? '#6d8bff' : 'rgba(255,255,255,0.14)' }}
      >
        <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span
          className="h-4 w-4 rounded-full bg-white transition"
          style={{ transform: `translateX(${checked ? 18 : 2}px)` }}
        />
      </span>
      <span>
        <span className="block text-xs font-medium text-mist-100">{label}</span>
        {hint ? <span className="block text-[11px] text-mist-500">{hint}</span> : null}
      </span>
    </label>
  )
}
