import { useEffect, useState } from 'react'
import { subDays } from 'date-fns'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, Cell,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { msToDay, pct, secondsToHMS, getOutcomeLabel } from '../lib/utils'
import type { ExperienceSession } from '../types'
import MetricCard from '../components/MetricCard'
import DateRangePicker from '../components/DateRangePicker'
import FilterSelect from '../components/FilterSelect'
import EmptyState from '../components/EmptyState'

interface Bucket {
  label: string
  minSec: number
  maxSec: number | null
  description: string
}

const BUCKETS: Bucket[] = [
  { label: '< 10s',     minSec: 0,   maxSec: 10,  description: 'Instant crash' },
  { label: '10–60s',    minSec: 10,  maxSec: 60,  description: 'Likely crash' },
  { label: '1–5 min',   minSec: 60,  maxSec: 300, description: 'Early exit' },
  { label: '5–12 min',  minSec: 300, maxSec: 720, description: 'Mid session' },
  { label: '12 min+',   minSec: 720, maxSec: null, description: 'Near complete' },
]

const OUTCOME_COLORS: Record<string, string> = {
  Natural:          '#22c55e',
  'Skip→Done':      '#3b82f6',
  'Operator Ended': '#f59e0b',
  'Operator Reset': '#f97316',
  Failure:          '#ef4444',
}

function getBucket(durationSeconds: number): Bucket {
  return BUCKETS.find((b) =>
    durationSeconds >= b.minSec && (b.maxSec === null || durationSeconds < b.maxSec)
  ) ?? BUCKETS[BUCKETS.length - 1]
}

