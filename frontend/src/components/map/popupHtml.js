import { severityMeta, statusMeta } from '../../lib/severity.js'

const INK = '#0e111c'
const MIST = '#eef1f8'
const MUTED = '#7c84a1'
const DIM = '#5d6480'

/** Shared popup markup for a group of potholes sharing one GPS fix. */
export function popupHtml(group) {
  const meta = severityMeta(group.severity)
  const rows = group.items
    .slice(0, 5)
    .map((item) => {
      const status = statusMeta(item.status)
      const road = item.road_name || item.address || '—'
      const score = Number(item.severity_score).toFixed(0)
      const scoreMeta = severityMeta(item.severity)
      const confidence = item.confidence != null ? `${(Number(item.confidence) * 100).toFixed(0)}%` : ''
      return `<div style="display:flex;align-items:center;gap:8px;font-family:'JetBrains Mono',monospace;font-size:11px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
        <span style="color:${MIST};font-weight:600;min-width:62px">${item.ref_code}</span>
        <span style="color:${MUTED};flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px">${road}</span>
        <span style="display:inline-flex;align-items:center;gap:3px;padding:1px 6px;border-radius:99px;font-size:9px;font-weight:700;background:${status.soft};color:${status.color}">${status.label}</span>
        <span style="display:inline-flex;align-items:center;gap:3px;min-width:24px;text-align:right">
          <span style="width:6px;height:6px;border-radius:99px;background:${scoreMeta.color};display:inline-block"></span>
          <span style="color:${scoreMeta.color};font-weight:700">${score}</span>
        </span>
        ${confidence ? `<span style="color:${DIM};font-size:9px">${confidence}</span>` : ''}
      </div>`
    })
    .join('')

  const avgScore = group.items.length
    ? (group.items.reduce((s, i) => s + (Number(i.severity_score) || 0), 0) / group.items.length).toFixed(1)
    : '—'

  return `<div style="font-family:Inter,sans-serif;color:${MIST};min-width:260px;max-width:380px;background:${INK}">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <span style="width:8px;height:8px;border-radius:99px;background:${meta.color};box-shadow:0 0 8px ${meta.color}"></span>
      <span style="font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${meta.color}">
        ${meta.label}
      </span>
      <span style="font-size:11px;color:${MUTED};margin-left:auto">${Math.round(group.maxScore)}/100</span>
    </div>
    <div style="display:flex;gap:12px;font-size:11px;color:${MUTED};margin-bottom:8px">
      <span>${group.count} pothole${group.count > 1 ? 's' : ''}</span>
      <span>Avg: ${avgScore}</span>
      <span style="color:${DIM}">${meta.hint}</span>
    </div>
    <div style="display:flex;flex-direction:column">${rows}</div>
    ${group.count > 5 ? `<div style="margin-top:6px;font-size:10px;color:${DIM};text-align:center">+${group.count - 5} more records</div>` : ''}
    <div style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.06);font-family:'JetBrains Mono',monospace;font-size:10px;color:${DIM};display:flex;justify-content:space-between">
      <span>${group.lat.toFixed(6)}, ${group.lng.toFixed(6)}</span>
      <span style="color:${MUTED};font-size:9px">Click for details</span>
    </div>
  </div>`
}
