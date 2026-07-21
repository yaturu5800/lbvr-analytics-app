import { useEffect, useMemo, useState } from 'react'
import { eachDayOfInterval, endOfDay, format, startOfDay, subDays } from 'date-fns'
import { Link } from 'react-router-dom'
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { msToDay } from '../lib/utils'
import type { DeviceHealthSnapshot, ExperienceSession } from '../types'
import EmptyState from '../components/EmptyState'

type SortKey = 'device' | 'firstOnline' | 'firstSession' | 'gap' | 'battery' | 'wifi' | 'sessions'
type SortDir = 'asc' | 'desc'
type ReadyPeriod = 'week' | 'month' | 'all'

interface DeviceRow {
  device: string
  firstOnline: number | null
  battery: number | null
  wifi: number | null
  appVersion: string | null
  firstSession: number | null
  gap: number | null        // ms between firstOnline and firstSession
  sessions: number
}

interface ReadyDayRow {
  day: string
  ready10: number
  ready11: number
  ready18: number
}

const PAGE_SIZE = 1000
const CHART_TOOLTIP = { background: '#111827', border: '1px solid #374151', borderRadius: 8 }

/** Page through all matching rows (Supabase/PostgREST caps each response). */
async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const all: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    if (!data?.length) break
    all.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}

function fmt(ms: number | null): string {
  if (ms === null) return '—'
  return format(new Date(ms), 'HH:mm:ss')
}

