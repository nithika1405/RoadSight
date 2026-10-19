import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  BadgeCheck,
  Crosshair,
  FileVideo,
  Gauge,
  Image as ImageIcon,
  Layers,
  LocateFixed,
  MapPin,
  Play,
  RefreshCw,
  ScanLine,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'

import MapCanvas from '../components/map/MapCanvas.jsx'
import PlaybackStage from '../components/PlaybackStage.jsx'
import { useToast } from '../lib/toastContext.js'
import {
  EmptyState,
  KeyValue,
  Legend,
  SectionHeading,
  SeverityBadge,
  Spinner,
  Switch,
} from '../components/Ui.jsx'
import { api } from '../lib/api.js'
import { formatBytes, formatNumber } from '../lib/format.js'
import { SEVERITY_META, SEVERITY_ORDER } from '../lib/severity.js'
import { useConfig, useAppData } from '../lib/appDataContext.js'

const EMPTY_FORM = {
  latitude: '',
  longitude: '',
  end_latitude: '',
  end_longitude: '',
  road_name: '',
  ward: '',
  address: '',
  min_score: 26,
  pixels_per_meter: 60,
  sample_interval_s: 0.5,
  auto_save: true,
}

function classifyFile(file, limits) {
  if (!file) return null
  const ext = `.${file.name.split('.').pop()?.toLowerCase() || ''}`
  if (limits.images.includes(ext)) return 'image'
  if (limits.videos.includes(ext)) return 'video'
  return null
}

