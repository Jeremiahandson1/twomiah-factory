import { NavLink, Outlet } from 'react-router-dom'
import { FileText, Image as ImageIcon, Settings, Inbox, LogOut, Users, UserCircle } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '../contexts/AuthContext'

type NavItem = { to: string; label: string; Icon: typeof FileText; adminOnly?: boolean }

const NAV: NavItem[] = [
  { to: '/pages',    label: 'Pages',    Icon: FileText },
  { to: '/photos',   label: 'Photos',   Icon: ImageIcon },
  { to: '/settings', label: 'Settings', Icon: Settings },
  { to: '/leads',    label: 'Leads',    Icon: Inbox },
  { to: '/users',    label: 'Users',    Icon: Users, adminOnly: true },
  { to: '/account',  label: 'Account',  Icon: UserCircle },
]

export function AdminLayout() {
  const { user, logout } = useAuth()
  const items = NAV.filter((n) => !n.adminOnly || user?.role === 'admin')

  return (
    <div className="h-full flex bg-paper">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 bg-brand-deep text-white flex flex-col">
        <div className="px-5 py-6 border-b border-white/10">
          <div className="font-display text-xl font-semibold">Premium Admin</div>
          <div className="text-xs text-white/50 mt-1">{user?.email}</div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {items.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => clsx('nav-link', isActive && 'nav-link-active')}
            >
              <Icon className="w-4 h-4" />
              {label}
            </NavLink>
          ))}
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
