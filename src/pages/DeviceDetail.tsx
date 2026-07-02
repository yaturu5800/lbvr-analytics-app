import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { supabase } from '../lib/supabase'
import { msToLabel, msToDay, pct, secondsToHMS, getOutcomeLabel, getOutcomeColor } from '../lib/utils'
import type { ExperienceSession, SessionStageEvent, DeviceHealthSnapshot } from '../types'
import MetricCard from '../components/MetricCard'

type DeviceTimelineEvent = SessionStageEvent & {
  timelineType: 'stage' | 'recalibration'
}

export default function DeviceDetail() {
  const { device_id } = useParams<{ device_id: string }>()
  const [sessions, setSessions] = useState<ExperienceSession[]>([])
  const [events, setEvents] = useState<SessionStageEvent[]>([])
  const [recalibrationEvents, setRecalibrationEvents] = useState<SessionStageEvent[]>([])
  const [health, setHealth] = useState<DeviceHealthSnapshot[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!device_id) return
    async function load() {
      setLoading(true)
      const [sessRes, evRes, recalRes, healthRes] = await Promise.all([
        supabase.from('experience_sessions').select('*').eq('device_id', device_id!).order('started_at', { ascending: false }),
        supabase.from('session_stage_events').select('*').eq('device_id', device_id!).order('transitioned_at', { ascending: true }),
        supabase.from('recalibration_events').select('*').eq('device_id', device_id!).order('transitioned_at', { ascending: true }),
        supabase.from('device_health_snapshots').select('*').eq('device_id', device_id!).order('captured_at', { ascending: true }),
      ])
      setSessions(sessRes.data ?? [])
      setEvents(evRes.data ?? [])
      setRecalibrationEvents(recalRes.data ?? [])
      setHealth(healthRes.data ?? [])
      setLoading(false)
    }
    load()
  }, [device_id])

  const completed = sessions.filter((s) => s.was_completed)
  const avgDuration = completed.length
    ? Math.round(completed.reduce((a, s) => a + s.duration_seconds, 0) / completed.length)
    : 0
  const lastSeen = sessions[0]?.started_at ?? 0

  const timelineEventsById = new Map<string, DeviceTimelineEvent>()
  for (const e of events) {
    timelineEventsById.set(e.event_id, { ...e, timelineType: 'stage' })
  }
  for (const e of recalibrationEvents) {
    timelineEventsById.set(e.event_id, { ...e, timelineType: 'recalibration' })
  }
  const timelineEvents = [...timelineEventsById.values()].sort((a, b) => a.transitioned_at - b.transitioned_at)

  // Group events by session
  const eventsBySession: Record<string, DeviceTimelineEvent[]> = {}
  for (const e of timelineEvents) {
    const key = e.session_id ?? `no-session-${e.event_id}`
    if (!eventsBySession[key]) eventsBySession[key] = []
    eventsBySession[key].push(e)
  }

  // Problem signals
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard label="Total Sessions" value={sessions.length} />
            <MetricCard label="Completion Rate" value={pct(completed.length, sessions.length)} color="text-green-400" />
            <MetricCard label="Avg Duration" value={avgDuration ? secondsToHMS(avgDuration) : '—'} />
            <MetricCard label="Last Seen" value={lastSeen ? msToLabel(lastSeen) : '—'} />
          </div>

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

          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 mb-3">Session History</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-800">
                    <th className="text-left pb-2">Date</th>
                    <th className="text-right pb-2">Duration</th>
                    <th className="text-left pb-2">Outcome</th>
                    <th className="text-left pb-2">Experience</th>
                    <th className="text-left pb-2">Lang</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => {
                    const label = getOutcomeLabel(s)
                    return (
                      <tr key={s.session_id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                        <td className="py-1.5 text-xs text-gray-400">{msToLabel(s.started_at)}</td>
                        <td className="py-1.5 text-right font-mono text-xs">
                          {secondsToHMS(s.duration_seconds)}
                          {s.duration_seconds < 60 && !s.was_completed && (
                            <span className="ml-1 text-red-400 text-[10px]">!</span>
                          )}
                        </td>
                        <td className={`py-1.5 text-xs ${getOutcomeColor(label)}`}>{label}</td>
                        <td className="py-1.5 text-xs text-gray-500 truncate max-w-[140px]">{s.experience_id}</td>
                        <td className="py-1.5 text-xs text-gray-500">{s.language}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {timelineEvents.length > 0 && (
            <div className="card">
              <h2 className="text-sm font-semibold text-gray-400 mb-3">Stage Event Timeline</h2>
              <div className="space-y-6 max-h-96 overflow-y-auto pr-2">
                {Object.entries(eventsBySession).map(([sessionId, evs]) => (
                  <div key={sessionId}>
                    <p className="text-xs text-gray-600 font-mono mb-1">session: {sessionId}</p>
                    <div className="space-y-1 ml-2">
                      {evs.map((e) => {
                        const isStart = e.stage_to === 'ExperienceStart'
                        const isRecalibration = e.timelineType === 'recalibration'
                        return (
                          <div key={e.event_id} className="flex items-start gap-2 text-xs">
                            <span className="text-gray-600 w-32 shrink-0">{msToLabel(e.transitioned_at)}</span>
                            <span className={isRecalibration ? 'text-purple-300' : 'text-gray-400'}>{e.stage_from}</span>
                            <span className="text-gray-600">→</span>
                            <span className={isRecalibration ? 'text-purple-200' : 'text-gray-200'}>{e.stage_to}</span>
                            {isRecalibration && (
                              <span className="text-purple-400 text-[10px]">[recalibration]</span>
                            )}
                            {e.was_operator_triggered === 1 && (
                              <span className="text-yellow-500 text-[10px]">[operator]</span>
                            )}
                            {isStart && e.position_x != null && (
                              <span className="text-cyan-500 text-[10px]">
                                pos ({e.position_x.toFixed(2)}, {e.position_z?.toFixed(2)})
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

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
