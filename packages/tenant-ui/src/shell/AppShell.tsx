// The CRM shell: sidebar (feature-gated nav with optional section headers), header (search, theme,
// user menu), trial banner, URL gate for modules the tenant doesn't have, error boundary per route.
// One implementation for every CRM; the template passes its nav list, api, auth and socket state.
import { useState, useEffect, useMemo } from 'react'
import { useOutlet, useLocation, useNavigate } from 'react-router-dom'
import { Menu, X, Home, Settings, LogOut, ChevronDown, Building, User, Sun, Moon } from 'lucide-react'
import { useTheme, useIsMobile } from './hooks'
import { SkipLink, RouteAnnouncer } from './Accessibility'
import { GlobalSearch } from './GlobalSearch'
import { TrialBanner } from './TrialBanner'
import { ErrorBoundary } from './ErrorBoundary'
import type { AppShellProps, NavItem } from './types'

// react-router's <NavLink> as JSX fails TS2786 in the typed templates (a second @types/react copy is
// resolved from the packages path), so links are plain anchors driven by the router hooks.
function RouterLink({ to, end, className, children, onClick, role, ...rest }: { to: string; end?: boolean; className: string | ((s: { isActive: boolean }) => string); children: React.ReactNode; onClick?: () => void; role?: string } & Record<string, unknown>) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const path = pathname.replace(/\/+$/, '') || '/'
  const target = to.replace(/\/+$/, '') || '/'
  const isActive = end ? path === target : path === target || path.startsWith(target + '/')
  const cls = typeof className === 'function' ? className({ isActive }) : className
  return (
    <a href={to} role={role} className={cls} aria-current={isActive ? 'page' : undefined} {...(rest as any)} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); onClick?.(); navigate(to) }}>
      {children}
    </a>
  )
}

const linkCls = (active: boolean) => `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${active ? 'bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400' : 'text-gray-700 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800'}`

