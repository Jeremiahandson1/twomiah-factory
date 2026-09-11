import { useState, useEffect, useMemo } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Menu, X, Home, Users, Settings, LogOut, Bell, Search,
  ChevronDown, Building, User, Package, Truck, ShoppingCart,
  BarChart3, Star, Shield, DollarSign, Sun, Moon,
  ShoppingBag, LayoutDashboard, Users2, Leaf, Tag, FileCheck,
  MapPin, Layers, Radio, Navigation, Monitor, Sparkles,
  Share2, PieChart, Sprout, Factory, Store, Globe, Briefcase,
  UserCheck, ScanLine, Database, Wallet, MessageCircle, Trophy,
  FileSearch, TrendingUp, Tv, Car, Scale, Receipt,
  Puzzle, Activity, Server, Calendar, GraduationCap, AlertTriangle,
  CheckSquare, WifiOff, ClipboardList, ShoppingBag as PurchaseIcon, RefreshCw
, Mail, LifeBuoy } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useSocket } from '../../contexts/SocketContext';
import api from '../../services/api';
import { SkipLink, RouteAnnouncer } from '../common/Accessibility';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { useTheme } from '../../hooks/useTheme';

// Nav items with optional feature gating.
// Items without `features` are always visible (core).
// Items with `features` show if ANY listed feature is enabled.
// Routes that exist in the app but have no sidebar entry, and the features that make them
// relevant. Used with ALL_NAV_ITEMS to gate URLs (see gatedItem below).
const EXTRA_ROUTE_GATES: Record<string, string[]> = {
};

