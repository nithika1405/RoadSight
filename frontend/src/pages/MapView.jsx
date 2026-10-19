import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Crosshair,
  Download,
  Eye,
  EyeOff,
  Filter,
  Flame,
  Layers,
  MapPin,
  Maximize2,
  Plus,
  Route as RouteIcon,
  Search,
  Trash2,
  Wifi,
  X,
} from 'lucide-react'

import MapCanvas from '../components/map/MapCanvas.jsx'
import { useToast } from '../lib/toastContext.js'
import { EmptyState, Legend, ScoreBar, SectionHeading, SeverityBadge, Spinner, StatusPill } from '../components/Ui.jsx'
import { api, downloadCsv } from '../lib/api.js'
import { useApi, useDebounced } from '../lib/hooks.js'
import { groupByLocation, SEVERITY_META, SEVERITY_ORDER, STATUS_META } from '../lib/severity.js'
import { formatCoord, formatDuration, formatNumber, relativeTime } from '../lib/format.js'
import { useAppData } from '../lib/appDataContext.js'

const STATUS_OPTIONS = ['pending', 'inspected', 'repaired']
const SOURCE_OPTIONS = [
  { value: '', label: 'All sources' },
  { value: 'image', label: 'Image' },
  { value: 'video', label: 'Video' },
  { value: 'manual', label: 'Manual' },
]

const EMPTY_DRAFT = { severity: 'medium', severity_score: 50, road_name: '', ward: '', notes: '' }

