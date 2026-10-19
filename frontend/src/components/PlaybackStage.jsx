import { useEffect, useMemo, useRef, useState } from 'react'
import { Eye, EyeOff, Percent, Tag } from 'lucide-react'

import { severityMeta } from '../lib/severity.js'

/**
 * Index of the sampled frame closest to `time`.
 * `frames` is time-ordered, so a nearest-neighbour scan (max ~240 entries)
 * is both cheap and jitter-free while the video plays.
 */
function nearestFrame(frames, time) {
  if (!frames.length) return -1
  let best = 0
  let bestDelta = Math.abs(frames[0].time_s - time)
  for (let i = 1; i < frames.length; i += 1) {
    const delta = Math.abs(frames[i].time_s - time)
    if (delta < bestDelta) {
      bestDelta = delta
      best = i
    }
  }
  return best
}

/** Severity-coloured boxes + labels for a single sampled timestamp. */
function DetOverlay({ frame, showLabels, showConfidence }) {
  if (!frame?.detections?.length) return null
  return (
    <div className="playback-overlay">
      {frame.detections.map((det) => {
        const meta = severityMeta(det.severity)
        const { x, y, w, h } = det.bbox
        // Not enough headroom above the box -> draw the label inside it.
        const tight = y < 0.08
        return (
          <div
            key={det.index}
            className="det-box"
            style={{
              left: `${x * 100}%`,
              top: `${y * 100}%`,
              width: `${w * 100}%`,
              height: `${h * 100}%`,
              '--det': meta.color,
            }}
          >
            {showLabels ? (
              <span className={`det-label${tight ? ' is-inside' : ''}`}>
                <b>{meta.label}</b>
                {showConfidence ? <span className="det-conf">{Math.round(det.confidence * 100)}%</span> : null}
              </span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Plays the uploaded media and overlays the detections that belong to the
 * timestamp currently on screen. Images are treated as a single frame at
 * t = 0 so both media types share one rendering path.
 *
 * Detections are matched to the playback position with requestAnimationFrame
 * and committed to React state only when the active sample changes, which
 * keeps playback smooth even with a long video.
 */
export default function PlaybackStage({ mediaUrl, kind = 'image', frames = [] }) {
  const videoRef = useRef(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [showBoxes, setShowBoxes] = useState(true)
  const [showLabels, setShowLabels] = useState(true)
  const [showConfidence, setShowConfidence] = useState(kind === 'image')

  useEffect(() => {
    if (kind !== 'video') return undefined
    let raf = 0
    const tick = () => {
      const el = videoRef.current
      if (el && el.readyState >= 1) {
        const index = nearestFrame(frames, el.currentTime)
        setActiveIndex((prev) => (prev === index ? prev : index))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [kind, frames])

  // Clamp during render so a stale index from a previous video never leaks in.
  const activeFrame = frames.length ? frames[Math.min(Math.max(activeIndex, 0), frames.length - 1)] : null
  const maxCount = useMemo(() => frames.reduce((max, f) => Math.max(max, f.detections.length), 0), [frames])
  const hasTimeline = kind === 'video' && frames.length > 1

  const seek = (index) => {
    const el = videoRef.current
    const frame = frames[index]
    if (el && frame) el.currentTime = frame.time_s
    setActiveIndex(index)
  }

  return (
    <div className="playback">
      <div className="playback-stage">
        <div className="playback-frame">
          {kind === 'video' ? (
            <video ref={videoRef} src={mediaUrl} className="playback-media" controls playsInline preload="metadata" />
          ) : (
            <img src={mediaUrl} alt="Uploaded road media" className="playback-media" />
          )}
          {showBoxes ? (
            <DetOverlay frame={activeFrame} showLabels={showLabels} showConfidence={showConfidence} />
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-1 pt-3">
        <button
          type="button"
          className={`btn ${showBoxes ? 'btn-primary' : ''}`}
          onClick={() => setShowBoxes((value) => !value)}
        >
          {showBoxes ? <Eye size={13} /> : <EyeOff size={13} />} Boxes
        </button>
        <button
          type="button"
          className={`btn ${showLabels ? 'btn-primary' : ''}`}
          onClick={() => setShowLabels((value) => !value)}
          disabled={!showBoxes}
        >
          <Tag size={13} /> Labels
        </button>
        <button
          type="button"
          className={`btn ${showConfidence ? 'btn-primary' : ''}`}
          onClick={() => setShowConfidence((value) => !value)}
          disabled={!showBoxes || !showLabels}
        >
          <Percent size={13} /> Confidence
        </button>
        <span className="mono ml-auto text-[11px] text-mist-500">
          {activeFrame
            ? `t = ${activeFrame.time_s.toFixed(1)}s · ${activeFrame.detections.length} detected`
            : 'run the detector to overlay boxes'}
        </span>
      </div>

      {hasTimeline ? (
        <div className="playback-timeline" style={{ paddingTop: 6 }}>
          {frames.map((frame, index) => (
            <button
              key={frame.time_s}
              type="button"
              className={`playback-tick${index === Math.min(activeIndex, frames.length - 1) ? ' is-active' : ''}`}
              style={{ height: `${8 + (maxCount ? (frame.detections.length / maxCount) * 20 : 0)}px` }}
              title={`t = ${frame.time_s.toFixed(1)}s · ${frame.detections.length} detected`}
              onClick={() => seek(index)}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
