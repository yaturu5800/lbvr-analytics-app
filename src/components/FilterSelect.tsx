interface Props {
  options: string[]
  value: string
  onChange: (v: string) => void
  placeholder?: string
}

export default function FilterSelect({ options, value, onChange, placeholder = 'All' }: Props) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-gray-200 min-w-[120px]"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  )
}
