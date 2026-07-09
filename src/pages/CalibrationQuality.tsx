import { useEffect, useState } from 'react'
import { subDays } from 'date-fns'
import { Link } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, Cell,
  ScatterChart, Scatter, CartesianGrid,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { msToDay, msToLabel, pct } from '../lib/utils'
import type { CalibrationEvent, SessionStageEvent } from '../types'
import MetricCard from '../components/MetricCard'
import DateRangePicker from '../components/DateRangePicker'
import FilterSelect from '../components/FilterSelect'
import EmptyState from '../components/EmptyState'

const METHOD_COLOR: Record<string, string> = {
  points: '#6366f1',
  single_press: '#14b8a6',
  skip_verify: '#f97316',
}

const METHOD_LABEL: Record<string, string> = {
  points: 'Points',
  single_press: 'Single Press',
  skip_verify: 'Skip Verify',
}

const MESH_BUCKETS = [
  { label: '0–4', min: 0, max: 5 },
  { label: '5–9', min: 5, max: 10 },
  { label: '10–19', min: 10, max: 20 },
  { label: '20+', min: 20, max: Infinity },
]

function meshColor(avg: number | null): string {
  if (avg === null) return 'text-gray-400'
  if (avg < 5) return 'text-red-400'
  if (avg < 10) return 'text-yellow-400'
  return 'text-green-400'
}

const TOOLTIP_STYLE = {
  contentStyle: { background: '#111827', border: '1px solid #374151', borderRadius: 8 },
}

