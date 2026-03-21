import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Users, Factory, LogOut, Zap, LifeBuoy, BarChart3, Settings, DollarSign, FileBarChart } from 'lucide-react'
import { useState, useEffect } from 'react'
import { supabase, API_URL as API } from '../supabase'
import { useUser, type UserRole } from '../contexts/UserContext'

export default function AppLayout() {
  const navigate = useNavigate()
  const { hasRole } = useUser()

  const [roofPending, setRoofPending] = useState(0)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return
      fetch(`${API}/api/v1/factory/roof-review/count`, { headers: { Authorization: `Bearer ${session.access_token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setRoofPending(d.pending || 0) })
        .catch(() => {})
    }).catch(() => {})
    // Poll every 60s
    const interval = setInterval(() => {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (!session) return
        fetch(`${API}/api/v1/factory/roof-review/count`, { headers: { Authorization: `Bearer ${session.access_token}` } })
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (d) setRoofPending(d.pending || 0) })
          .catch(() => {})
      }).catch(() => {})
    }, 60000)
    return () => clearInterval(interval)
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate('/login')
  }

  const navItems: { to: string; icon: typeof LayoutDashboard; label: string; end?: boolean; roles?: UserRole[] }[] = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
    { to: '/tenants', icon: Users, label: 'Customers' },
    { to: '/factory', icon: Factory, label: 'Factory', roles: ['owner', 'admin', 'editor'] },
    { to: '/roof-review', icon: FileBarChart, label: 'Roof Review', roles: ['owner', 'admin'] },
    { to: '/support', icon: LifeBuoy, label: 'Support' },
    { to: '/analytics', icon: BarChart3, label: 'Analytics' },
    { to: '/pricing', icon: DollarSign, label: 'Pricing', roles: ['owner', 'admin'] },
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
          {navItems
            .filter(({ roles }) => !roles || hasRole(...roles))
            .map(({ to, icon: Icon, label, end }) => (
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
              {to === '/roof-review' && roofPending > 0 && (
                <span className="ml-auto px-1.5 py-0.5 text-[10px] font-bold bg-orange-500 text-white rounded-full min-w-[18px] text-center">
                  {roofPending}
                </span>
              )}
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
