import { useEffect, useState } from 'react'
import { subDays } from 'date-fns'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { msToDay, msToLabel, pct, secondsToHMS, getOutcomeLabel, getOutcomeColor } from '../lib/utils'
import type { ExperienceSession } from '../types'
import MetricCard from '../components/MetricCard'
import DateRangePicker from '../components/DateRangePicker'
import EmptyState from '../components/EmptyState'

const OUTCOME_COLORS: Record<string, string> = {
  Natural: '#22c55e',
  'Skip→Done': '#3b82f6',
  'Operator Ended': '#f59e0b',
  Failure: '#ef4444',
}

export default function CompletionRates() {
  const [sessions, setSessions] = useState<ExperienceSession[]>([])
  const [loading, setLoading] = useState(true)
  const [start, setStart] = useState(subDays(new Date(), 30))
  const [end, setEnd] = useState(new Date())

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('experience_sessions')
        .select('*')
        .gte('started_at', start.getTime())
        .lte('started_at', end.getTime())
        .order('started_at', { ascending: false })
      setSessions(data ?? [])
      setLoading(false)
    }
    load()
  }, [start, end])

  const failed = sessions.filter((s) => !s.was_completed && s.was_operator_ended === 0)
  const completed = sessions.filter((s) => s.was_completed)

  // By day
  const dayMap: Record<string, { total: number; completed: number }> = {}
  for (const s of sessions) {
    const day = msToDay(s.started_at)
    if (!dayMap[day]) dayMap[day] = { total: 0, completed: 0 }
    dayMap[day].total++
    if (s.was_completed) dayMap[day].completed++
  }
  const byDayData = Object.entries(dayMap)
    .map(([day, { total, completed }]) => ({
      day, rate: total ? +(completed / total * 100).toFixed(1) : 0,
    }))
    .sort((a, b) => a.day.localeCompare(b.day))

  // By device
  const deviceMap: Record<string, { total: number; completed: number }> = {}
  for (const s of sessions) {
    if (!deviceMap[s.device_id]) deviceMap[s.device_id] = { total: 0, completed: 0 }
    deviceMap[s.device_id].total++
    if (s.was_completed) deviceMap[s.device_id].completed++
  }
  const byDeviceData = Object.entries(deviceMap)
    .map(([device, { total, completed }]) => ({
      device, rate: total ? +(completed / total * 100).toFixed(1) : 0,
    }))
    .sort((a, b) => a.rate - b.rate)

  // Outcome stacked by day
  const outcomeByDay: Record<string, Record<string, number>> = {}
  for (const s of sessions) {
    const day = msToDay(s.started_at)
    const label = getOutcomeLabel(s)
    if (!outcomeByDay[day]) outcomeByDay[day] = {}
    outcomeByDay[day][label] = (outcomeByDay[day][label] ?? 0) + 1
  }
  const stackedData = Object.entries(outcomeByDay)
    .map(([day, outcomes]) => ({ day, ...outcomes }))
    .sort((a, b) => a.day.localeCompare(b.day))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-white mr-2">Completion Rates</h1>
        <DateRangePicker start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e) }} />
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard label="Total Sessions" value={sessions.length} />
            <MetricCard label="Completed" value={completed.length} color="text-green-400" />
            <MetricCard label="Completion Rate" value={pct(completed.length, sessions.length)} color="text-green-400" />
            <MetricCard label="Failures" value={failed.length} color="text-red-400" sub="incomplete, not operator-ended" />
          </div>

          {sessions.length === 0 ? (
            <EmptyState message="No sessions in this date range" />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="card">
                <h2 className="text-sm font-semibold text-gray-400 mb-4">Completion Rate by Day</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={byDayData}>
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                    <YAxis unit="%" domain={[0, 100]} tick={{ fontSize: 10, fill: '#9ca3af' }} />
                    <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }} formatter={(v) => `${v}%`} />
                    <Line type="monotone" dataKey="rate" stroke="#22d3ee" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="card">
                <h2 className="text-sm font-semibold text-gray-400 mb-4">Completion Rate by Device (ascending)</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={byDeviceData}>
                    <XAxis dataKey="device" tick={{ fontSize: 9, fill: '#9ca3af' }} />
                    <YAxis unit="%" domain={[0, 100]} tick={{ fontSize: 10, fill: '#9ca3af' }} />
                    <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }} formatter={(v) => `${v}%`} />
                    <Bar dataKey="rate" fill="#6366f1" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="card lg:col-span-2">
                <h2 className="text-sm font-semibold text-gray-400 mb-4">Session Outcomes per Day (stacked)</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={stackedData}>
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} />
                    <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {['Natural', 'Skip→Done', 'Operator Ended', 'Failure'].map((k) => (
                      <Bar key={k} dataKey={k} stackId="a" fill={OUTCOME_COLORS[k]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {failed.length > 0 && (
            <div className="card">
              <h2 className="text-sm font-semibold text-gray-400 mb-3">Incomplete Sessions</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b border-gray-800">
                      <th className="text-left pb-2">Device</th>
                      <th className="text-left pb-2">Started</th>
                      <th className="text-right pb-2">Duration</th>
                      <th className="text-left pb-2">Outcome</th>
                      <th className="text-left pb-2">Experience</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions
                      .filter((s) => !s.was_completed)
                      .slice(0, 100)
                      .map((s) => {
                        const label = getOutcomeLabel(s)
                        const isCrash = s.duration_seconds < 60
                        return (
                          <tr key={s.session_id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                            <td className="py-1.5 font-mono text-xs">{s.device_id}</td>
                            <td className="py-1.5 text-gray-400 text-xs">{msToLabel(s.started_at)}</td>
                            <td className="py-1.5 text-right font-mono text-xs">
                              {secondsToHMS(s.duration_seconds)}
                              {isCrash && <span className="ml-1 text-red-400 text-[10px]">crash?</span>}
                            </td>
                            <td className={`py-1.5 text-xs ${getOutcomeColor(label)}`}>{label}</td>
                            <td className="py-1.5 text-xs text-gray-500 truncate max-w-[140px]">{s.experience_id}</td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
