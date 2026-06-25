interface MetricCardProps {
  label: string
  value: string | number
  sub?: string
  color?: string
}

export default function MetricCard({ label, value, sub, color = 'text-white' }: MetricCardProps) {
  return (
    <div className="card">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-3xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  )
}
