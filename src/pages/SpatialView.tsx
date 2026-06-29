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
      <p style={{ color }}>{dotLabel(info.wrongLocation, info.completed)}</p>
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

  // map controls
  const [wrongLocationOnly, setWrongLocationOnly] = useState(false)
  const [showHeadings, setShowHeadings] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [hoveredDot, setHoveredDot] = useState<{ info: DotInfo; px: number; py: number } | null>(null)

  const isDragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  // ── Load map config ──────────────────────────────────────────────────────────
  useEffect(() => {
    async function loadConfig() {
      setMapConfigLoaded(false)
      let q = supabase.from('venue_map_config').select('*')
      if (premiseFilter) q = q.eq('premise_id', premiseFilter)
      const { data } = await q.limit(1)
      setMapConfig(data?.[0] ?? null)
      setMapConfigLoaded(true)
    }
    loadConfig()
  }, [premiseFilter])

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

      const sessionIds = evs.map((e) => e.session_id).filter(Boolean) as string[]
      const sessionMap = new Map<string, { completed: boolean; wrongLocation: boolean }>()

      if (sessionIds.length > 0) {
        const { data: sessData } = await supabase
          .from('experience_sessions')
          .select('session_id, was_completed, was_wrong_location')
          .in('session_id', sessionIds.slice(0, 500))
        for (const s of (sessData ?? []) as Pick<ExperienceSession, 'session_id' | 'was_completed' | 'was_wrong_location'>[]) {
          sessionMap.set(s.session_id, {
            completed: Boolean(s.was_completed),
            wrongLocation: s.was_wrong_location === 1,
          })
        }
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

  const visiblePoints = wrongLocationOnly ? points.filter((p) => p.wrongLocation) : points
  const wrongCount = points.filter((p) => p.wrongLocation).length

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

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-white mr-2">Spatial View</h1>
        <DateRangePicker start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e) }} />
        <FilterSelect options={premises} value={premiseFilter} onChange={setPremiseFilter} placeholder="All Premises" />
        <FilterSelect options={devices} value={deviceFilter} onChange={setDeviceFilter} placeholder="All Devices" />
      </div>

      <div className="card text-sm text-amber-400 bg-amber-950/30 border-amber-800">
        Spatial data is only available from 2026-06-25 onwards. Points show where each headset was when the session started (PreExperience → ExperienceStart transition).
      </div>

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
            </div>
          </div>

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

              {/* Session dots */}
              {mapConfig && visiblePoints.map((pt) => {
                const { x: px, y: py } = unityToPixel(pt.x, pt.z, mapConfig)
                const color = dotColor(pt.wrongLocation, pt.completed)
                const headingDeg = (showHeadings && pt.rot)
                  ? quaternionToMapAngleDeg(pt.rot, mapConfig)
                  : null
                const DOT = 12

                return (
                  <div
                    key={pt.event_id}
                    style={{ position: 'absolute', left: px, top: py, transform: 'translate(-50%, -50%)', zIndex: 10 }}
                    onMouseEnter={(e) => {
                      const rect = containerRef.current?.getBoundingClientRect()
                      if (!rect) return
                      setHoveredDot({
                        info: { device_id: pt.device_id, x: pt.x, z: pt.z, timestamp: pt.timestamp, wrongLocation: pt.wrongLocation, completed: pt.completed },
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
                        border: '2px solid rgba(255,255,255,0.8)',
                        boxShadow: `0 0 5px ${color}88`,
                      }}
                    />
                  </div>
                )
              })}
            </div>

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
