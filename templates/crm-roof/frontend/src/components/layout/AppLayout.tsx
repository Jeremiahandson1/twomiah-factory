import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useTheme } from '../../shared'
import { TrialBanner } from '../trial/TrialBanner'
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
  Sun,
  Moon,
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
  Star,
  CreditCard,
  Radio,
  Mail, LifeBuoy } from 'lucide-react'

const baseNavItems = [
  { label: 'Pipeline', icon: LayoutDashboard, to: '/crm/pipeline' },
  { label: 'Jobs', icon: Briefcase, to: '/crm/jobs' },
  { label: 'Contacts', icon: Users, to: '/crm/contacts' },
  { label: 'Crews', icon: HardHat, to: '/crm/crews' },
  { label: 'Measurements', icon: Ruler, to: '/crm/measurements' },
  { label: 'Materials', icon: Package, to: '/crm/materials', feature: 'materials' },
  { label: 'Quotes', icon: FileText, to: '/crm/quotes' },
  { label: 'Invoices', icon: Receipt, to: '/crm/invoices' },
  { label: 'Adjusters', icon: Shield, to: '/crm/adjusters', feature: 'insurance_workflow' },
  // M7: lead_inbox is a real feature a tenant can switch off in Settings, and the API refuses it when
  // it is off — so the nav must hide it too, or switching it off leaves a link that 403s.
  { label: 'Lead Inbox', icon: Inbox, to: '/crm/leads', feature: 'lead_inbox' },
  { label: 'AI Receptionist', icon: Bot, to: '/crm/ai-receptionist', feature: 'ai_receptionist' },
  { to: '/crm/contact-support', icon: LifeBuoy, label: 'Contact Twomiah' },
]

const fieldNavItems = [
  { label: 'Canvassing', icon: MapPin, to: '/crm/canvassing', feature: 'canvassing_tool' },
  { label: 'Storm Leads', icon: Zap, to: '/crm/storm-leads', feature: 'storm_lead_gen' },
  { label: 'Ads', icon: Megaphone, to: '/crm/ads', feature: 'paid_ads' },
  { label: 'Reviews', icon: Star, to: '/crm/reviews', feature: 'google_reviews' },
  { label: 'Financing', icon: CreditCard, to: '/crm/financing', feature: 'consumer_financing' },
  { label: 'Storm Radar', icon: Radio, to: '/crm/storm-radar', feature: 'storm_radar_overlay' },
  // Paid add-on products — hidden unless the add-on is enabled (matching the
  // contractor CRM: no visible-but-gated nav for products the tenant hasn't bought).
  { label: 'Roof Estimator', icon: Calculator, to: '/crm/estimator', feature: 'instant_estimator' },
  { label: 'Roof Reports', icon: FileBarChart, to: '/crm/roof-reports', feature: 'measurement_reports' },
]

const bottomNavItems = [
  { label: 'Email', icon: Mail, to: '/crm/email', feature: 'branded_email' },
  { label: 'Google Reviews', icon: Star, to: '/crm/google-reviews', feature: 'google_business' },
  { label: 'Documents', icon: FileText, to: '/crm/documents', feature: 'documents' },
  { label: 'Import', icon: Upload, to: '/crm/import' },
  { label: 'Reports', icon: BarChart3, to: '/crm/reports' },
  { label: 'Settings', icon: Settings, to: '/crm/settings' },
]

export default function AppLayout() {
  const { user, company, logout, hasFeature } = useAuth()
  const { setTheme, isDark } = useTheme()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // The same rule for every group: an item with no `feature` is always shown, one with a feature is
  // shown only when the tenant has it. Only fieldNavItems was being filtered, so a feature key added
  // to the other two lists would have been silently ignored — which is how a nav link that 403s gets
  // shipped.
  const enabled = <T extends { feature?: string }>(items: T[]) => items.filter(i => !i.feature || hasFeature(i.feature))

  const navItems = [
    ...enabled(baseNavItems),
    ...enabled(fieldNavItems),
    ...enabled(bottomNavItems),
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
                  // brand-*, not blue-*: tailwind.config.js maps orange/primary/brand to the tenant's
                  // generated palette, and blue is NOT mapped — so the roofer's own colour never reached
                  // their sidebar. Every other vertical's chrome already rides that mapping. (Summit M-06)
                  //
                  // A TINT, not white on a solid brand fill. generatePalette fixes lightness, so white on
                  // shade 600 swings by hue: lime 2.29:1, yellow 2.38:1, cyan 2.68:1, green 2.96:1 — and
                  // even the default orange is 4.31:1, all under AA. Shade 200 over a 10% tint clears it
                  // for every hue (worst measured 8.39:1), which is why the shared AppShell draws its own
                  // active row this way. (Salon T20 M6 measured the same effect on a tinted sidebar.)
                  ? 'bg-brand-500/10 text-brand-200'
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
            <p className="text-xs text-gray-500 dark:text-slate-400 capitalize">{user?.role || 'admin'}</p>
          </div>
          {/* M4: dark mode shipped as 173 unreachable CSS rules because nothing offered the choice
              and nothing set the class. The hook is the fleet's shared one. */}
          <button
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-gray-800 transition"
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
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
    <div className="flex h-screen bg-gray-50 dark:bg-slate-900">
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
          className="absolute top-4 right-4 text-gray-500 dark:text-slate-400 hover:text-white"
        >
          <X size={20} />
        </button>
        {sidebarContent}
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile header */}
        <header className="lg:hidden bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 dark:bg-slate-900 dark:border-slate-700">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-gray-600 hover:text-gray-900 dark:hover:text-slate-200 dark:text-slate-400"
          >
            <Menu size={22} />
          </button>
          <h1 className="text-lg font-semibold text-gray-900 truncate dark:text-slate-100">
            {company?.name || 'Roofing CRM'}
          </h1>
        </header>

        {/* Trial countdown banner — only renders when within 7 days of expiry */}
        <TrialBanner />

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
