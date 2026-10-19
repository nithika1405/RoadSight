import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  Activity,
  Download,
  LayoutDashboard,
  MapPinned,
  Menu,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Table2,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'

import { useAppData, useConfig } from '../lib/appDataContext.js'
import { downloadCsv } from '../lib/api.js'
import { useToast } from '../lib/toastContext.js'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, hint: 'Overview & analytics' },
  { to: '/detect', label: 'AI Detection', icon: ScanLine, hint: 'Analyse image / video' },
  { to: '/map', label: 'Live Map', icon: MapPinned, hint: 'GPS map & routes' },
  { to: '/records', label: 'Records', icon: Table2, hint: 'Search, filter, export' },
]

const TITLES = {
  '/': { title: 'Command Centre', subtitle: 'Network-wide road condition intelligence' },
  '/detect': { title: 'AI Detection Studio', subtitle: 'Upload road media and geotag new potholes' },
  '/map': { title: 'Interactive Map', subtitle: 'Live GPS positions with severity intensity' },
  '/records': { title: 'Detection Records', subtitle: 'Search, triage and export the full registry' },
}

export default function Layout({ children }) {
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const { connected, health, liveDetections, refresh } = useAppData()
  const { version } = useConfig()
  const toast = useToast()

  const meta = TITLES[location.pathname] || TITLES['/']
  const total = health?.total_potholes ?? 0

  const handleExportAll = () => {
    downloadCsv({ sort: 'severity_score', order: 'desc' })
    toast.info('Preparing CSV export of every detection…')
  }

  return (
    <div className="flex min-h-screen">
      {/* sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[248px] shrink-0 border-r border-white/[0.06] bg-ink-950/85 backdrop-blur-xl transition-transform lg:static lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-full flex-col p-4">
          <div className="flex items-center justify-between">
            <NavLink to="/" className="flex items-center gap-3" onClick={() => setMobileOpen(false)}>
              <span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-sev-high to-sev-critical shadow-lg">
                <MapPinned size={18} className="text-ink-950" />
              </span>
              <span>
                <span className="block text-[15px] font-bold leading-tight tracking-tight">RoadSight</span>
                <span className="block text-[10px] uppercase tracking-[0.16em] text-mist-500">
                  Pothole Intelligence
                </span>
              </span>
            </NavLink>
            <button
              type="button"
              className="btn btn-ghost p-1.5 lg:hidden"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
            >
              <X size={16} />
            </button>
          </div>

          <nav className="mt-6 flex flex-col gap-1">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              >
                <item.icon size={17} />
                <span className="flex-1">
                  <span className="block leading-tight">{item.label}</span>
                  <span className="block text-[10px] text-mist-500">{item.hint}</span>
                </span>
              </NavLink>
            ))}
          </nav>

          <div className="mt-auto space-y-3">
            <div className="surface-flat p-3">
              <div className="flex items-center gap-2 text-[11px]">
                {connected ? (
                  <>
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-sev-low animate-halo" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-sev-low" />
                    </span>
                    <span className="font-semibold text-sev-low">LIVE STREAM</span>
                  </>
                ) : (
                  <>
                    <WifiOff size={12} className="text-mist-500" />
                    <span className="font-semibold text-mist-500">OFFLINE</span>
                  </>
                )}
              </div>
              <p className="mt-2 text-[11px] text-mist-500">
                {liveDetections > 0 ? (
                  <>
                    <span className="mono text-mist-100">{liveDetections}</span> new detections this session
                  </>
                ) : (
                  'Listening for detections…'
                )}
              </p>
            </div>

            <div className="flex items-center justify-between px-1 text-[10px] uppercase tracking-[0.12em] text-mist-600">
              <span className="flex items-center gap-1.5">
                <ShieldCheck size={12} /> v{version}
              </span>
              <span className="mono">{total ? `${total} pts` : 'no data'}</span>
            </div>
          </div>
        </div>
      </aside>

      {mobileOpen ? (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      ) : null}

      {/* main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-white/[0.06] bg-ink-950/75 px-4 py-3 backdrop-blur-xl lg:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn btn-ghost p-2 lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Menu size={16} />
            </button>

            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[17px] font-semibold leading-tight">{meta.title}</h1>
              <p className="truncate text-[11px] text-mist-500">{meta.subtitle}</p>
            </div>

            <div className="hidden items-center gap-2 md:flex">
              <span
                className="chip"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  color: connected ? '#3ee6b0' : '#7c84a1',
                  borderColor: 'rgba(255,255,255,0.08)',
                }}
                title="Real-time event stream"
              >
                {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
                SSE
              </span>
              <span
                className="chip"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  color: health?.status === 'ok' ? '#22d3ee' : '#ff7a1a',
                  borderColor: 'rgba(255,255,255,0.08)',
                }}
                title={`API ${health?.database || 'unknown'} · uptime ${health?.uptime_s ?? 0}s`}
              >
                <Activity size={12} />
                {health?.status === 'ok' ? 'API OK' : 'API ?'}
              </span>
            </div>

            <button
              type="button"
              className="btn"
              onClick={() => {
                refresh()
                toast.info('Refreshing dashboard data…')
              }}
              title="Refresh"
            >
              <RefreshCw size={14} />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            <button type="button" className="btn btn-primary" onClick={handleExportAll}>
              <Download size={14} />
              <span className="hidden sm:inline">Export CSV</span>
            </button>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-5 lg:px-6">{children}</main>
      </div>
    </div>
  )
}
