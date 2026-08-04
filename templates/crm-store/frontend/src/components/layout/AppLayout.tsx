import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Home, Package, ShoppingBag, Users, CreditCard, Tag, Settings, LogOut, Menu, X, Store , Mail , Truck } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'

const NAV = [
  { to: '/', label: 'Dashboard', icon: Home, end: true },
  { to: '/products', label: 'Products', icon: Package },
  { to: '/orders', label: 'Orders', icon: ShoppingBag },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/payments', label: 'Payments', icon: CreditCard },
  { to: '/discounts', label: 'Discounts', icon: Tag },
  { to: '/suppliers', label: 'Suppliers', icon: Truck },
  { to: '/email', label: 'Email', icon: Mail },
  { to: '/settings', label: 'Settings', icon: Settings },
]

const companyName = import.meta.env.VITE_COMPANY_NAME || 'Store'

export default function AppLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  const doLogout = async () => { await logout(); navigate('/login') }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Mobile top bar */}
      <div className="lg:hidden flex items-center justify-between bg-white border-b px-4 py-3">
        <div className="flex items-center gap-2 font-semibold text-gray-900">
          <Store className="h-5 w-5 text-primary-500" /> {companyName}
        </div>
        <button onClick={() => setOpen(!open)} className="p-2 text-gray-600">
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      <div className="flex">
        {/* Sidebar */}
        <aside className={`${open ? 'block' : 'hidden'} lg:block fixed lg:static inset-0 top-[57px] lg:top-0 z-20 w-full lg:w-64 bg-white border-r lg:min-h-screen`}>
          <div className="hidden lg:flex items-center gap-2 px-6 py-5 font-semibold text-gray-900 border-b">
            <Store className="h-5 w-5 text-primary-500" /> {companyName}
          </div>
          <nav className="p-3 space-y-1">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:bg-gray-50'}`}>
                <Icon className="h-4 w-4" /> {label}
              </NavLink>
            ))}
          </nav>
          <div className="p-3 border-t mt-auto">
            <div className="px-3 py-2 text-xs text-gray-500 truncate">{user?.email}</div>
            <button onClick={doLogout} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
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
