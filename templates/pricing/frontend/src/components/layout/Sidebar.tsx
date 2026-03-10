import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import {
  LayoutDashboard,
  FilePlus,
  FileText,
  DollarSign,
  Calculator,
  BookOpen,
  Upload,
  Users,
  BarChart3,
  FileSignature,
  Tag,
  Map,
  CreditCard,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronLeft,
} from 'lucide-react'

interface NavItem {
  label: string
  to: string
  icon: React.ReactNode
  roles: string[]
}

const navItems: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: <LayoutDashboard size={22} />, roles: ['admin', 'manager', 'rep'] },
  { label: 'New Quote', to: '/quote/new', icon: <FilePlus size={22} />, roles: ['admin', 'manager', 'rep'] },
  { label: 'My Quotes', to: '/quotes', icon: <FileText size={22} />, roles: ['admin', 'manager', 'rep'] },
  { label: 'New Estimate', to: '/estimator/new', icon: <Calculator size={22} />, roles: ['admin', 'manager', 'rep'] },
  { label: 'Commissions', to: '/commissions', icon: <DollarSign size={22} />, roles: ['admin', 'manager', 'rep'] },
  { label: 'Pricebook', to: '/admin/pricebook', icon: <BookOpen size={22} />, roles: ['admin', 'manager'] },
  { label: 'Estimator', to: '/admin/estimator', icon: <Calculator size={22} />, roles: ['admin', 'manager'] },
  { label: 'Import', to: '/admin/import', icon: <Upload size={22} />, roles: ['admin', 'manager'] },
  { label: 'Reps', to: '/admin/reps', icon: <Users size={22} />, roles: ['admin', 'manager'] },
  { label: 'Analytics', to: '/admin/analytics', icon: <BarChart3 size={22} />, roles: ['admin', 'manager'] },
  { label: 'Contracts', to: '/admin/contracts', icon: <FileSignature size={22} />, roles: ['admin', 'manager'] },
  { label: 'Promotions', to: '/admin/promotions', icon: <Tag size={22} />, roles: ['admin', 'manager'] },
  { label: 'Territories', to: '/admin/territories', icon: <Map size={22} />, roles: ['admin', 'manager'] },
  { label: 'Financing', to: '/admin/financing', icon: <CreditCard size={22} />, roles: ['admin', 'manager'] },
  { label: 'Settings', to: '/admin/settings', icon: <Settings size={22} />, roles: ['admin'] },
]

export default function Sidebar() {
  const { user, company, logout } = useAuth()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  const userRole = user?.role || 'rep'
  const visibleItems = navItems.filter((item) => item.roles.includes(userRole))

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-gray-200">
        {company?.logo ? (
          <img
            src={company.logo}
            alt={company.name}
            className="w-9 h-9 rounded-lg object-contain flex-shrink-0"
          />
        ) : (
          <div className="w-9 h-9 rounded-lg bg-primary-500 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
            {(company?.name || 'C')[0]}
          </div>
        )}
        {!collapsed && (
          <span className="font-semibold text-gray-900 text-lg truncate">
            {company?.name || '{{COMPANY_NAME}}'}
          </span>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="ml-auto p-1.5 rounded-lg hover:bg-gray-100 transition-colors touch-manipulation hidden lg:flex"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <ChevronLeft
            size={20}
            className={`text-gray-500 transition-transform ${collapsed ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 px-2">
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-3 rounded-lg text-base font-medium transition-colors touch-manipulation min-h-[48px] ${
                isActive
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-gray-700 hover:bg-gray-100'
              }`
            }
          >
            <span className="flex-shrink-0">{item.icon}</span>
            {!collapsed && <span className="truncate">{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* User section */}
      <div className="border-t border-gray-200 px-3 py-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-semibold text-base flex-shrink-0">
            {(user?.name || 'U')[0].toUpperCase()}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {user?.name || 'User'}
              </p>
              <p className="text-xs text-gray-500 truncate capitalize">
                {user?.role || 'rep'}
              </p>
            </div>
          )}
          <button
            onClick={logout}
            className="p-2.5 rounded-lg hover:bg-gray-100 transition-colors touch-manipulation"
            aria-label="Logout"
            title="Logout"
          >
            <LogOut size={20} className="text-gray-500" />
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-3 left-3 z-40 p-2.5 bg-white rounded-lg shadow-md touch-manipulation"
        aria-label="Open menu"
      >
        <Menu size={24} className="text-gray-700" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar */}
      <aside
        className={`lg:hidden fixed inset-y-0 left-0 z-50 w-72 bg-white shadow-xl transition-transform duration-200 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <button
          onClick={() => setMobileOpen(false)}
          className="absolute top-3 right-3 p-2 rounded-lg hover:bg-gray-100 touch-manipulation"
          aria-label="Close menu"
        >
          <X size={22} className="text-gray-500" />
        </button>
        {sidebarContent}
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={`hidden lg:flex flex-col bg-white border-r border-gray-200 transition-all duration-200 ${
          collapsed ? 'w-[72px]' : 'w-64'
        }`}
      >
        {sidebarContent}
      </aside>
    </>
  )
}
