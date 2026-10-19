import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Gauge,
  MapPin,
  Radar,
  RefreshCw,
  ScanLine,
  TrendingUp,
} from 'lucide-react'
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { api } from '../lib/api.js'
import { useApi, useTicker } from '../lib/hooks.js'
import { SEVERITY_META, SEVERITY_ORDER, STATUS_META } from '../lib/severity.js'
import { useAppData } from '../lib/appDataContext.js'
import { formatNumber, relativeTime } from '../lib/format.js'
import {
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  ScoreBar,
  SectionHeading,
  SeverityBadge,
  StatTile,
  StatusPill,
} from '../components/Ui.jsx'

const TOOLTIP = {
  contentStyle: {
    background: 'rgba(10, 12, 21, 0.96)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 12,
    fontSize: 12,
    color: '#eef1f8',
    boxShadow: '0 20px 40px -20px rgba(0,0,0,0.9)',
  },
  labelStyle: { color: '#b7bdd1', fontSize: 11, fontWeight: 600 },
  itemStyle: { fontSize: 12 },
}

const AXIS = {
  stroke: '#5d6480',
  tick: { fill: '#7c84a1', fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: 'rgba(255,255,255,0.08)' },
}

export default function Dashboard() {
  const { revision, health, refresh, connected } = useAppData()
  useTicker(30000)

  const { data: stats, error, loading, reload } = useApi((signal) => api.stats({ days: 21 }, signal), [revision])
  const { data: recent } = useApi(
    (signal) => api.listPotholes({ limit: 7, sort: 'detected_at', order: 'desc' }, signal),
    [revision],
  )

  const daySeries = useMemo(
    () =>
      (stats?.by_day || []).map((point) => ({
        ...point,
        short: new Date(point.label).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
      })),
    [stats],
  )

  const severitySeries = useMemo(
    () => SEVERITY_ORDER.map((key) => {
      const bucket = (stats?.by_severity || []).find((item) => item.severity === key)
      return { key, label: SEVERITY_META[key].label, count: bucket?.count || 0, avg: bucket?.avg_score || 0 }
    }),
    [stats],
  )

  const statusSeries = useMemo(
    () =>
      (stats?.by_status || []).map((bucket) => ({
        name: STATUS_META[bucket.severity]?.label || bucket.severity,
        value: bucket.count,
        color: STATUS_META[bucket.severity]?.color || '#6d8bff',
      })),
    [stats],
  )

  const wardSeries = useMemo(() => (stats?.by_ward || []).slice(0, 7), [stats])
  const peakDay = useMemo(
    () => daySeries.reduce((acc, point) => (point.count > (acc?.count || 0) ? point : acc), null),
    [daySeries],
  )

  if (error) {
    return (
      <div className="space-y-4">
        <ErrorBlock error={error} onRetry={reload} />
        <p className="text-xs text-mist-500">
          Start the backend with <span className="mono text-mist-300">uvicorn app.main:app --reload</span> from the{' '}
          <span className="mono text-mist-300">backend</span> folder.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <StatTile
          label="Total potholes"
          value={loading && !stats ? '—' : formatNumber(stats?.total)}
          hint={`${formatNumber(health?.total_potholes ?? 0)} in registry`}
          icon={Radar}
          tone="#6d8bff"
        />
        <StatTile
          label="Pending"
          value={formatNumber(stats?.pending)}
          hint="awaiting inspection"
          icon={Clock}
          tone="#f5b301"
        />
        <StatTile
          label="Inspected"
          value={formatNumber(stats?.inspected)}
          hint="verified on site"
          icon={CheckCircle2}
          tone="#22d3ee"
        />
        <StatTile
          label="Critical"
          value={formatNumber(stats?.critical)}
          hint="immediate action"
          icon={AlertTriangle}
          tone="#ff2d55"
        />
        <StatTile
          label="Avg severity"
          value={stats ? `${Number(stats.avg_severity_score).toFixed(1)}` : '—'}
          hint={`confidence ${stats ? (Number(stats.avg_confidence) * 100).toFixed(0) : 0}%`}
          icon={Gauge}
          tone="#3ee6b0"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <section className="surface p-4 xl:col-span-2">
          <SectionHeading
            title="Detection trend"
            subtitle="New potholes recorded per day vs. average severity"
            icon={TrendingUp}
            action={
              <button type="button" className="btn" onClick={refresh} disabled={loading}>
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                Sync
              </button>
            }
          />
          <div className="mt-4 h-[248px]">
            {loading && !stats ? (
              <LoadingBlock height={248} />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={daySeries} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6d8bff" stopOpacity={0.55} />
                      <stop offset="100%" stopColor="#6d8bff" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="short" {...AXIS} />
                  <YAxis {...AXIS} allowDecimals={false} width={44} />
                  <YAxis yAxisId="score" orientation="right" domain={[0, 100]} {...AXIS} width={40} />
                  <Tooltip {...TOOLTIP} />
                  <Legend wrapperStyle={{ fontSize: 11, color: '#7c84a1' }} />
                  <Area
                    type="monotone"
                    dataKey="count"
                    name="Detections"
                    stroke="#6d8bff"
                    strokeWidth={2}
                    fill="url(#trendFill)"
                  />
                  <Line
                    yAxisId="score"
                    type="monotone"
                    dataKey="avg_score"
                    name="Avg severity"
                    stroke="#3ee6b0"
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
          {peakDay?.count ? (
            <p className="mt-2 text-[11px] text-mist-500">
              Peak activity on <span className="text-mist-300">{peakDay.short}</span> with{' '}
              <span className="mono text-mist-100">{peakDay.count}</span> detections.
            </p>
          ) : null}
        </section>

        <section className="surface p-4">
          <SectionHeading title="Inspection status" subtitle="Workflow distribution" icon={Activity} />
          <div className="mt-4 h-[248px]">
            {loading && !stats ? (
              <LoadingBlock height={248} />
            ) : statusSeries.some((item) => item.value > 0) ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusSeries}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={58}
                    outerRadius={92}
                    paddingAngle={3}
                    stroke="rgba(5,6,12,0.9)"
                    strokeWidth={2}
                  >
                    {statusSeries.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip {...TOOLTIP} />
                  <Legend wrapperStyle={{ fontSize: 11, color: '#7c84a1' }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                icon={MapPin}
                title="No detections yet"
                description="Seed the demo dataset or run your first AI analysis to populate the dashboard."
              />
            )}
          </div>
        </section>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="surface p-4">
          <SectionHeading title="Severity mix" subtitle="Count and average score per band" icon={AlertTriangle} />
          <div className="mt-4 h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={severitySeries} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="label" {...AXIS} />
                <YAxis {...AXIS} allowDecimals={false} width={44} />
                <Tooltip {...TOOLTIP} cursor={{ fill: 'rgba(109,139,255,0.08)' }} />
                <Bar dataKey="count" name="Potholes" radius={[6, 6, 0, 0]}>
                  {severitySeries.map((entry) => (
                    <Cell key={entry.key} fill={SEVERITY_META[entry.key].color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="surface p-4">
          <SectionHeading title="Worst zones" subtitle="Detections grouped by ward" icon={MapPin} />
          <div className="mt-4 h-[220px]">
            {wardSeries.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={wardSeries}
                  layout="vertical"
                  margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
                >
                  <CartesianGrid stroke="rgba(255,255,255,0.05)" horizontal={false} />
                  <XAxis type="number" {...AXIS} allowDecimals={false} />
                  <YAxis type="category" dataKey="label" {...AXIS} width={110} />
                  <Tooltip {...TOOLTIP} cursor={{ fill: 'rgba(109,139,255,0.08)' }} />
                  <Bar dataKey="count" name="Potholes" fill="#22d3ee" radius={[0, 6, 6, 0]} barSize={14} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState icon={MapPin} title="No ward data" description="Records need a ward to appear here." />
            )}
          </div>
        </section>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <section className="surface overflow-hidden xl:col-span-2">
          <div className="border-b border-white/[0.06] px-4 py-3">
            <SectionHeading
              title="Recent detections"
              subtitle={connected ? 'Streaming live from the detection engine' : 'Polling the registry'}
              icon={ScanLine}
              action={
                <Link to="/records" className="btn">
                  View all
                </Link>
              }
            />
          </div>
          {recent?.items?.length ? (
            <ul className="divide-y divide-white/[0.05]">
              {recent.items.map((item) => (
                <li key={item.id} className="flex items-center gap-3 px-4 py-3 transition hover:bg-white/[0.03]">
                  <SeverityBadge severity={item.severity} score={item.severity_score} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-mist-100">
                      {item.road_name || item.address || `Fix ${item.ref_code}`}
                    </p>
                    <p className="mono truncate text-[11px] text-mist-500">
                      {item.ref_code} · {Number(item.latitude).toFixed(5)}, {Number(item.longitude).toFixed(5)}
                    </p>
                  </div>
                  <div className="hidden w-28 shrink-0 sm:block">
                    <ScoreBar score={item.severity_score} />
                  </div>
                  <StatusPill status={item.status} />
                  <span className="hidden w-20 shrink-0 text-right text-[11px] text-mist-500 md:block">
                    {relativeTime(item.detected_at)}
                  </span>
                  <Link to={`/map?focus=${item.id}`} className="btn btn-ghost p-1.5" title="Show on map">
                    <MapPin size={14} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={ScanLine}
              title="No detections recorded"
              description="Upload a road photo or video on the AI Detection page to create your first record."
              action={
                <Link to="/detect" className="btn btn-primary">
                  Open AI Detection
                </Link>
              }
            />
          )}
        </section>

        <section className="surface overflow-hidden">
          <div className="border-b border-white/[0.06] px-4 py-3">
            <SectionHeading title="Highest risk" subtitle="Prioritised repair queue" icon={AlertTriangle} />
          </div>
          {stats?.highest_risk?.length ? (
            <ul className="divide-y divide-white/[0.05]">
              {stats.highest_risk.map((item) => (
                <li key={item.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="mono text-[12px] text-mist-100">{item.ref_code}</span>
                    <span className="mono text-[12px]" style={{ color: SEVERITY_META[item.severity].color }}>
                      {Number(item.severity_score).toFixed(1)}
                    </span>
                  </div>
                  <div className="mt-2">
                    <ScoreBar score={item.severity_score} />
                  </div>
                  <p className="mt-2 truncate text-[11px] text-mist-500">
                    {item.road_name || item.address || 'Unnamed location'}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Gauge} title="Nothing ranked yet" description="Severity scores appear here once data exists." />
          )}
        </section>
      </div>
    </div>
  )
}
