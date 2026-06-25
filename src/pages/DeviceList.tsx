import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { msToLabel, pct, secondsToHMS } from '../lib/utils'
import type { ExperienceSession, DeviceHealthSnapshot } from '../types'

interface DeviceRow {
  device_id: string
  total: number
  completed: number
  avgDuration: number
  lastSeen: number
  appVersion: string
}

export default function DeviceList() {
  const [rows, setRows] = useState<DeviceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState<keyof DeviceRow>('lastSeen')
  const [asc, setAsc] = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [sessRes, snapRes] = await Promise.all([
        supabase
          .from('experience_sessions')
          .select('device_id, was_completed, duration_seconds, started_at')
          .order('started_at', { ascending: false }),
        supabase
          .from('device_health_snapshots')
          .select('device_id, captured_at, app_version')
          .order('captured_at', { ascending: false }),
      ])

      const sessions: Pick<ExperienceSession, 'device_id' | 'was_completed' | 'duration_seconds' | 'started_at'>[] = sessRes.data ?? []
      const snapshots: Pick<DeviceHealthSnapshot, 'device_id' | 'captured_at' | 'app_version'>[] = snapRes.data ?? []

      const deviceMap: Record<string, DeviceRow> = {}
      for (const s of sessions) {
        if (!deviceMap[s.device_id]) {
          deviceMap[s.device_id] = { device_id: s.device_id, total: 0, completed: 0, avgDuration: 0, lastSeen: 0, appVersion: '—' }
        }
        deviceMap[s.device_id].total++
        if (s.was_completed) deviceMap[s.device_id].completed++
        deviceMap[s.device_id].avgDuration += s.duration_seconds
        if (s.started_at > deviceMap[s.device_id].lastSeen) deviceMap[s.device_id].lastSeen = s.started_at
      }
      for (const d of Object.values(deviceMap)) {
        if (d.total) d.avgDuration = Math.round(d.avgDuration / d.total)
      }
      for (const snap of snapshots) {
        if (!deviceMap[snap.device_id]) continue
        if (snap.captured_at > deviceMap[snap.device_id].lastSeen) {
          deviceMap[snap.device_id].lastSeen = snap.captured_at
        }
        if (deviceMap[snap.device_id].appVersion === '—' && snap.app_version) {
          deviceMap[snap.device_id].appVersion = snap.app_version
        }
      }
      setRows(Object.values(deviceMap))
      setLoading(false)
    }
    load()
  }, [])

  function toggleSort(col: keyof DeviceRow) {
    if (sort === col) setAsc((a) => !a)
    else { setSort(col); setAsc(false) }
  }

  const sorted = [...rows].sort((a, b) => {
    const av = a[sort], bv = b[sort]
    if (typeof av === 'number' && typeof bv === 'number') return asc ? av - bv : bv - av
    return asc
      ? String(av).localeCompare(String(bv))
      : String(bv).localeCompare(String(av))
  })

  const Th = ({ col, label }: { col: keyof DeviceRow; label: string }) => (
    <th
      className="text-left pb-2 cursor-pointer select-none hover:text-gray-200 text-xs text-gray-500"
      onClick={() => toggleSort(col)}
    >
      {label} {sort === col ? (asc ? '↑' : '↓') : ''}
    </th>
  )

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-white">Devices</h1>
      {loading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <Th col="device_id" label="Device ID" />
                <Th col="total" label="Total Sessions" />
                <Th col="completed" label="Completion %" />
                <Th col="avgDuration" label="Avg Duration" />
                <Th col="lastSeen" label="Last Seen" />
                <Th col="appVersion" label="App Version" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr key={row.device_id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="py-2">
                    <Link to={`/devices/${row.device_id}`} className="font-mono text-indigo-400 hover:text-indigo-300 text-xs">
                      {row.device_id}
                    </Link>
                  </td>
                  <td className="py-2 font-mono text-xs">{row.total}</td>
                  <td className="py-2 font-mono text-xs">{pct(row.completed, row.total)}</td>
                  <td className="py-2 font-mono text-xs">{secondsToHMS(row.avgDuration)}</td>
                  <td className="py-2 text-xs text-gray-400">{row.lastSeen ? msToLabel(row.lastSeen) : '—'}</td>
                  <td className="py-2 text-xs text-gray-500 font-mono">{row.appVersion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
