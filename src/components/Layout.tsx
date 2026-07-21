import { NavLink } from 'react-router-dom'
import { useState } from 'react'

const primaryNav = [
  { to: '/', label: 'Throughput', icon: '📊' },
  { to: '/devices', label: 'Devices', icon: '🥽' },
  { to: '/problems', label: 'Problematic Devices', icon: '⚠️' },
  { to: '/spatial', label: 'Spatial', icon: '📍' },
]

const analyticsNav = [
  { to: '/funnel', label: 'Funnel' },
  { to: '/completion', label: 'Completion' },
  { to: '/durations', label: 'Durations' },
  { to: '/wrong-location', label: 'Wrong Location' },
  { to: '/recalibration', label: 'Recalibration' },
  { to: '/calibration-quality', label: 'Calibration Quality' },
  { to: '/device-startup', label: 'Device Startup' },
  { to: '/daily-devices-snapshot', label: 'Daily Devices Snapshot' },
]

export default function Layout({ children }: { children: React.ReactNode }) {
  const [analyticsOpen, setAnalyticsOpen] = useState(false)

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center gap-6 sticky top-0 z-50">
        <div className="flex items-center gap-2 mr-4">
          <span className="text-xl">🎮</span>
          <span className="font-bold text-white tracking-tight">LBVR Analytics</span>
        </div>
        <nav className="flex gap-1 flex-wrap items-center">
          {primaryNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`
              }
            >
              <span>{item.icon}</span>
              <span className="hidden sm:inline">{item.label}</span>
            </NavLink>
          ))}

          <div className="relative">
            <button
              onClick={() => setAnalyticsOpen((o) => !o)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors text-gray-400 hover:text-white hover:bg-gray-800"
            >
              <span>📈</span>
              <span className="hidden sm:inline">Analytics</span>
              <span className="text-xs opacity-60">{analyticsOpen ? '▲' : '▼'}</span>
            </button>
            {analyticsOpen && (
              <div className="absolute top-full left-0 mt-1 bg-gray-900 border border-gray-700 rounded-lg py-1 min-w-[160px] shadow-xl z-50">
                {analyticsNav.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setAnalyticsOpen(false)}
                    className={({ isActive }) =>
                      `block px-4 py-2 text-sm transition-colors ${
                        isActive ? 'text-indigo-400' : 'text-gray-400 hover:text-white hover:bg-gray-800'
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        </nav>
      </header>
      <main className="flex-1 p-6 max-w-screen-2xl mx-auto w-full">{children}</main>
    </div>
  )
}
