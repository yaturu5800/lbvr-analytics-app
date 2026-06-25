import { useEffect, useState } from 'react'
import { subDays } from 'date-fns'
import { supabase } from '../lib/supabase'
import { pct } from '../lib/utils'
import type { SessionStageEvent, ExperienceSession } from '../types'
import DateRangePicker from '../components/DateRangePicker'
import FilterSelect from '../components/FilterSelect'
import EmptyState from '../components/EmptyState'
import MetricCard from '../components/MetricCard'

const FUNNEL_STAGES = [
  { label: 'PreExperience', key: 'pre', stageKey: 'PreExperience' },
  { label: 'ExperienceStart', key: 'start', stageKey: 'ExperienceStart' },
  { label: 'ExperienceMain', key: 'main', stageKey: 'ExperienceMain' },
  { label: 'ExperienceEnd', key: 'end', stageKey: 'ExperienceEnd' },
]

export default function FunnelAnalysis() {
  const [events, setEvents] = useState<SessionStageEvent[]>([])
  const [sessions, setSessions] = useState<ExperienceSession[]>([])
  const [loading, setLoading] = useState(true)
  const [start, setStart] = useState(subDays(new Date(), 30))
  const [end, setEnd] = useState(new Date())
  const [premiseFilter, setPremiseFilter] = useState('')
  const [expFilter, setExpFilter] = useState('')

  useEffect(() => {
    async function load() {
      setLoading(true)
      const startMs = start.getTime()
      const endMs = end.getTime()

      const [eventsRes, sessionsRes] = await Promise.all([
        supabase
          .from('session_stage_events')
          .select('*')
          .gte('transitioned_at', startMs)
          .lte('transitioned_at', endMs),
        supabase
          .from('experience_sessions')
          .select('session_id, was_skipped_to_main, was_operator_ended, premise_id, experience_id')
          .gte('started_at', startMs)
          .lte('started_at', endMs),
      ])

      let evs: SessionStageEvent[] = (eventsRes.data ?? []) as SessionStageEvent[]
      let sess: Pick<ExperienceSession, 'session_id' | 'was_skipped_to_main' | 'was_operator_ended' | 'premise_id' | 'experience_id'>[] =
        (sessionsRes.data ?? []) as Pick<ExperienceSession, 'session_id' | 'was_skipped_to_main' | 'was_operator_ended' | 'premise_id' | 'experience_id'>[]

      if (premiseFilter) {
        evs = evs.filter((e) => e.premise_id === premiseFilter)
        sess = sess.filter((s) => s.premise_id === premiseFilter)
      }
      if (expFilter) {
        evs = evs.filter((e) => e.experience_id === expFilter)
        sess = sess.filter((s) => s.experience_id === expFilter)
      }
      setEvents(evs)
      setSessions(sess as unknown as ExperienceSession[])
      setLoading(false)
    }
    load()
  }, [start, end, premiseFilter, expFilter])

  const premises = [...new Set(events.map((e) => e.premise_id))].filter(Boolean)
  const experiences = [...new Set(events.map((e) => e.experience_id))].filter(Boolean)

  // Count distinct session_ids at each stage
  const sessionsAtStage = (stageTo: string | string[]) => {
    const stages = Array.isArray(stageTo) ? stageTo : [stageTo]
    return new Set(
      events.filter((e) => stages.includes(e.stage_to) && e.session_id).map((e) => e.session_id)
    ).size
  }

  const preCount = sessionsAtStage('PreExperience')
  const startCount = sessionsAtStage('ExperienceStart')
  const mainCount = sessionsAtStage('ExperienceMain')
  const endCount = sessionsAtStage(['ExperienceEnd', 'ExpereinceEnd'])

  const operatorTriggered = events.filter((e) => e.was_operator_triggered === 1).length
  const skipCount = sessions.filter((s) => s.was_skipped_to_main === 1).length

  const isEmpty = events.length === 0

  const stageData = [
    { label: 'Pre-Experience', count: preCount, color: 'bg-indigo-500' },
    { label: 'Experience Start', count: startCount, color: 'bg-cyan-500' },
    { label: 'Experience Main', count: mainCount, color: 'bg-amber-500' },
    { label: 'Experience End', count: endCount, color: 'bg-green-500' },
  ]

  const maxCount = Math.max(...stageData.map((s) => s.count), 1)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-white mr-2">Funnel Analysis</h1>
        <DateRangePicker start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e) }} />
        <FilterSelect options={premises} value={premiseFilter} onChange={setPremiseFilter} placeholder="All Premises" />
        <FilterSelect options={experiences} value={expFilter} onChange={setExpFilter} placeholder="All Experiences" />
      </div>

      <div className="card text-sm text-amber-400 bg-amber-950/30 border-amber-800">
        ℹ️ Stage event data is only available from 2026-06-25 onwards. Earlier sessions will not appear here.
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : isEmpty ? (
        <EmptyState message="No stage event data yet. Data is still accumulating." />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard label="Operator-triggered transitions" value={operatorTriggered} />
            <MetricCard label="Sessions with skip-to-main" value={skipCount} />
            <MetricCard label="Start→End completion" value={pct(endCount, startCount)} color="text-green-400" />
            <MetricCard label="Pre→End full rate" value={pct(endCount, preCount)} color="text-cyan-400" />
          </div>

          <div className="card space-y-4">
            <h2 className="text-sm font-semibold text-gray-400">Funnel Drop-off</h2>
            {stageData.map((stage, i) => {
              const prev = i > 0 ? stageData[i - 1].count : stage.count
              const dropRate = i > 0 && prev > 0 ? ((prev - stage.count) / prev * 100).toFixed(1) : null
              return (
                <div key={stage.label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>{stage.label}</span>
                    <span className="font-mono">{stage.count.toLocaleString()}</span>
                  </div>
                  <div className="w-full bg-gray-800 rounded-full h-6 relative overflow-hidden">
                    <div
                      className={`h-full ${stage.color} transition-all duration-500`}
                      style={{ width: `${(stage.count / maxCount) * 100}%` }}
                    />
                  </div>
                  {dropRate !== null && (
                    <p className="text-xs text-red-400 ml-1">
                      ↓ {dropRate}% drop-off ({(prev - stage.count).toLocaleString()} sessions lost)
                    </p>
                  )}
                  {i < stageData.length - 1 && (
                    <p className="text-xs text-gray-600 ml-1">
                      Transition: {pct(stageData[i + 1].count, stage.count)}
                    </p>
                  )}
                </div>
              )
            })}
          </div>

          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 mb-3">Stage Breakdown Table</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-800">
                  <th className="text-left pb-2">Stage</th>
                  <th className="text-right pb-2">Sessions</th>
                  <th className="text-right pb-2">Transition Rate</th>
                </tr>
              </thead>
              <tbody>
                {stageData.map((s, i) => (
                  <tr key={s.label} className="border-b border-gray-800/50">
                    <td className="py-2 text-gray-300">{s.label}</td>
                    <td className="py-2 text-right font-mono">{s.count.toLocaleString()}</td>
                    <td className="py-2 text-right text-gray-500">
                      {i < stageData.length - 1 ? pct(stageData[i + 1].count, s.count) : '—'}
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
