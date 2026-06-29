import { NavLink } from 'react-router-dom'

const navItems = [
  { to: '/', label: 'Fleet Overview', icon: '📊' },
  { to: '/funnel', label: 'Funnel', icon: '🔽' },
  { to: '/completion', label: 'Completion', icon: '✅' },
  { to: '/durations', label: 'Durations', icon: '⏱' },
  { to: '/devices', label: 'Devices', icon: '🥽' },
  { to: '/problems', label: 'Problems', icon: '⚠️' },
  { to: '/wrong-location', label: 'Wrong Location', icon: '🎯' },
  { to: '/recalibration', label: 'Recalibration', icon: '🔄' },
  { to: '/spatial', label: 'Spatial', icon: '📍' },
]

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center gap-6 sticky top-0 z-50">
        <div className="flex items-center gap-2 mr-4">
          <span className="text-xl">🎮</span>
          <span className="font-bold text-white tracking-tight">LBVR Analytics</span>
        </div>
        <nav className="flex gap-1 flex-wrap">
          {navItems.map((item) => (
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
        </nav>
      </header>
      <main className="flex-1 p-6 max-w-screen-2xl mx-auto w-full">{children}</main>
    </div>
  )
}
