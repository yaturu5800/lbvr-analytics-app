import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { msToLabel } from '../lib/utils'
import type { ExperienceSession, SessionStageEvent, DeviceHealthSnapshot } from '../types'

type Severity = 'high' | 'medium' | 'low'

interface Issue {
  id: string
  severity: Severity
  device_id: string
  description: string
  timestamp: number
}

export default function ProblemDetection() {
  const [issues, setIssues] = useState<Issue[]>([])
  const [loading, setLoading] = useState(true)
  const [severityFilter, setSeverityFilter] = useState<Severity | 'all'>('all')

  useEffect(() => {
    async function load() {
      setLoading(true)
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
      const dayAgo = Date.now() - 24 * 60 * 60 * 1000

      const [sessRes, evRes, healthRes] = await Promise.all([
        supabase
          .from('experience_sessions')
          .select('session_id, device_id, duration_seconds, was_completed, was_skipped_to_main, started_at, premise_id')
          .gte('started_at', cutoff),
        supabase
          .from('session_stage_events')
          .select('*')
          .gte('transitioned_at', cutoff),
        supabase
          .from('device_health_snapshots')
          .select('device_id, captured_at, battery_level, device_state')
          .gte('captured_at', cutoff),
      ])

      const sessions: Pick<ExperienceSession, 'session_id' | 'device_id' | 'duration_seconds' | 'was_completed' | 'was_skipped_to_main' | 'started_at'>[] = sessRes.data ?? []
      const events: SessionStageEvent[] = evRes.data ?? []
      const health: Pick<DeviceHealthSnapshot, 'device_id' | 'captured_at' | 'battery_level' | 'device_state'>[] = healthRes.data ?? []

      const found: Issue[] = []

      // High: short crash sessions
      for (const s of sessions) {
        if (!s.was_completed && s.duration_seconds < 60) {
          found.push({
            id: `crash-${s.session_id}`,
            severity: 'high',
            device_id: s.device_id,
            description: `Session under 60s (${s.duration_seconds}s) — likely crash`,
            timestamp: s.started_at,
          })
        }
      }

      // Medium: stuck in pre-experience > 20 min (health snapshots show PreExperience state for consecutive readings)
      const healthByDevice: Record<string, typeof health> = {}
      for (const h of health) {
        if (!healthByDevice[h.device_id]) healthByDevice[h.device_id] = []
        healthByDevice[h.device_id].push(h)
      }
      for (const [device, snaps] of Object.entries(healthByDevice)) {
        const preExSnaps = snaps
          .filter((s) => s.device_state === 'PreExperience')
          .sort((a, b) => a.captured_at - b.captured_at)
        if (preExSnaps.length >= 2) {
          const span = preExSnaps[preExSnaps.length - 1].captured_at - preExSnaps[0].captured_at
          if (span > 20 * 60 * 1000) {
            found.push({
              id: `pre-stuck-${device}`,
              severity: 'medium',
              device_id: device,
              description: `Stuck in PreExperience for ${Math.round(span / 60000)} min`,
              timestamp: preExSnaps[preExSnaps.length - 1].captured_at,
            })
          }
        }
      }

      // Medium: never reached ExperienceMain after ExperienceStart
      const startedSessions = new Set(events.filter((e) => e.stage_to === 'ExperienceStart').map((e) => e.session_id))
      const reachedMain = new Set(events.filter((e) => e.stage_to === 'ExperienceMain').map((e) => e.session_id))
      for (const e of events.filter((e) => e.stage_to === 'ExperienceStart')) {
        if (!reachedMain.has(e.session_id)) {
          found.push({
            id: `no-main-${e.event_id}`,
            severity: 'medium',
            device_id: e.device_id,
            description: `Entered ExperienceStart but never reached ExperienceMain`,
            timestamp: e.transitioned_at,
          })
        }
      }
      void startedSessions

      // Medium: repeated skip-to-main (>2 in one day)
      const skipsByDeviceDay: Record<string, number> = {}
      for (const s of sessions) {
        if (s.was_skipped_to_main === 1) {
          const day = new Date(s.started_at).toDateString()
          const key = `${s.device_id}|${day}`
          skipsByDeviceDay[key] = (skipsByDeviceDay[key] ?? 0) + 1
        }
      }
      for (const [key, count] of Object.entries(skipsByDeviceDay)) {
        if (count > 2) {
          const [device] = key.split('|')
          found.push({
            id: `repeated-skip-${key}`,
            severity: 'medium',
            device_id: device,
            description: `${count} skip-to-main events in one day`,
            timestamp: Date.now(),
          })
        }
      }

      // Low: low battery during ExperienceMain
      const mainSnaps = events.filter((e) => e.stage_to === 'ExperienceMain')
      const mainEndSnaps = events.filter((e) =>
        e.stage_to === 'ExperienceEnd' || e.stage_to === 'ExpereinceEnd' || e.stage_to === 'ready'
      )
      for (const h of health) {
        if (h.battery_level < 15) {
          const duringMain = mainSnaps.some((e) => {
            const end = mainEndSnaps.find((e2) => e2.device_id === e.device_id && e2.transitioned_at > e.transitioned_at)
            return (
              e.device_id === h.device_id &&
              h.captured_at >= e.transitioned_at &&
              (!end || h.captured_at <= end.transitioned_at)
            )
          })
          if (duringMain) {
            found.push({
              id: `battery-${h.device_id}-${h.captured_at}`,
              severity: 'low',
              device_id: h.device_id,
              description: `Battery at ${h.battery_level}% during ExperienceMain`,
              timestamp: h.captured_at,
            })
          }
        }
      }

      found.sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2 }
        if (order[a.severity] !== order[b.severity]) return order[a.severity] - order[b.severity]
        return b.timestamp - a.timestamp
      })

      setIssues(found)
      setLoading(false)
    }
    load()
  }, [])

  const filtered = severityFilter === 'all' ? issues : issues.filter((i) => i.severity === severityFilter)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-white mr-2">Problem Detection</h1>
        <span className="text-xs text-gray-500">Last 7 days</span>
        <div className="flex gap-1 ml-2">
          {(['all', 'high', 'medium', 'low'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSeverityFilter(s)}
              className={`text-xs px-2.5 py-1 rounded transition-colors ${
                severityFilter === s
                  ? s === 'high' ? 'bg-red-700 text-white'
                    : s === 'medium' ? 'bg-yellow-700 text-white'
                    : s === 'low' ? 'bg-blue-700 text-white'
                    : 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
              {s !== 'all' && ` (${issues.filter((i) => i.severity === s).length})`}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm">Analysing data…</p>
      ) : filtered.length === 0 ? (
        <div className="card text-center text-gray-500 py-12">
          <span className="text-3xl block mb-2">✅</span>
          No issues detected in the last 7 days.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-800">
                <th className="text-left pb-2 w-20">Severity</th>
                <th className="text-left pb-2 w-24">Device</th>
                <th className="text-left pb-2">Description</th>
                <th className="text-left pb-2 w-40">Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((issue) => (
                <tr key={issue.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="py-2">
                    <span className={`badge-${issue.severity}`}>{issue.severity}</span>
                  </td>
                  <td className="py-2">
                    <Link to={`/devices/${issue.device_id}`} className="font-mono text-indigo-400 hover:text-indigo-300 text-xs">
                      {issue.device_id}
                    </Link>
                  </td>
                  <td className="py-2 text-gray-300 text-xs">{issue.description}</td>
                  <td className="py-2 text-xs text-gray-500">{msToLabel(issue.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
