import { useEffect, useMemo, useState } from 'react'
import { eachDayOfInterval, endOfDay, format, parseISO, startOfDay, subDays } from 'date-fns'
import { Link } from 'react-router-dom'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { msToDay } from '../lib/utils'
import MetricCard from '../components/MetricCard'
import DateRangePicker from '../components/DateRangePicker'
import EmptyState from '../components/EmptyState'

const PAGE_SIZE = 1000

interface DaySeries {
  day: string
  online: number
  active: number
  unused: number
  utilizationPct: number
}

interface UnusedRow {
  device: string
  firstOnline: number
  battery: number | null
  wifi: number | null
  appVersion: string | null
}

interface SnapLean {
  device_id: string
  captured_at: number
}

interface SessionLean {
  device_id: string
  started_at: number
}

function fmtTime(ms: number): string {
  return format(new Date(ms), 'HH:mm:ss')
}

/** Chart / UI label: 21-Jul (mon) */
function fmtChartDay(day: string): string {
  const d = parseISO(day)
  return `${format(d, 'dd-MMM')} (${format(d, 'EEE').toLowerCase()})`
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

/** Page through all matching rows (avoids hard limit truncation). */
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

function buildSetsByDay(
  rows: { device_id: string; at: number }[],
): Record<string, Set<string>> {
  const sets: Record<string, Set<string>> = {}
  for (const r of rows) {
    if (!r.device_id) continue
    const day = msToDay(r.at)
    if (!sets[day]) sets[day] = new Set()
    sets[day].add(r.device_id)
  }
  return sets
}

export default function DailyDevicesSnapshot() {
  const [start, setStart] = useState(subDays(new Date(), 30))
  const [end, setEnd] = useState(new Date())
  const [loading, setLoading] = useState(true)
  const [onlineByDay, setOnlineByDay] = useState<Record<string, Set<string>>>({})
  const [activeByDay, setActiveByDay] = useState<Record<string, Set<string>>>({})
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [unusedRows, setUnusedRows] = useState<UnusedRow[]>([])
  const [unusedLoading, setUnusedLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setSelectedDay(null)
      try {
        const [snapRows, sessionRows] = await Promise.all([
          fetchAllPages<SnapLean>((from, to) =>
            supabase
              .from('device_health_snapshots')
              .select('device_id, captured_at')
              .eq('online', 1)
              .gte('captured_at', start.getTime())
              .lte('captured_at', end.getTime())
              .order('captured_at', { ascending: true })
              .range(from, to),
          ),
          fetchAllPages<SessionLean>((from, to) =>
            supabase
              .from('experience_sessions')
              .select('device_id, started_at')
              .eq('was_completed', true)
              .gte('started_at', start.getTime())
              .lte('started_at', end.getTime())
              .order('started_at', { ascending: true })
              .range(from, to),
          ),
        ])
        if (cancelled) return
        setOnlineByDay(buildSetsByDay(snapRows.map((s) => ({ device_id: s.device_id, at: s.captured_at }))))
        setActiveByDay(buildSetsByDay(sessionRows.map((s) => ({ device_id: s.device_id, at: s.started_at }))))
      } catch (err) {
        console.error('DailyDevicesSnapshot load failed', err)
        if (!cancelled) {
          setOnlineByDay({})
          setActiveByDay({})
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [start, end])

  const series: DaySeries[] = useMemo(() => {
    const days = eachDayOfInterval({ start, end }).map((d) => format(d, 'yyyy-MM-dd'))
    return days.map((day) => {
      const online = onlineByDay[day]?.size ?? 0
      const active = activeByDay[day]?.size ?? 0
      const unused = online
        ? [...(onlineByDay[day] ?? [])].filter((id) => !activeByDay[day]?.has(id)).length
        : 0
      return {
        day,
        online,
        active,
        unused,
        utilizationPct: online ? +((active / online) * 100).toFixed(1) : 0,
      }
    })
  }, [onlineByDay, activeByDay, start, end])

  const effectiveSelectedDay = useMemo(() => {
    if (selectedDay && series.some((d) => d.day === selectedDay)) return selectedDay
    const withData = [...series].reverse().find((d) => d.online > 0 || d.active > 0)
    return withData?.day ?? series[series.length - 1]?.day ?? null
  }, [selectedDay, series])

  // Detail rows for unused devices on the selected day (battery / wifi / version)
  useEffect(() => {
    let cancelled = false
    async function loadUnused() {
      if (!effectiveSelectedDay) {
        setUnusedRows([])
        return
      }
      const online = onlineByDay[effectiveSelectedDay]
      const active = activeByDay[effectiveSelectedDay] ?? new Set()
      if (!online?.size) {
        setUnusedRows([])
        return
      }
      const unusedIds = [...online].filter((id) => !active.has(id))
      const unusedSet = new Set(unusedIds)
      if (!unusedIds.length) {
        setUnusedRows([])
        return
      }

      setUnusedLoading(true)
      try {
        const dayStart = startOfDay(parseISO(effectiveSelectedDay)).getTime()
        const dayEnd = endOfDay(parseISO(effectiveSelectedDay)).getTime()
        const snapRows = await fetchAllPages<{
          device_id: string
          captured_at: number
          battery_level: number | null
          wifi_strength: number | null
          app_version: string | null
        }>((from, to) =>
          supabase
            .from('device_health_snapshots')
            .select('device_id, captured_at, battery_level, wifi_strength, app_version')
            .eq('online', 1)
            .gte('captured_at', dayStart)
            .lte('captured_at', dayEnd)
            .order('captured_at', { ascending: true })
            .range(from, to),
        )
        if (cancelled) return

        const firstByDevice: Record<string, (typeof snapRows)[0]> = {}
        for (const s of snapRows) {
          if (!s.device_id || !unusedSet.has(s.device_id)) continue
          if (!firstByDevice[s.device_id]) firstByDevice[s.device_id] = s
        }

        const rows: UnusedRow[] = unusedIds
          .map((id) => {
            const snap = firstByDevice[id]
            return {
              device: id,
              firstOnline: snap?.captured_at ?? 0,
              battery: snap?.battery_level ?? null,
              wifi: snap?.wifi_strength ?? null,
              appVersion: snap?.app_version ?? null,
            }
          })
          .sort((a, b) => a.firstOnline - b.firstOnline)

        setUnusedRows(rows)
      } catch (err) {
        console.error('DailyDevicesSnapshot unused load failed', err)
        if (!cancelled) setUnusedRows([])
      } finally {
        if (!cancelled) setUnusedLoading(false)
      }
    }
    loadUnused()
    return () => { cancelled = true }
  }, [effectiveSelectedDay, onlineByDay, activeByDay])

  const daysWithOnline = series.filter((d) => d.online > 0)
  const avgOnline = daysWithOnline.length
    ? daysWithOnline.reduce((a, d) => a + d.online, 0) / daysWithOnline.length
    : 0
  const avgActive = daysWithOnline.length
    ? daysWithOnline.reduce((a, d) => a + d.active, 0) / daysWithOnline.length
    : 0
  const avgUnused = daysWithOnline.length
    ? daysWithOnline.reduce((a, d) => a + d.unused, 0) / daysWithOnline.length
    : 0
  const avgUtilization = daysWithOnline.length
    ? daysWithOnline.reduce((a, d) => a + d.utilizationPct, 0) / daysWithOnline.length
    : 0

  const hasAnyData = series.some((d) => d.online > 0 || d.active > 0)
  const fmtAvg = (n: number) => (daysWithOnline.length ? n.toFixed(1) : '—')

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-white mr-2">Daily Devices Snapshot</h1>
        <DateRangePicker start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e) }} />
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : !hasAnyData ? (
        <EmptyState message="No device health or session data found in this date range" />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              label="Avg Online / Day"
              value={fmtAvg(avgOnline)}
              sub="days with ≥1 online device"
            />
            <MetricCard
              label="Avg Active / Day"
              value={fmtAvg(avgActive)}
              color="text-teal-400"
              sub="devices with ≥1 completed experience"
            />
            <MetricCard
              label="Avg Unused / Day"
              value={fmtAvg(avgUnused)}
              color="text-yellow-400"
              sub="online, no completed experience"
            />
            <MetricCard
              label="Avg Utilization"
              value={daysWithOnline.length ? `${avgUtilization.toFixed(1)}%` : '—'}
              color="text-indigo-400"
              sub="active ÷ online"
            />
          </div>

          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 mb-1">Online vs Active Devices per Day</h2>
            <p className="text-xs text-gray-600 mb-4">
              Active = ≥1 completed experience that day. Click a bar to inspect unused devices.
              {effectiveSelectedDay ? (
                <> Selected: <span className="text-gray-400">{fmtChartDay(effectiveSelectedDay)}</span></>
              ) : null}
            </p>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={series}
                onClick={(state) => {
                  const day = state?.activeLabel
                  if (typeof day === 'string') setSelectedDay(day)
                }}
              >
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                  tickFormatter={fmtChartDay}
                />
                <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }}
                  cursor={{ fill: 'rgba(99, 102, 241, 0.08)' }}
                  labelFormatter={(label) => fmtChartDay(String(label))}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="online" name="Online" fill="#6366f1" radius={[3, 3, 0, 0]} cursor="pointer" />
                <Bar dataKey="active" name="Active (completed)" fill="#14b8a6" radius={[3, 3, 0, 0]} cursor="pointer" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 mb-1">Utilization % per Day</h2>
            <p className="text-xs text-gray-600 mb-4">
              Devices with ≥1 completed experience ÷ online devices. Days with no online devices show 0%.
            </p>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={series}>
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                  tickFormatter={fmtChartDay}
                />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#9ca3af' }} unit="%" />
                <Tooltip
                  contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }}
                  formatter={(value) => [`${value}%`, 'Utilization']}
                  labelFormatter={(label) => fmtChartDay(String(label))}
                />
                <Line
                  type="monotone"
                  dataKey="utilizationPct"
                  name="Utilization"
                  stroke="#22d3ee"
                  strokeWidth={2}
                  dot={{ r: 2, fill: '#22d3ee' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="card overflow-x-auto">
            <h2 className="text-sm font-semibold text-gray-400 mb-1">
              Online but Unused
              {effectiveSelectedDay ? (
                <span className="text-gray-500 font-normal"> — {fmtChartDay(effectiveSelectedDay)}</span>
              ) : null}
            </h2>
            <p className="text-xs text-gray-600 mb-4">
              Devices with an <code className="text-gray-500">online=1</code> health snapshot and no completed experience that day.
              {unusedRows.length > 0 ? ` ${unusedRows.length} device${unusedRows.length === 1 ? '' : 's'}.` : ''}
            </p>
            {unusedLoading ? (
              <p className="text-sm text-gray-500">Loading…</p>
            ) : unusedRows.length === 0 ? (
              <p className="text-sm text-gray-500">
                {effectiveSelectedDay && (onlineByDay[effectiveSelectedDay]?.size ?? 0) > 0
                  ? 'All online devices completed at least one experience this day.'
                  : 'No online devices for this day.'}
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-800">
                    <th className="pb-2 pr-4 text-left">Device</th>
                    <th className="pb-2 pr-4 text-right">First Online</th>
                    <th className="pb-2 pr-4 text-right">Battery</th>
                    <th className="pb-2 pr-4 text-right">WiFi (dBm)</th>
                    <th className="pb-2 text-right">App Version</th>
                  </tr>
                </thead>
                <tbody>
                  {unusedRows.map((r) => (
                    <tr key={r.device} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                      <td className="py-2 pr-4">
                        <Link
                          to={`/devices/${r.device}`}
                          className="font-mono text-indigo-400 hover:text-indigo-300 text-xs"
                        >
                          {r.device}
                        </Link>
                      </td>
                      <td className="py-2 pr-4 text-right font-mono text-xs text-green-400">
                        {r.firstOnline ? fmtTime(r.firstOnline) : '—'}
                      </td>
                      <td className={`py-2 pr-4 text-right font-mono text-xs ${battColor(r.battery)}`}>
                        {r.battery !== null ? `${r.battery}%` : '—'}
                      </td>
                      <td className={`py-2 pr-4 text-right font-mono text-xs ${wifiColor(r.wifi)}`}>
                        {r.wifi !== null ? `${r.wifi}` : '—'}
                      </td>
                      <td className="py-2 text-right font-mono text-xs text-gray-300">
                        {r.appVersion ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}
