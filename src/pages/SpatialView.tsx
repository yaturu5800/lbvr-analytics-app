import { useCallback, useEffect, useRef, useState } from 'react'
import { subDays } from 'date-fns'
import { ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend } from 'recharts'
import { supabase, mapImageUrl } from '../lib/supabase'
import { msToLabel } from '../lib/utils'
import type { SessionStageEvent, ExperienceSession, VenueMapConfig } from '../types'
import DateRangePicker from '../components/DateRangePicker'
import FilterSelect from '../components/FilterSelect'
import EmptyState from '../components/EmptyState'

// ── Coordinate transform (ported from operator app VenueMapView.tsx) ──────────

function unityToPixel(ux: number, uz: number, cfg: VenueMapConfig): { x: number; y: number } {
  const θ = (cfg.rotation_deg * Math.PI) / 180
  let rx = ux * Math.cos(θ) - uz * Math.sin(θ)
  let rz = ux * Math.sin(θ) + uz * Math.cos(θ)
  if (cfg.flip_x) rx = -rx
  if (cfg.flip_y) rz = -rz
  return {
    x: cfg.offset_x * cfg.scale + rx * cfg.scale,
    y: cfg.offset_y * cfg.scale + rz * cfg.scale,
  }
}

function quaternionToMapAngleDeg(
  q: { x: number; y: number; z: number; w: number },
  cfg: VenueMapConfig,
): number {
  const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z))
  let dx = Math.sin(yaw)
  let dz = Math.cos(yaw)
  const θ = (cfg.rotation_deg * Math.PI) / 180
  let sdx = dx * Math.cos(θ) - dz * Math.sin(θ)
  let sdz = dx * Math.sin(θ) + dz * Math.cos(θ)
  if (cfg.flip_x) sdx = -sdx
  if (cfg.flip_y) sdz = -sdz
  return (Math.atan2(sdx, -sdz) * 180) / Math.PI
}

// ── Dot colour ────────────────────────────────────────────────────────────────

function dotColor(wrongLocation: boolean, completed: boolean | null): string {
  if (wrongLocation) return '#f97316'   // orange
  if (completed === true) return '#22c55e'  // green
  if (completed === false) return '#ef4444' // red
  return '#6b7280' // gray — unknown
}

function dotLabel(wrongLocation: boolean, completed: boolean | null): string {
  if (wrongLocation) return 'Wrong Location'
  if (completed === true) return 'Completed'
  if (completed === false) return 'Incomplete'
  return 'Unknown'
}

// ── Tooltip component ─────────────────────────────────────────────────────────

interface DotInfo {
  device_id: string
  x: number
  z: number
  timestamp: number
  wrongLocation: boolean
  completed: boolean | null
  duration_seconds: number | null
  last_stage_seen: string | null
}

function DotTooltip({ info, style }: { info: DotInfo; style?: React.CSSProperties }) {
  const color = dotColor(info.wrongLocation, info.completed)
  return (
    <div
      className="absolute z-50 pointer-events-none bg-gray-900 border border-gray-700 rounded p-2 text-xs shadow-xl whitespace-nowrap"
      style={style}
    >
      <p className="text-gray-300">Device: <span className="text-white font-mono">{info.device_id}</span></p>
      <p className="text-gray-300">Pos: ({info.x.toFixed(2)}, {info.z.toFixed(2)})</p>
      <p className="text-gray-300">{msToLabel(info.timestamp)}</p>
      {info.duration_seconds != null && (
        <p className="text-gray-300">Duration: <span className="text-white">{info.duration_seconds}s</span></p>
      )}
      <p style={{ color }}>{dotLabel(info.wrongLocation, info.completed)}</p>
      {info.last_stage_seen != null && (
        <p className="text-gray-400">Last stage: <span className="text-gray-200">{info.last_stage_seen}</span></p>
      )}
    </div>
  )
}

// ── Data types ────────────────────────────────────────────────────────────────

