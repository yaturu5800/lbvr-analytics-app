import { useEffect, useState } from 'react'
import { subDays } from 'date-fns'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { msToDay, pct, secondsToHMS } from '../lib/utils'
import type { ExperienceSession } from '../types'
import MetricCard from '../components/MetricCard'
import DateRangePicker from '../components/DateRangePicker'
import FilterSelect from '../components/FilterSelect'
import EmptyState from '../components/EmptyState'

export default function FleetOverview() {
  const [sessions, setSessions] = useState<ExperienceSession[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [start, setStart] = useState(subDays(new Date(), 30))
  const [end, setEnd] = useState(new Date())
  const [premiseFilter, setPremiseFilter] = useState('')
  const [expFilter, setExpFilter] = useState('')

  useEffect(() => {
    async function load() {
      setLoading(true)
      let q = supabase
        .from('experience_sessions')
        .select('*', { count: 'exact' })
        .gte('started_at', start.getTime())
        .lte('started_at', end.getTime())
        .order('started_at', { ascending: false })
        .limit(5000)
      if (premiseFilter) q = q.eq('premise_id', premiseFilter)
      if (expFilter) q = q.eq('experience_id', expFilter)
      const { data, count } = await q
      setSessions(data ?? [])
      setTotalCount(count ?? data?.length ?? 0)
      setLoading(false)
    }
    load()
  }, [start, end, premiseFilter, expFilter])

  const premises = [...new Set(sessions.map((s) => s.premise_id))].filter(Boolean)
  const experiences = [...new Set(sessions.map((s) => s.experience_id))].filter(Boolean)
  const completed = sessions.filter((s) => s.was_completed)
  const avgDuration = completed.length
    ? Math.round(completed.reduce((a, s) => a + s.duration_seconds, 0) / completed.length)
    : 0
  const isCapped = totalCount > sessions.length

  // Sessions per day
  const byDay: Record<string, number> = {}
  for (const s of sessions) {
    const day = msToDay(s.started_at)
    byDay[day] = (byDay[day] ?? 0) + 1
  }
  const sessionsByDayData = Object.entries(byDay)
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => a.day.localeCompare(b.day))

  // Sessions by hour of day (0–23)
  const byHour: Record<number, number> = {}
  for (let h = 0; h < 24; h++) byHour[h] = 0
  for (const s of sessions) {
    const hour = new Date(s.started_at).getHours()
    byHour[hour] = (byHour[hour] ?? 0) + 1
  }
  const sessionsByHourData = Object.entries(byHour)
    .map(([hour, count]) => ({ hour: `${String(hour).padStart(2, '0')}:00`, count }))
    .sort((a, b) => a.hour.localeCompare(b.hour))

  // Language summary card
  const byLang: Record<string, number> = {}
  for (const s of sessions) byLang[s.language] = (byLang[s.language] ?? 0) + 1
  const langSummary = Object.entries(byLang)
    .sort((a, b) => b[1] - a[1])
    .map(([lang, n]) => `${lang.toUpperCase()} ${pct(n, sessions.length)}`)
    .join(' · ')

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-white mr-2">Throughput</h1>
        <DateRangePicker start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e) }} />
        <FilterSelect options={premises} value={premiseFilter} onChange={setPremiseFilter} placeholder="All Premises" />
        <FilterSelect options={experiences} value={expFilter} onChange={setExpFilter} placeholder="All Experiences" />
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <MetricCard
              label="Total Sessions"
              value={totalCount.toLocaleString()}
              sub={isCapped ? `Charts based on latest ${sessions.length.toLocaleString()} rows` : undefined}
            />
            <MetricCard
              label="Completion Rate"
              value={pct(completed.length, sessions.length)}
              color="text-green-400"
              sub={isCapped ? 'based on sample' : undefined}
            />
            <MetricCard
              label="Avg Duration (completed)"
              value={avgDuration ? secondsToHMS(avgDuration) : '—'}
            />
            <MetricCard label="Devices Active" value={new Set(sessions.map((s) => s.device_id)).size} />
            <MetricCard label="Languages" value={langSummary || '—'} />
          </div>

          {sessions.length === 0 ? (
            <EmptyState message="No sessions in this date range" />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="card">
                <h2 className="text-sm font-semibold text-gray-400 mb-4">Sessions per Day</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={sessionsByDayData}>
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} />
                    <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }} />
                    <Bar dataKey="count" fill="#6366f1" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="card">
                <h2 className="text-sm font-semibold text-gray-400 mb-4">Sessions by Hour of Day</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={sessionsByHourData}>
                    <XAxis dataKey="hour" tick={{ fontSize: 9, fill: '#9ca3af' }} interval={1} />
                    <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} />
                    <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }} />
                    <Bar dataKey="count" fill="#22d3ee" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