export default function Detect() {
  const toast = useToast()
  const { uploadLimits } = useConfig()
  const { refresh } = useAppData()

  const [file, setFile] = useState(null)
  const [kind, setKind] = useState(null)
  const [preview, setPreview] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState(0)
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [pickTarget, setPickTarget] = useState('start')
  const [engine, setEngine] = useState('leaflet')
  const inputRef = useRef(null)

  const limits = useMemo(
    () => ({
      images: uploadLimits?.images || ['.jpg', '.jpeg', '.png', '.webp', '.tiff'],
      videos: uploadLimits?.videos || ['.mp4', '.mov', '.avi', '.mkv', '.webm'],
      max_image_mb: uploadLimits?.max_image_mb || 15,
      max_video_mb: uploadLimits?.max_video_mb || 200,
    }),
    [uploadLimits],
  )

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))

  const acceptFile = useCallback(
    (next) => {
      if (!next) return
      const detected = classifyFile(next, limits)
      if (!detected) {
        toast.error(`Unsupported file type. Allowed images: ${limits.images.join(', ')} · videos: ${limits.videos.join(', ')}`)
        return
      }
      const maxMb = detected === 'image' ? limits.max_image_mb : limits.max_video_mb
      if (next.size > maxMb * 1024 * 1024) {
        toast.error(`File is larger than the ${maxMb} MB limit for ${detected}s.`)
        return
      }
      setFile(next)
      setKind(detected)
      setResult(null)
      setProgress(0)
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old)
        return URL.createObjectURL(next)
      })
    },
    [limits, toast],
  )

  const onDrop = (event) => {
    event.preventDefault()
    setDragging(false)
    acceptFile(event.dataTransfer.files?.[0])
  }

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      toast.error('This browser does not expose geolocation.')
      return
    }
    toast.info('Requesting your current position…')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setField('latitude', position.coords.latitude.toFixed(6))
        setField('longitude', position.coords.longitude.toFixed(6))
        toast.success('Coordinates captured from GPS.')
      },
      (error) => toast.error(`Could not read your location: ${error.message}`),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const handleMapClick = ({ lat, lng }) => {
    if (pickTarget === 'end') {
      setField('end_latitude', lat.toFixed(6))
      setField('end_longitude', lng.toFixed(6))
    } else {
      setField('latitude', lat.toFixed(6))
      setField('longitude', lng.toFixed(6))
    }
  }

  const analyze = async () => {
    if (!file || !kind) {
      toast.error('Select an image or video first.')
      return
    }
    const payload = new FormData()
    payload.append('file', file)
    payload.append('auto_save', String(form.auto_save))
    payload.append('min_score', String(form.min_score))
    payload.append('pixels_per_meter', String(form.pixels_per_meter))
    if (form.latitude) payload.append('latitude', form.latitude)
    if (form.longitude) payload.append('longitude', form.longitude)
    if (form.road_name) payload.append('road_name', form.road_name)
    if (form.ward) payload.append('ward', form.ward)
    if (form.address) payload.append('address', form.address)
    if (kind === 'video') {
      payload.append('sample_interval_s', String(form.sample_interval_s))
      if (form.end_latitude) payload.append('end_latitude', form.end_latitude)
      if (form.end_longitude) payload.append('end_longitude', form.end_longitude)
    }

    setAnalyzing(true)
    setProgress(0)
    setResult(null)
    try {
      const response =
        kind === 'image'
          ? await api.detectImage(payload, setProgress)
          : await api.detectVideo(payload, setProgress)
      setResult(response)
      const count = response.detections?.length || 0
      if (count === 0) {
        toast.info('Analysis complete — no potholes detected in this media.')
      } else if (response.saved) {
        toast.success(`${count} pothole${count > 1 ? 's' : ''} detected and saved to the registry.`)
        refresh()
      } else {
        toast.success(`${count} pothole${count > 1 ? 's' : ''} detected (not saved).`)
      }
    } catch (error) {
      toast.error(error.message)
    } finally {
      setAnalyzing(false)
    }
  }

  const discard = async (item) => {
    if (!item.pothole_id) return
    try {
      await api.deletePothole(item.pothole_id)
      toast.success(`${item.ref_code} removed from the registry.`)
      setResult((prev) => ({
        ...prev,
        detections: prev.detections.map((det) =>
          det.index === item.index ? { ...det, pothole_id: null, ref_code: null } : det,
        ),
      }))
      refresh()
    } catch (error) {
      toast.error(error.message)
    }
  }

  const reset = () => {
    setFile(null)
    setKind(null)
    setResult(null)
    setProgress(0)
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old)
      return null
    })
    if (inputRef.current) inputRef.current.value = ''
  }

  const draftGroup = useMemo(() => {
    const lat = Number(form.latitude)
    const lng = Number(form.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !form.latitude || !form.longitude) return null
    return {
      key: 'draft',
      lat,
      lng,
      count: 1,
      maxScore: 70,
      severity: 'high',
      items: [],
      avgScore: 70,
    }
  }, [form.latitude, form.longitude])

  const detectedGroups = useMemo(() => {
    if (!result?.detections?.length) return []
    const buckets = new Map()
    result.detections.forEach((item) => {
      if (!Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)) return
      const key = `${item.latitude.toFixed(6)},${item.longitude.toFixed(6)}`
      if (!buckets.has(key)) {
        buckets.set(key, {
          key,
          lat: item.latitude,
          lng: item.longitude,
          count: 0,
          maxScore: 0,
          severity: item.severity,
          items: [],
          avgScore: 0,
        })
      }
      const bucket = buckets.get(key)
      bucket.items.push({ ...item, ref_code: item.ref_code || `D${item.index + 1}`, status: 'pending' })
      bucket.count += 1
      if (item.severity_score > bucket.maxScore) {
        bucket.maxScore = item.severity_score
        bucket.severity = item.severity
      }
    })
    return Array.from(buckets.values())
  }, [result])

  const savedCount = result?.detections?.filter((item) => item.pothole_id).length || 0

  return (
    <div className="grid gap-5 xl:grid-cols-5">
      {/* ---------------- upload + options ---------------- */}
      <div className="space-y-5 xl:col-span-3">
        <section className="surface p-4">
          <SectionHeading
            title="Road media"
            subtitle="Drop an image or video — analysis runs on the FastAPI backend"
            icon={Upload}
            action={
              file ? (
                <button type="button" className="btn" onClick={reset}>
                  <X size={13} /> Clear
                </button>
              ) : null
            }
          />

          <div
            className={`mt-4 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${
              dragging ? 'border-accent-500/70 bg-accent-500/10' : 'border-white/10 bg-white/[0.02]'
            }`}
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click()
            }}
          >
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              accept={[...limits.images, ...limits.videos].join(',')}
              onChange={(event) => acceptFile(event.target.files?.[0])}
            />
            <span className="grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/[0.05]">
              <ScanLine size={20} className="text-accent-300" />
            </span>
            <p className="text-sm font-semibold text-mist-100">
              {file ? file.name : 'Drag & drop or click to browse'}
            </p>
            <p className="text-xs text-mist-500">
              {file
                ? `${kind === 'video' ? 'Video' : 'Image'} · ${formatBytes(file.size)}`
                : `Images ${limits.images.join(' ')} (max ${limits.max_image_mb} MB) · Videos ${limits.videos.join(' ')} (max ${limits.max_video_mb} MB)`}
            </p>
          </div>

          {preview ? (
            <div className="relative mt-4 overflow-hidden rounded-2xl border border-white/10 bg-black/40">
              <PlaybackStage mediaUrl={preview} kind={kind} frames={result?.frames || []} />
              {analyzing ? <div className="scan-overlay" /> : null}
              {analyzing ? (
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink-950 via-ink-950/80 to-transparent px-4 py-3">
                  <div className="flex items-center gap-2 text-xs text-cyan-300">
                    <Spinner size={13} /> Analysing {kind}… {progress}%
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-cyan-400 transition-all" style={{ width: `${progress}%` }} />
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="surface p-4">
          <SectionHeading title="Detector settings" subtitle="Tune the computer-vision pipeline" icon={Gauge} />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="min-score">
                Minimum severity score · <span className="mono text-mist-300">{form.min_score}</span>
              </label>
              <input
                id="min-score"
                type="range"
                min={0}
                max={100}
                step={1}
                value={form.min_score}
                onChange={(event) => setField('min_score', Number(event.target.value))}
                className="w-full"
              />
              <p className="mt-1 text-[11px] text-mist-500">Lower values surface subtle surface damage.</p>
            </div>
            <div>
              <label className="label" htmlFor="ppm">
                Scale · pixels per metre
              </label>
              <input
                id="ppm"
                type="number"
                min={2}
                max={1000}
                className="input"
                value={form.pixels_per_meter}
                onChange={(event) => setField('pixels_per_meter', Number(event.target.value))}
              />
              <p className="mt-1 text-[11px] text-mist-500">Used to convert crater area into cm.</p>
            </div>
            {kind === 'video' ? (
              <div>
                <label className="label" htmlFor="interval">
                  Frame sample interval (s)
                </label>
                <input
                  id="interval"
                  type="number"
                  min={0.2}
                  max={10}
                  step={0.2}
                  className="input"
                  value={form.sample_interval_s}
                  onChange={(event) => setField('sample_interval_s', Number(event.target.value))}
                />
              </div>
            ) : null}
            <div className="flex items-end">
              <Switch
                checked={form.auto_save}
                onChange={(value) => setField('auto_save', value)}
                label="Auto-save detections"
                hint="Write accepted results to the registry and broadcast them live"
              />
            </div>
          </div>
        </section>

        <section className="surface p-4">
          <SectionHeading
            title="Geotag"
            subtitle="Pin the recording location — click the map to place the marker"
            icon={Crosshair}
            action={
              <button type="button" className="btn" onClick={useMyLocation}>
                <LocateFixed size={13} /> Use my GPS
              </button>
            }
          />

          {kind === 'video' ? (
            <div className="mt-3 flex gap-2">
              {[
                { id: 'start', label: 'Set start point' },
                { id: 'end', label: 'Set end point' },
              ].map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`btn ${pickTarget === option.id ? 'btn-primary' : ''}`}
                  onClick={() => setPickTarget(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="lat">
                Latitude
              </label>
              <input
                id="lat"
                className="input mono"
                placeholder="12.971599"
                value={form.latitude}
                onChange={(event) => setField('latitude', event.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="lng">
                Longitude
              </label>
              <input
                id="lng"
                className="input mono"
                placeholder="77.594566"
                value={form.longitude}
                onChange={(event) => setField('longitude', event.target.value)}
              />
            </div>
            {kind === 'video' ? (
              <>
                <div>
                  <label className="label" htmlFor="endlat">
                    End latitude
                  </label>
                  <input
                    id="endlat"
                    className="input mono"
                    placeholder="optional"
                    value={form.end_latitude}
                    onChange={(event) => setField('end_latitude', event.target.value)}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="endlng">
                    End longitude
                  </label>
                  <input
                    id="endlng"
                    className="input mono"
                    placeholder="optional"
                    value={form.end_longitude}
                    onChange={(event) => setField('end_longitude', event.target.value)}
                  />
                </div>
              </>
            ) : null}
            <div>
              <label className="label" htmlFor="road">
                Road name
              </label>
              <input
                id="road"
                className="input"
                placeholder="Outer Ring Road"
                value={form.road_name}
                onChange={(event) => setField('road_name', event.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="ward">
                Ward
              </label>
              <input
                id="ward"
                className="input"
                placeholder="Ward 84"
                value={form.ward}
                onChange={(event) => setField('ward', event.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="address">
                Address
              </label>
              <input
                id="address"
                className="input"
                placeholder="Near Marathahalli junction"
                value={form.address}
                onChange={(event) => setField('address', event.target.value)}
              />
            </div>
          </div>

          <div className="mt-4 h-[260px] overflow-hidden rounded-2xl border border-white/10">
            <MapCanvas
              groups={[...(draftGroup ? [draftGroup] : []), ...detectedGroups]}
              center={{ lat: Number(form.latitude) || 12.9716, lng: Number(form.longitude) || 77.5946 }}
              zoom={13}
              intensity
              pickMode
              onMapClick={handleMapClick}
              focus={draftGroup ? { lat: draftGroup.lat, lng: draftGroup.lng } : null}
              onEngineChange={setEngine}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-mist-500">
            <span>
              Map engine: <span className="text-mist-300">{engine === 'google' ? 'Google Maps' : 'Leaflet (no API key)'}</span>
            </span>
            <span>{detectedGroups.length ? `${detectedGroups.length} detected cluster(s) overlaid` : 'Click to place the marker'}</span>
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-primary" onClick={analyze} disabled={!file || analyzing}>
            {analyzing ? <Spinner size={14} /> : <Sparkles size={14} />}
            {analyzing ? 'Analysing…' : 'Run AI detection'}
          </button>
          {result ? (
            <button type="button" className="btn" onClick={analyze} disabled={analyzing}>
              <RefreshCw size={13} /> Re-run
            </button>
          ) : null}
        </div>
      </div>

      {/* ---------------- results ---------------- */}
      <div className="space-y-5 xl:col-span-2">
        {!result ? (
          <section className="surface">
            <EmptyState
              icon={Play}
              title="No analysis yet"
              description="Select road media and run the detector. Detections appear here with bounding boxes, severity scores and their geotagged position on the map."
            />
          </section>
        ) : (
          <>
            <section className="surface overflow-hidden">
              <div className="border-b border-white/[0.06] px-4 py-3">
                <SectionHeading
                  title="Analysis summary"
                  subtitle={result.filename}
                  icon={kind === 'video' ? FileVideo : ImageIcon}
                />
              </div>
              <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3">
                <KeyValue label="Detections" value={formatNumber(result.detections.length)} mono />
                <KeyValue label="Saved" value={savedCount ? `${savedCount}` : 'no'} mono tone={savedCount ? '#3ee6b0' : undefined} />
                <KeyValue label="Resolution" value={`${result.width}×${result.height}`} mono />
                {kind === 'video' ? (
                  <KeyValue label="Frames" value={formatNumber(result.frames_analyzed)} mono />
                ) : null}
                <KeyValue label="Processing" value={`${result.processing_ms} ms`} mono />
                {result.duration_s ? (
                  <KeyValue label="Duration" value={`${result.duration_s.toFixed(1)} s`} mono />
                ) : null}
                {result.exif_gps ? (
                  <KeyValue
                    label="EXIF GPS"
                    value={`${Number(result.exif_gps.latitude).toFixed(4)}, ${Number(result.exif_gps.longitude).toFixed(4)}`}
                    mono
                  />
                ) : null}
              </div>
            </section>

            {result.annotated_image ? (
              <section className="surface overflow-hidden">
                <div className="border-b border-white/[0.06] px-4 py-3">
                  <SectionHeading title="Annotated frame" subtitle="Bounding boxes drawn by the detector" icon={Layers} />
                </div>
                <div className="relative bg-black/40">
                  <img src={result.annotated_image} alt="Annotated detection" className="w-full object-contain" />
                </div>
                <div className="border-t border-white/[0.06] px-4 py-3">
                  <Legend
                    items={SEVERITY_ORDER.map((key) => ({
                      label: `${SEVERITY_META[key].label} (${SEVERITY_META[key].range})`,
                      color: SEVERITY_META[key].color,
                    }))}
                  />
                </div>
              </section>
            ) : null}

            <section className="surface overflow-hidden">
              <div className="border-b border-white/[0.06] px-4 py-3">
                <SectionHeading
                  title="Detections"
                  subtitle={`${result.detections.length} crater${result.detections.length === 1 ? '' : 's'} found`}
                  icon={ScanLine}
                />
              </div>
              {result.detections.length ? (
                <ul className="max-h-[520px] divide-y divide-white/[0.05] overflow-y-auto">
                  {result.detections.map((item) => (
                    <li key={item.index} className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <SeverityBadge severity={item.severity} score={item.severity_score} />
                        <span className="mono text-[11px] text-mist-500">#{item.index + 1}</span>
                        <span className="ml-auto flex items-center gap-2">
                          {item.ref_code ? (
                            <span className="chip bg-white/[0.05] text-mist-300">{item.ref_code}</span>
                          ) : (
                            <span className="chip bg-white/[0.05] text-mist-600">not saved</span>
                          )}
                          {item.pothole_id ? (
                            <button
                              type="button"
                              className="btn btn-ghost p-1.5"
                              title="Discard this detection"
                              onClick={() => discard(item)}
                            >
                              <Trash2 size={13} />
                            </button>
                          ) : null}
                        </span>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                        <KeyValue label="Confidence" value={`${(item.confidence * 100).toFixed(0)}%`} mono />
                        <KeyValue label="Diameter" value={`${Number(item.diameter_cm).toFixed(1)} cm`} mono />
                        <KeyValue label="Depth" value={`${Number(item.depth_cm).toFixed(1)} cm`} mono />
                        <KeyValue
                          label="Frame time"
                          value={item.frame_time_s != null ? `${Number(item.frame_time_s).toFixed(1)} s` : '—'}
                          mono
                        />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-mist-500">
                        <MapPin size={12} />
                        <span className="mono">
                          {Number.isFinite(item.latitude) ? Number(item.latitude).toFixed(6) : '—'},{' '}
                          {Number.isFinite(item.longitude) ? Number(item.longitude).toFixed(6) : '—'}
                        </span>
                        {item.pothole_id ? (
                          <Link to={`/map?focus=${item.pothole_id}`} className="ml-auto text-accent-300 hover:text-accent-500">
                            Open on map →
                          </Link>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon={BadgeCheck}
                  title="No potholes detected"
                  description="Try lowering the minimum severity score, or use a clearer, closer-up road photo."
                />
              )}
            </section>
          </>
        )}

        <section className="surface p-4">
          <SectionHeading title="How scoring works" subtitle="Transparent weighted model" icon={AlertTriangle} />
          <ul className="mt-3 space-y-2 text-[11px] text-mist-500">
            <li>
              <span className="text-mist-300">Local contrast</span> (42%) — darkness relative to the surrounding asphalt at
              two scales.
            </li>
            <li>
              <span className="text-mist-300">Area</span> (22%) — crater footprint relative to the frame.
            </li>
            <li>
              <span className="text-mist-300">Circularity</span> (14%) and <span className="text-mist-300">solidity</span>{' '}
              (12%) — pothole-like geometry.
            </li>
            <li>
              <span className="text-mist-300">Edge density</span> (10%) — ragged, broken rims.
            </li>
          </ul>
        </section>
      </div>
    </div>
  )
}
