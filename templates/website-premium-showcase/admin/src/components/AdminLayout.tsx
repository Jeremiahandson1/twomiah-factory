import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { FileText, Image as ImageIcon, Settings, Inbox, LogOut, Users, UserCircle, CreditCard, Newspaper, Shield, Calendar, Globe, BarChart3, Mail } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../api/client'

type NavItem = { to: string; label: string; Icon: typeof FileText; adminOnly?: boolean; customerVisible?: boolean }

const NAV: NavItem[] = [
  { to: '/pages',    label: 'Pages',    Icon: FileText,    customerVisible: true },
  { to: '/posts',    label: 'Blog',     Icon: Newspaper },
  { to: '/bookings', label: 'Bookings', Icon: Calendar },
  { to: '/photos',   label: 'Photos',   Icon: ImageIcon,   customerVisible: true },
  { to: '/settings', label: 'Settings', Icon: Settings },
  { to: '/leads',    label: 'Leads',    Icon: Inbox },
  { to: '/analytics', label: 'Traffic',  Icon: BarChart3 },
  { to: '/billing',  label: 'Billing',  Icon: CreditCard,  adminOnly: true },
  { to: '/domain',   label: 'Domain',   Icon: Globe,       adminOnly: true },
  { to: '/email',    label: 'Email',    Icon: Mail,        adminOnly: true },
  { to: '/users',    label: 'Users',    Icon: Users,       adminOnly: true },
  { to: '/activity', label: 'Activity', Icon: Shield,      adminOnly: true },
  { to: '/account',  label: 'Account',  Icon: UserCircle },
]

export function AdminLayout() {
  const { user, logout } = useAuth()
  const isCustomer = user?.role === 'customer'
  const items = NAV.filter((n) => {
    if (isCustomer) return n.customerVisible
    return !n.adminOnly || user?.role === 'admin'
  })
  const [newLeadCount, setNewLeadCount] = useState<number>(0)

  // Poll new-lead count every 60s so customers see the badge update
  // without refreshing. Best-effort — silently zero on failure.
  useEffect(() => {
    let cancelled = false
    async function fetchCount() {
      try {
        const { leads } = await api.get<{ leads: Array<{ status?: string }> }>('/api/admin/leads?status=new')
        if (!cancelled) setNewLeadCount((leads || []).length)
      } catch { if (!cancelled) setNewLeadCount(0) }
    }
    fetchCount()
    const t = setInterval(fetchCount, 60_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  return (
    <div className="h-full flex bg-paper">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 bg-brand-deep text-white flex flex-col">
        <div className="px-5 py-6 border-b border-white/10">
          <div className="font-display text-xl font-semibold">{isCustomer ? 'Customize your site' : 'Premium Admin'}</div>
          <div className="text-xs text-white/50 mt-1">{isCustomer ? 'Tweak text, swap photos, save when ready' : user?.email}</div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {items.map(({ to, label, Icon }) => {
            const badge = to === '/leads' && newLeadCount > 0 ? newLeadCount : null
            return (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) => clsx('nav-link', isActive && 'nav-link-active')}
              >
                <Icon className="w-4 h-4" />
                <span className="flex-1">{label}</span>
                {badge !== null && (
                  <span className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-orange-500 text-white text-[10px] font-bold">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </NavLink>
            )
          })}
        </nav>
        <div className="px-3 py-4 border-t border-white/10">
          <button onClick={logout} className="nav-link w-full">
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