export default function CalibrationQuality() {
  const [events, setEvents] = useState<CalibrationEvent[]>([])
  const [recalByDevice, setRecalByDevice] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [start, setStart] = useState(subDays(new Date(), 30))
  const [end, setEnd] = useState(new Date())
  const [deviceFilter, setDeviceFilter] = useState('')
  const [methodFilter, setMethodFilter] = useState('')

  useEffect(() => {
    async function load() {
      setLoading(true)

      // Primary query: calibration_events view
      let q = supabase
        .from('calibration_events')
        .select('event_id, device_id, app_version, received_at, calibration_method, scan_meshes, created_at')
        .gte('received_at', start.getTime())
        .lte('received_at', end.getTime())
        .order('received_at', { ascending: false })
        .limit(5000)
      if (deviceFilter) q = q.eq('device_id', deviceFilter)
      if (methodFilter) q = q.eq('calibration_method', methodFilter)

      // Correlation query: recalibration counts per device for same window
      const recalQ = supabase
        .from('recalibration_events')
        .select('device_id')
        .gte('transitioned_at', start.getTime())
        .lte('transitioned_at', end.getTime())

      const [{ data: calData }, { data: recalData }] = await Promise.all([q, recalQ])

      setEvents((calData ?? []) as CalibrationEvent[])

      const counts: Record<string, number> = {}
      for (const r of recalData ?? []) {
        const row = r as Pick<SessionStageEvent, 'device_id'>
        counts[row.device_id] = (counts[row.device_id] ?? 0) + 1
      }
      setRecalByDevice(counts)
      setLoading(false)
    }
    load()
  }, [start, end, deviceFilter, methodFilter])

  const devices = [...new Set(events.map((e) => e.device_id))].filter(Boolean).sort()
  const methods = ['points', 'single_press', 'skip_verify']

  // ── Metrics ───────────────────────────────────────────────────────────────
  const total = events.length
  const uniqueDevices = new Set(events.map((e) => e.device_id)).size
  const meshValues = events.filter((e) => e.scan_meshes !== null).map((e) => e.scan_meshes!)
  const avgMeshes = meshValues.length > 0
    ? meshValues.reduce((a, b) => a + b, 0) / meshValues.length
    : null
  const skipVerifyCount = events.filter((e) => e.calibration_method === 'skip_verify').length

  // ── Method breakdown ──────────────────────────────────────────────────────
  const methodCounts: Record<string, number> = {}
  for (const e of events) {
    const m = e.calibration_method ?? 'unknown'
    methodCounts[m] = (methodCounts[m] ?? 0) + 1
  }
  const methodData = methods.map((m) => ({ method: METHOD_LABEL[m] ?? m, Count: methodCounts[m] ?? 0, key: m }))

  // ── Daily trend (stacked by method) ──────────────────────────────────────
  const byDay: Record<string, Record<string, number>> = {}
  for (const e of events) {
    const day = msToDay(e.received_at)
    if (!byDay[day]) byDay[day] = {}
    const m = e.calibration_method ?? 'unknown'
    byDay[day][m] = (byDay[day][m] ?? 0) + 1
  }
  const trendData = Object.entries(byDay)
    .map(([day, counts]) => ({ day, ...counts }))
    .sort((a, b) => a.day.localeCompare(b.day))

  // ── Scan mesh distribution (histogram) ───────────────────────────────────
  const meshDist = MESH_BUCKETS.map((bucket) => ({
    range: bucket.label,
    Count: meshValues.filter((v) => v >= bucket.min && v < bucket.max).length,
  }))

  // ── Avg scan meshes by method ─────────────────────────────────────────────
  const meshByMethod = methods.map((m) => {
    const vals = events
      .filter((e) => e.calibration_method === m && e.scan_meshes !== null)
      .map((e) => e.scan_meshes!)
    return {
      method: METHOD_LABEL[m],
      key: m,
      avg: vals.length > 0 ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : 0,
      n: vals.length,
    }
  })

  // ── Device quality table ──────────────────────────────────────────────────
  const deviceStats = devices.map((id) => {
    const devEvents = events.filter((e) => e.device_id === id)
    const devMeshes = devEvents.filter((e) => e.scan_meshes !== null).map((e) => e.scan_meshes!)
    const devAvg = devMeshes.length > 0
      ? devMeshes.reduce((a, b) => a + b, 0) / devMeshes.length
      : null
    const devMethodCounts: Record<string, number> = {}
    for (const e of devEvents) {
      const m = e.calibration_method ?? 'unknown'
      devMethodCounts[m] = (devMethodCounts[m] ?? 0) + 1
    }
    const topMethod = Object.entries(devMethodCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
    const lowMeshCount = devMeshes.filter((v) => v < 5).length
    return {
      id,
      total: devEvents.length,
      avgMeshes: devAvg,
      topMethod,
      lowMeshPct: devMeshes.length > 0 ? (lowMeshCount / devMeshes.length) * 100 : null,
      latestAt: devEvents[0]?.received_at ?? 0,
    }
  }).sort((a, b) => (a.avgMeshes ?? 999) - (b.avgMeshes ?? 999))

  // ── Correlation scatter data ──────────────────────────────────────────────
  const scatterData = devices
    .map((id) => {
      const devEvents = events.filter((e) => e.device_id === id)
      const devMeshes = devEvents.filter((e) => e.scan_meshes !== null).map((e) => e.scan_meshes!)
      const avgM = devMeshes.length > 0
        ? devMeshes.reduce((a, b) => a + b, 0) / devMeshes.length
        : null
      return {
        device: id,
        avgMeshes: avgM !== null ? +avgM.toFixed(1) : null,
        recalibrations: recalByDevice[id] ?? 0,
      }
    })
    .filter((d) => d.avgMeshes !== null) as { device: string; avgMeshes: number; recalibrations: number }[]

  return (
    <div className="space-y-6">
      {/* Header + filters */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-white mr-2">Calibration Quality</h1>
        <DateRangePicker start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e) }} />
        <FilterSelect options={devices} value={deviceFilter} onChange={setDeviceFilter} placeholder="All Devices" />
        <FilterSelect
          options={methods}
          value={methodFilter}
          onChange={setMethodFilter}
          placeholder="All Methods"
        />
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : (
        <>
          {/* Metric cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard label="Calibration Confirms" value={total} color="text-indigo-400" />
            <MetricCard label="Unique Devices" value={uniqueDevices} color="text-teal-400" />
            <MetricCard
              label="Avg Scan Meshes"
              value={avgMeshes !== null ? avgMeshes.toFixed(1) : '—'}
              color={meshColor(avgMeshes)}
              sub="Higher = better spatial mapping"
            />
            <MetricCard
              label="Skip Verify"
              value={pct(skipVerifyCount, total)}
              color={skipVerifyCount / (total || 1) > 0.2 ? 'text-orange-400' : 'text-gray-300'}
              sub={`${skipVerifyCount} of ${total} confirmations`}
            />
          </div>

          {total === 0 ? (
            <EmptyState message="No calibration confirms in this date range" />
          ) : (
            <>
              {/* Charts grid */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

                {/* Method breakdown */}
                <div className="card">
                  <h2 className="text-sm font-semibold text-gray-400 mb-1">Calibration Method Breakdown</h2>
                  <p className="text-xs text-gray-600 mb-4">How users confirmed calibration</p>
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={methodData} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 100 }}>
                      <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} allowDecimals={false} />
                      <YAxis type="category" dataKey="method" tick={{ fontSize: 11, fill: '#9ca3af' }} width={96} />
                      <Tooltip
                        {...TOOLTIP_STYLE}
                        formatter={(v) => [`${v ?? 0} confirms`, 'Count']}
                      />
                      <Bar dataKey="Count" radius={[0, 4, 4, 0]}>
                        {methodData.map((entry) => (
                          <Cell key={entry.key} fill={METHOD_COLOR[entry.key] ?? '#6b7280'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  {/* Method legend */}
                  <div className="flex flex-wrap gap-3 mt-3">
                    {methods.map((m) => (
                      <span key={m} className="flex items-center gap-1.5 text-xs text-gray-400">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-sm"
                          style={{ background: METHOD_COLOR[m] }}
                        />
                        {METHOD_LABEL[m]}
                        <span className="text-gray-600">({methodCounts[m] ?? 0})</span>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Avg scan meshes by method */}
                <div className="card">
                  <h2 className="text-sm font-semibold text-gray-400 mb-1">Avg Scan Meshes by Method</h2>
                  <p className="text-xs text-gray-600 mb-4">Does method choice affect spatial mapping quality?</p>
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={meshByMethod} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                      <XAxis dataKey="method" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                      <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} allowDecimals={false} />
                      <Tooltip
                        {...TOOLTIP_STYLE}
                        formatter={(v, _n, props) => [`${v ?? 0} meshes (n=${props.payload.n})`, 'Avg']}
                      />
                      <Bar dataKey="avg" radius={[4, 4, 0, 0]}>
                        {meshByMethod.map((entry) => (
                          <Cell key={entry.key} fill={METHOD_COLOR[entry.key] ?? '#6b7280'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Daily trend stacked by method */}
                <div className="card">
                  <h2 className="text-sm font-semibold text-gray-400 mb-1">Daily Calibration Confirms</h2>
                  <p className="text-xs text-gray-600 mb-4">Stacked by calibration method</p>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={trendData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                      <XAxis dataKey="day" tick={{ fontSize: 9, fill: '#9ca3af' }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} allowDecimals={false} />
                      <Tooltip {...TOOLTIP_STYLE} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="points" name="Points" stackId="a" fill={METHOD_COLOR.points} />
                      <Bar dataKey="single_press" name="Single Press" stackId="a" fill={METHOD_COLOR.single_press} />
                      <Bar
                        dataKey="skip_verify"
                        name="Skip Verify"
                        stackId="a"
                        fill={METHOD_COLOR.skip_verify}
                        radius={[3, 3, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Scan mesh distribution */}
                <div className="card">
                  <h2 className="text-sm font-semibold text-gray-400 mb-1">Scan Mesh Distribution</h2>
                  <p className="text-xs text-gray-600 mb-4">
                    Count of confirms per mesh range — low values (&lt;5) may indicate poor room scanning
                  </p>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={meshDist} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                      <XAxis dataKey="range" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                      <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} allowDecimals={false} />
                      <Tooltip
                        {...TOOLTIP_STYLE}
                        formatter={(v) => [`${v ?? 0} confirms`, 'Count']}
                      />
                      <Bar dataKey="Count" radius={[4, 4, 0, 0]}>
                        {meshDist.map((entry, i) => (
                          <Cell
                            key={i}
                            fill={
                              entry.range === '0–4'
                                ? '#ef4444'
                                : entry.range === '5–9'
                                ? '#eab308'
                                : '#22c55e'
                            }
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Correlation: scan meshes vs recalibrations */}
              {scatterData.length > 0 && (
                <div className="card">
                  <h2 className="text-sm font-semibold text-gray-400 mb-1">
                    Scan Mesh Quality vs. Recalibration Frequency
                  </h2>
                  <p className="text-xs text-gray-600 mb-4">
                    Per-device correlation over the selected date window. Each dot is a device — lower mesh counts may
                    predict more in-session recalibrations.
                  </p>
                  <ResponsiveContainer width="100%" height={260}>
                    <ScatterChart margin={{ top: 8, right: 24, bottom: 24, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis
                        dataKey="avgMeshes"
                        type="number"
                        name="Avg Scan Meshes"
                        tick={{ fontSize: 10, fill: '#9ca3af' }}
                        label={{ value: 'Avg Scan Meshes', position: 'insideBottom', offset: -12, fill: '#6b7280', fontSize: 11 }}
                      />
                      <YAxis
                        dataKey="recalibrations"
                        type="number"
                        name="Recalibrations"
                        tick={{ fontSize: 10, fill: '#9ca3af' }}
                        label={{ value: 'Recalibrations', angle: -90, position: 'insideLeft', fill: '#6b7280', fontSize: 11 }}
                        allowDecimals={false}
                      />
                      <Tooltip
                        {...TOOLTIP_STYLE}
                        cursor={{ strokeDasharray: '3 3' }}
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null
                          const d = payload[0].payload as { device: string; avgMeshes: number; recalibrations: number }
                          return (
                            <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs">
                              <p className="font-mono text-indigo-400 mb-1">{d.device}</p>
                              <p className="text-gray-300">Avg meshes: <span className="text-white">{d.avgMeshes}</span></p>
                              <p className="text-gray-300">Recalibrations: <span className="text-white">{d.recalibrations}</span></p>
                            </div>
                          )
                        }}
                      />
                      <Scatter data={scatterData} fill="#6366f1" fillOpacity={0.75} />
                    </ScatterChart>
                  </ResponsiveContainer>
                  <p className="text-xs text-gray-600 mt-2">
                    Note: joined on device_id only — recalibration events come from{' '}
                    <code className="text-gray-500">session_stage_events</code> (stage transitions) and are a different
                    signal from calibration confirms.
                  </p>
                </div>
              )}

              {/* Device quality table */}
              <div className="card overflow-x-auto">
                <h2 className="text-sm font-semibold text-gray-400 mb-1">Device Quality Summary</h2>
                <p className="text-xs text-gray-600 mb-4">
                  Sorted by avg scan meshes ascending — red badge = avg &lt; 5 meshes
                </p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b border-gray-800">
                      <th className="text-left pb-2 pr-4">Device</th>
                      <th className="text-right pb-2 pr-4">Confirms</th>
                      <th className="text-right pb-2 pr-4">Avg Meshes</th>
                      <th className="text-left pb-2 pr-4">Top Method</th>
                      <th className="text-right pb-2 pr-4">Low-Mesh %</th>
                      <th className="text-left pb-2">Last Seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deviceStats.map((d) => (
                      <tr key={d.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                        <td className="py-2 pr-4">
                          <div className="flex items-center gap-2">
                            <Link
                              to={`/devices/${d.id}`}
                              className="font-mono text-indigo-400 hover:text-indigo-300 text-xs"
                            >
                              {d.id}
                            </Link>
                            {d.avgMeshes !== null && d.avgMeshes < 5 && (
                              <span className="text-[10px] bg-red-900/60 text-red-400 border border-red-800 px-1.5 py-0.5 rounded">
                                Low mesh
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2 pr-4 text-right text-xs text-gray-300">{d.total}</td>
                        <td className={`py-2 pr-4 text-right text-xs font-mono font-semibold ${meshColor(d.avgMeshes)}`}>
                          {d.avgMeshes !== null ? d.avgMeshes.toFixed(1) : '—'}
                        </td>
                        <td className="py-2 pr-4 text-xs">
                          <span
                            className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                            style={{
                              background: `${METHOD_COLOR[d.topMethod] ?? '#374151'}22`,
                              color: METHOD_COLOR[d.topMethod] ?? '#9ca3af',
                              border: `1px solid ${METHOD_COLOR[d.topMethod] ?? '#374151'}44`,
                            }}
                          >
                            {METHOD_LABEL[d.topMethod] ?? d.topMethod}
                          </span>
                        </td>
                        <td className={`py-2 pr-4 text-right text-xs ${d.lowMeshPct !== null && d.lowMeshPct > 50 ? 'text-red-400' : 'text-gray-300'}`}>
                          {d.lowMeshPct !== null ? `${d.lowMeshPct.toFixed(0)}%` : '—'}
                        </td>
                        <td className="py-2 text-xs text-gray-400">
                          {d.latestAt ? msToLabel(d.latestAt) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
