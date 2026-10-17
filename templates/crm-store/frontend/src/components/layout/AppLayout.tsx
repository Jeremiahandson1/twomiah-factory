import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Home, Package, ShoppingBag, Users, CreditCard, Tag, Settings, LogOut, Menu, X, Store , Mail , Truck , Star, LifeBuoy, Gift, Shield, Sun, Moon, Globe, KeyRound } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { usePermissions, useTheme } from '../../shared'

// `permission` is what the page's API asks before it answers. An entry without one is a page every
// seat can open (owner, manager and staff all read it; its write controls ask for themselves). Suppliers
// and Google Reviews are integrations — owner and admin on every CRM — so a manager or staff member was
// shown two links that opened onto a refusal.
const NAV: { to: string; label: string; icon: any; end?: boolean; permission?: string }[] = [
  { to: '/', label: 'Dashboard', icon: Home, end: true },
  { to: '/products', label: 'Products', icon: Package },
  { to: '/orders', label: 'Orders', icon: ShoppingBag },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/payments', label: 'Payments', icon: CreditCard },
  { to: '/discounts', label: 'Discounts', icon: Tag },
  { to: '/loyalty', label: 'Loyalty', icon: Gift },
  { to: '/suppliers', label: 'Suppliers', icon: Truck, permission: 'integrations:update' },
  { to: '/shipping', label: 'Shipping', icon: Package },
  { to: '/reviews', label: 'Reviews', icon: Star },
  { to: '/google-reviews', label: 'Google Reviews', icon: Star, permission: 'integrations:update' },
  { to: '/email', label: 'Email', icon: Mail },
  // The store's web address — buying one, or connecting one it owns, is the owner's (settings:update, routes/domain.ts).
  { to: '/domain', label: 'Domain', icon: Globe, permission: 'settings:update' },
  { to: '/settings', label: 'Settings', icon: Settings },
  // Who did what, when — the owner's (audit:read, as routes/audit.ts asks).
  { to: '/audit', label: 'Audit Log', icon: Shield, permission: 'audit:read' },

  { to: '/contact-support', icon: LifeBuoy, label: 'Contact Twomiah' },
]

const companyName = import.meta.env.VITE_COMPANY_NAME || 'Store'

export default function AppLayout() {
  const { user, logout } = useAuth()
  const { known, can } = usePermissions()
  // Hidden only once the list has arrived and says no — never on a guess.
  const nav = NAV.filter((item) => !item.permission || !known || can(item.permission))
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  // Light or dark, saved per browser — the same control, wording and storage as every other CRM's shell. (Store sweep,
  // 10/12: the ten CRMs had it; the store rendered light whatever the person chose.)
  const { setTheme, isDark } = useTheme()
  const themeButton = (
    <button type="button" onClick={() => setTheme(isDark ? 'light' : 'dark')} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700" aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'} title={isDark ? 'Light mode' : 'Dark mode'}>
      {isDark ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-gray-600 dark:text-slate-400" />}
    </button>
  )

  const doLogout = async () => { await logout(); navigate('/login') }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-800 dark:text-slate-100">
      {/* Mobile top bar */}
      <div className="lg:hidden flex items-center justify-between bg-white border-b px-4 py-3 dark:bg-slate-900 dark:border-slate-700">
        <div className="flex items-center gap-2 font-semibold text-gray-900 dark:text-slate-100">
          <Store className="h-5 w-5 text-primary-500 dark:text-primary-300" /> {companyName}
        </div>
        <div className="flex items-center gap-1">
        {themeButton}
        <button onClick={() => setOpen(!open)} aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} className="p-2 text-gray-600 dark:text-slate-300">
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        </div>
      </div>

      <div className="flex">
        {/* Sidebar */}
        <aside className={`${open ? 'block' : 'hidden'} lg:block fixed lg:static inset-0 top-[57px] lg:top-0 z-20 w-full lg:w-64 bg-white border-r lg:min-h-screen dark:bg-slate-900 dark:border-slate-700`}>
          <div className="hidden lg:flex items-center gap-2 px-6 py-5 font-semibold text-gray-900 border-b dark:text-slate-100 dark:border-slate-700">
            <Store className="h-5 w-5 text-primary-500 dark:text-primary-300" /> <span className="flex-1 truncate">{companyName}</span> {themeButton}
          </div>
          <nav className="p-3 space-y-1">
            {nav.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-primary-50 text-primary-700 dark:bg-slate-800 dark:text-white' : 'text-gray-600 hover:bg-gray-50 dark:hover:bg-slate-800 dark:text-slate-300'}`}>
                <Icon className="h-4 w-4" /> {label}
              </NavLink>
            ))}
          </nav>
          <div className="p-3 border-t mt-auto dark:border-slate-700">
            <div className="px-3 py-2 text-xs text-gray-500 truncate dark:text-slate-400">{user?.email}</div>
            {/* This person's own password and two-factor: offered to every seat, with no permission, like Sign out. */}
            <NavLink to="/account" onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-primary-50 text-primary-700 dark:bg-slate-800 dark:text-white' : 'text-gray-600 hover:bg-gray-50 dark:hover:bg-slate-800 dark:text-slate-300'}`}>
              <KeyRound className="h-4 w-4" /> My account
            </NavLink>
            <button onClick={doLogout} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 dark:hover:bg-slate-800 dark:text-slate-300">
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
