import { useEffect, useState } from 'react'
import { subDays } from 'date-fns'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { msToDay, pct, secondsToHMS } from '../lib/utils'
import type { ExperienceSession } from '../types'
import MetricCard from '../components/MetricCard'
import DateRangePicker from '../components/DateRangePicker'
import FilterSelect from '../components/FilterSelect'
import EmptyState from '../components/EmptyState'

const COLORS = ['#6366f1', '#22d3ee', '#f59e0b', '#f43f5e', '#a3e635', '#fb923c']

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
  const completedByDay: Record<string, number> = {}
  for (const s of sessions) {
    const day = msToDay(s.started_at)
    byDay[day] = (byDay[day] ?? 0) + 1
    if (s.was_completed) completedByDay[day] = (completedByDay[day] ?? 0) + 1
  }
  const sessionsByDayData = Object.entries(byDay)
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => a.day.localeCompare(b.day))

  const completionTrendData = Object.entries(byDay)
    .map(([day, total]) => ({
      day,
      rate: total ? +((completedByDay[day] ?? 0) / total * 100).toFixed(1) : 0,
    }))
    .sort((a, b) => a.day.localeCompare(b.day))

  // By experience
  const byExp: Record<string, number> = {}
  for (const s of sessions) byExp[s.experience_id] = (byExp[s.experience_id] ?? 0) + 1
  const byExpData = Object.entries(byExp).map(([name, value]) => ({ name, value }))

  // Language distribution
  const byLang: Record<string, number> = {}
  for (const s of sessions) byLang[s.language] = (byLang[s.language] ?? 0) + 1
  const byLangData = Object.entries(byLang).map(([name, value]) => ({ name, value }))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-white mr-2">Fleet Overview</h1>
        <DateRangePicker start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e) }} />
        <FilterSelect options={premises} value={premiseFilter} onChange={setPremiseFilter} placeholder="All Premises" />
        <FilterSelect options={experiences} value={expFilter} onChange={setExpFilter} placeholder="All Experiences" />
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
            <MetricCard label="Devices in Range" value={new Set(sessions.map((s) => s.device_id)).size} />
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
                <h2 className="text-sm font-semibold text-gray-400 mb-4">Completion Rate Trend</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={completionTrendData}>
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                    <YAxis unit="%" domain={[0, 100]} tick={{ fontSize: 10, fill: '#9ca3af' }} />
                    <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }} formatter={(v) => `${v}%`} />
                    <Line type="monotone" dataKey="rate" stroke="#22d3ee" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="card">
                <h2 className="text-sm font-semibold text-gray-400 mb-4">Sessions by Experience</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={byExpData} layout="vertical">
                    <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                    <YAxis dataKey="name" type="category" width={160} tick={{ fontSize: 9, fill: '#9ca3af' }} />
                    <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }} />
                    <Bar dataKey="value" fill="#f59e0b" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="card">
                <h2 className="text-sm font-semibold text-gray-400 mb-4">Language Distribution</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={byLangData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                      {byLangData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Legend />
                    <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
