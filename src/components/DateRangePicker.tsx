import { useState } from 'react'
import { format, subDays } from 'date-fns'

interface DateRangePickerProps {
  start: Date
  end: Date
  onChange: (start: Date, end: Date) => void
}

const PRESETS = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
]

export default function DateRangePicker({ start, end, onChange }: DateRangePickerProps) {
  const [startStr, setStartStr] = useState(format(start, 'yyyy-MM-dd'))
  const [endStr, setEndStr] = useState(format(end, 'yyyy-MM-dd'))

  function apply(s: string, e: string) {
    const d1 = new Date(s + 'T00:00:00')
    const d2 = new Date(e + 'T23:59:59')
    if (!isNaN(d1.getTime()) && !isNaN(d2.getTime())) onChange(d1, d2)
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => {
              const s = subDays(new Date(), p.days)
              const e = new Date()
              setStartStr(format(s, 'yyyy-MM-dd'))
              setEndStr(format(e, 'yyyy-MM-dd'))
              onChange(s, e)
            }}
            className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300"
          >
            {p.label}
          </button>
        ))}
      </div>
      <input
        type="date"
        value={startStr}
        onChange={(e) => { setStartStr(e.target.value); apply(e.target.value, endStr) }}
        className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-200"
      />
      <span className="text-gray-500 text-xs">→</span>
      <input
        type="date"
        value={endStr}
        onChange={(e) => { setEndStr(e.target.value); apply(startStr, e.target.value) }}
        className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-200"
      />
    </div>
  )
}