function fmtGap(ms: number | null): string {
  if (ms === null || ms < 0) return '—'
  const totalSec = Math.round(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  if (m === 0) return `${s}s`
  return `${m}m ${s}s`
}

function wifiColor(v: number | null): string {
  if (v === null) return 'text-gray-400'
  if (v >= -60) return 'text-green-400'
  if (v >= -75) return 'text-yellow-400'
  return 'text-red-400'
}

function battColor(v: number | null): string {
  if (v === null) return 'text-gray-400'
  if (v >= 50) return 'text-green-400'
  if (v >= 20) return 'text-yellow-400'
  return 'text-red-400'
}

/** Local-time minutes since midnight for an epoch ms timestamp. */
function minutesOfDay(ms: number): number {
  const d = new Date(ms)
  return d.getHours() * 60 + d.getMinutes()
}

function periodLabel(period: ReadyPeriod): string {
  if (period === 'week') return 'Past week'
  if (period === 'month') return 'Past month'
  return 'All time'
}

export default function DeviceStartup() {
  const [date, setDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'))
  const [rows, setRows] = useState<DeviceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>('firstOnline')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const [readyPeriod, setReadyPeriod] = useState<ReadyPeriod>('week')
  const [readySeries, setReadySeries] = useState<ReadyDayRow[]>([])
  const [readyLoading, setReadyLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)

      const dayStart = startOfDay(new Date(date)).getTime()
      const dayEnd = endOfDay(new Date(date)).getTime()

      try {
        type SnapRow = Pick<DeviceHealthSnapshot, 'device_id' | 'captured_at' | 'battery_level' | 'wifi_strength' | 'app_version'>
        type SessRow = Pick<ExperienceSession, 'device_id' | 'started_at'>

        const [snapData, sessionData] = await Promise.all([
          fetchAllPages<SnapRow>((from, to) =>
            supabase
              .from('device_health_snapshots')
              .select('device_id, captured_at, battery_level, wifi_strength, app_version')
              .gte('captured_at', dayStart)
              .lte('captured_at', dayEnd)
              .eq('online', 1)
              .order('captured_at', { ascending: true })
              .range(from, to),
          ),
          fetchAllPages<SessRow>((from, to) =>
            supabase
              .from('experience_sessions')
              .select('device_id, started_at')
              .gte('started_at', dayStart)
              .lte('started_at', dayEnd)
              .order('started_at', { ascending: true })
              .range(from, to),
          ),
        ])
        if (cancelled) return

        // First online snapshot per device
        const firstSnap: Record<string, SnapRow> = {}
        for (const s of snapData) {
          if (!firstSnap[s.device_id]) firstSnap[s.device_id] = s
        }

        // First session + session count per device
        const firstSess: Record<string, number> = {}
        const sessCount: Record<string, number> = {}
        for (const s of sessionData) {
          if (s.device_id) {
            if (!firstSess[s.device_id]) firstSess[s.device_id] = s.started_at
            sessCount[s.device_id] = (sessCount[s.device_id] ?? 0) + 1
          }
        }

        const allDevices = new Set([
          ...Object.keys(firstSnap),
          ...Object.keys(firstSess),
        ])

        const result: DeviceRow[] = [...allDevices].map((id) => {
          const snap = firstSnap[id]
          const onlineAt = snap?.captured_at ?? null
          const sessionAt = firstSess[id] ?? null
          const gap = onlineAt !== null && sessionAt !== null ? sessionAt - onlineAt : null
          return {
            device: id,
            firstOnline: onlineAt,
            battery: snap?.battery_level ?? null,
            wifi: snap?.wifi_strength ?? null,
            appVersion: snap?.app_version ?? null,
            firstSession: sessionAt,
            gap,
            sessions: sessCount[id] ?? 0,
          }
        })

        setRows(result)
      } catch (e) {
        if (!cancelled) {
          console.error(e)
          setRows([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [date])

  // Historical: devices ready (first online) by 10:00 / 11:00 / 18:00 per day
  useEffect(() => {
    let cancelled = false
    async function loadReady() {
      setReadyLoading(true)

      const end = endOfDay(new Date())
      const start =
        readyPeriod === 'week' ? startOfDay(subDays(new Date(), 6))
          : readyPeriod === 'month' ? startOfDay(subDays(new Date(), 29))
            : null

      try {
        type SnapLean = Pick<DeviceHealthSnapshot, 'device_id' | 'captured_at'>
        const snapData = await fetchAllPages<SnapLean>((from, to) => {
          let q = supabase
            .from('device_health_snapshots')
            .select('device_id, captured_at')
            .eq('online', 1)
            .lte('captured_at', end.getTime())
          if (start) q = q.gte('captured_at', start.getTime())
          return q
            .order('captured_at', { ascending: true })
            .range(from, to)
        })
        if (cancelled) return

        const firstByDayDevice: Record<string, Record<string, number>> = {}
        for (const s of snapData) {
          if (!s.device_id) continue
          const day = msToDay(s.captured_at)
          if (!firstByDayDevice[day]) firstByDayDevice[day] = {}
          if (firstByDayDevice[day][s.device_id] === undefined) {
            firstByDayDevice[day][s.device_id] = s.captured_at
          }
        }

        const days =
          start
            ? eachDayOfInterval({ start, end }).map((d) => format(d, 'yyyy-MM-dd'))
            : Object.keys(firstByDayDevice).sort()

        const series: ReadyDayRow[] = days.map((day) => {
          const firsts = Object.values(firstByDayDevice[day] ?? {})
          const countBy = (hour: number) =>
            firsts.filter((ms) => minutesOfDay(ms) <= hour * 60).length
          return {
            day,
            ready10: countBy(10),
            ready11: countBy(11),
            ready18: countBy(18),
          }
        })

        setReadySeries(series)
      } catch (e) {
        if (!cancelled) {
          console.error(e)
          setReadySeries([])
        }
      } finally {
        if (!cancelled) setReadyLoading(false)
      }
    }
    loadReady()
    return () => { cancelled = true }
  }, [readyPeriod])

  /** Cumulative devices woken up by each hour from 09:00 onward (selected day). */
  const cumulativeWakeSeries = useMemo(() => {
    const firstTimes = rows
      .map((r) => r.firstOnline)
      .filter((ms): ms is number => ms !== null)
      .sort((a, b) => a - b)

    if (!firstTimes.length) return []

    const day = startOfDay(new Date(date))
    const startHour = 9
    const now = new Date()
    const isToday = format(now, 'yyyy-MM-dd') === date
    const lastHour = isToday
      ? Math.max(startHour, now.getHours())
      : Math.max(startHour, ...firstTimes.map((ms) => new Date(ms).getHours()), 18)

    const points: { time: string; hour: number; woken: number }[] = []
    for (let hour = startHour; hour <= lastHour; hour++) {
      const cutoff = new Date(day)
      cutoff.setHours(hour, 0, 0, 0)
      const cutoffMs = cutoff.getTime()
      const woken = firstTimes.filter((ms) => ms <= cutoffMs).length
      points.push({
        time: format(cutoff, 'HH:mm'),
        hour,
        woken,
      })
    }
    return points
  }, [rows, date])

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const sorted = [...rows].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    const av = a[sortKey]
    const bv = b[sortKey]
    if (av === null || av === undefined) return 1
    if (bv === null || bv === undefined) return -1
    if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * dir
    return ((av as number) - (bv as number)) * dir
  })

  const onlineCount = rows.filter((r) => r.firstOnline !== null).length
  const withSession = rows.filter((r) => r.firstSession !== null).length
  const avgGap = (() => {
    const gaps = rows.filter((r) => r.gap !== null && r.gap >= 0).map((r) => r.gap!)
    if (!gaps.length) return null
    return gaps.reduce((a, b) => a + b, 0) / gaps.length
  })()

  const cols: { key: SortKey; label: string; align: 'left' | 'right' }[] = [
    { key: 'device', label: 'Device', align: 'left' },
    { key: 'firstOnline', label: 'First Online', align: 'right' },
    { key: 'battery', label: 'Battery', align: 'right' },
    { key: 'wifi', label: 'WiFi (dBm)', align: 'right' },
    { key: 'firstSession', label: 'First Session', align: 'right' },
    { key: 'gap', label: 'Online → Session', align: 'right' },
    { key: 'sessions', label: 'Sessions Today', align: 'right' },
  ]

  const periodButtons: { key: ReadyPeriod; label: string }[] = [
    { key: 'week', label: 'Past week' },
    { key: 'month', label: 'Past month' },
    { key: 'all', label: 'All time' },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-xl font-bold text-white mr-2">Device Startup Times</h1>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState message="No device health or session data found for this date" />
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="card">
              <p className="text-xs text-gray-500 mb-1">Devices Online</p>
              <p className="text-2xl font-bold text-white">{onlineCount}</p>
              <p className="text-xs text-gray-600 mt-1">had a health snapshot that day</p>
            </div>
            <div className="card">
              <p className="text-xs text-gray-500 mb-1">Ran Sessions</p>
              <p className="text-2xl font-bold text-teal-400">{withSession}</p>
              <p className="text-xs text-gray-600 mt-1">devices with ≥1 session</p>
            </div>
            <div className="card">
              <p className="text-xs text-gray-500 mb-1">Total Sessions</p>
              <p className="text-2xl font-bold text-indigo-400">{rows.reduce((a, r) => a + r.sessions, 0)}</p>
              <p className="text-xs text-gray-600 mt-1">across all devices</p>
            </div>
            <div className="card">
              <p className="text-xs text-gray-500 mb-1">Avg Online → Session</p>
              <p className="text-2xl font-bold text-yellow-400">{avgGap !== null ? fmtGap(avgGap) : '—'}</p>
              <p className="text-xs text-gray-600 mt-1">warmup time</p>
            </div>
          </div>

          {/* Cumulative wake-up during the selected day */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 mb-1">Devices Woken Up Through the Day</h2>
            <p className="text-xs text-gray-600 mb-4">
              Cumulative count of devices that have been online by each hour on {date} (first <code className="text-gray-500">online=1</code> snapshot). Only increases.
            </p>
            {cumulativeWakeSeries.length === 0 ? (
              <p className="text-sm text-gray-500">No online devices for this date.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={cumulativeWakeSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                  <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={CHART_TOOLTIP}
                    formatter={(value) => [value ?? 0, 'Devices woken']}
                    labelFormatter={(label) => `By ${label}`}
                  />
                  <Bar dataKey="woken" name="Devices woken" fill="#6366f1" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </>
      )}

      {/* Ready-at checkpoints — own period filter, always visible */}
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <h2 className="text-sm font-semibold text-gray-400">Devices Ready by Checkpoint</h2>
          <div className="flex items-center gap-1">
            {periodButtons.map((p) => (
              <button
                key={p.key}
                onClick={() => setReadyPeriod(p.key)}
                className={`text-xs px-2 py-1 rounded ${
                  readyPeriod === p.key
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-800 hover:bg-gray-700 text-gray-300'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-gray-600 mb-4">
          Daily count of devices whose first online snapshot was at or before 10:00, 11:00, and 18:00 — {periodLabel(readyPeriod).toLowerCase()}.
        </p>
        {readyLoading ? (
          <p className="text-gray-500 text-sm">Loading…</p>
        ) : readySeries.length === 0 ? (
          <p className="text-sm text-gray-500">No snapshot data for this period.</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={readySeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 10, fill: '#9ca3af' }}
                tickFormatter={(d) => format(new Date(d + 'T00:00:00'), 'MMM d')}
                interval="preserveStartEnd"
              />
              <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} allowDecimals={false} />
              <Tooltip
                contentStyle={CHART_TOOLTIP}
                labelFormatter={(d) => format(new Date(String(d) + 'T00:00:00'), 'EEE, MMM d yyyy')}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="ready10" name="Ready by 10:00" stroke="#6366f1" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="ready11" name="Ready by 11:00" stroke="#14b8a6" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="ready18" name="Ready by 18:00" stroke="#22d3ee" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {!loading && rows.length > 0 && (
        <div className="card overflow-x-auto">
          <h2 className="text-sm font-semibold text-gray-400 mb-1">Per-Device Startup Times</h2>
          <p className="text-xs text-gray-600 mb-4">
            First health-snapshot with <code className="text-gray-500">online=1</code> and first session start for {date}. Click headers to sort.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-800">
                {cols.map(({ key, label, align }, i, arr) => {
                  const active = sortKey === key
                  const isLast = i === arr.length - 1
                  return (
                    <th
                      key={key}
                      className={`pb-2 ${isLast ? '' : 'pr-4'} text-${align} select-none cursor-pointer hover:text-gray-300 whitespace-nowrap`}
                      onClick={() => handleSort(key)}
                    >
                      <span className="inline-flex items-center gap-1">
                        {label}
                        <span className={active ? 'text-indigo-400' : 'text-gray-700'}>
                          {active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                        </span>
                      </span>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.device} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="py-2 pr-4">
                    <Link
                      to={`/devices/${r.device}`}
                      className="font-mono text-indigo-400 hover:text-indigo-300 text-xs"
                    >
                      {r.device}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 text-right font-mono text-xs text-gray-200">
                    {r.firstOnline !== null ? (
                      <span className="text-green-400">{fmt(r.firstOnline)}</span>
                    ) : (
                      <span className="text-gray-600">No snapshot</span>
                    )}
                  </td>
                  <td className={`py-2 pr-4 text-right font-mono text-xs ${battColor(r.battery)}`}>
                    {r.battery !== null ? `${r.battery}%` : '—'}
                  </td>
                  <td className={`py-2 pr-4 text-right font-mono text-xs ${wifiColor(r.wifi)}`}>
                    {r.wifi !== null ? `${r.wifi}` : '—'}
                  </td>
                  <td className="py-2 pr-4 text-right font-mono text-xs text-gray-300">
                    {r.firstSession !== null ? fmt(r.firstSession) : <span className="text-gray-600">No session</span>}
                  </td>
                  <td className="py-2 pr-4 text-right font-mono text-xs text-yellow-400">
                    {fmtGap(r.gap)}
                  </td>
                  <td className="py-2 text-right text-xs text-gray-300">
                    {r.sessions > 0 ? r.sessions : <span className="text-gray-600">0</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