const ALL_NAV_ITEMS = [
  // Core
  { to: '/crm', icon: LayoutDashboard, label: 'Dashboard', exact: true },
  { to: '/crm/products', icon: Package, label: 'Products' },
  { to: '/crm/orders', icon: ShoppingCart, label: 'Orders (POS)' },
  { to: '/crm/customers', icon: Users, label: 'Customers' },

  // Inventory & Compliance
  { to: '/crm/batches', icon: Layers, label: 'Batches', features: ['batches'] },
  { to: '/crm/locations', icon: MapPin, label: 'Locations', features: ['multi_location'] },
  { to: '/crm/rfid', icon: Radio, label: 'RFID', features: ['rfid'] },
  { to: '/crm/labels', icon: Tag, label: 'Labels', features: ['labels'] },
  { to: '/crm/metrc', icon: Leaf, label: 'Metrc', features: ['metrc'] },
  { to: '/crm/compliance', icon: FileCheck, label: 'Compliance', features: ['compliance'] },

  // Sales & Marketing
  { to: '/crm/loyalty', icon: Star, label: 'Loyalty' },
  { to: '/crm/referrals', icon: Share2, label: 'Referrals', features: ['referrals'] },
  { to: '/crm/recommendations', icon: Sparkles, label: 'AI Recs', features: ['ai_recommendations'] },
  { to: '/crm/kiosk', icon: Monitor, label: 'Kiosk', features: ['kiosk'] },
  { to: '/crm/merch', icon: ShoppingBag, label: 'Merch Store', features: ['merch_store'] },

  // Delivery
  { to: '/crm/delivery', icon: Truck, label: 'Delivery', features: ['delivery'] },
  { to: '/crm/tracking', icon: Navigation, label: 'Tracking', features: ['delivery_tracking'] },

  // Supply Chain
  { to: '/crm/cultivation', icon: Sprout, label: 'Cultivation', features: ['cultivation'] },
  { to: '/crm/manufacturing', icon: Factory, label: 'Manufacturing', features: ['manufacturing'] },
  { to: '/crm/wholesale', icon: Store, label: 'Wholesale', features: ['wholesale'] },

  // Analytics & Reporting
  { to: '/crm/analytics', icon: BarChart3, label: 'Analytics' },
  { to: '/crm/reports', icon: PieChart, label: 'Reports', features: ['custom_reports', 'bi_dashboard'] },
  { to: '/crm/website-analytics', icon: Globe, label: 'Web Analytics', features: ['website_analytics'] },

  // Operations
  { to: '/crm/cash', icon: DollarSign, label: 'Cash' },
  { to: '/crm/audit', icon: Shield, label: 'Audit Log' },
  { to: '/crm/team', icon: Users2, label: 'Team' },
  { to: '/crm/enterprise', icon: Briefcase, label: 'Enterprise', features: ['franchise', 'multi_store'] },

  // Phase 2 features
  { to: '/crm/checkin', icon: UserCheck, label: 'Check-In', features: ['checkin', 'queue_management'] },
  { to: '/crm/id-scanner', icon: ScanLine, label: 'ID Scanner', features: ['id_verification'] },
  { to: '/crm/biotrack', icon: Database, label: 'BioTrack', features: ['biotrack'] },
  { to: '/crm/pay-by-bank', icon: Wallet, label: 'Pay by Bank', features: ['pay_by_bank'] },
  { to: '/crm/ai-budtender', icon: MessageCircle, label: 'AI Budtender', features: ['ai_budtender'] },
  { to: '/crm/gamified-loyalty', icon: Trophy, label: 'Challenges', features: ['gamified_loyalty'] },
  { to: '/crm/seo-pages', icon: FileSearch, label: 'SEO Pages', features: ['seo_pages'] },
  { to: '/crm/predictive-inventory', icon: TrendingUp, label: 'Forecasting', features: ['predictive_inventory'] },
  { to: '/crm/signage', icon: Tv, label: 'Signage', features: ['digital_signage'] },
  { to: '/crm/curbside', icon: Car, label: 'Curbside', features: ['curbside'] },
  { to: '/crm/equivalency', icon: Scale, label: 'Equivalency', features: ['equivalency'] },
  { to: '/crm/tax-filing', icon: Receipt, label: 'Tax Filing', features: ['tax_filing'] },
  { to: '/crm/marketplace', icon: Puzzle, label: 'Integrations', features: ['marketplace'] },
  { to: '/crm/platform', icon: Activity, label: 'Platform', features: ['platform'] },
  { to: '/crm/security', icon: Shield, label: 'Security' },
  { to: '/crm/soc2', icon: FileCheck, label: 'SOC 2', features: ['soc2'] },
  { to: '/crm/grow-inputs', icon: Sprout, label: 'Grow Inputs', features: ['cultivation'] },
  { to: '/crm/qr-scanner', icon: ScanLine, label: 'QR Scanner' },
  { to: '/crm/scheduling', icon: Calendar, label: 'Scheduling', features: ['scheduling'] },
  { to: '/crm/training', icon: GraduationCap, label: 'Training', features: ['training_lms'] },
  { to: '/crm/fraud-detection', icon: AlertTriangle, label: 'Fraud Detection', features: ['fraud_detection'] },
  { to: '/crm/approvals', icon: CheckSquare, label: 'Approvals', features: ['approvals'] },
  { to: '/crm/offline', icon: WifiOff, label: 'Offline Mode', features: ['offline_mode'] },
  { to: '/crm/eod', icon: ClipboardList, label: 'EOD Report' },
  { to: '/crm/purchase-orders', icon: PurchaseIcon, label: 'Purchase Orders', features: ['purchase_orders'] },
  { to: '/crm/menu-sync', icon: RefreshCw, label: 'Menu Sync', features: ['menu_sync'] },
  { to: '/crm/email', icon: Mail, label: 'Email', features: ['branded_email'] },
  { to: '/crm/google-reviews', icon: Star, label: 'Google Reviews', features: ['google_business'] },
  { to: '/crm/contact-support', icon: LifeBuoy, label: 'Contact Twomiah' },
];

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const { user, company, logout, hasFeature } = useAuth();
  const { connected } = useSocket();
  const { theme, setTheme, isDark } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  // Filter nav items based on enabled features
  const navItems = useMemo(() => {
    return ALL_NAV_ITEMS.filter(item => {
      // Core items (no features array) always show
      if (!item.features) return true;
      // Feature-gated items show if ANY listed feature is enabled
      return item.features.some(f => hasFeature(f));
    });
  }, [hasFeature]);

  // A module that is not part of this tenant's vertical/plan must not be reachable by URL either:
  // the sidebar hid it, but /crm/rfis, /crm/lien-waivers… still rendered contractor pages inside a
  // salon. Gate from the same nav list so there is one source of truth. (SALON launch QA)
  const gatedItem = useMemo(() => {
    const path = location.pathname.replace(/\/+$/, '');
    const candidates: { to: string; label: string; features?: string[] }[] = [
      ...ALL_NAV_ITEMS.map((i: any) => ({ to: i.to as string, label: i.label as string, features: i.features as string[] | undefined })),
      ...Object.entries(EXTRA_ROUTE_GATES).map(([to, features]) => ({ to, label: to.split('/').pop()!.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), features })),
    ];
    const match = candidates
      .filter((i) => i.features && i.features.length && (path === i.to || path.startsWith(i.to + '/')))
      .sort((a, b) => b.to.length - a.to.length)[0];
    if (!match) return null;
    return match.features!.some((f: string) => hasFeature(f)) ? null : match;
  }, [location.pathname, hasFeature]);

  // Close sidebar on route change (mobile)
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [location, isMobile]);

  // Close sidebar on escape
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        setSidebarOpen(false);
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  // Prevent body scroll when mobile sidebar open
  useEffect(() => {
    document.body.style.overflow = sidebarOpen && isMobile ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [sidebarOpen, isMobile]);

  // Wire the header global search to the backend quick-search (debounced). It was
  // a static input that fired nothing (S21).
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) { setSearchResults([]); return; }
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const res: any = await api.search.query({ q, limit: 8 });
        const items = Array.isArray(res) ? res : (res?.results || res?.data || []);
        if (active) { setSearchResults(items); setSearchOpen(true); }
      } catch {
        if (active) setSearchResults([]);
      }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [searchQuery]);

  const goToResult = (url: string) => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    if (url) navigate(url);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      {/* Skip Link */}
      <SkipLink />
      
      {/* Route Announcer */}
      <RouteAnnouncer />

      {/* Mobile Overlay */}
      {sidebarOpen && isMobile && (
        <div 
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-64 bg-white dark:bg-slate-900 border-r dark:border-slate-800 flex flex-col overflow-hidden
          transform transition-transform duration-200 ease-out
          lg:translate-x-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
        aria-label="Main navigation"
      >
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-4 border-b dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Building className="w-8 h-8 text-orange-500" aria-hidden="true" />
            <span className="font-bold text-lg text-gray-900 dark:text-white">{company?.name || 'CRM'}</span>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Company */}
        <div className="px-4 py-3 border-b dark:border-slate-800">
          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{company?.name}</p>
          <p className="text-xs text-gray-500 dark:text-slate-400 truncate">{user?.email}</p>
        </div>

        {/* Back to Portal */}
        <div className="px-3 pt-3">
          <NavLink
            to="/"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition-colors"
          >
            <Home className="w-4 h-4" />
            Back to Portal
          </NavLink>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-3" aria-label="Sidebar">
          <ul className="space-y-1" role="list">
            {navItems.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.exact}
                  className={({ isActive }) => `
                    flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium
                    transition-colors
                    ${isActive
                      ? 'bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400'
                      : 'text-gray-700 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800'
                    }
                  `}
                >
                  <item.icon className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {/* Settings */}
        <div className="border-t dark:border-slate-800 p-3">

          <NavLink
            to="/crm/settings"
            className={({ isActive }) => `
              flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium
              ${isActive ? 'bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400' : 'text-gray-700 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800'}
            `}
          >
            <Settings className="w-5 h-5" aria-hidden="true" />
            <span>Settings</span>
          </NavLink>
        </div>
      </aside>

      {/* Main Content */}
      <div className="lg:ml-64">
        {/* Header */}
        <header className="sticky top-0 z-30 bg-white dark:bg-slate-900 border-b dark:border-slate-800 h-16">
          <div className="h-full px-4 flex items-center justify-between">
            {/* Mobile menu button */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 -ml-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg"
              aria-label="Open menu"
              aria-expanded={sidebarOpen}
            >
              <Menu className="w-6 h-6" />
            </button>

            {/* Search (desktop) — wired to global quick-search */}
            <div className="hidden md:block flex-1 max-w-md ml-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" aria-hidden="true" />
                <input
                  type="search"
                  placeholder="Search customers, products, orders..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => { if (searchResults.length) setSearchOpen(true); }}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                  aria-label="Search"
                />
                {searchOpen && searchQuery.trim().length >= 2 && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setSearchOpen(false)} aria-hidden="true" />
                    <div className="absolute left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg z-40 max-h-80 overflow-y-auto">
                      {searchResults.length > 0 ? (
                        searchResults.map((r: any) => (
                          <button
                            key={`${r.type}-${r.id}`}
                            onClick={() => goToResult(r.url)}
                            className="w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-slate-700"
                          >
                            <p className="text-sm font-medium text-gray-900 dark:text-slate-100 truncate">{r.name}</p>
                            <p className="text-xs text-gray-500 dark:text-slate-400 truncate">{r.description || r.type}</p>
                          </button>
                        ))
                      ) : (
                        <p className="px-4 py-3 text-sm text-gray-500 dark:text-slate-400">No results for “{searchQuery.trim()}”.</p>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Right side */}
            <div className="flex items-center gap-2">
              {/* Connection status */}
              <div 
                className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-300'}`}
                title={connected ? 'Connected' : 'Disconnected'}
                aria-label={connected ? 'Real-time updates connected' : 'Real-time updates disconnected'}
              />

              {/* Theme toggle */}
              <button
                onClick={() => setTheme(isDark ? 'light' : 'dark')}
                className="p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg"
                aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
                title={isDark ? 'Light mode' : 'Dark mode'}
              >
                {isDark
                  ? <Sun className="w-5 h-5 text-amber-400" />
                  : <Moon className="w-5 h-5 text-gray-600 dark:text-slate-400" />
                }
              </button>

              {/* Notifications — honest empty state (no inbox wired yet) */}
              <div className="relative">
                <button
                  onClick={() => setNotifOpen(!notifOpen)}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg relative"
                  aria-label="Notifications"
                  aria-expanded={notifOpen}
                  aria-haspopup="true"
                >
                  <Bell className="w-5 h-5 text-gray-600 dark:text-slate-300" />
                </button>
                {notifOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setNotifOpen(false)} aria-hidden="true" />
                    <div className="absolute right-0 mt-1 w-72 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg z-40">
                      <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700">
                        <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">Notifications</p>
                      </div>
                      <div className="px-4 py-6 text-center">
                        <Bell className="w-6 h-6 text-gray-300 dark:text-slate-600 mx-auto mb-2" />
                        <p className="text-sm text-gray-500 dark:text-slate-400">You're all caught up — no new notifications.</p>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* User menu */}
              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center gap-2 p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg"
                  aria-expanded={userMenuOpen}
                  aria-haspopup="true"
                >
                  <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center">
                    <User className="w-5 h-5 text-orange-600" aria-hidden="true" />
                  </div>
                  <ChevronDown className="w-4 h-4 text-gray-400 hidden sm:block" aria-hidden="true" />
                </button>

                {userMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setUserMenuOpen(false)}
                      aria-hidden="true"
                    />
                    <div
                      className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-slate-800 rounded-lg shadow-lg border dark:border-slate-700 z-50"
                      role="menu"
                    >
                      <div className="p-3 border-b dark:border-slate-700">
                        <p className="font-medium text-gray-900 dark:text-white">{user?.firstName} {user?.lastName}</p>
                        <p className="text-sm text-gray-500 dark:text-slate-400 truncate">{user?.email}</p>
                      </div>
                      <div className="py-1">
                        <NavLink
                          to="/crm/settings"
                          className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700"
                          role="menuitem"
                          onClick={() => setUserMenuOpen(false)}
                        >
                          <Settings className="w-4 h-4" aria-hidden="true" />
                          Settings
                        </NavLink>
                        <button
                          onClick={handleLogout}
                          className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                          role="menuitem"
                        >
                          <LogOut className="w-4 h-4" aria-hidden="true" />
                          Sign out
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main id="main-content" className="p-4 lg:p-6" tabIndex={-1}>
          {gatedItem ? (
            <div className="max-w-xl mx-auto mt-16 text-center bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-8">
              <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-2">{gatedItem.label} isn't part of this CRM</h1>
              <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">This module is not included for your business type or plan. Everything you can use is in the left menu.</p>
              <NavLink to="/crm" className="inline-block px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold dark:bg-slate-100 dark:text-slate-900">Back to dashboard</NavLink>
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </div>
  );
}
