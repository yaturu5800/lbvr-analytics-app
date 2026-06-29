import { useEffect, useState } from 'react'
import { subDays } from 'date-fns'
import { Link } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, Cell,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { msToDay, msToLabel, pct } from '../lib/utils'
import type { SessionStageEvent } from '../types'
import MetricCard from '../components/MetricCard'
import DateRangePicker from '../components/DateRangePicker'
import FilterSelect from '../components/FilterSelect'
import EmptyState from '../components/EmptyState'

type RecalEvent = Pick<
  SessionStageEvent,
  | 'event_id'
  | 'device_id'
  | 'premise_id'
  | 'experience_id'
  | 'session_id'
  | 'transitioned_at'
  | 'stage_duration_ms'
  | 'was_operator_triggered'
>

const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, '0')}:00`)

export default function Recalibration() {
  const [events, setEvents] = useState<RecalEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [start, setStart] = useState(subDays(new Date(), 30))
  const [end, setEnd] = useState(new Date())
  const [premiseFilter, setPremiseFilter] = useState('')
  const [expFilter, setExpFilter] = useState('')

  useEffect(() => {
    async function load() {
      setLoading(true)
      let q = supabase
        .from('recalibration_events')
        .select(
          'event_id, device_id, premise_id, experience_id, session_id, transitioned_at, stage_duration_ms, was_operator_triggered'
        )
        .gte('transitioned_at', start.getTime())
        .lte('transitioned_at', end.getTime())
        .order('transitioned_at', { ascending: false })
        .limit(5000)
      if (premiseFilter) q = q.eq('premise_id', premiseFilter)
      if (expFilter) q = q.eq('experience_id', expFilter)
      const { data } = await q
      setEvents((data ?? []) as RecalEvent[])
      setLoading(false)
    }
    load()
  }, [start, end, premiseFilter, expFilter])

  const premises = [...new Set(events.map((e) => e.premise_id))].filter(Boolean)
  const experiences = [...new Set(events.map((e) => e.experience_id))].filter(Boolean)

  // ── Metrics ───────────────────────────────────────────────────────────────
  const total = events.length
  const operatorTriggered = events.filter((e) => e.was_operator_triggered === 1).length
  const devicesAffected = new Set(events.map((e) => e.device_id)).size
  const durationsMs = events.filter((e) => e.stage_duration_ms != null).map((e) => e.stage_duration_ms!)
  const avgDurationSec =
    durationsMs.length > 0
      ? (durationsMs.reduce((a, b) => a + b, 0) / durationsMs.length / 1000).toFixed(1)
      : '—'

  // ── Trend over time (by day) ──────────────────────────────────────────────
  const byDay: Record<string, number> = {}
  for (const e of events) {
    const day = msToDay(e.transitioned_at)
    byDay[day] = (byDay[day] ?? 0) + 1
  }
  const trendData = Object.entries(byDay)
    .map(([day, count]) => ({ day, Count: count }))
    .sort((a, b) => a.day.localeCompare(b.day))

  // ── By hour of day ────────────────────────────────────────────────────────
  const byHour: Record<number, number> = {}
  for (const e of events) {
    const h = new Date(e.transitioned_at).getHours()
    byHour[h] = (byHour[h] ?? 0) + 1
  }
  const hourData = Array.from({ length: 24 }, (_, h) => ({
    hour: HOUR_LABELS[h],
    Count: byHour[h] ?? 0,
  }))

  // ── Top offending devices ─────────────────────────────────────────────────
  const deviceCounts: Record<string, { count: number; durationSum: number; durationN: number }> = {}
  for (const e of events) {
    if (!deviceCounts[e.device_id]) deviceCounts[e.device_id] = { count: 0, durationSum: 0, durationN: 0 }
    deviceCounts[e.device_id].count++
    if (e.stage_duration_ms != null) {
      deviceCounts[e.device_id].durationSum += e.stage_duration_ms
      deviceCounts[e.device_id].durationN++
    }
  }
  const topDevicesData = Object.entries(deviceCounts)
    .map(([device, { count, durationSum, durationN }]) => ({
      device,
      Count: count,
      avgDuration: durationN > 0 ? +(durationSum / durationN / 1000).toFixed(1) : null,
    }))
    .sort((a, b) => b.Count - a.Count)
    .slice(0, 20)

  // ── Operator vs player per day ────────────────────────────────────────────
  const triggerByDay: Record<string, { operator: number; player: number }> = {}
  for (const e of events) {
    const day = msToDay(e.transitioned_at)
    if (!triggerByDay[day]) triggerByDay[day] = { operator: 0, player: 0 }
    if (e.was_operator_triggered === 1) triggerByDay[day].operator++
    else triggerByDay[day].player++
  }
  const triggerData = Object.entries(triggerByDay)
    .map(([day, { operator, player }]) => ({ day, Operator: operator, Player: player }))
    .sort((a, b) => a.day.localeCompare(b.day))

  // ── Recent events table ───────────────────────────────────────────────────
  const recentEvents = events.slice(0, 200)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-white mr-2">Recalibration</h1>
        <DateRangePicker start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e) }} />
        <FilterSelect options={premises} value={premiseFilter} onChange={setPremiseFilter} placeholder="All Premises" />
        <FilterSelect options={experiences} value={expFilter} onChange={setExpFilter} placeholder="All Experiences" />
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard label="Total Recalibrations" value={total} color="text-purple-400" />
            <MetricCard
              label="Avg Duration"
              value={avgDurationSec === '—' ? '—' : `${avgDurationSec}s`}
              color="text-purple-400"
            />
            <MetricCard label="Devices Affected" value={devicesAffected} color="text-yellow-400" />
            <MetricCard
              label="Operator-Triggered"
              value={pct(operatorTriggered, total)}
              color="text-orange-400"
              sub={`${operatorTriggered} of ${total}`}
            />
          </div>

          {total === 0 ? (
            <EmptyState message="No recalibration events in this date range" />
          ) : (
            <>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {/* Trend over time */}
                <div className="card">
                  <h2 className="text-sm font-semibold text-gray-400 mb-1">Daily Recalibrations</h2>
                  <p className="text-xs text-gray-600 mb-4">Count per day over the selected period</p>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={trendData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                      <XAxis dataKey="day" tick={{ fontSize: 9, fill: '#9ca3af' }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} allowDecimals={false} />
                      <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }} />
                      <Bar dataKey="Count" fill="#a855f7" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* By hour of day */}
                <div className="card">
                  <h2 className="text-sm font-semibold text-gray-400 mb-1">By Hour of Day</h2>
                  <p className="text-xs text-gray-600 mb-4">Identify problematic time windows</p>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={hourData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                      <XAxis dataKey="hour" tick={{ fontSize: 8, fill: '#9ca3af' }} interval={1} />
                      <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} allowDecimals={false} />
                      <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }} />
                      <Bar dataKey="Count" radius={[3, 3, 0, 0]}>
                        {hourData.map((entry, i) => (
                          <Cell
                            key={i}
                            fill={entry.Count >= Math.max(...hourData.map((d) => d.Count)) * 0.75 ? '#f97316' : '#a855f7'}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Top offending devices */}
                <div className="card">
                  <h2 className="text-sm font-semibold text-gray-400 mb-1">Top Offending Devices</h2>
                  <p className="text-xs text-gray-600 mb-4">Sorted by recalibration count — top 20</p>
                  <ResponsiveContainer width="100%" height={Math.max(180, topDevicesData.length * 30)}>
                    <BarChart data={topDevicesData} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 80 }}>
                      <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} allowDecimals={false} />
                      <YAxis type="category" dataKey="device" tick={{ fontSize: 9, fill: '#9ca3af' }} width={76} />
                      <Tooltip
                        contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }}
                        formatter={(value, _name, props) => [
                          props.payload.avgDuration != null
                            ? `${value} events (avg ${props.payload.avgDuration}s)`
                            : `${value} events`,
                          'Recalibrations',
                        ]}
                      />
                      <Bar dataKey="Count" fill="#a855f7" radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Operator vs player per day */}
                <div className="card">
                  <h2 className="text-sm font-semibold text-gray-400 mb-1">Operator vs. Player Triggered</h2>
                  <p className="text-xs text-gray-600 mb-4">Daily breakdown by who initiated recalibration</p>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={triggerData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                      <XAxis dataKey="day" tick={{ fontSize: 9, fill: '#9ca3af' }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} allowDecimals={false} />
                      <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="Operator" stackId="a" fill="#f97316" />
                      <Bar dataKey="Player" stackId="a" fill="#a855f7" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Recent events table */}
              <div className="card overflow-x-auto">
                <h2 className="text-sm font-semibold text-gray-400 mb-1">Recent Events</h2>
                <p className="text-xs text-gray-600 mb-4">
                  Most recent {recentEvents.length} of {total} recalibration events
                </p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b border-gray-800">
                      <th className="text-left pb-2 pr-4">Timestamp</th>
                      <th className="text-left pb-2 pr-4">Device</th>
                      <th className="text-left pb-2 pr-4">Experience</th>
                      <th className="text-right pb-2 pr-4">Duration</th>
                      <th className="text-left pb-2">Triggered by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentEvents.map((e) => (
                      <tr key={e.event_id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                        <td className="py-2 pr-4 text-xs text-gray-400">{msToLabel(e.transitioned_at)}</td>
                        <td className="py-2 pr-4">
                          <Link
                            to={`/devices/${e.device_id}`}
                            className="font-mono text-indigo-400 hover:text-indigo-300 text-xs"
                          >
                            {e.device_id}
                          </Link>
                        </td>
                        <td className="py-2 pr-4 text-xs text-gray-300">{e.experience_id ?? '—'}</td>
                        <td className="py-2 pr-4 text-right text-xs text-gray-300">
                          {e.stage_duration_ms != null ? `${(e.stage_duration_ms / 1000).toFixed(1)}s` : '—'}
                        </td>
                        <td className="py-2 text-xs">
                          {e.was_operator_triggered === 1 ? (
                            <span className="text-orange-400">Operator</span>
                          ) : (
                            <span className="text-purple-400">Player</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
