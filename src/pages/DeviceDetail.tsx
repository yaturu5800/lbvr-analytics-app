import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { supabase } from '../lib/supabase'
import { msToLabel, msToDay, pct, secondsToHMS, getOutcomeLabel, getOutcomeColor } from '../lib/utils'
import type { ExperienceSession, SessionStageEvent, DeviceHealthSnapshot, CalibrationEvent } from '../types'
import MetricCard from '../components/MetricCard'

const METHOD_COLOR: Record<string, string> = {
  points: '#6366f1',
  single_press: '#14b8a6',
  skip_verify: '#f97316',
}

const METHOD_LABEL: Record<string, string> = {
  points: 'Points',
  single_press: 'Single Press',
  skip_verify: 'Skip Verify',
}

function meshColor(n: number | null): string {
  if (n === null) return 'text-gray-400'
  if (n < 5) return 'text-red-400'
  if (n < 10) return 'text-yellow-400'
  return 'text-green-400'
}

type DeviceTimelineEvent = SessionStageEvent & {
  timelineType: 'stage' | 'recalibration'
}

export default function DeviceDetail() {
  const { device_id } = useParams<{ device_id: string }>()
  const [sessions, setSessions] = useState<ExperienceSession[]>([])
  const [events, setEvents] = useState<SessionStageEvent[]>([])
  const [recalibrationEvents, setRecalibrationEvents] = useState<SessionStageEvent[]>([])
  const [calibrationEvents, setCalibrationEvents] = useState<CalibrationEvent[]>([])
  const [health, setHealth] = useState<DeviceHealthSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!device_id) return
    async function load() {
      setLoading(true)
      const [sessRes, evRes, recalRes, healthRes, calRes] = await Promise.all([
        supabase
          .from('experience_sessions')
          .select('*')
          .eq('device_id', device_id!)
          .order('started_at', { ascending: false })
          .limit(2000),
        supabase
          .from('session_stage_events')
          .select('*')
          .eq('device_id', device_id!)
          .order('transitioned_at', { ascending: true })
          .limit(5000),
        supabase
          .from('recalibration_events')
          .select('*')
          .eq('device_id', device_id!)
          .order('transitioned_at', { ascending: true })
          .limit(2000),
        supabase
          .from('device_health_snapshots')
          .select('*')
          .eq('device_id', device_id!)
          .order('captured_at', { ascending: true })
          .limit(2000),
        supabase
          .from('calibration_events')
          .select('event_id, device_id, app_version, received_at, calibration_method, scan_meshes, created_at')
          .eq('device_id', device_id!)
          .order('received_at', { ascending: false })
          .limit(1000),
      ])
      setSessions(sessRes.data ?? [])
      setEvents(evRes.data ?? [])
      setRecalibrationEvents(recalRes.data ?? [])
      setHealth(healthRes.data ?? [])
      setCalibrationEvents((calRes.data ?? []) as CalibrationEvent[])
      setLoading(false)
    }
    load()
  }, [device_id])

  function toggleSession(id: string) {
    setExpandedSessions((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ── Stage events merged + grouped by session ──────────────────────────────
  const timelineEventsById = new Map<string, DeviceTimelineEvent>()
  for (const e of events) {
    timelineEventsById.set(e.event_id, { ...e, timelineType: 'stage' })
  }
  for (const e of recalibrationEvents) {
    timelineEventsById.set(e.event_id, { ...e, timelineType: 'recalibration' })
  }
  const timelineEvents = [...timelineEventsById.values()].sort((a, b) => a.transitioned_at - b.transitioned_at)

  const eventsBySession: Record<string, DeviceTimelineEvent[]> = {}
  for (const e of timelineEvents) {
    const key = e.session_id ?? `no-session-${e.event_id}`
    if (!eventsBySession[key]) eventsBySession[key] = []
    eventsBySession[key].push(e)
  }

  // ── Link calibration events to sessions by timestamp ─────────────────────
  // A calibration confirm belongs to the session whose window contains it.
  const calBySession: Record<string, CalibrationEvent[]> = {}
  for (const session of sessions) {
    const matching = calibrationEvents.filter(
      (c) => c.received_at >= session.started_at && c.received_at <= session.ended_at
    )
    if (matching.length > 0) {
      calBySession[session.session_id] = matching
    }
  }
  // Calibration events not linked to any session
  const linkedReceivedAts = new Set(
    Object.values(calBySession).flat().map((c) => c.received_at)
  )
  const unlinkedCal = calibrationEvents.filter((c) => !linkedReceivedAts.has(c.received_at))

  // ── Calibration summary metrics ───────────────────────────────────────────
  const totalConfirms = calibrationEvents.length
  const meshValues = calibrationEvents.filter((c) => c.scan_meshes !== null).map((c) => c.scan_meshes!)
  const avgMeshes = meshValues.length > 0
    ? meshValues.reduce((a, b) => a + b, 0) / meshValues.length
    : null
  const methodCounts: Record<string, number> = {}
  for (const c of calibrationEvents) {
    const m = c.calibration_method ?? 'unknown'
    methodCounts[m] = (methodCounts[m] ?? 0) + 1
  }
  const topMethod = Object.entries(methodCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  // ── Problem signals ───────────────────────────────────────────────────────
  const completed = sessions.filter((s) => s.was_completed)
  const avgDuration = completed.length
    ? Math.round(completed.reduce((a, s) => a + s.duration_seconds, 0) / completed.length)
    : 0
  const lastSeen = sessions[0]?.started_at ?? 0
  const shortSessions = sessions.filter((s) => s.duration_seconds < 60 && !s.was_completed)
  const skipSessions = sessions.filter((s) => s.was_skipped_to_main === 1)
  const stuckSessions = events
    .filter((e) => e.stage_to === 'ExperienceStart')
    .filter((e) => !events.some((e2) => e2.session_id === e.session_id && e2.stage_to === 'ExperienceMain'))

  const healthChartData = health.map((h) => ({
    day: msToDay(h.captured_at),
    battery: h.battery_level,
    wifi: h.wifi_strength,
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/devices" className="text-gray-500 hover:text-gray-300 text-sm">← Devices</Link>
        <h1 className="text-xl font-bold text-white font-mono">{device_id}</h1>
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : (
        <>
          {/* Metric cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard label="Total Sessions" value={sessions.length} />
            <MetricCard label="Completion Rate" value={pct(completed.length, sessions.length)} color="text-green-400" />
            <MetricCard label="Avg Duration" value={avgDuration ? secondsToHMS(avgDuration) : '—'} />
            <MetricCard label="Last Seen" value={lastSeen ? msToLabel(lastSeen) : '—'} />
          </div>

          {/* Problem signals */}
          {(shortSessions.length > 0 || skipSessions.length > 0 || stuckSessions.length > 0) && (
            <div className="card border-red-800 bg-red-950/20">
              <h2 className="text-sm font-semibold text-red-400 mb-2">⚠️ Problem Signals</h2>
              <ul className="text-sm text-red-300 space-y-1 list-disc list-inside">
                {shortSessions.length > 0 && <li>{shortSessions.length} session(s) under 60s (likely crash)</li>}
                {skipSessions.length > 0 && <li>{skipSessions.length} session(s) operator-skipped to main</li>}
                {stuckSessions.length > 0 && <li>{stuckSessions.length} session(s) started but never reached ExperienceMain</li>}
              </ul>
            </div>
          )}

          {/* Session History — expandable rows */}
          <div className="card overflow-x-auto">
            <h2 className="text-sm font-semibold text-gray-400 mb-1">Session History</h2>
            <p className="text-xs text-gray-600 mb-3">Click a row to expand stage timeline and calibration details</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-800">
                  <th className="text-left pb-2 w-4"></th>
                  <th className="text-left pb-2 pr-4">Date</th>
                  <th className="text-right pb-2 pr-4">Duration</th>
                  <th className="text-left pb-2 pr-4">Outcome</th>
                  <th className="text-left pb-2 pr-4">Calibration</th>
                  <th className="text-left pb-2 pr-4">Experience</th>
                  <th className="text-left pb-2">Lang</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const label = getOutcomeLabel(s)
                  const isExpanded = expandedSessions.has(s.session_id)
                  const sessionCals = calBySession[s.session_id] ?? []
                  const sessionStages = eventsBySession[s.session_id] ?? []

                  return (
                    <>
                      <tr
                        key={s.session_id}
                        className="border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer"
                        onClick={() => toggleSession(s.session_id)}
                      >
                        <td className="py-1.5 pr-2 text-gray-600 text-xs select-none">
                          {isExpanded ? '▼' : '▶'}
                        </td>
                        <td className="py-1.5 pr-4 text-xs text-gray-400 whitespace-nowrap">
                          {msToLabel(s.started_at)}
                        </td>
                        <td className="py-1.5 pr-4 text-right font-mono text-xs">
                          {secondsToHMS(s.duration_seconds)}
                          {s.duration_seconds < 60 && !s.was_completed && (
                            <span className="ml-1 text-red-400 text-[10px]">!</span>
                          )}
                        </td>
                        <td className={`py-1.5 pr-4 text-xs ${getOutcomeColor(label)}`}>{label}</td>
                        <td className="py-1.5 pr-4 text-xs">
                          {sessionCals.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {sessionCals.map((c) => (
                                <span
                                  key={c.event_id}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
                                  style={{
                                    background: `${METHOD_COLOR[c.calibration_method ?? ''] ?? '#374151'}22`,
                                    color: METHOD_COLOR[c.calibration_method ?? ''] ?? '#9ca3af',
                                    border: `1px solid ${METHOD_COLOR[c.calibration_method ?? ''] ?? '#374151'}44`,
                                  }}
                                >
                                  {METHOD_LABEL[c.calibration_method ?? ''] ?? c.calibration_method ?? '?'}
                                  {c.scan_meshes !== null && (
                                    <span className={`font-mono ${meshColor(c.scan_meshes)}`}>
                                      {c.scan_meshes}⬡
                                    </span>
                                  )}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>
                        <td className="py-1.5 pr-4 text-xs text-gray-500 truncate max-w-[140px]">
                          {s.experience_id}
                        </td>
                        <td className="py-1.5 text-xs text-gray-500">{s.language}</td>
                      </tr>

                      {/* Expanded detail row */}
                      {isExpanded && (
                        <tr key={`${s.session_id}-expanded`} className="border-b border-gray-800/50">
                          <td colSpan={7} className="pb-3 pt-1 px-4 bg-gray-900/40">
                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-2">

                              {/* Stage timeline */}
                              <div>
                                <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1.5">
                                  Stage Timeline
                                </p>
                                {sessionStages.length > 0 ? (
                                  <div className="space-y-0.5">
                                    {sessionStages.map((e) => {
                                      const isRecal = e.timelineType === 'recalibration'
                                      return (
                                        <div key={e.event_id} className="flex items-center gap-2 text-xs">
                                          <span className="text-gray-600 w-28 shrink-0 text-[10px]">
                                            {msToLabel(e.transitioned_at)}
                                          </span>
                                          <span className={isRecal ? 'text-purple-300' : 'text-gray-400'}>
                                            {e.stage_from}
                                          </span>
                                          <span className="text-gray-600">→</span>
                                          <span className={isRecal ? 'text-purple-200 font-medium' : 'text-gray-200'}>
                                            {e.stage_to}
                                          </span>
                                          {e.stage_duration_ms != null && (
                                            <span className="text-gray-600 text-[10px] font-mono">
                                              {e.stage_duration_ms < 1000
                                                ? `${e.stage_duration_ms}ms`
                                                : `${(e.stage_duration_ms / 1000).toFixed(1)}s`}
                                            </span>
                                          )}
                                          {isRecal && (
                                            <span className="text-purple-400 text-[10px]">[recal]</span>
                                          )}
                                          {e.was_operator_triggered === 1 && (
                                            <span className="text-yellow-500 text-[10px]">[op]</span>
                                          )}
                                        </div>
                                      )
                                    })}
                                  </div>
                                ) : (
                                  <p className="text-xs text-gray-600">No stage events recorded</p>
                                )}
                              </div>

                              {/* Calibration events during session */}
                              <div>
                                <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1.5">
                                  Calibration Confirms
                                </p>
                                {sessionCals.length > 0 ? (
                                  <div className="space-y-1.5">
                                    {sessionCals.map((c) => (
                                      <div key={c.event_id} className="flex items-center gap-3 text-xs">
                                        <span className="text-gray-600 text-[10px] w-28 shrink-0">
                                          {msToLabel(c.received_at)}
                                        </span>
                                        <span
                                          className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                                          style={{
                                            background: `${METHOD_COLOR[c.calibration_method ?? ''] ?? '#374151'}22`,
                                            color: METHOD_COLOR[c.calibration_method ?? ''] ?? '#9ca3af',
                                            border: `1px solid ${METHOD_COLOR[c.calibration_method ?? ''] ?? '#374151'}44`,
                                          }}
                                        >
                                          {METHOD_LABEL[c.calibration_method ?? ''] ?? c.calibration_method ?? 'Unknown'}
                                        </span>
                                        {c.scan_meshes !== null && (
                                          <span className={`font-mono font-semibold text-xs ${meshColor(c.scan_meshes)}`}>
                                            {c.scan_meshes} meshes
                                          </span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-xs text-gray-600">No calibration confirms in this session</p>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Calibration History card */}
          {(calibrationEvents.length > 0 || unlinkedCal.length > 0) && (
            <div className="card">
              <h2 className="text-sm font-semibold text-gray-400 mb-1">Calibration History</h2>
              <p className="text-xs text-gray-600 mb-4">All calibration confirms for this device</p>

              {/* Summary row */}
              <div className="flex flex-wrap gap-6 mb-4 pb-4 border-b border-gray-800">
                <div>
                  <p className="text-xs text-gray-500">Total Confirms</p>
                  <p className="text-lg font-bold text-white">{totalConfirms}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Avg Scan Meshes</p>
                  <p className={`text-lg font-bold font-mono ${meshColor(avgMeshes)}`}>
                    {avgMeshes !== null ? avgMeshes.toFixed(1) : '—'}
                  </p>
                </div>
                {topMethod && (
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Top Method</p>
                    <span
                      className="px-2 py-0.5 rounded text-xs font-medium"
                      style={{
                        background: `${METHOD_COLOR[topMethod] ?? '#374151'}22`,
                        color: METHOD_COLOR[topMethod] ?? '#9ca3af',
                        border: `1px solid ${METHOD_COLOR[topMethod] ?? '#374151'}44`,
                      }}
                    >
                      {METHOD_LABEL[topMethod] ?? topMethod}
                    </span>
                  </div>
                )}
                <div>
                  <p className="text-xs text-gray-500">Method Breakdown</p>
                  <div className="flex gap-2 mt-1">
                    {Object.entries(methodCounts).sort((a, b) => b[1] - a[1]).map(([m, count]) => (
                      <span key={m} className="text-xs text-gray-400">
                        <span
                          className="inline-block w-2 h-2 rounded-sm mr-1"
                          style={{ background: METHOD_COLOR[m] ?? '#6b7280' }}
                        />
                        {METHOD_LABEL[m] ?? m}: {count}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Calibration events table */}
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-800">
                    <th className="text-left pb-2 pr-4">Date / Time</th>
                    <th className="text-left pb-2 pr-4">Method</th>
                    <th className="text-right pb-2 pr-4">Scan Meshes</th>
                    <th className="text-left pb-2 pr-4">Session</th>
                    <th className="text-left pb-2">App Version</th>
                  </tr>
                </thead>
                <tbody>
                  {calibrationEvents.map((c) => {
                    // Find which session this calibration belongs to
                    const linkedSession = sessions.find(
                      (s) => c.received_at >= s.started_at && c.received_at <= s.ended_at
                    )
                    return (
                      <tr key={c.event_id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                        <td className="py-1.5 pr-4 text-xs text-gray-400 whitespace-nowrap">
                          {msToLabel(c.received_at)}
                        </td>
                        <td className="py-1.5 pr-4">
                          <span
                            className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                            style={{
                              background: `${METHOD_COLOR[c.calibration_method ?? ''] ?? '#374151'}22`,
                              color: METHOD_COLOR[c.calibration_method ?? ''] ?? '#9ca3af',
                              border: `1px solid ${METHOD_COLOR[c.calibration_method ?? ''] ?? '#374151'}44`,
                            }}
                          >
                            {METHOD_LABEL[c.calibration_method ?? ''] ?? c.calibration_method ?? 'Unknown'}
                          </span>
                        </td>
                        <td className={`py-1.5 pr-4 text-right text-xs font-mono font-semibold ${meshColor(c.scan_meshes)}`}>
                          {c.scan_meshes !== null ? c.scan_meshes : '—'}
                        </td>
                        <td className="py-1.5 pr-4 text-xs">
                          {linkedSession ? (
                            <button
                              onClick={() => toggleSession(linkedSession.session_id)}
                              className="font-mono text-indigo-400 hover:text-indigo-300 text-[10px] text-left"
                            >
                              {linkedSession.session_id.slice(0, 16)}…
                            </button>
                          ) : (
                            <span className="text-gray-600 text-[10px]">—</span>
                          )}
                        </td>
                        <td className="py-1.5 text-xs text-gray-500 font-mono">
                          {c.app_version ?? '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Health Trends */}
          {health.length > 0 && (
            <div className="card">
              <h2 className="text-sm font-semibold text-gray-400 mb-4">Health Trends</h2>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={healthChartData}>
                  <XAxis dataKey="day" tick={{ fontSize: 9, fill: '#9ca3af' }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#9ca3af' }} />
                  <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="battery" stroke="#f59e0b" dot={false} strokeWidth={2} name="Battery %" />
                  <Line type="monotone" dataKey="wifi" stroke="#22d3ee" dot={false} strokeWidth={2} name="WiFi Strength" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  )
}
