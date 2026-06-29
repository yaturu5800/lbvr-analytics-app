import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { msToLabel } from '../lib/utils'
import type { ExperienceSession, SessionStageEvent, DeviceHealthSnapshot } from '../types'

interface DeviceProblemSummary {
  device_id: string
  recalibrations: number
  wrongLocations: number
  crashes: number
  lastSeen: number
  total: number
}

function countColor(n: number, warnAt: number, errorAt: number): string {
  if (n >= errorAt) return 'text-red-400 font-semibold'
  if (n >= warnAt) return 'text-yellow-400 font-semibold'
  return 'text-gray-400'
}

export default function ProblemDetection() {
  const [devices, setDevices] = useState<DeviceProblemSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000

      const [sessRes, evRes] = await Promise.all([
        supabase
          .from('experience_sessions')
          .select('session_id, device_id, duration_seconds, was_completed, was_wrong_location, started_at')
          .gte('started_at', cutoff),
        supabase
          .from('session_stage_events')
          .select('event_id, device_id, stage_from, stage_duration_ms, transitioned_at')
          .gte('transitioned_at', cutoff),
      ])

      const sessions: Pick<ExperienceSession, 'session_id' | 'device_id' | 'duration_seconds' | 'was_completed' | 'was_wrong_location' | 'started_at'>[] = sessRes.data ?? []
      const events: Pick<SessionStageEvent, 'event_id' | 'device_id' | 'stage_from' | 'stage_duration_ms' | 'transitioned_at'>[] = evRes.data ?? []

      const map: Record<string, DeviceProblemSummary> = {}

      function get(id: string): DeviceProblemSummary {
        if (!map[id]) map[id] = { device_id: id, recalibrations: 0, wrongLocations: 0, crashes: 0, lastSeen: 0, total: 0 }
        return map[id]
      }

      for (const s of sessions) {
        const d = get(s.device_id)
        if (s.started_at > d.lastSeen) d.lastSeen = s.started_at
        if (!s.was_completed && s.duration_seconds < 60) d.crashes++
        if (s.was_wrong_location === 1) d.wrongLocations++
      }

      for (const e of events) {
        const d = get(e.device_id)
        if (e.transitioned_at > d.lastSeen) d.lastSeen = e.transitioned_at
        if (
          (e.stage_from === 'Calibration' || e.stage_from === 'calibrating') &&
          e.stage_duration_ms != null &&
          e.stage_duration_ms > 5000
        ) {
          d.recalibrations++
        }
      }

      const result = Object.values(map)
        .map((d) => ({ ...d, total: d.recalibrations + d.wrongLocations + d.crashes }))
        .filter((d) => d.total > 0)
        .sort((a, b) => b.total - a.total)

      setDevices(result)
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-white mr-2">Problematic Devices</h1>
        <span className="text-xs text-gray-500">Last 7 days</span>
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm">Analysing data…</p>
      ) : devices.length === 0 ? (
        <div className="card text-center text-gray-500 py-12">
          No device problems detected in the last 7 days.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-800">
                <th className="text-left pb-2">Device</th>
                <th className="text-right pb-2 pr-6">Recalibrations</th>
                <th className="text-right pb-2 pr-6">Wrong Locations</th>
                <th className="text-right pb-2 pr-6">Crashes</th>
                <th className="text-left pb-2">Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.device_id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="py-2.5">
                    <Link to={`/devices/${d.device_id}`} className="font-mono text-indigo-400 hover:text-indigo-300 text-xs">
                      {d.device_id}
                    </Link>
                  </td>
                  <td className={`py-2.5 text-right pr-6 text-sm tabular-nums ${countColor(d.recalibrations, 3, 6)}`}>
                    {d.recalibrations}
                  </td>
                  <td className={`py-2.5 text-right pr-6 text-sm tabular-nums ${countColor(d.wrongLocations, 2, 5)}`}>
                    {d.wrongLocations}
                  </td>
                  <td className={`py-2.5 text-right pr-6 text-sm tabular-nums ${countColor(d.crashes, 1, 3)}`}>
                    {d.crashes}
                  </td>
                  <td className="py-2.5 text-xs text-gray-500">{d.lastSeen ? msToLabel(d.lastSeen) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
