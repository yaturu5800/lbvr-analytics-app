import { useEffect, useMemo, useState } from 'react'
import { eachDayOfInterval, format, subDays } from 'date-fns'
import { Link } from 'react-router-dom'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { msToDay } from '../lib/utils'
import type { DeviceHealthSnapshot, ExperienceSession } from '../types'
import MetricCard from '../components/MetricCard'
import DateRangePicker from '../components/DateRangePicker'
import EmptyState from '../components/EmptyState'

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

function fmtTime(ms: number): string {
  return format(new Date(ms), 'HH:mm:ss')
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

export default function DailyDevicesSnapshot() {
  const [start, setStart] = useState(subDays(new Date(), 30))
  const [end, setEnd] = useState(new Date())
  const [loading, setLoading] = useState(true)
  const [snaps, setSnaps] = useState<Pick<DeviceHealthSnapshot, 'device_id' | 'captured_at' | 'battery_level' | 'wifi_strength' | 'app_version'>[]>([])
  const [sessions, setSessions] = useState<Pick<ExperienceSession, 'device_id' | 'started_at'>[]>([])
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [{ data: snapData }, { data: sessionData }] = await Promise.all([
        supabase
          .from('device_health_snapshots')
          .select('device_id, captured_at, online, battery_level, wifi_strength, app_version')
          .gte('captured_at', start.getTime())
          .lte('captured_at', end.getTime())
          .eq('online', 1)
          .order('captured_at', { ascending: true })
          .limit(50000),
        supabase
          .from('experience_sessions')
          .select('device_id, started_at')
          .gte('started_at', start.getTime())
          .lte('started_at', end.getTime())
          .order('started_at', { ascending: true })
          .limit(20000),
      ])
      setSnaps((snapData ?? []) as typeof snaps)
      setSessions((sessionData ?? []) as typeof sessions)
      setSelectedDay(null)
      setLoading(false)
    }
    load()
  }, [start, end])

  const { series, onlineByDay, firstSnapByDayDevice } = useMemo(() => {
    const onlineSets: Record<string, Set<string>> = {}
    const activeSets: Record<string, Set<string>> = {}
    const firstSnap: Record<string, Record<string, typeof snaps[0]>> = {}

    for (const s of snaps) {
      if (!s.device_id) continue
      const day = msToDay(s.captured_at)
      if (!onlineSets[day]) onlineSets[day] = new Set()
      onlineSets[day].add(s.device_id)
      if (!firstSnap[day]) firstSnap[day] = {}
      if (!firstSnap[day][s.device_id]) firstSnap[day][s.device_id] = s
    }

    for (const s of sessions) {
      if (!s.device_id) continue
      const day = msToDay(s.started_at)
      if (!activeSets[day]) activeSets[day] = new Set()
      activeSets[day].add(s.device_id)
    }

    const days = eachDayOfInterval({ start, end }).map((d) => format(d, 'yyyy-MM-dd'))
    const seriesData: DaySeries[] = days.map((day) => {
      const online = onlineSets[day]?.size ?? 0
      const active = activeSets[day]?.size ?? 0
      const unused = online
        ? [...(onlineSets[day] ?? [])].filter((id) => !activeSets[day]?.has(id)).length
        : 0
      return {
        day,
        online,
        active,
        unused,
        utilizationPct: online ? +((active / online) * 100).toFixed(1) : 0,
      }
    })

    return {
      series: seriesData,
      onlineByDay: onlineSets,
      firstSnapByDayDevice: firstSnap,
    }
  }, [snaps, sessions, start, end])

  const activeByDay = useMemo(() => {
    const sets: Record<string, Set<string>> = {}
    for (const s of sessions) {
      if (!s.device_id) continue
      const day = msToDay(s.started_at)
      if (!sets[day]) sets[day] = new Set()
      sets[day].add(s.device_id)
    }
    return sets
  }, [sessions])

  const effectiveSelectedDay = useMemo(() => {
    if (selectedDay && series.some((d) => d.day === selectedDay)) return selectedDay
    const withData = [...series].reverse().find((d) => d.online > 0 || d.active > 0)
    return withData?.day ?? series[series.length - 1]?.day ?? null
  }, [selectedDay, series])

  const unusedRows: UnusedRow[] = useMemo(() => {
    if (!effectiveSelectedDay) return []
    const online = onlineByDay[effectiveSelectedDay]
    if (!online) return []
    const active = activeByDay[effectiveSelectedDay] ?? new Set()
    const firsts = firstSnapByDayDevice[effectiveSelectedDay] ?? {}
    return [...online]
      .filter((id) => !active.has(id))
      .map((id) => {
        const snap = firsts[id]
        return {
          device: id,
          firstOnline: snap?.captured_at ?? 0,
          battery: snap?.battery_level ?? null,
          wifi: snap?.wifi_strength ?? null,
          appVersion: snap?.app_version ?? null,
        }
      })
      .sort((a, b) => a.firstOnline - b.firstOnline)
  }, [effectiveSelectedDay, onlineByDay, activeByDay, firstSnapByDayDevice])

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
              value={avgOnline ? avgOnline.toFixed(1) : '—'}
              sub="days with ≥1 online device"
            />
            <MetricCard
              label="Avg Active / Day"
              value={avgActive ? avgActive.toFixed(1) : '—'}
              color="text-teal-400"
              sub="devices with ≥1 session"
            />
            <MetricCard
              label="Avg Unused / Day"
              value={avgUnused ? avgUnused.toFixed(1) : '—'}
              color="text-yellow-400"
              sub="online, zero sessions"
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
              Click a bar to inspect unused devices for that day.
              {effectiveSelectedDay ? (
                <> Selected: <span className="text-gray-400">{effectiveSelectedDay}</span></>
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
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }}
                  cursor={{ fill: 'rgba(99, 102, 241, 0.08)' }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="online" name="Online" fill="#6366f1" radius={[3, 3, 0, 0]} cursor="pointer" />
                <Bar dataKey="active" name="Active" fill="#14b8a6" radius={[3, 3, 0, 0]} cursor="pointer" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 mb-1">Utilization % per Day</h2>
            <p className="text-xs text-gray-600 mb-4">Active devices ÷ online devices. Days with no online devices show 0%.</p>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={series}>
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#9ca3af' }} unit="%" />
                <Tooltip
                  contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }}
                  formatter={(value) => [`${value}%`, 'Utilization']}
                />
                <Line
                  type="monotone"
                  dataKey="utilizationPct"
                  name="Utilization"
                  stroke="#22d3ee"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="card overflow-x-auto">
            <h2 className="text-sm font-semibold text-gray-400 mb-1">
              Online but Unused
              {effectiveSelectedDay ? (
                <span className="text-gray-500 font-normal"> — {effectiveSelectedDay}</span>
              ) : null}
            </h2>
            <p className="text-xs text-gray-600 mb-4">
              Devices with an <code className="text-gray-500">online=1</code> health snapshot and zero sessions that day.
              {unusedRows.length > 0 ? ` ${unusedRows.length} device${unusedRows.length === 1 ? '' : 's'}.` : ''}
            </p>
            {unusedRows.length === 0 ? (
              <p className="text-sm text-gray-500">
                {effectiveSelectedDay && (onlineByDay[effectiveSelectedDay]?.size ?? 0) > 0
                  ? 'All online devices ran at least one session this day.'
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
