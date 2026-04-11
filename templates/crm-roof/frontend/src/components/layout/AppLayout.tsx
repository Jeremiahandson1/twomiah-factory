import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import {
  LayoutDashboard,
  Briefcase,
  Users,
  HardHat,
  Ruler,
  Package,
  FileText,
  Receipt,
  BarChart3,
  Settings,
  LogOut,
  Menu,
  X,
  Shield,
  MapPin,
  Zap,
  Inbox,
  Bot,
  Megaphone,
  Calculator,
  FileBarChart,
  Upload,
} from 'lucide-react'
import { useFeature } from '../../data/features'

const baseNavItems = [
  { label: 'Pipeline', icon: LayoutDashboard, to: '/crm/pipeline' },
  { label: 'Jobs', icon: Briefcase, to: '/crm/jobs' },
  { label: 'Contacts', icon: Users, to: '/crm/contacts' },
  { label: 'Crews', icon: HardHat, to: '/crm/crews' },
  { label: 'Measurements', icon: Ruler, to: '/crm/measurements' },
  { label: 'Materials', icon: Package, to: '/crm/materials' },
  { label: 'Quotes', icon: FileText, to: '/crm/quotes' },
  { label: 'Invoices', icon: Receipt, to: '/crm/invoices' },
  { label: 'Adjusters', icon: Shield, to: '/crm/adjusters' },
  { label: 'Lead Inbox', icon: Inbox, to: '/crm/leads' },
  { label: 'AI Receptionist', icon: Bot, to: '/crm/ai-receptionist' },
  { label: 'Roof Estimator', icon: Calculator, to: '/crm/estimator' },
  { label: 'Roof Reports', icon: FileBarChart, to: '/crm/roof-reports' },
]

const fieldNavItems = [
  { label: 'Canvassing', icon: MapPin, to: '/crm/canvassing', feature: 'canvassing_tool' },
  { label: 'Storm Leads', icon: Zap, to: '/crm/storm-leads', feature: 'storm_lead_gen' },
  { label: 'Ads', icon: Megaphone, to: '/crm/ads', feature: 'paid_ads' },
]

const bottomNavItems = [
  { label: 'Import', icon: Upload, to: '/crm/import' },
  { label: 'Reports', icon: BarChart3, to: '/crm/reports' },
  { label: 'Settings', icon: Settings, to: '/crm/settings' },
]

export default function AppLayout() {
  const { user, company, logout } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const hasCanvassing = useFeature('canvassing_tool')
  const hasStormLeads = useFeature('storm_lead_gen')
  const hasPaidAds = useFeature('paid_ads')
  const activeFieldItems = fieldNavItems.filter(item => {
    if (item.feature === 'canvassing_tool') return hasCanvassing
    if (item.feature === 'storm_lead_gen') return hasStormLeads
    if (item.feature === 'paid_ads') return hasPaidAds
    return true
  })

  const navItems = [
    ...baseNavItems,
    ...activeFieldItems,
    ...bottomNavItems,
  ]

  function handleLogout() {
    logout()
    navigate('/login')
  }

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Company name */}
      <div className="px-5 py-5 border-b border-gray-700">
        <h1 className="text-lg font-bold text-white truncate">
          {company?.name || 'Roofing CRM'}
        </h1>
      </div>

      {/* Nav items */}
      <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-1">
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`
            }
          >
            <item.icon size={18} />
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* User info + logout */}
      <div className="px-4 py-4 border-t border-gray-700">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-white truncate">
              {user?.email || 'User'}
            </p>
            <p className="text-xs text-gray-400 capitalize">{user?.role || 'admin'}</p>
          </div>
          <button
            onClick={handleLogout}
            className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-gray-800 transition"
            title="Logout"
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar - desktop */}
      <aside className="hidden lg:flex lg:flex-col lg:w-60 bg-gray-900 flex-shrink-0">
        {sidebarContent}
      </aside>

      {/* Sidebar - mobile */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-60 bg-gray-900 transform transition-transform lg:hidden ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <button
          onClick={() => setSidebarOpen(false)}
          className="absolute top-4 right-4 text-gray-400 hover:text-white"
        >
          <X size={20} />
        </button>
        {sidebarContent}
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile header */}
        <header className="lg:hidden bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-gray-600 hover:text-gray-900"
          >
            <Menu size={22} />
          </button>
          <h1 className="text-lg font-semibold text-gray-900 truncate">
            {company?.name || 'Roofing CRM'}
          </h1>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
