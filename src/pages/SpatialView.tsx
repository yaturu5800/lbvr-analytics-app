import { useEffect, useState } from 'react'
import { subDays } from 'date-fns'
import { ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend } from 'recharts'
import { supabase } from '../lib/supabase'
import { msToLabel } from '../lib/utils'
import type { SessionStageEvent, ExperienceSession } from '../types'
import DateRangePicker from '../components/DateRangePicker'
import FilterSelect from '../components/FilterSelect'
import EmptyState from '../components/EmptyState'

interface Point {
  x: number
  z: number
  device_id: string
  session_id: string | null
  timestamp: number
  completed: boolean | null
}

export default function SpatialView() {
  const [points, setPoints] = useState<Point[]>([])
  const [loading, setLoading] = useState(true)
  const [start, setStart] = useState(subDays(new Date(), 30))
  const [end, setEnd] = useState(new Date())
  const [deviceFilter, setDeviceFilter] = useState('')
  const [expFilter, setExpFilter] = useState('')

  useEffect(() => {
    async function load() {
      setLoading(true)
      let q = supabase
        .from('session_stage_events')
        .select('*')
        .eq('stage_to', 'ExperienceStart')
        .gte('transitioned_at', start.getTime())
        .lte('transitioned_at', end.getTime())
        .not('position_x', 'is', null)

      if (deviceFilter) q = q.eq('device_id', deviceFilter)
      if (expFilter) q = q.eq('experience_id', expFilter)

      const { data: eventsData } = await q
      const evs: SessionStageEvent[] = eventsData ?? []

      const sessionIds = evs.map((e) => e.session_id).filter(Boolean) as string[]
      const completedSet = new Set<string>()
      if (sessionIds.length > 0) {
        const { data: sessData } = await supabase
          .from('experience_sessions')
          .select('session_id, was_completed')
          .in('session_id', sessionIds.slice(0, 500))
        for (const s of (sessData ?? []) as Pick<ExperienceSession, 'session_id' | 'was_completed'>[]) {
          if (s.was_completed) completedSet.add(s.session_id)
        }
      }

      setPoints(
        evs
          .filter((e) => e.position_x != null && e.position_z != null)
          .map((e) => ({
            x: e.position_x!,
            z: e.position_z!,
            device_id: e.device_id,
            session_id: e.session_id,
            timestamp: e.transitioned_at,
            completed: e.session_id ? completedSet.has(e.session_id) : null,
          }))
      )
      setLoading(false)
    }
    load()
  }, [start, end, deviceFilter, expFilter])

  const devices = [...new Set(points.map((p) => p.device_id))]
  const experiences: string[] = []

  const completedPoints = points.filter((p) => p.completed === true)
  const incompletePoints = points.filter((p) => p.completed === false)
  const unknownPoints = points.filter((p) => p.completed === null)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-white mr-2">Spatial View</h1>
        <DateRangePicker start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e) }} />
        <FilterSelect options={devices} value={deviceFilter} onChange={setDeviceFilter} placeholder="All Devices" />
        <FilterSelect options={experiences} value={expFilter} onChange={setExpFilter} placeholder="All Experiences" />
      </div>

      <div className="card text-sm text-amber-400 bg-amber-950/30 border-amber-800">
        ℹ️ Spatial data is only available from 2026-06-25 onwards. Points represent where each guest's headset was when their session started (stage: PreExperience → ExperienceStart).
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : points.length === 0 ? (
        <EmptyState message="No spatial data yet. Data accumulates from 2026-06-25 onwards." />
      ) : (
        <>
          <div className="flex gap-4 text-xs text-gray-400">
            <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500 mr-1" />Completed ({completedPoints.length})</span>
            <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 mr-1" />Incomplete ({incompletePoints.length})</span>
            {unknownPoints.length > 0 && <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-gray-500 mr-1" />Unknown ({unknownPoints.length})</span>}
          </div>

          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 mb-4">Starting Positions (X / Z horizontal plane)</h2>
            <ResponsiveContainer width="100%" height={500}>
              <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                <XAxis
                  dataKey="x"
                  type="number"
                  name="X"
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                  label={{ value: 'X (m)', position: 'insideBottom', fill: '#6b7280', fontSize: 11 }}
                />
                <YAxis
                  dataKey="z"
                  type="number"
                  name="Z"
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                  label={{ value: 'Z (m)', angle: -90, position: 'insideLeft', fill: '#6b7280', fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 11 }}
                  content={({ payload }) => {
                    if (!payload?.length) return null
                    const p = payload[0].payload as Point
                    return (
                      <div className="bg-gray-900 border border-gray-700 rounded p-2 text-xs">
                        <p className="text-gray-300">Device: <span className="text-white font-mono">{p.device_id}</span></p>
                        <p className="text-gray-300">Pos: ({p.x.toFixed(2)}, {p.z.toFixed(2)})</p>
                        <p className="text-gray-300">{msToLabel(p.timestamp)}</p>
                        <p className={p.completed ? 'text-green-400' : p.completed === false ? 'text-red-400' : 'text-gray-500'}>
                          {p.completed ? 'Completed' : p.completed === false ? 'Incomplete' : 'Unknown'}
                        </p>
                      </div>
                    )
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Scatter name="Completed" data={completedPoints} fill="#22c55e">
                  {completedPoints.map((_, i) => <Cell key={i} fill="#22c55e" fillOpacity={0.7} />)}
                </Scatter>
                <Scatter name="Incomplete" data={incompletePoints} fill="#ef4444">
                  {incompletePoints.map((_, i) => <Cell key={i} fill="#ef4444" fillOpacity={0.7} />)}
                </Scatter>
                {unknownPoints.length > 0 && (
                  <Scatter name="Unknown" data={unknownPoints} fill="#6b7280">
                    {unknownPoints.map((_, i) => <Cell key={i} fill="#6b7280" fillOpacity={0.5} />)}
                  </Scatter>
                )}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  )
}
