import { format } from 'date-fns'

export function msToDate(ms: number): Date {
  return new Date(ms)
}

export function msToLabel(ms: number): string {
  return format(new Date(ms), 'MMM d, yyyy HH:mm')
}

export function msToDay(ms: number): string {
  return format(new Date(ms), 'yyyy-MM-dd')
}

export function secondsToHMS(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

export function pct(num: number, denom: number): string {
  if (!denom) return '—'
  return ((num / denom) * 100).toFixed(1) + '%'
}

export function getOutcomeLabel(session: {
  was_completed: boolean
  was_operator_ended: number
  was_skipped_to_main: number
  was_operator_reset?: number
}): string {
  if (session.was_completed && session.was_skipped_to_main === 0) return 'Natural'
  if (session.was_completed && session.was_skipped_to_main === 1) return 'Skip→Done'
  if (session.was_operator_ended === 1) return 'Operator Ended'
  if (session.was_operator_reset === 1) return 'Operator Reset'
  return 'Failure'
}

export function getOutcomeColor(label: string): string {
  switch (label) {
    case 'Natural': return 'text-green-400'
    case 'Skip→Done': return 'text-blue-400'
    case 'Operator Ended': return 'text-yellow-400'
    case 'Operator Reset': return 'text-orange-400'
    default: return 'text-red-400'
  }
}

export const EXPERIENCE_END_STAGES = ['ExperienceEnd', 'ExpereinceEnd']