export function AppShell({ api, auth, connected = false, config }: AppShellProps) {
  const { user, company, logout, hasFeature } = auth
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const { setTheme, isDark } = useTheme()
  const location = useLocation()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const Brand = config.brand?.icon || Building
  const fallbackName = config.brand?.fallbackName || 'CRM'

  // Core items always show; feature-gated items show if ANY listed feature is enabled.
  const navItems = useMemo(() => config.nav.filter((i) => !i.features || i.features.some((f) => hasFeature(f))), [config.nav, hasFeature])

  // A module that is not part of this tenant's vertical/plan must not be reachable by URL either — the
  // sidebar hid it, but /crm/rfis still rendered contractor pages inside a salon. Gate from the same
  // list (plus routes that have no sidebar entry) so there is one source of truth. (SALON launch QA)
  const gatedItem = useMemo(() => {
    const path = location.pathname.replace(/\/+$/, '')
    const candidates: { to: string; label: string; features?: string[] }[] = [
      ...config.nav.filter((i) => !i.external).map((i) => ({ to: i.to, label: i.label, features: i.features })),
      ...Object.entries(config.routeGates || {}).map(([to, features]) => ({ to, label: to.split('/').pop()!.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), features })),
    ]
    const match = candidates
      .filter((i) => i.features && i.features.length && (path === i.to || path.startsWith(i.to + '/')))
      .sort((a, b) => b.to.length - a.to.length)[0]
    if (!match) return null
    return match.features!.some((f) => hasFeature(f)) ? null : match
  }, [location.pathname, hasFeature, config.nav, config.routeGates])

  useEffect(() => { if (isMobile) setSidebarOpen(false) }, [location, isMobile])
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setSidebarOpen(false); setUserMenuOpen(false) } }
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [])
  useEffect(() => {
    document.body.style.overflow = sidebarOpen && isMobile ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [sidebarOpen, isMobile])

  const handleLogout = async () => { await logout(); navigate('/login') }
  const outlet = useOutlet({ instance: { primaryColor: company?.primaryColor || '#f97316', companyName: company?.name, companyId: company?.id, slug: company?.slug } })
  const externalHref = (item: NavItem) => `${String(company?.website || '').replace(/\/+$/, '')}/admin`

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      <SkipLink />
      <RouteAnnouncer />

      {sidebarOpen && isMobile && <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} aria-hidden="true" />}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white dark:bg-slate-900 border-r dark:border-slate-800 flex flex-col overflow-hidden transform transition-transform duration-200 ease-out lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
        aria-label="Main navigation"
      >
        <div className="h-16 flex items-center justify-between px-4 border-b dark:border-slate-800">
          <div className="flex items-center gap-2 min-w-0">
            <Brand className="w-8 h-8 text-orange-500 flex-shrink-0" aria-hidden="true" />
            <span className="font-bold text-lg text-gray-900 dark:text-white truncate">{company?.name || fallbackName}</span>
          </div>
          <button type="button" onClick={() => setSidebarOpen(false)} className="lg:hidden p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg" aria-label="Close menu"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-4 py-3 border-b dark:border-slate-800">
          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{company?.name}</p>
          <p className="text-xs text-gray-500 dark:text-slate-400 truncate">{user?.email}</p>
        </div>

        {config.backToPortal !== false && (
          <div className="px-3 pt-3">
            <RouterLink to="/" className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition-colors">
              <Home className="w-4 h-4" />Back to Portal
            </RouterLink>
          </div>
        )}

        <nav className="flex-1 overflow-y-auto py-4 px-3" aria-label="Sidebar">
          <ul className="space-y-1" role="list">
            {navItems.map((item, index) => {
              const prev = navItems[index - 1]
              const showSection = item.section && (!prev || prev.section !== item.section)
              return (
                <li key={`${item.to}-${item.label}`}>
                  {showSection && (
                    <div className="pt-4 pb-1 px-3"><p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">{item.section}</p></div>
                  )}
                  {item.external ? (
                    <a href={externalHref(item)} target="_blank" rel="noopener noreferrer" className={linkCls(false)}>
                      <item.icon className="w-5 h-5 flex-shrink-0" aria-hidden="true" /><span>{item.label}</span>
                    </a>
                  ) : (
                    <RouterLink to={item.to} end={item.exact} className={({ isActive }) => linkCls(isActive)}>
                      <item.icon className="w-5 h-5 flex-shrink-0" aria-hidden="true" /><span>{item.label}</span>
                    </RouterLink>
                  )}
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="border-t dark:border-slate-800 p-3">
          <RouterLink to="/crm/settings" className={({ isActive }) => linkCls(isActive)}>
            <Settings className="w-5 h-5" aria-hidden="true" /><span>Settings</span>
          </RouterLink>
        </div>
      </aside>

      <div className="lg:ml-64">
        <header className="sticky top-0 z-30 bg-white dark:bg-slate-900 border-b dark:border-slate-800 h-16">
          <div className="h-full px-4 flex items-center justify-between">
            <button type="button" onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 -ml-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg" aria-label="Open menu" aria-expanded={sidebarOpen}>
              <Menu className="w-6 h-6" />
            </button>

            <div className="flex-1 max-w-md ml-4"><GlobalSearch api={api} /></div>

            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-300'}`} title={connected ? 'Connected' : 'Disconnected'} aria-label={connected ? 'Real-time updates connected' : 'Real-time updates disconnected'} />

              <button type="button" onClick={() => setTheme(isDark ? 'light' : 'dark')} className="p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg" aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'} title={isDark ? 'Light mode' : 'Dark mode'}>
                {isDark ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-gray-600 dark:text-slate-400" />}
              </button>

              <div className="relative">
                <button type="button" onClick={() => setUserMenuOpen(!userMenuOpen)} className="flex items-center gap-2 p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg" aria-expanded={userMenuOpen} aria-haspopup="true" aria-label="Account menu">
                  <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center"><User className="w-5 h-5 text-orange-600" aria-hidden="true" /></div>
                  <ChevronDown className="w-4 h-4 text-gray-400 hidden sm:block" aria-hidden="true" />
                </button>
                {userMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} aria-hidden="true" />
                    <div className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-slate-800 rounded-lg shadow-lg border dark:border-slate-700 z-50" role="menu">
                      <div className="p-3 border-b dark:border-slate-700">
                        <p className="font-medium text-gray-900 dark:text-white">{user?.firstName} {user?.lastName}</p>
                        <p className="text-sm text-gray-500 dark:text-slate-400 truncate">{user?.email}</p>
                      </div>
                      <div className="py-1">
                        <RouterLink to="/crm/settings" className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700" role="menuitem" onClick={() => setUserMenuOpen(false)}>
                          <Settings className="w-4 h-4" aria-hidden="true" />Settings
                        </RouterLink>
                        <button type="button" onClick={handleLogout} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" role="menuitem">
                          <LogOut className="w-4 h-4" aria-hidden="true" />Sign out
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </header>

        <TrialBanner company={company} />

        <main id="main-content" className="p-4 lg:p-6" tabIndex={-1}>
          <ErrorBoundary resetKey={location.pathname}>
            {gatedItem ? (
              <div className="max-w-xl mx-auto mt-16 text-center bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-8">
                <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-2">{gatedItem.label} isn't part of this CRM</h1>
                <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">This module is not included for your business type or plan. Everything you can use is in the left menu.</p>
                <RouterLink to="/crm" className="inline-block px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold dark:bg-slate-100 dark:text-slate-900">Back to dashboard</RouterLink>
              </div>
            ) : (
              outlet
            )}
          </ErrorBoundary>
        </main>
      </div>
    </div>
  )
}

export default AppShell