export default function MapView() {
  const toast = useToast()
  const { revision, connected } = useAppData()
  const [searchParams] = useSearchParams()

  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounced(query, 320)
  const [severities, setSeverities] = useState([...SEVERITY_ORDER])
  const [statusFilter, setStatusFilter] = useState('')
  const [source, setSource] = useState('')
  const [minScore, setMinScore] = useState(0)
  const [road, setRoad] = useState('')
  const [ward, setWard] = useState('')
  const [limit, setLimit] = useState(400)

  const [intensity, setIntensity] = useState(true)
  const [selectedKey, setSelectedKey] = useState(null)
  const [focus, setFocus] = useState(null)
  const [fitSignal, setFitSignal] = useState(0)
  const [engine, setEngine] = useState('leaflet')
  const [tileLayer, setTileLayer] = useState('dark')

  const [route, setRoute] = useState(null)
  const [routing, setRouting] = useState(false)
  const [pickMode, setPickMode] = useState(false)
  const [draft, setDraft] = useState(null)
  const [draftForm, setDraftForm] = useState(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)

  const [handledFocus, setHandledFocus] = useState(null)

  const params = useMemo(
    () => ({
      q: debouncedQuery || undefined,
      severity: severities.length && severities.length < SEVERITY_ORDER.length ? severities : undefined,
      status: statusFilter || undefined,
      source_type: source || undefined,
      min_score: minScore || undefined,
      road: road || undefined,
      ward: ward || undefined,
      sort: 'severity_score',
      order: 'desc',
      limit,
    }),
    [debouncedQuery, severities, statusFilter, source, minScore, road, ward, limit],
  )

  const { data, error, loading, reload } = useApi((signal) => api.listPotholes(params, signal), [params, revision])

  const groups = useMemo(() => groupByLocation(data?.items || []), [data])
  const selected = useMemo(() => groups.find((group) => group.key === selectedKey) || null, [groups, selectedKey])

  const stats = useMemo(() => {
    const items = data?.items || []
    return {
      markers: groups.length,
      potholes: items.length,
      critical: items.filter((item) => item.severity === 'critical').length,
      avg: items.length ? items.reduce((sum, item) => sum + Number(item.severity_score || 0), 0) / items.length : 0,
    }
  }, [data, groups])

  // deep link: /map?focus=<id>
  // Adjust state during render (React's "storing information from previous
  // renders" pattern) so the map jumps to the linked pothole once data lands.
  const focusId = searchParams.get('focus')
  if (focusId && focusId !== handledFocus && data?.items?.length) {
    const target = data.items.find((item) => String(item.id) === String(focusId))
    if (target) {
      setHandledFocus(focusId)
      setSelectedKey(`${Number(target.latitude).toFixed(6)},${Number(target.longitude).toFixed(6)}`)
      setFocus({ lat: Number(target.latitude), lng: Number(target.longitude) })
    }
  }

  const toggleSeverity = (key) => {
    setSeverities((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]))
  }

  const buildRoute = async () => {
    setRouting(true)
    try {
      const response = await api.route({
        severity: severities.length && severities.length < SEVERITY_ORDER.length ? severities.join(',') : undefined,
        status: statusFilter || undefined,
        min_score: minScore || undefined,
        limit: 20,
      })
      setRoute(response)
      setFitSignal((value) => value + 1)
      toast.success(`Route optimised across ${response.points.length} repairs · ${response.distance_km} km`)
    } catch (err) {
      toast.error(err.message)
      setRoute(null)
    } finally {
      setRouting(false)
    }
  }

  const handleMapClick = useCallback(
    ({ lat, lng }) => {
      if (!pickMode) return
      setDraft({ lat, lng })
      setDraftForm(EMPTY_DRAFT)
    },
    [pickMode],
  )

  const saveDraft = async () => {
    if (!draft) return
    setSaving(true)
    try {
      await api.createPothole({
        latitude: Number(draft.lat.toFixed(7)),
        longitude: Number(draft.lng.toFixed(7)),
        severity: draftForm.severity,
        severity_score: Number(draftForm.severity_score),
        road_name: draftForm.road_name || null,
        ward: draftForm.ward || null,
        notes: draftForm.notes || null,
        source_type: 'manual',
        status: 'pending',
      })
      toast.success('Pothole registered at the picked coordinates.')
      setDraft(null)
      setPickMode(false)
      reload()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const deleteSelected = async () => {
    if (!selected) return
    const victims = selected.items.filter((item) => item.id)
    try {
      await Promise.all(victims.map((item) => api.deletePothole(item.id)))
      toast.success(`Removed ${victims.length} record(s) from this fix.`)
      setSelectedKey(null)
      reload()
    } catch (err) {
      toast.error(err.message)
    }
  }

  const draftGroup = draft
    ? { key: 'draft', lat: draft.lat, lng: draft.lng, count: 1, maxScore: 85, severity: 'critical', items: [] }
    : null

  return (
    <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
      {/* ---------------- filters ---------------- */}
      <aside className="surface h-fit p-4">
        <SectionHeading title="Map filters" subtitle="Live query against the registry" icon={Filter} />

        <div className="mt-4">
          <label className="label" htmlFor="map-search">
            Search
          </label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mist-500" />
            <input
              id="map-search"
              className="input pl-9"
              placeholder="Road, ward, ref code…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>

        <div className="mt-4">
          <span className="label">Severity</span>
          <div className="flex flex-wrap gap-2">
            {SEVERITY_ORDER.map((key) => {
              const meta = SEVERITY_META[key]
              const active = severities.includes(key)
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleSeverity(key)}
                  className="chip transition"
                  style={{
                    background: active ? meta.soft : 'rgba(255,255,255,0.03)',
                    borderColor: active ? meta.border : 'rgba(255,255,255,0.08)',
                    color: active ? meta.color : '#7c84a1',
                  }}
                >
                  <span className="badge-dot" style={{ background: active ? meta.color : '#4a5170' }} />
                  {meta.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="map-status">
              Status
            </label>
            <select
              id="map-status"
              className="select"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="">All</option>
              {STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {STATUS_META[option].label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="map-source">
              Source
            </label>
            <select id="map-source" className="select" value={source} onChange={(event) => setSource(event.target.value)}>
              {SOURCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4">
          <label className="label" htmlFor="map-score">
            Minimum severity score · <span className="mono text-mist-300">{minScore}</span>
          </label>
          <input
            id="map-score"
            type="range"
            min={0}
            max={100}
            value={minScore}
            onChange={(event) => setMinScore(Number(event.target.value))}
            className="w-full"
          />
        </div>

        <div className="mt-2 grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="map-road">
              Road
            </label>
            <input id="map-road" className="input" placeholder="Hosur Road" value={road} onChange={(e) => setRoad(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="map-ward">
              Ward
            </label>
            <input id="map-ward" className="input" placeholder="Ward 84" value={ward} onChange={(e) => setWard(e.target.value)} />
          </div>
        </div>

        <div className="mt-4">
          <label className="label" htmlFor="map-limit">
            Max markers · <span className="mono text-mist-300">{limit}</span>
          </label>
          <input
            id="map-limit"
            type="range"
            min={50}
            max={2000}
            step={50}
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value))}
            className="w-full"
          />
        </div>

        <div className="mt-4 space-y-2 border-t border-white/[0.06] pt-4">
          <button
            type="button"
            className={`btn w-full ${intensity ? 'btn-primary' : ''}`}
            onClick={() => setIntensity((value) => !value)}
          >
            {intensity ? <Eye size={14} /> : <EyeOff size={14} />}
            Colour intensity {intensity ? 'on' : 'off'}
          </button>
          <button type="button" className="btn w-full" onClick={() => setFitSignal((value) => value + 1)}>
            <Maximize2 size={14} /> Fit map to results
          </button>
          <button
            type="button"
            className={`btn w-full ${pickMode ? 'btn-primary' : ''}`}
            onClick={() => {
              setPickMode((value) => !value)
              if (pickMode) setDraft(null)
            }}
          >
            <Plus size={14} /> {pickMode ? 'Click the map…' : 'Add pothole by clicking'}
          </button>
          <button type="button" className="btn w-full" onClick={buildRoute} disabled={routing}>
            {routing ? <Spinner size={14} /> : <RouteIcon size={14} />}
            {route ? 'Rebuild repair route' : 'Optimise repair route'}
          </button>
          <button
            type="button"
            className="btn w-full"
            onClick={() => {
              downloadCsv(params)
              toast.info('Exporting the current filtered view as CSV…')
            }}
          >
            <Download size={14} /> Export filtered CSV
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] text-mist-500">
          <div className="flex items-center justify-between">
            <span>Markers</span>
            <span className="mono text-mist-100">{formatNumber(stats.markers)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span>Records</span>
            <span className="mono text-mist-100">{formatNumber(stats.potholes)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span>Critical</span>
            <span className="mono" style={{ color: SEVERITY_META.critical.color }}>
              {formatNumber(stats.critical)}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span>Avg score</span>
            <span className="mono text-mist-100">{stats.avg.toFixed(1)}</span>
          </div>
        </div>
      </aside>

      {/* ---------------- map ---------------- */}
      <section className="surface relative overflow-hidden p-0">
        <div className="h-[calc(100vh-172px)] min-h-[540px]">
          <MapCanvas
            groups={[...groups, ...(draftGroup ? [draftGroup] : [])]}
            route={route}
            selectedKey={selectedKey}
            focus={focus}
            center={{ lat: 12.9716, lng: 77.5946 }}
            zoom={12}
            intensity={intensity}
            fitSignal={fitSignal}
            pickMode={pickMode}
            tileLayer={tileLayer}
            onTileLayerChange={setTileLayer}
            onSelect={(group) => setSelectedKey(group.key)}
            onMapClick={handleMapClick}
            onEngineChange={setEngine}
          />
        </div>

        {/* map HUD */}
        <div className="pointer-events-none absolute left-3 top-3 z-[1000] flex flex-col gap-2">
          <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-white/10 bg-ink-950/85 px-3 py-2 backdrop-blur">
            <Layers size={14} className="text-accent-300" />
            <span className="text-[11px] font-semibold text-mist-100">
              {engine === 'google' ? 'Google Maps' : `MapLibre GL · ${tileLayer === 'dark' ? 'CARTO dark' : tileLayer === 'streets' ? 'CARTO streets' : tileLayer === 'satellite' ? 'Esri satellite' : 'OpenTopoMap'}`}
            </span>
            <span
              className="chip"
              style={{
                background: connected ? 'rgba(62,230,176,0.14)' : 'rgba(255,255,255,0.05)',
                color: connected ? '#3ee6b0' : '#7c84a1',
              }}
            >
              <Wifi size={11} /> {connected ? 'live' : 'offline'}
            </span>
          </div>
          <div className="pointer-events-auto rounded-xl border border-white/10 bg-ink-950/85 px-3 py-2 backdrop-blur">
            <Legend
              items={SEVERITY_ORDER.map((key) => ({
                label: `${SEVERITY_META[key].label} ${SEVERITY_META[key].range}`,
                color: SEVERITY_META[key].color,
              }))}
            />
            <p className="mt-2 flex items-center gap-1.5 text-[10px] text-mist-500">
              <Flame size={11} className="text-sev-high" /> halo radius &amp; opacity scale with severity
            </p>
          </div>
          {pickMode ? (
            <div className="pointer-events-auto rounded-xl border border-accent-500/50 bg-accent-500/15 px-3 py-2 text-[11px] text-accent-300 backdrop-blur">
              <Crosshair size={12} className="mr-1 inline" /> Click the map to place a new pothole
            </div>
          ) : null}
        </div>

        {loading ? (
          <div className="pointer-events-none absolute right-3 top-16 z-[1000] flex items-center gap-2 rounded-xl border border-white/10 bg-ink-950/85 px-3 py-2 text-[11px] text-mist-300 backdrop-blur">
            <Spinner size={13} /> updating…
          </div>
        ) : null}

        {error ? (
          <div className="absolute inset-x-3 bottom-3 z-[1000] rounded-xl border border-sev-critical/40 bg-sev-critical/10 px-4 py-3 text-xs text-rose-200">
            {String(error.message || error)}
            <button type="button" className="btn ml-3" onClick={reload}>
              Retry
            </button>
          </div>
        ) : null}

        {/* route summary */}
        {route ? (
          <div className="absolute inset-x-3 top-16 ml-auto w-[min(320px,90%)] z-[1000] rounded-xl border border-accent-500/40 bg-ink-950/92 p-3 backdrop-blur xl:right-3 xl:left-auto">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-[12px] font-semibold text-mist-100">
                <RouteIcon size={14} className="text-accent-300" /> Repair route
              </span>
              <button type="button" className="btn btn-ghost p-1" onClick={() => setRoute(null)} aria-label="Clear route">
                <X size={13} />
              </button>
            </div>
            <div className="mt-2 flex gap-4 text-[11px] text-mist-500">
              <span>
                <span className="mono text-mist-100">{route.distance_km}</span> km
              </span>
              <span>
                <span className="mono text-mist-100">{formatDuration(route.duration_min)}</span> drive
              </span>
              <span>
                <span className="mono text-mist-100">{route.points.length}</span> stops
              </span>
            </div>
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
              {route.points.map((point) => (
                <li key={point.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[11px] transition hover:bg-white/[0.06]"
                    onClick={() => {
                      setSelectedKey(`${Number(point.latitude).toFixed(6)},${Number(point.longitude).toFixed(6)}`)
                      setFocus({ lat: point.latitude, lng: point.longitude })
                    }}
                  >
                    <span className="mono w-5 text-mist-500">{point.sequence}</span>
                    <span className="mono flex-1 truncate text-mist-100">{point.ref_code}</span>
                    <span className="mono" style={{ color: SEVERITY_META[point.severity].color }}>
                      {Number(point.severity_score).toFixed(0)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* selected cluster / draft editor */}
        {selected ? (
          <div className="absolute bottom-3 left-3 z-[1000] w-[min(340px,92%)] rounded-xl border border-white/10 bg-ink-950/92 p-3 backdrop-blur">
            <div className="flex items-center gap-2">
              <SeverityBadge severity={selected.severity} score={selected.maxScore} />
              <span className="text-[11px] text-mist-500">{selected.count} record(s)</span>
              <button
                type="button"
                className="btn btn-ghost ml-auto p-1"
                onClick={() => setSelectedKey(null)}
                aria-label="Close details"
              >
                <X size={13} />
              </button>
            </div>
            <p className="mono mt-2 text-[11px] text-mist-500">
              {formatCoord(selected.lat)}, {formatCoord(selected.lng)}
            </p>
            <div className="mt-2 max-h-44 space-y-2 overflow-y-auto">
              {selected.items.map((item) => (
                <div key={item.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
                  <div className="flex items-center gap-2">
                    <span className="mono text-[11px] text-mist-100">{item.ref_code}</span>
                    <StatusPill status={item.status} />
                    <span className="mono ml-auto text-[11px] text-mist-500">{relativeTime(item.detected_at)}</span>
                  </div>
                  <p className="mt-1 truncate text-[11px] text-mist-500">
                    {item.road_name || item.address || 'Unnamed location'}
                  </p>
                  <div className="mt-1.5">
                    <ScoreBar score={item.severity_score} />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <button type="button" className="btn btn-danger flex-1" onClick={deleteSelected}>
                <Trash2 size={13} /> Delete cluster
              </button>
            </div>
          </div>
        ) : null}

        {draft ? (
          <div className="absolute bottom-3 right-3 z-[1000] w-[min(320px,92%)] rounded-xl border border-accent-500/40 bg-ink-950/94 p-3 backdrop-blur">
            <div className="flex items-center gap-2">
              <MapPin size={14} className="text-accent-300" />
              <span className="text-[12px] font-semibold text-mist-100">New pothole</span>
              <button
                type="button"
                className="btn btn-ghost ml-auto p-1"
                onClick={() => {
                  setDraft(null)
                  setPickMode(false)
                }}
                aria-label="Cancel"
              >
                <X size={13} />
              </button>
            </div>
            <p className="mono mt-2 text-[11px] text-mist-500">
              {formatCoord(draft.lat)}, {formatCoord(draft.lng)}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="draft-sev">
                  Severity
                </label>
                <select
                  id="draft-sev"
                  className="select"
                  value={draftForm.severity}
                  onChange={(event) => {
                    const key = event.target.value
                    const midpoint = { low: 20, medium: 46, high: 68, critical: 88 }[key]
                    setDraftForm((prev) => ({ ...prev, severity: key, severity_score: midpoint }))
                  }}
                >
                  {SEVERITY_ORDER.map((key) => (
                    <option key={key} value={key}>
                      {SEVERITY_META[key].label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="draft-score">
                  Score
                </label>
                <input
                  id="draft-score"
                  type="number"
                  min={0}
                  max={100}
                  className="input mono"
                  value={draftForm.severity_score}
                  onChange={(event) => setDraftForm((prev) => ({ ...prev, severity_score: Number(event.target.value) }))}
                />
              </div>
              <div>
                <label className="label" htmlFor="draft-road">
                  Road
                </label>
                <input
                  id="draft-road"
                  className="input"
                  value={draftForm.road_name}
                  onChange={(event) => setDraftForm((prev) => ({ ...prev, road_name: event.target.value }))}
                />
              </div>
              <div>
                <label className="label" htmlFor="draft-ward">
                  Ward
                </label>
                <input
                  id="draft-ward"
                  className="input"
                  value={draftForm.ward}
                  onChange={(event) => setDraftForm((prev) => ({ ...prev, ward: event.target.value }))}
                />
              </div>
              <div className="col-span-2">
                <label className="label" htmlFor="draft-notes">
                  Notes
                </label>
                <textarea
                  id="draft-notes"
                  rows={2}
                  className="textarea"
                  value={draftForm.notes}
                  onChange={(event) => setDraftForm((prev) => ({ ...prev, notes: event.target.value }))}
                />
              </div>
            </div>
            <button type="button" className="btn btn-primary mt-3 w-full" onClick={saveDraft} disabled={saving}>
              {saving ? <Spinner size={14} /> : <Plus size={14} />} Save pothole
            </button>
          </div>
        ) : null}

        {!loading && !error && !groups.length ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="pointer-events-auto surface max-w-sm">
              <EmptyState
                icon={MapPin}
                title="No potholes match the filters"
                description="Loosen the severity filter, clear the search box, or add a pothole by clicking on the map."
              />
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}
