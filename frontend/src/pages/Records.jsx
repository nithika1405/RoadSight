import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowDownUp,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  ImageOff,
  MapPin,
  RefreshCw,
  Save,
  Search,
  Table2,
  Trash2,
  X,
} from 'lucide-react'

import { useToast } from '../lib/toastContext.js'
import {
  EmptyState,
  KeyValue,
  LoadingBlock,
  ScoreBar,
  SectionHeading,
  SeverityBadge,
  Spinner,
  StatusPill,
} from '../components/Ui.jsx'
import { api, downloadCsv, mediaUrl } from '../lib/api.js'
import { useApi, useDebounced } from '../lib/hooks.js'
import { SEVERITY_META, SEVERITY_ORDER, STATUS_META } from '../lib/severity.js'
import { formatCoord, formatDateTime, formatNumber } from '../lib/format.js'
import { useAppData } from '../lib/appDataContext.js'

const SORTABLE = new Set(['severity_score', 'detected_at', 'id', 'confidence', 'diameter_cm'])
const STATUS_OPTIONS = ['pending', 'inspected', 'repaired']
const PAGE_SIZES = [25, 50, 100, 250]

export default function Records() {
  const toast = useToast()
  const { revision } = useAppData()

  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounced(query, 320)
  const [severities, setSeverities] = useState([...SEVERITY_ORDER])
  const [statusFilter, setStatusFilter] = useState('')
  const [source, setSource] = useState('')
  const [minScore, setMinScore] = useState(0)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [sort, setSort] = useState('detected_at')
  const [order, setOrder] = useState('desc')
  const [pageSize, setPageSize] = useState(50)
  const [offset, setOffset] = useState(0)

  const [selected, setSelected] = useState(null)
  const [draftStatus, setDraftStatus] = useState('')
  const [draftNotes, setDraftNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const filters = useMemo(
    () => ({
      q: debouncedQuery || undefined,
      severity: severities.length && severities.length < SEVERITY_ORDER.length ? severities : undefined,
      status: statusFilter || undefined,
      source_type: source || undefined,
      min_score: minScore || undefined,
      date_from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
      date_to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
      sort,
      order,
      limit: pageSize,
      offset,
    }),
    [debouncedQuery, severities, statusFilter, source, minScore, from, to, sort, order, pageSize, offset],
  )

  const { data, loading, error, reload } = useApi((signal) => api.listPotholes(filters, signal), [filters, revision])

  const items = data?.items || []
  const total = data?.total || 0
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.floor(offset / pageSize) + 1

  const resetPage = (updater) => {
    updater()
    setOffset(0)
  }

  const toggleSeverity = (key) =>
    resetPage(() => setSeverities((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key])))

  const applySort = (key) => {
    if (!SORTABLE.has(key)) return
    resetPage(() => {
      if (sort === key) setOrder((value) => (value === 'desc' ? 'asc' : 'desc'))
      else {
        setSort(key)
        setOrder('desc')
      }
    })
  }

  const openDetail = (item) => {
    setSelected(item)
    setDraftStatus(item.status)
    setDraftNotes(item.notes || '')
  }

  const saveDetail = async () => {
    if (!selected) return
    setSaving(true)
    try {
      const updated = await api.updatePothole(selected.id, { status: draftStatus, notes: draftNotes || null })
      toast.success(`${updated.ref_code} updated.`)
      setSelected(updated)
      reload()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (item) => {
    try {
      await api.deletePothole(item.id)
      toast.success(`${item.ref_code} deleted.`)
      if (selected?.id === item.id) setSelected(null)
      reload()
    } catch (err) {
      toast.error(err.message)
    }
  }

  const headerCell = (label, key, align = 'left') => (
    <th
      key={label}
      onClick={() => applySort(key)}
      style={{ textAlign: align, cursor: SORTABLE.has(key) ? 'pointer' : 'default' }}
      title={SORTABLE.has(key) ? 'Click to sort' : undefined}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {SORTABLE.has(key) && sort === key ? (
          <ArrowDownUp size={11} className={order === 'asc' ? 'rotate-180' : ''} style={{ color: '#6d8bff' }} />
        ) : null}
      </span>
    </th>
  )

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-4">
        <section className="surface p-4">
          <SectionHeading
            title="Registry filters"
            subtitle="Interrogate every detection recorded by the platform"
            icon={Filter}
            action={
              <div className="flex gap-2">
                <button type="button" className="btn" onClick={reload} disabled={loading}>
                  <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Reload
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    downloadCsv(filters)
                    toast.info('Exporting the filtered registry as CSV…')
                  }}
                >
                  <Download size={13} /> Export CSV
                </button>
              </div>
            }
          />

          <div className="mt-4 grid gap-3 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <label className="label" htmlFor="rec-search">
                Search
              </label>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mist-500" />
                <input
                  id="rec-search"
                  className="input pl-9"
                  placeholder="Reference, road, ward, notes…"
                  value={query}
                  onChange={(event) => resetPage(() => setQuery(event.target.value))}
                />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="rec-status">
                Status
              </label>
              <select
                id="rec-status"
                className="select"
                value={statusFilter}
                onChange={(event) => resetPage(() => setStatusFilter(event.target.value))}
              >
                <option value="">All statuses</option>
                {STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {STATUS_META[option].label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="rec-source">
                Source
              </label>
              <select
                id="rec-source"
                className="select"
                value={source}
                onChange={(event) => resetPage(() => setSource(event.target.value))}
              >
                <option value="">All sources</option>
                <option value="image">Image</option>
                <option value="video">Video</option>
                <option value="manual">Manual</option>
              </select>
            </div>
            <div className="lg:col-span-2">
              <span className="label">Severity</span>
              <div className="flex flex-wrap gap-2">
                {SEVERITY_ORDER.map((key) => {
                  const meta = SEVERITY_META[key]
                  const active = severities.includes(key)
                  return (
                    <button
                      key={key}
                      type="button"
                      className="chip transition"
                      onClick={() => toggleSeverity(key)}
                      style={{
                        background: active ? meta.soft : 'rgba(255,255,255,0.03)',
                        borderColor: active ? meta.border : 'rgba(255,255,255,0.08)',
                        color: active ? meta.color : '#7c84a1',
                      }}
                    >
                      {meta.label}
                    </button>
                  )
                })}
              </div>
            </div>
            <div>
              <label className="label" htmlFor="rec-from">
                Detected from
              </label>
              <input
                id="rec-from"
                type="date"
                className="input"
                value={from}
                onChange={(event) => resetPage(() => setFrom(event.target.value))}
              />
            </div>
            <div>
              <label className="label" htmlFor="rec-to">
                Detected to
              </label>
              <input
                id="rec-to"
                type="date"
                className="input"
                value={to}
                onChange={(event) => resetPage(() => setTo(event.target.value))}
              />
            </div>
            <div className="lg:col-span-2">
              <label className="label" htmlFor="rec-score">
                Minimum severity score · <span className="mono text-mist-300">{minScore}</span>
              </label>
              <input
                id="rec-score"
                type="range"
                min={0}
                max={100}
                value={minScore}
                onChange={(event) => resetPage(() => setMinScore(Number(event.target.value)))}
                className="w-full"
              />
            </div>
          </div>
        </section>

        <section className="surface overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
            <SectionHeading
              title="Detections"
              subtitle={`${formatNumber(total)} record(s) · page ${page} of ${pages}`}
              icon={Table2}
            />
            <div className="flex items-center gap-2">
              <select
                className="select w-auto"
                value={pageSize}
                onChange={(event) => resetPage(() => setPageSize(Number(event.target.value)))}
                aria-label="Rows per page"
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size} / page
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn p-2"
                disabled={offset <= 0}
                onClick={() => setOffset((value) => Math.max(0, value - pageSize))}
                aria-label="Previous page"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                type="button"
                className="btn p-2"
                disabled={offset + pageSize >= total}
                onClick={() => setOffset((value) => value + pageSize)}
                aria-label="Next page"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>

          {error ? (
            <EmptyState icon={X} title="Could not load records" description={String(error.message || error)} />
          ) : loading && !items.length ? (
            <div className="p-4">
              <LoadingBlock height={320} />
            </div>
          ) : items.length ? (
            <div className="max-h-[calc(100vh-360px)] overflow-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    {headerCell('Reference', 'id')}
                    {headerCell('Severity')}
                    {headerCell('Score', 'severity_score')}
                    {headerCell('Status')}
                    {headerCell('Road / Ward')}
                    {headerCell('Coordinates')}
                    {headerCell('Diameter', 'diameter_cm')}
                    {headerCell('Confidence', 'confidence')}
                    {headerCell('Detected', 'detected_at')}
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className={selected?.id === item.id ? 'bg-accent-500/10' : undefined}>
                      <td>
                        <button
                          type="button"
                          className="mono text-[12px] text-accent-300 hover:text-accent-500"
                          onClick={() => openDetail(item)}
                        >
                          {item.ref_code}
                        </button>
                      </td>
                      <td>
                        <SeverityBadge severity={item.severity} compact />
                      </td>
                      <td style={{ minWidth: 120 }}>
                        <ScoreBar score={item.severity_score} showValue />
                      </td>
                      <td>
                        <StatusPill status={item.status} />
                      </td>
                      <td>
                        <span className="block truncate text-[12px] text-mist-100" style={{ maxWidth: 190 }}>
                          {item.road_name || item.address || '—'}
                        </span>
                        <span className="text-[11px] text-mist-500">{item.ward || '—'}</span>
                      </td>
                      <td className="mono text-[11px] text-mist-300">
                        {formatCoord(item.latitude, 5)}, {formatCoord(item.longitude, 5)}
                      </td>
                      <td className="mono text-[12px] text-mist-300">{Number(item.diameter_cm).toFixed(0)} cm</td>
                      <td className="mono text-[12px] text-mist-300">{(Number(item.confidence) * 100).toFixed(0)}%</td>
                      <td className="text-[11px] text-mist-500">{formatDateTime(item.detected_at)}</td>
                      <td>
                        <div className="flex items-center justify-end gap-1">
                          <Link to={`/map?focus=${item.id}`} className="btn btn-ghost p-1.5" title="Show on map">
                            <MapPin size={13} />
                          </Link>
                          <button
                            type="button"
                            className="btn btn-ghost p-1.5"
                            title="Delete"
                            onClick={() => remove(item)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={Table2}
              title="No matching records"
              description="Adjust the filters, or run a detection on the AI Detection page."
              action={
                <Link to="/detect" className="btn btn-primary">
                  Open AI Detection
                </Link>
              }
            />
          )}
        </section>
      </div>

      {/* ---------------- detail drawer ---------------- */}
      <aside className="surface h-fit p-4 xl:sticky xl:top-[84px]">
        {!selected ? (
          <EmptyState
            icon={Table2}
            title="No record selected"
            description="Pick a reference code from the table to inspect its media, geometry and triage it."
          />
        ) : (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="mono text-[13px] text-mist-100">{selected.ref_code}</p>
                <p className="text-[11px] text-mist-500">ID #{selected.id}</p>
              </div>
              <button
                type="button"
                className="btn btn-ghost p-1"
                onClick={() => setSelected(null)}
                aria-label="Close detail"
              >
                <X size={14} />
              </button>
            </div>

            <div className="overflow-hidden rounded-xl border border-white/10 bg-black/30">
              {selected.thumbnail_url || selected.media_url ? (
                <img
                  src={mediaUrl(selected.thumbnail_url || selected.media_url)}
                  alt={`Detection ${selected.ref_code}`}
                  className="max-h-40 w-full object-cover"
                />
              ) : (
                <div className="flex h-28 items-center justify-center gap-2 text-[11px] text-mist-600">
                  <ImageOff size={16} /> no media attached
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={selected.severity} score={selected.severity_score} />
              <StatusPill status={selected.status} />
            </div>
            <ScoreBar score={selected.severity_score} showValue />

            <div className="grid grid-cols-2 gap-3">
              <KeyValue label="Latitude" value={formatCoord(selected.latitude)} mono />
              <KeyValue label="Longitude" value={formatCoord(selected.longitude)} mono />
              <KeyValue label="Diameter" value={`${Number(selected.diameter_cm).toFixed(1)} cm`} mono />
              <KeyValue label="Depth" value={`${Number(selected.depth_cm).toFixed(1)} cm`} mono />
              <KeyValue label="Confidence" value={`${(Number(selected.confidence) * 100).toFixed(0)}%`} mono />
              <KeyValue label="Source" value={selected.source_type} mono />
              <KeyValue label="Detected" value={formatDateTime(selected.detected_at)} />
              <KeyValue label="Area" value={`${formatNumber(selected.area_px)} px`} mono />
            </div>

            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <p className="label">Triage</p>
              <div className="flex flex-wrap gap-2">
                {STATUS_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`chip transition ${draftStatus === option ? '' : 'opacity-60'}`}
                    style={{
                      background: STATUS_META[option].soft,
                      color: STATUS_META[option].color,
                      borderColor: draftStatus === option ? STATUS_META[option].color : 'transparent',
                    }}
                    onClick={() => setDraftStatus(option)}
                  >
                    {STATUS_META[option].label}
                  </button>
                ))}
              </div>
              <div className="mt-3">
                <label className="label" htmlFor="rec-notes">
                  Notes
                </label>
                <textarea
                  id="rec-notes"
                  rows={3}
                  className="textarea"
                  placeholder="Repair crew notes…"
                  value={draftNotes}
                  onChange={(event) => setDraftNotes(event.target.value)}
                />
              </div>
              <button type="button" className="btn btn-primary mt-3 w-full" onClick={saveDetail} disabled={saving}>
                {saving ? <Spinner size={14} /> : <Save size={14} />} Save changes
              </button>
            </div>

            <div className="flex gap-2">
              <Link to={`/map?focus=${selected.id}`} className="btn flex-1">
                <MapPin size={13} /> Show on map
              </Link>
              <button type="button" className="btn btn-danger" onClick={() => remove(selected)}>
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}
