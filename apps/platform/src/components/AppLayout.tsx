import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Users, Factory, LogOut, Zap, LifeBuoy, BarChart3, Settings } from 'lucide-react'
import { supabase } from '../supabase'

export default function AppLayout() {
  const navigate = useNavigate()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate('/login')
  }

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
    { to: '/tenants', icon: Users, label: 'Customers' },
    { to: '/factory', icon: Factory, label: 'Factory' },
    { to: '/support', icon: LifeBuoy, label: 'Support' },
    { to: '/analytics', icon: BarChart3, label: 'Analytics' },
    { to: '/settings', icon: Settings, label: 'Settings' },
  ]

  return (
    <div className="flex h-screen bg-gray-950 text-white">
      <aside className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="p-6 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Zap className="text-blue-500" size={22} />
            <span className="font-bold text-lg tracking-tight">Twomiah Factory</span>
          </div>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ' +
                (isActive ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800')
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t border-gray-800">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 w-full transition-colors"
          >
            <LogOut size={18} />
            Sign Out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
