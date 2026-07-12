import { useEffect, useState } from 'react'
import { format, startOfDay, endOfDay } from 'date-fns'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { DeviceHealthSnapshot, ExperienceSession } from '../types'
import EmptyState from '../components/EmptyState'

type SortKey = 'device' | 'firstOnline' | 'firstSession' | 'gap' | 'battery' | 'wifi' | 'sessions'
type SortDir = 'asc' | 'desc'

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

export default function DeviceStartup() {
  const [date, setDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'))
  const [rows, setRows] = useState<DeviceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>('firstOnline')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  useEffect(() => {
    async function load() {
      setLoading(true)

      const dayStart = startOfDay(new Date(date)).getTime()
      const dayEnd = endOfDay(new Date(date)).getTime()

      const [{ data: snapData }, { data: sessionData }] = await Promise.all([
        supabase
          .from('device_health_snapshots')
          .select('device_id, captured_at, online, battery_level, wifi_strength, app_version')
          .gte('captured_at', dayStart)
          .lte('captured_at', dayEnd)
          .eq('online', 1)
          .order('captured_at', { ascending: true })
          .limit(20000),
        supabase
          .from('experience_sessions')
          .select('device_id, started_at')
          .gte('started_at', dayStart)
          .lte('started_at', dayEnd)
          .order('started_at', { ascending: true })
          .limit(10000),
      ])

      // First online snapshot per device
      const firstSnap: Record<string, DeviceHealthSnapshot> = {}
      for (const s of (snapData ?? []) as DeviceHealthSnapshot[]) {
        if (!firstSnap[s.device_id]) firstSnap[s.device_id] = s
      }

      // First session + session count per device
      const firstSess: Record<string, number> = {}
      const sessCount: Record<string, number> = {}
      for (const s of (sessionData ?? []) as Pick<ExperienceSession, 'device_id' | 'started_at'>[]) {
        if (s.device_id) {
          if (!firstSess[s.device_id]) firstSess[s.device_id] = s.started_at
          sessCount[s.device_id] = (sessCount[s.device_id] ?? 0) + 1
        }
      }

      // Union of all device IDs seen today
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
      setLoading(false)
    }
    load()
  }, [date])

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

          {/* Table */}
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
        </>
      )}
    </div>
  )
}
