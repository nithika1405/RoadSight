/** Severity palette + the visual "intensity" model used by the map. */

export const SEVERITY_ORDER = ['low', 'medium', 'high', 'critical']

export const SEVERITY_META = {
  low: {
    key: 'low',
    label: 'Low',
    color: '#3ee6b0',
    soft: 'rgba(62, 230, 176, 0.16)',
    border: 'rgba(62, 230, 176, 0.45)',
    hint: 'cosmetic wear',
    range: '0 – 35',
  },
  medium: {
    key: 'medium',
    label: 'Medium',
    color: '#f5b301',
    soft: 'rgba(245, 179, 1, 0.16)',
    border: 'rgba(245, 179, 1, 0.45)',
    hint: 'needs scheduling',
    range: '36 – 57',
  },
  high: {
    key: 'high',
    label: 'High',
    color: '#ff7a1a',
    soft: 'rgba(255, 122, 26, 0.16)',
    border: 'rgba(255, 122, 26, 0.45)',
    hint: 'repair within days',
    range: '58 – 77',
  },
  critical: {
    key: 'critical',
    label: 'Critical',
    color: '#ff2d55',
    soft: 'rgba(255, 45, 85, 0.18)',
    border: 'rgba(255, 45, 85, 0.5)',
    hint: 'immediate action',
    range: '78 – 100',
  },
}

export const STATUS_META = {
  pending: { key: 'pending', label: 'Pending', color: '#f5b301', soft: 'rgba(245, 179, 1, 0.15)' },
  inspected: { key: 'inspected', label: 'Inspected', color: '#22d3ee', soft: 'rgba(34, 211, 238, 0.15)' },
  repaired: { key: 'repaired', label: 'Repaired', color: '#3ee6b0', soft: 'rgba(62, 230, 176, 0.15)' },
}

export function severityMeta(severity) {
  return SEVERITY_META[severity] || SEVERITY_META.medium
}

export function statusMeta(status) {
  return STATUS_META[status] || STATUS_META.pending
}

export function severityColor(severity) {
  return severityMeta(severity).color
}

/** Marker diameter in px, driven by the severity score. */
export function markerSize(score = 50) {
  const clamped = Math.max(0, Math.min(100, Number(score) || 0))
  return Math.round(20 + (clamped / 100) * 22)
}

/** Ground radius (metres) of the colour-intensity halo drawn under a marker. */
export function haloRadius(score = 50) {
  const clamped = Math.max(0, Math.min(100, Number(score) || 0))
  return Math.round(22 + (clamped / 100) * 90)
}

/** Opacity of the intensity halo - higher severity reads "hotter". */
export function haloOpacity(score = 50) {
  const clamped = Math.max(0, Math.min(100, Number(score) || 0))
  return Number((0.1 + (clamped / 100) * 0.26).toFixed(3))
}

/** 0..1 normalised heat used for inline bars. */
export function heat(score = 0) {
  return Math.max(0, Math.min(1, (Number(score) || 0) / 100))
}

export function scoreLabel(score) {
  return Number(score || 0).toFixed(1)
}

/** #rrggbb -> rgba(r, g, b, alpha) */
export function withAlpha(hex, alpha = 1) {
  const value = String(hex || '#6d8bff').replace('#', '')
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value
  const int = parseInt(full, 16)
  const r = (int >> 16) & 255
  const g = (int >> 8) & 255
  const b = int & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * Collapse potholes that share the same GPS fix into a single map marker.
 * (A single survey photo can legitimately contain several potholes at one
 * location - stacking them keeps the map readable.)
 */
export function groupByLocation(potholes = [], precision = 6) {
  const buckets = new Map()
  potholes.forEach((item) => {
    const lat = Number(item.latitude)
    const lng = Number(item.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
    const key = `${lat.toFixed(precision)},${lng.toFixed(precision)}`
    if (!buckets.has(key)) {
      buckets.set(key, { key, lat, lng, items: [], maxScore: 0, count: 0 })
    }
    const bucket = buckets.get(key)
    bucket.items.push(item)
    bucket.count += 1
    bucket.maxScore = Math.max(bucket.maxScore, Number(item.severity_score) || 0)
  })

  return Array.from(buckets.values()).map((bucket) => {
    const worst = bucket.items.reduce(
      (acc, item) => (Number(item.severity_score) > Number(acc.severity_score) ? item : acc),
      bucket.items[0],
    )
    return {
      ...bucket,
      severity: worst.severity,
      worst,
      avgScore: bucket.items.reduce((sum, i) => sum + (Number(i.severity_score) || 0), 0) / bucket.count,
    }
  })
}
