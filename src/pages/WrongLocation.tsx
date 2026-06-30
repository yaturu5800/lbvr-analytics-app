import { useEffect, useState } from 'react'
import { subDays } from 'date-fns'
import { Link } from 'react-router-dom'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, LabelList,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { msToDay, pct } from '../lib/utils'
import type { ExperienceSession } from '../types'
import MetricCard from '../components/MetricCard'
import DateRangePicker from '../components/DateRangePicker'
import FilterSelect from '../components/FilterSelect'
import EmptyState from '../components/EmptyState'

type SessionRow = Pick<
  ExperienceSession,
  'session_id' | 'device_id' | 'premise_id' | 'experience_id' | 'started_at' | 'was_wrong_location' | 'duration_seconds'
>

export default function WrongLocation() {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [start, setStart] = useState(subDays(new Date(), 30))
  const [end, setEnd] = useState(new Date())
  const [premiseFilter, setPremiseFilter] = useState('')
  const [expFilter, setExpFilter] = useState('')
  const [minDuration, setMinDuration] = useState('')
  const [maxDuration, setMaxDuration] = useState('')

  useEffect(() => {
    async function load() {
      setLoading(true)
      let q = supabase
        .from('experience_sessions')
        .select('session_id, device_id, premise_id, experience_id, started_at, was_wrong_location, duration_seconds')
        .gte('started_at', start.getTime())
        .lte('started_at', end.getTime())
        .order('started_at', { ascending: false })
      if (premiseFilter) q = q.eq('premise_id', premiseFilter)
      if (expFilter) q = q.eq('experience_id', expFilter)
      const { data } = await q
      setSessions((data ?? []) as SessionRow[])
      setLoading(false)
    }
    load()
  }, [start, end, premiseFilter, expFilter])

  const premises = [...new Set(sessions.map((s) => s.premise_id))].filter(Boolean)
  const experiences = [...new Set(sessions.map((s) => s.experience_id))].filter(Boolean)

  const minDurSec = minDuration !== '' ? Number(minDuration) : null
  const maxDurSec = maxDuration !== '' ? Number(maxDuration) : null
  const filteredSessions = sessions.filter((s) => {
    if (minDurSec !== null && (s.duration_seconds == null || s.duration_seconds < minDurSec)) return false
    if (maxDurSec !== null && (s.duration_seconds == null || s.duration_seconds > maxDurSec)) return false
    return true
  })
  const durationFilterActive = minDuration !== '' || maxDuration !== ''

  const wrongSessions = filteredSessions.filter((s) => s.was_wrong_location === 1)

  // ── Trend over time ──────────────────────────────────────────────────────────
  const byDay: Record<string, { total: number; wrong: number }> = {}
  for (const s of filteredSessions) {
    const day = msToDay(s.started_at)
    if (!byDay[day]) byDay[day] = { total: 0, wrong: 0 }
    byDay[day].total++
    if (s.was_wrong_location === 1) byDay[day].wrong++
  }
  const trendData = Object.entries(byDay)
    .map(([day, { total, wrong }]) => ({
      day,
      Count: wrong,
      'Rate %': total ? +(wrong / total * 100).toFixed(1) : 0,
    }))
    .sort((a, b) => a.day.localeCompare(b.day))

  // ── Rate by device ───────────────────────────────────────────────────────────
  const deviceMap: Record<string, { total: number; wrong: number }> = {}
  for (const s of filteredSessions) {
    if (!deviceMap[s.device_id]) deviceMap[s.device_id] = { total: 0, wrong: 0 }
    deviceMap[s.device_id].total++
    if (s.was_wrong_location === 1) deviceMap[s.device_id].wrong++
  }
  const byDeviceData = Object.entries(deviceMap)
    .filter(([, { total }]) => total >= 3)
    .map(([device, { total, wrong }]) => ({
      device,
      'Rate %': total ? +(wrong / total * 100).toFixed(1) : 0,
      wrong,
      total,
    }))
    .sort((a, b) => b['Rate %'] - a['Rate %'])

  // ── Repeat offenders (same device, same day, >1 wrong-location event) ────────
  const deviceDayMap: Record<string, { wrong: number; total: number }> = {}
  for (const s of filteredSessions) {
    const key = `${s.device_id}|${msToDay(s.started_at)}`
    if (!deviceDayMap[key]) deviceDayMap[key] = { wrong: 0, total: 0 }
    deviceDayMap[key].total++
    if (s.was_wrong_location === 1) deviceDayMap[key].wrong++
  }
  const repeatOffenders = Object.entries(deviceDayMap)
    .filter(([, { wrong }]) => wrong > 1)
    .map(([key, { wrong, total }]) => {
      const [device, date] = key.split('|')
      return { device, date, wrong, total }
    })
    .sort((a, b) => b.wrong - a.wrong || b.date.localeCompare(a.date))

  const repeatOffenderPairCount = repeatOffenders.length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-white mr-2">Wrong Location</h1>
        <DateRangePicker start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e) }} />
        <FilterSelect options={premises} value={premiseFilter} onChange={setPremiseFilter} placeholder="All Premises" />
        <FilterSelect options={experiences} value={expFilter} onChange={setExpFilter} placeholder="All Experiences" />
        <div
          className="flex items-center gap-1 text-xs text-gray-400"
          title="Filter by session duration to exclude outliers (e.g. set max=30 to remove instant resets, min=60 to remove very short sessions)"
        >
          <span>Duration (s):</span>
          <input
            type="number"
            min={0}
            placeholder="min"
            value={minDuration}
            onChange={(e) => setMinDuration(e.target.value)}
            className="w-16 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white text-xs"
          />
          <span>–</span>
          <input
            type="number"
            min={0}
            placeholder="max"
            value={maxDuration}
            onChange={(e) => setMaxDuration(e.target.value)}
            className="w-16 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white text-xs"
          />
          {durationFilterActive && (
            <button
              onClick={() => { setMinDuration(''); setMaxDuration('') }}
              className="text-gray-500 hover:text-gray-300 ml-1"
              title="Clear duration filter"
            >✕</button>
          )}
        </div>
      </div>

      {durationFilterActive && (
        <div className="text-xs text-indigo-400 bg-indigo-950/30 border border-indigo-800 rounded px-3 py-2">
          Duration filter active — showing {filteredSessions.length} of {sessions.length} sessions.
          Use this to exclude outliers: e.g. <strong>max = 30s</strong> removes instant resets, <strong>min = 60s</strong> removes sessions too short to be real plays.
        </div>
      )}

      {loading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard label="Wrong Location Events" value={wrongSessions.length} color="text-orange-400" />
            <MetricCard
              label="Wrong Location Rate"
              value={pct(wrongSessions.length, filteredSessions.length)}
              color="text-orange-400"
              sub={`of ${filteredSessions.length} sessions`}
            />
            <MetricCard
              label="Devices Affected"
              value={new Set(wrongSessions.map((s) => s.device_id)).size}
              color="text-yellow-400"
            />
            <MetricCard
              label="Repeat Offender Days"
              value={repeatOffenderPairCount}
              color="text-red-400"
              sub="device-days with 2+ events"
            />
          </div>

          {sessions.length === 0 ? (
            <EmptyState message="No sessions in this date range" />
          ) : (
            <>
              {/* Trend chart */}
              <div className="card">
                <h2 className="text-sm font-semibold text-gray-400 mb-1">Wrong Location Trend</h2>
                <p className="text-xs text-gray-600 mb-4">Daily count and rate across all sessions</p>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={trendData} margin={{ top: 4, right: 40, bottom: 4, left: 0 }}>
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#9ca3af' }} allowDecimals={false} />
                    <YAxis yAxisId="right" orientation="right" unit="%" domain={[0, 100]} tick={{ fontSize: 10, fill: '#9ca3af' }} />
                    <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line yAxisId="left" type="monotone" dataKey="Count" stroke="#f97316" strokeWidth={2} dot={false} />
                    <Line yAxisId="right" type="monotone" dataKey="Rate %" stroke="#fbbf24" strokeWidth={2} dot={false} strokeDasharray="4 2" />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Rate by device */}
              {byDeviceData.length > 0 && (
                <div className="card">
                  <h2 className="text-sm font-semibold text-gray-400 mb-1">Wrong Location Rate by Device</h2>
                  <p className="text-xs text-gray-600 mb-4">Devices with at least 3 sessions — sorted by rate descending</p>
                  <ResponsiveContainer width="100%" height={Math.max(180, byDeviceData.length * 34)}>
                    <BarChart data={byDeviceData} layout="vertical" margin={{ top: 4, right: 100, bottom: 4, left: 80 }}>
                      <XAxis type="number" unit="%" domain={[0, 100]} tick={{ fontSize: 10, fill: '#9ca3af' }} />
                      <YAxis type="category" dataKey="device" tick={{ fontSize: 10, fill: '#9ca3af' }} width={76} />
                      <Tooltip
                        contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }}
                        formatter={(value, name, props) => [
                          `${value}% — ${props.payload.wrong} wrong of ${props.payload.total} total`,
                          'Wrong Location Rate',
                        ]}
                      />
                      <Bar dataKey="Rate %" fill="#f97316" radius={[0, 3, 3, 0]}>
                        {/* wrong / total inside the bar */}
                        <LabelList
                          content={(props) => {
                            const { x, y, width, height, index } = props as {
                              x: number; y: number; width: number; height: number; index: number
                            }
                            const row = byDeviceData[index]
                            if (!row || (width as number) < 40) return null
                            return (
                              <text
                                x={(x as number) + (width as number) / 2}
                                y={(y as number) + (height as number) / 2}
                                dy={4}
                                textAnchor="middle"
                                fontSize={10}
                                fontFamily="monospace"
                                fill="rgba(255,255,255,0.9)"
                              >
                                {row.wrong}/{row.total}
                              </text>
                            )
                          }}
                        />
                        {/* total sessions label to the right of bar */}
                        <LabelList
                          content={(props) => {
                            const { x, y, width, height, index } = props as {
                              x: number; y: number; width: number; height: number; index: number
                            }
                            const row = byDeviceData[index]
                            if (!row) return null
                            return (
                              <text
                                x={(x as number) + (width as number) + 6}
                                y={(y as number) + (height as number) / 2}
                                dy={4}
                                textAnchor="start"
                                fontSize={10}
                                fill="#6b7280"
                              >
                                {row['Rate %']}% · {row.total} sessions
                              </text>
                            )
                          }}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Repeat offenders table */}
              {repeatOffenders.length > 0 && (
                <div className="card">
                  <h2 className="text-sm font-semibold text-gray-400 mb-3">Repeat Offenders</h2>
                  <p className="text-xs text-gray-600 mb-3">Device-days with more than one wrong-location event</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-gray-500 border-b border-gray-800">
                          <th className="text-left pb-2 pr-4">Device</th>
                          <th className="text-left pb-2 pr-4">Date</th>
                          <th className="text-right pb-2 pr-4 text-orange-500">Wrong Location</th>
                          <th className="text-right pb-2 pr-4">Total Sessions</th>
                          <th className="text-right pb-2">Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {repeatOffenders.map((row) => (
                          <tr key={`${row.device}|${row.date}`} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                            <td className="py-2 pr-4">
                              <Link to={`/devices/${row.device}`} className="font-mono text-indigo-400 hover:text-indigo-300 text-xs">
                                {row.device}
                              </Link>
                            </td>
                            <td className="py-2 pr-4 text-xs text-gray-400">{row.date}</td>
                            <td className="py-2 pr-4 text-right text-xs text-orange-400 font-semibold">{row.wrong}</td>
                            <td className="py-2 pr-4 text-right text-xs text-gray-300">{row.total}</td>
                            <td className="py-2 text-right text-xs text-gray-400">{pct(row.wrong, row.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