interface Point {
  event_id: string
  device_id: string
  premise_id: string
  session_id: string | null
  x: number
  z: number
  rot: { x: number; y: number; z: number; w: number } | null
  timestamp: number
  wrongLocation: boolean
  completed: boolean | null
  duration_seconds: number | null
  last_stage_seen: string | null
}

// ── CalibrationPanel ─────────────────────────────────────────────────────────

interface CalibPanelProps {
  cfg: VenueMapConfig
  onChange: (next: VenueMapConfig) => void
  onSave: () => void
  onDiscard: () => void
  saving: boolean
  dataBounds: { minX: number; maxX: number; minZ: number; maxZ: number } | null
}

function CalibrationPanel({ cfg, onChange, onSave, onDiscard, saving, dataBounds }: CalibPanelProps) {
  const field = (key: keyof VenueMapConfig, step: number, min: number, max: number, label: string) => (
    <div className="flex items-center gap-2">
      <label className="text-xs text-gray-400 w-24 shrink-0">{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Number(cfg[key])}
        onChange={(e) => onChange({ ...cfg, [key]: Number(e.target.value) })}
        className="flex-1 accent-indigo-500"
      />
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number(cfg[key])}
        onChange={(e) => onChange({ ...cfg, [key]: Number(e.target.value) })}
        className="w-20 text-xs bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-white text-right"
      />
    </div>
  )

  return (
    <div className="border-b border-gray-800 bg-gray-900/80 px-4 py-3 space-y-2.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wide">Map Calibration</span>
        {dataBounds && (
          <span className="text-xs text-gray-500">
            Data X [{dataBounds.minX.toFixed(2)}, {dataBounds.maxX.toFixed(2)}] &nbsp;
            Z [{dataBounds.minZ.toFixed(2)}, {dataBounds.maxZ.toFixed(2)}]
          </span>
        )}
      </div>
      {field('scale', 1, 1, 500, 'Scale (px/m)')}
      {field('offset_x', 0.1, -100, 100, 'Offset X (m)')}
      {field('offset_y', 0.1, -100, 100, 'Offset Y (m)')}
      {field('rotation_deg', 1, 0, 359, 'Rotation (°)')}
      <div className="flex items-center gap-6 pt-1">
        <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(cfg.flip_x)}
            onChange={(e) => onChange({ ...cfg, flip_x: e.target.checked })}
            className="accent-indigo-500"
          />
          Flip X
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(cfg.flip_y)}
            onChange={(e) => onChange({ ...cfg, flip_y: e.target.checked })}
            className="accent-indigo-500"
          />
          Flip Y
        </label>
        <div className="ml-auto flex gap-2">
          <button
            onClick={onDiscard}
            className="text-xs px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300"
          >Discard</button>
          <button
            onClick={onSave}
            disabled={saving}
            className="text-xs px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50"
          >{saving ? 'Saving…' : 'Save to Supabase'}</button>
        </div>
      </div>
      <p className="text-xs text-gray-600">
        Origin crosshair (⊕) shows where Unity (0, 0) maps on the image.
        Adjust until dots align with expected rooms.
      </p>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SpatialView() {
  const [points, setPoints] = useState<Point[]>([])
  const [mapConfig, setMapConfig] = useState<VenueMapConfig | null>(null)
  const [mapConfigLoaded, setMapConfigLoaded] = useState(false)
  const [loading, setLoading] = useState(true)

  const [start, setStart] = useState(subDays(new Date(), 30))
  const [end, setEnd] = useState(new Date())
  const [premiseFilter, setPremiseFilter] = useState('')
  const [deviceFilter, setDeviceFilter] = useState('')
  const [expFilter, setExpFilter] = useState('')

  // duration filter
  const [minDuration, setMinDuration] = useState('')
  const [maxDuration, setMaxDuration] = useState('')

  // device text search (client-side, partial match)
  const [deviceSearch, setDeviceSearch] = useState('')

  // map controls
  const [wrongLocationOnly, setWrongLocationOnly] = useState(false)
  const [showHeadings, setShowHeadings] = useState(true)
  const [showOrigin, setShowOrigin] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [hoveredDot, setHoveredDot] = useState<{ info: DotInfo; px: number; py: number } | null>(null)

  // calibration
  const [calibrating, setCalibrating] = useState(false)
  const [calibCfg, setCalibCfg] = useState<VenueMapConfig | null>(null)
  const [calibSaving, setCalibSaving] = useState(false)

  const isDragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  // ── Load map config ──────────────────────────────────────────────────────────
  useEffect(() => {
    async function loadConfig() {
      setMapConfigLoaded(false)
      setCalibrating(false)
      let q = supabase.from('venue_map_config').select('*')
      if (premiseFilter) q = q.eq('premise_id', premiseFilter)
      const { data } = await q.limit(1)
      const cfg = (data as VenueMapConfig[] | null)?.[0] ?? null
      setMapConfig(cfg)
      setCalibCfg(cfg ? { ...cfg } : null)
      setMapConfigLoaded(true)
    }
    loadConfig()
  }, [premiseFilter])

  // ── Calibration handlers ─────────────────────────────────────────────────────
  const startCalibration = () => {
    if (mapConfig) setCalibCfg({ ...mapConfig })
    setCalibrating(true)
  }

  const discardCalibration = () => {
    if (mapConfig) setCalibCfg({ ...mapConfig })
    setCalibrating(false)
  }

  const saveCalibration = async () => {
    if (!calibCfg) return
    setCalibSaving(true)
    const updatePayload: Partial<VenueMapConfig> = {
      scale: calibCfg.scale,
      offset_x: calibCfg.offset_x,
      offset_y: calibCfg.offset_y,
      rotation_deg: calibCfg.rotation_deg,
      flip_x: calibCfg.flip_x,
      flip_y: calibCfg.flip_y,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('venue_map_config') as any)
      .update(updatePayload)
      .eq('premise_id', calibCfg.premise_id)
    setCalibSaving(false)
    if (!error) {
      setMapConfig({ ...calibCfg })
      setCalibrating(false)
    } else {
      alert('Save failed: ' + error.message)
    }
  }

  // ── Load session data ────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoading(true)

      let evQ = supabase
        .from('session_stage_events')
        .select('event_id, device_id, premise_id, session_id, transitioned_at, position_x, position_z, rotation_x, rotation_y, rotation_z, rotation_w')
        .eq('stage_to', 'ExperienceStart')
        .gte('transitioned_at', start.getTime())
        .lte('transitioned_at', end.getTime())
        .not('position_x', 'is', null)

      if (deviceFilter) evQ = evQ.eq('device_id', deviceFilter)
      if (expFilter) evQ = evQ.eq('experience_id', expFilter)
      if (premiseFilter) evQ = evQ.eq('premise_id', premiseFilter)

      const { data: eventsData } = await evQ
      const evs = (eventsData ?? []) as Pick<
        SessionStageEvent,
        'event_id' | 'device_id' | 'premise_id' | 'session_id' | 'transitioned_at' | 'position_x' | 'position_z' | 'rotation_x' | 'rotation_y' | 'rotation_z' | 'rotation_w'
      >[]

      const sessionIds = [...new Set(evs.map((e) => e.session_id).filter(Boolean) as string[])]
      const sessionMap = new Map<string, { completed: boolean; wrongLocation: boolean; duration_seconds: number | null; last_stage_seen: string | null }>()

      if (sessionIds.length > 0) {
        const BATCH = 500
        const batches: Promise<void>[] = []
        for (let i = 0; i < sessionIds.length; i += BATCH) {
          batches.push(
            supabase
              .from('experience_sessions')
              .select('session_id, was_completed, was_wrong_location, duration_seconds, last_stage_seen')
              .in('session_id', sessionIds.slice(i, i + BATCH))
              .then(({ data }) => {
                for (const s of (data ?? []) as Pick<ExperienceSession, 'session_id' | 'was_completed' | 'was_wrong_location' | 'duration_seconds' | 'last_stage_seen'>[]) {
                  sessionMap.set(s.session_id, {
                    completed: Boolean(s.was_completed),
                    wrongLocation: s.was_wrong_location === 1,
                    duration_seconds: s.duration_seconds ?? null,
                    last_stage_seen: s.last_stage_seen ?? null,
                  })
                }
              })
          )
        }
        await Promise.all(batches)
      }

      setPoints(
        evs
          .filter((e) => e.position_x != null && e.position_z != null)
          .map((e) => {
            const sess = e.session_id ? sessionMap.get(e.session_id) : undefined
            const hasRot = e.rotation_x != null && e.rotation_y != null && e.rotation_z != null && e.rotation_w != null
            return {
              event_id: e.event_id,
              device_id: e.device_id,
              session_id: e.session_id,
              premise_id: e.premise_id,
              x: e.position_x!,
              z: e.position_z!,
              rot: hasRot
                ? { x: e.rotation_x!, y: e.rotation_y!, z: e.rotation_z!, w: e.rotation_w! }
                : null,
              timestamp: e.transitioned_at,
              wrongLocation: sess?.wrongLocation ?? false,
              completed: sess != null ? sess.completed : null,
              duration_seconds: sess?.duration_seconds ?? null,
              last_stage_seen: sess?.last_stage_seen ?? null,
            }
          })
      )
      setLoading(false)
    }
    load()
  }, [start, end, premiseFilter, deviceFilter, expFilter])

  // ── Derived data ─────────────────────────────────────────────────────────────
  const premises = [...new Set(points.map((p) => p.premise_id))].filter(Boolean)
  const devices = [...new Set(points.map((p) => p.device_id))].filter(Boolean)

  const minDurSec = minDuration !== '' ? Number(minDuration) : null
  const maxDurSec = maxDuration !== '' ? Number(maxDuration) : null

  const deviceSearchLower = deviceSearch.trim().toLowerCase()

  const durationFiltered = points.filter((p) => {
    if (minDurSec !== null && (p.duration_seconds == null || p.duration_seconds < minDurSec)) return false
    if (maxDurSec !== null && (p.duration_seconds == null || p.duration_seconds > maxDurSec)) return false
    if (deviceSearchLower && !p.device_id.toLowerCase().includes(deviceSearchLower)) return false
    return true
  })

  const matchedDevices = deviceSearchLower
    ? [...new Set(durationFiltered.map((p) => p.device_id))]
    : []

  const visiblePoints = wrongLocationOnly ? durationFiltered.filter((p) => p.wrongLocation) : durationFiltered
  const wrongCount = durationFiltered.filter((p) => p.wrongLocation).length

  // effective config: use live calibration overrides when calibrating
  const effectiveCfg = (calibrating && calibCfg) ? calibCfg : mapConfig

  // data bounds for the calibration helper
  const dataBounds = points.length > 0 ? {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minZ: Math.min(...points.map((p) => p.z)),
    maxZ: Math.max(...points.map((p) => p.z)),
  } : null

  // ── Pan / zoom handlers ──────────────────────────────────────────────────────
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.85 : 1.15
    setZoom((z) => Math.min(8, Math.max(0.2, z * delta)))
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    isDragging.current = true
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
  }, [pan])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return
    setPan({
      x: dragStart.current.panX + (e.clientX - dragStart.current.x),
      y: dragStart.current.panY + (e.clientY - dragStart.current.y),
    })
  }, [])

  const handleMouseUp = useCallback(() => { isDragging.current = false }, [])

  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }) }

  // ── Scatter chart data (fallback) ────────────────────────────────────────────
  const completedPoints = points.filter((p) => !p.wrongLocation && p.completed === true)
  const incompletePoints = points.filter((p) => !p.wrongLocation && p.completed === false)
  const unknownPoints = points.filter((p) => !p.wrongLocation && p.completed === null)
  const wrongPoints = points.filter((p) => p.wrongLocation)

  const useFloorPlan = mapConfigLoaded && mapConfig != null && mapConfig.image_path != null
  const imageUrl = (useFloorPlan && mapConfig!.image_path) ? mapImageUrl(mapConfig!.image_path) : null

  // origin crosshair position (where Unity 0,0 maps — always offset_x*scale, offset_y*scale)
  const originPx = effectiveCfg
    ? { x: effectiveCfg.offset_x * effectiveCfg.scale, y: effectiveCfg.offset_y * effectiveCfg.scale }
    : null

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-white mr-2">Spatial View</h1>
        <DateRangePicker start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e) }} />
        <FilterSelect options={premises} value={premiseFilter} onChange={setPremiseFilter} placeholder="All Premises" />
        <FilterSelect options={devices} value={deviceFilter} onChange={setDeviceFilter} placeholder="All Devices" />
        <div className="relative flex items-center">
          <input
            type="text"
            placeholder="Search device…"
            value={deviceSearch}
            onChange={(e) => setDeviceSearch(e.target.value)}
            className="w-36 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white text-xs placeholder-gray-600 focus:outline-none focus:border-indigo-500"
          />
          {deviceSearch && (
            <button
              onClick={() => setDeviceSearch('')}
              className="absolute right-1.5 text-gray-500 hover:text-gray-300 text-xs"
            >✕</button>
          )}
          {deviceSearch && matchedDevices.length > 0 && (
            <span className="ml-1.5 text-xs text-indigo-400 whitespace-nowrap">
              {matchedDevices.length} device{matchedDevices.length !== 1 ? 's' : ''} · {durationFiltered.length} pts
            </span>
          )}
          {deviceSearch && matchedDevices.length === 0 && (
            <span className="ml-1.5 text-xs text-red-400 whitespace-nowrap">no match</span>
          )}
        </div>
        <div className="flex items-center gap-1 text-xs text-gray-400" title="Filter by session duration to exclude outliers (e.g. set max to remove crash/reset noise, or min to remove instant failures)">
          <span>Duration (s):</span>
          <input
            type="number"
            min={0}
            placeholder="min s"
            value={minDuration}
            onChange={(e) => setMinDuration(e.target.value)}
            className="w-16 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white text-xs"
          />
          <span>–</span>
          <input
            type="number"
            min={0}
            placeholder="max s"
            value={maxDuration}
            onChange={(e) => setMaxDuration(e.target.value)}
            className="w-16 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white text-xs"
          />
          {(minDuration || maxDuration) && (
            <button
              onClick={() => { setMinDuration(''); setMaxDuration('') }}
              className="text-gray-500 hover:text-gray-300 ml-1"
              title="Clear duration filter"
            >✕</button>
          )}
        </div>
      </div>

      <div className="card text-sm text-amber-400 bg-amber-950/30 border-amber-800">
        Spatial data is only available from 2026-06-25 onwards. Points show where each headset was when the session started (PreExperience → ExperienceStart transition).
      </div>

      {(minDuration || maxDuration) && (
        <div className="text-xs text-indigo-400 bg-indigo-950/30 border border-indigo-800 rounded px-3 py-2">
          Duration filter active — use this to exclude outliers: e.g. set <strong>max = 30s</strong> to isolate instant failures/resets, or <strong>min = 60s</strong> to exclude sessions too short to be real plays.
          Showing {durationFiltered.length} of {points.length} points.
        </div>
      )}

      {loading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : points.length === 0 ? (
        <EmptyState message="No spatial data in this date range." />
      ) : useFloorPlan ? (
        // ── FLOOR PLAN MODE ───────────────────────────────────────────────────
        <div className="card p-0 overflow-hidden">
          {/* Map toolbar */}
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-800">
            <span className="text-xs text-gray-400 font-medium">{visiblePoints.length} point{visiblePoints.length !== 1 ? 's' : ''}</span>
            {wrongCount > 0 && (
              <button
                onClick={() => setWrongLocationOnly((v) => !v)}
                className={`text-xs px-2.5 py-1 rounded transition-colors ${
                  wrongLocationOnly
                    ? 'bg-orange-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                Wrong Location Only ({wrongCount})
              </button>
            )}
            <button
              onClick={() => setShowHeadings((v) => !v)}
              className={`text-xs px-2.5 py-1 rounded transition-colors ${
                showHeadings
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              Headings {showHeadings ? 'On' : 'Off'}
            </button>
            {/* Legend */}
            <div className="flex items-center gap-3 ml-2">
              {[
                { color: '#f97316', label: 'Wrong Location' },
                { color: '#22c55e', label: 'Completed' },
                { color: '#ef4444', label: 'Incomplete' },
                { color: '#6b7280', label: 'Unknown' },
              ].map(({ color, label }) => (
                <span key={label} className="flex items-center gap-1 text-xs text-gray-400">
                  <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                  {label}
                </span>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => setZoom((z) => Math.min(8, z * 1.25))}
                className="w-7 h-7 flex items-center justify-center rounded bg-gray-800 hover:bg-gray-700 text-white text-sm"
              >+</button>
              <button
                onClick={() => setZoom((z) => Math.max(0.2, z / 1.25))}
                className="w-7 h-7 flex items-center justify-center rounded bg-gray-800 hover:bg-gray-700 text-white text-sm"
              >−</button>
              <button
                onClick={resetView}
                className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400"
              >Reset</button>
              <span className="text-xs text-gray-600 ml-1">{Math.round(zoom * 100)}%</span>
              <button
                onClick={calibrating ? discardCalibration : startCalibration}
                className={`text-xs px-2.5 py-1 rounded ml-2 transition-colors ${
                  calibrating
                    ? 'bg-yellow-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >{calibrating ? 'Exit Calibrate' : 'Calibrate'}</button>
            </div>
          </div>

          {/* Calibration panel */}
          {calibrating && calibCfg && (
            <CalibrationPanel
              cfg={calibCfg}
              onChange={setCalibCfg}
              onSave={saveCalibration}
              onDiscard={discardCalibration}
              saving={calibSaving}
              dataBounds={dataBounds}
            />
          )}

          {/* Map canvas */}
          <div
            ref={containerRef}
            className="relative overflow-hidden bg-gray-950"
            style={{ height: 560, cursor: isDragging.current ? 'grabbing' : 'grab', userSelect: 'none' }}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            {/* Transform wrapper */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                transformOrigin: '0 0',
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              }}
            >
              {/* Floor plan image */}
              {imageUrl && (
                <img
                  src={imageUrl}
                  alt="Venue floor plan"
                  draggable={false}
                  style={{ display: 'block', maxWidth: 'none', opacity: 0.88, filter: 'brightness(0.85) contrast(1.1)' }}
                />
              )}

              {/* Origin crosshair — shows where Unity (0,0) maps on the image */}
              {originPx && (showOrigin || calibrating) && (
                <div
                  style={{
                    position: 'absolute',
                    left: originPx.x,
                    top: originPx.y,
                    transform: 'translate(-50%, -50%)',
                    pointerEvents: 'none',
                    zIndex: 30,
                  }}
                >
                  <svg width="28" height="28" viewBox="-14 -14 28 28" overflow="visible">
                    <line x1="-14" y1="0" x2="14" y2="0" stroke="#facc15" strokeWidth="1.5" />
                    <line x1="0" y1="-14" x2="0" y2="14" stroke="#facc15" strokeWidth="1.5" />
                    <circle cx="0" cy="0" r="5" fill="none" stroke="#facc15" strokeWidth="1.5" />
                    <circle cx="0" cy="0" r="1.5" fill="#facc15" />
                  </svg>
                </div>
              )}

              {/* Session dots */}
              {effectiveCfg && visiblePoints.map((pt) => {
                const { x: px, y: py } = unityToPixel(pt.x, pt.z, effectiveCfg)
                const color = dotColor(pt.wrongLocation, pt.completed)
                const headingDeg = (showHeadings && pt.rot)
                  ? quaternionToMapAngleDeg(pt.rot, effectiveCfg)
                  : null
                const DOT = 12

                return (
                  <div
                    key={pt.event_id}
                    style={{ position: 'absolute', left: px, top: py, transform: 'translate(-50%, -50%)', zIndex: 10 }}
                    onMouseEnter={() => {
                      const rect = containerRef.current?.getBoundingClientRect()
                      if (!rect) return
                      setHoveredDot({
                        info: { device_id: pt.device_id, x: pt.x, z: pt.z, timestamp: pt.timestamp, wrongLocation: pt.wrongLocation, completed: pt.completed, duration_seconds: pt.duration_seconds, last_stage_seen: pt.last_stage_seen },
                        px: (px * zoom + pan.x) + rect.left,
                        py: (py * zoom + pan.y) + rect.top,
                      })
                    }}
                    onMouseLeave={() => setHoveredDot(null)}
                  >
                    {/* Heading arrow */}
                    {headingDeg != null && (
                      <div
                        style={{
                          position: 'absolute',
                          width: DOT * 3,
                          height: DOT * 3,
                          top: '50%',
                          left: '50%',
                          transform: `translate(-50%, -50%) rotate(${headingDeg}deg)`,
                          pointerEvents: 'none',
                        }}
                      >
                        <svg
                          width={DOT * 3}
                          height={DOT * 3}
                          viewBox={`${-(DOT * 1.5)} ${-(DOT * 1.5)} ${DOT * 3} ${DOT * 3}`}
                          overflow="visible"
                        >
                          <polygon
                            points={`0,${-(DOT / 2 + DOT)} ${DOT * 0.28},${-(DOT / 2) + 2} ${-(DOT * 0.28)},${-(DOT / 2) + 2}`}
                            fill={color}
                            fillOpacity={0.85}
                            stroke="rgba(255,255,255,0.6)"
                            strokeWidth={1}
                          />
                        </svg>
                      </div>
                    )}
                    {/* Dot */}
                    <div
                      style={{
                        width: DOT,
                        height: DOT,
                        borderRadius: '50%',
                        backgroundColor: color,
                        border: deviceSearchLower ? '2px solid rgba(255,255,255,1)' : '2px solid rgba(255,255,255,0.8)',
                        boxShadow: deviceSearchLower ? `0 0 8px ${color}, 0 0 14px ${color}88` : `0 0 5px ${color}88`,
                      }}
                    />
                  </div>
                )
              })}
            </div>

            {/* Origin toggle (bottom-left, only when not calibrating) */}
            {!calibrating && (
              <div className="absolute bottom-3 left-3 z-30">
                <button
                  onClick={() => setShowOrigin((v) => !v)}
                  title="Toggle origin crosshair"
                  className={`text-xs px-2 py-1 rounded transition-colors ${
                    showOrigin ? 'bg-yellow-700/70 text-yellow-200' : 'bg-gray-800/70 text-gray-500'
                  }`}
                >⊕ origin</button>
              </div>
            )}

            {/* Floating tooltip */}
            {hoveredDot && (
              <DotTooltip
                info={hoveredDot.info}
                style={{
                  position: 'fixed',
                  left: hoveredDot.px + 14,
                  top: hoveredDot.py - 8,
                }}
              />
            )}
          </div>
        </div>
      ) : (
        // ── SCATTER CHART FALLBACK ────────────────────────────────────────────
        <>
          {!mapConfigLoaded ? null : (
            <div className="card text-xs text-gray-500 bg-gray-900/50 border-gray-800">
              No floor plan configured for this premise. Showing raw Unity coordinates.
              To enable the floor plan view, add a row to <code className="text-gray-400">venue_map_config</code> in Supabase and upload the floor plan image to the <code className="text-gray-400">venue-maps</code> storage bucket.
            </div>
          )}

          {/* Toggle for scatter chart too */}
          {wrongCount > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setWrongLocationOnly((v) => !v)}
                className={`text-xs px-2.5 py-1 rounded transition-colors ${
                  wrongLocationOnly ? 'bg-orange-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                Wrong Location Only ({wrongCount})
              </button>
            </div>
          )}

          <div className="flex gap-4 text-xs text-gray-400">
            <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-orange-500 mr-1" />Wrong Location ({wrongPoints.length})</span>
            <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500 mr-1" />Completed ({completedPoints.length})</span>
            <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 mr-1" />Incomplete ({incompletePoints.length})</span>
            {unknownPoints.length > 0 && <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-gray-500 mr-1" />Unknown ({unknownPoints.length})</span>}
          </div>

          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 mb-4">Starting Positions (X / Z horizontal plane)</h2>
            <ResponsiveContainer width="100%" height={500}>
              <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                <XAxis
                  dataKey="x"
                  type="number"
                  name="X"
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                  label={{ value: 'X (m)', position: 'insideBottom', fill: '#6b7280', fontSize: 11 }}
                />
                <YAxis
                  dataKey="z"
                  type="number"
                  name="Z"
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                  label={{ value: 'Z (m)', angle: -90, position: 'insideLeft', fill: '#6b7280', fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 11 }}
                  content={({ payload }) => {
                    if (!payload?.length) return null
                    const p = payload[0].payload as Point
                    return (
                      <div className="bg-gray-900 border border-gray-700 rounded p-2 text-xs">
                        <p className="text-gray-300">Device: <span className="text-white font-mono">{p.device_id}</span></p>
                        <p className="text-gray-300">Pos: ({p.x.toFixed(2)}, {p.z.toFixed(2)})</p>
                        <p className="text-gray-300">{msToLabel(p.timestamp)}</p>
                        <p style={{ color: dotColor(p.wrongLocation, p.completed) }}>
                          {dotLabel(p.wrongLocation, p.completed)}
                        </p>
                        {p.last_stage_seen != null && (
                          <p className="text-gray-400">Last stage: <span className="text-gray-200">{p.last_stage_seen}</span></p>
                        )}
                      </div>
                    )
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {!wrongLocationOnly && (
                  <Scatter name="Completed" data={completedPoints} fill="#22c55e">
                    {completedPoints.map((_, i) => <Cell key={i} fill="#22c55e" fillOpacity={0.7} />)}
                  </Scatter>
                )}
                {!wrongLocationOnly && (
                  <Scatter name="Incomplete" data={incompletePoints} fill="#ef4444">
                    {incompletePoints.map((_, i) => <Cell key={i} fill="#ef4444" fillOpacity={0.7} />)}
                  </Scatter>
                )}
                {!wrongLocationOnly && unknownPoints.length > 0 && (
                  <Scatter name="Unknown" data={unknownPoints} fill="#6b7280">
                    {unknownPoints.map((_, i) => <Cell key={i} fill="#6b7280" fillOpacity={0.5} />)}
                  </Scatter>
                )}
                <Scatter name="Wrong Location" data={wrongLocationOnly ? points.filter((p) => p.wrongLocation) : wrongPoints} fill="#f97316">
                  {(wrongLocationOnly ? points.filter((p) => p.wrongLocation) : wrongPoints).map((_, i) => (
                    <Cell key={i} fill="#f97316" fillOpacity={0.85} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  )
}