export default function SessionDurations() {
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
  const isCapped = totalCount > sessions.length

  // Derive per-session bucket + outcome
  const enriched = sessions.map((s) => ({
    ...s,
    bucket: getBucket(s.duration_seconds),
    outcome: getOutcomeLabel(s),
  }))

  const failures = enriched.filter((s) => !s.was_completed && s.was_operator_ended === 0)
  const crashes = enriched.filter((s) => !s.was_completed && s.was_operator_ended === 0 && s.was_operator_reset === 0 && s.duration_seconds < 60)
  const nearComplete = enriched.filter((s) => !s.was_completed && s.was_operator_ended === 0 && s.was_operator_reset === 0 && s.duration_seconds >= 720)
  const avgFailureDuration = failures.length
    ? Math.round(failures.reduce((a, s) => a + s.duration_seconds, 0) / failures.length)
    : 0

  // Histogram data: one entry per bucket, stacked by outcome
  const histogramData = BUCKETS.map((bucket) => {
    const inBucket = enriched.filter((s) => s.bucket.label === bucket.label)
    const row: Record<string, string | number> = { label: bucket.label, description: bucket.description }
    for (const outcome of Object.keys(OUTCOME_COLORS)) {
      row[outcome] = inBucket.filter((s) => s.outcome === outcome).length
    }
    row._total = inBucket.length
    return row
  })

  // Fine-grained histogram by day (line chart style — sessions per day coloured by outcome)
  const byDay: Record<string, Record<string, number>> = {}
  for (const s of enriched) {
    const day = msToDay(s.started_at)
    if (!byDay[day]) byDay[day] = {}
    byDay[day][s.outcome] = (byDay[day][s.outcome] ?? 0) + 1
  }
  const byDayData = Object.entries(byDay)
    .map(([day, outcomes]) => ({ day, ...outcomes }))
    .sort((a, b) => a.day.localeCompare(b.day))

  // Bucket summary table data
  const tableData = BUCKETS.map((bucket) => {
    const inBucket = enriched.filter((s) => s.bucket.label === bucket.label)
    const completedCount = inBucket.filter((s) => s.was_completed).length
    const operatorResetCount = inBucket.filter((s) => !s.was_completed && s.was_operator_ended === 0 && s.was_operator_reset === 1).length
    const failureCount = inBucket.filter((s) => !s.was_completed && s.was_operator_ended === 0 && s.was_operator_reset === 0).length
    const operatorEndedCount = inBucket.filter((s) => s.was_operator_ended === 1).length
    return {
      label: bucket.label,
      description: bucket.description,
      total: inBucket.length,
      completed: completedCount,
      operatorResets: operatorResetCount,
      failures: failureCount,
      operatorEnded: operatorEndedCount,
      failurePct: pct(failureCount, inBucket.length),
    }
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-white mr-2">Session Durations</h1>
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
              sub={isCapped ? `Showing latest ${sessions.length.toLocaleString()}` : undefined}
            />
            <MetricCard
              label="Likely Crashes"
              value={crashes.length}
              color="text-red-400"
              sub="incomplete, under 60s"
            />
            <MetricCard
              label="Avg Failure Duration"
              value={avgFailureDuration ? secondsToHMS(avgFailureDuration) : '—'}
              color="text-yellow-400"
            />
            <MetricCard
              label="Near-Complete Failures"
              value={nearComplete.length}
              color="text-orange-400"
              sub="incomplete, 12 min+"
            />
          </div>

          {sessions.length === 0 ? (
            <EmptyState message="No sessions in this date range" />
          ) : (
            <>
              {/* Stacked histogram by duration bucket */}
              <div className="card">
                <h2 className="text-sm font-semibold text-gray-400 mb-1">Session Count by Duration Bucket</h2>
                <p className="text-xs text-gray-600 mb-4">All sessions stacked by outcome — shows where failures cluster</p>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={histogramData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: '#9ca3af' }}
                      tickFormatter={(v, i) => `${v}\n${histogramData[i]?.description ?? ''}`}
                    />
                    <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} />
                    <Tooltip
                      contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }}
                      formatter={(value: number, name: string) => [value, name]}
                      labelFormatter={(label, payload) => {
                        const item = histogramData.find((d) => d.label === label)
                        return `${label} — ${item?.description ?? ''} (${item?._total ?? 0} total)`
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {Object.entries(OUTCOME_COLORS).map(([outcome, color]) => (
                      <Bar key={outcome} dataKey={outcome} stackId="a" fill={color}>
                        {histogramData.map((_, i) => <Cell key={i} fill={color} />)}
                      </Bar>
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Outcome breakdown per day */}
              <div className="card">
                <h2 className="text-sm font-semibold text-gray-400 mb-1">Session Outcomes per Day</h2>
                <p className="text-xs text-gray-600 mb-4">Daily view of how sessions resolved</p>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={byDayData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} />
                    <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {Object.entries(OUTCOME_COLORS).map(([outcome, color]) => (
                      <Bar key={outcome} dataKey={outcome} stackId="a" fill={color} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Bucket summary table */}
              <div className="card">
                <h2 className="text-sm font-semibold text-gray-400 mb-3">Bucket Breakdown</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-500 border-b border-gray-800">
                        <th className="text-left pb-2 pr-4">Duration</th>
                        <th className="text-left pb-2 pr-4 text-gray-600">Label</th>
                        <th className="text-right pb-2 pr-4">Total</th>
                        <th className="text-right pb-2 pr-4 text-green-600">Completed</th>
                        <th className="text-right pb-2 pr-4 text-red-600">Failures</th>
                        <th className="text-right pb-2 pr-4 text-orange-500">Op. Reset</th>
                        <th className="text-right pb-2 pr-4 text-yellow-600">Op. Ended</th>
                        <th className="text-right pb-2">Failure %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableData.map((row) => (
                        <tr key={row.label} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                          <td className="py-2 pr-4 font-mono text-xs text-white">{row.label}</td>
                          <td className="py-2 pr-4 text-xs text-gray-500">{row.description}</td>
                          <td className="py-2 pr-4 text-right text-xs text-gray-300">{row.total}</td>
                          <td className="py-2 pr-4 text-right text-xs text-green-400">{row.completed}</td>
                          <td className="py-2 pr-4 text-right text-xs text-red-400">{row.failures}</td>
                          <td className="py-2 pr-4 text-right text-xs text-orange-400">{row.operatorResets}</td>
                          <td className="py-2 pr-4 text-right text-xs text-yellow-400">{row.operatorEnded}</td>
                          <td className="py-2 text-right text-xs text-gray-400">{row.failurePct}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-gray-700 font-semibold">
                        <td className="pt-2 pr-4 text-xs text-gray-300" colSpan={2}>Total</td>
                        <td className="pt-2 pr-4 text-right text-xs text-white">{sessions.length}</td>
                        <td className="pt-2 pr-4 text-right text-xs text-green-400">
                          {tableData.reduce((a, r) => a + r.completed, 0)}
                        </td>
                        <td className="pt-2 pr-4 text-right text-xs text-red-400">
                          {tableData.reduce((a, r) => a + r.failures, 0)}
                        </td>
                        <td className="pt-2 pr-4 text-right text-xs text-orange-400">
                          {tableData.reduce((a, r) => a + r.operatorResets, 0)}
                        </td>
                        <td className="pt-2 pr-4 text-right text-xs text-yellow-400">
                          {tableData.reduce((a, r) => a + r.operatorEnded, 0)}
                        </td>
                        <td className="pt-2 text-right text-xs text-gray-400">
                          {pct(tableData.reduce((a, r) => a + r.failures, 0), sessions.length)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
