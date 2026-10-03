import { useState, useEffect, useMemo } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Menu, X, Home, Users, Settings, LogOut, Bell, Search,
  ChevronDown, Building, User, Package, Truck, ShoppingCart,
  BarChart3, Star, Shield, DollarSign, Sun, Moon,
  ShoppingBag, LayoutDashboard, Users2, Leaf, Tag, FileCheck,
  MapPin, Layers, Radio, Navigation, Monitor, Sparkles,
  Share2, PieChart, Sprout, Factory, Store, Globe, Briefcase, Megaphone,
  UserCheck, ScanLine, Database, Wallet, MessageCircle, Trophy,
  FileSearch, TrendingUp, Tv, Car, Scale, Receipt,
  Puzzle, Activity, Server, Calendar, GraduationCap, AlertTriangle,
  CheckSquare, WifiOff, ClipboardList, ShoppingBag as PurchaseIcon, RefreshCw
, Mail, LifeBuoy, FileText } from 'lucide-react';
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
// The role ladder, matching backend/src/middleware/permissions.ts. A nav entry carries minRole only
// where that route family already refuses the role — the menu follows the API, it does not invent a
// second policy. Staff and managers were being shown all 58 items, including screens whose every
// call answers 403, and Analytics rendered $0.00 revenue rather than saying so. (Dispensary T39 M2)
const ROLE_RANK: Record<string, number> = { viewer: 0, driver: 1, field: 2, user: 2, budtender: 2, manager: 3, admin: 4, owner: 5 };
const meetsRole = (role: string | undefined, min?: string) => !min || (ROLE_RANK[String(role || "")] ?? 0) >= (ROLE_RANK[min] ?? 0);
// Routes that answer to a ROLE but are not nav entries. Settings is reached from the sidebar footer
// and the user menu, so marking the nav array never touched it — and typing the URL walked past both,
// which is how a budtender opened the full Settings page. company:update is admin and up.
// (Dispensary T40 M2)
const EXTRA_ROUTE_ROLES: Record<string, string> = { '/crm/settings': 'admin', '/crm/billing': 'owner' };

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
  { to: '/crm/metrc', icon: Leaf, label: 'Metrc', features: ['metrc'] , minRole: 'manager'},
  { to: '/crm/compliance', icon: FileCheck, label: 'Compliance', features: ['compliance'] , minRole: 'manager'},
  { to: '/crm/documents', icon: FileText, label: 'Documents', features: ['documents'] },

  // Sales & Marketing
  { to: '/crm/loyalty', icon: Star, label: 'Loyalty', features: ['loyalty_rewards'] },
  { to: '/crm/referrals', icon: Share2, label: 'Referrals', features: ['referrals'] },
  // Email Campaigns and SMS Marketing were sellable features with no screen behind them at all.
  // Either one opens this. (T45 H23)
  { to: '/crm/marketing', icon: Megaphone, label: 'Marketing', features: ['email_campaigns', 'sms_marketing'], minRole: 'manager' },
  { to: '/crm/recommendations', icon: Sparkles, label: 'AI Recs', features: ['ai_recommendations'] },
  { to: '/crm/kiosk', icon: Monitor, label: 'Kiosk', features: ['kiosk'], minRole: 'manager' },
  { to: '/crm/merch', icon: ShoppingBag, label: 'Merch Store', features: ['merch_store'] },

  // Delivery
  { to: '/crm/delivery', icon: Truck, label: 'Delivery', features: ['delivery'] },
  { to: '/crm/tracking', icon: Navigation, label: 'Tracking', features: ['delivery_tracking'] },

  // Supply Chain
  { to: '/crm/cultivation', icon: Sprout, label: 'Cultivation', features: ['cultivation'] },
  { to: '/crm/manufacturing', icon: Factory, label: 'Manufacturing', features: ['manufacturing'] },
  // Buyer credit limits, order totals and payment terms. Manager and up, matching the API. (T45 M21)
  { to: '/crm/wholesale', icon: Store, label: 'Wholesale', features: ['wholesale'], minRole: 'manager' },

  // Analytics & Reporting
  { to: '/crm/analytics', icon: BarChart3, label: 'Analytics' , minRole: 'manager'},
  { to: '/crm/reports', icon: PieChart, label: 'Reports', features: ['custom_reports', 'bi_dashboard'] , minRole: 'manager'},
  { to: '/crm/website-analytics', icon: Globe, label: 'Web Analytics', features: ['website_analytics'], minRole: 'manager' },

  // Operations
  { to: '/crm/cash', icon: DollarSign, label: 'Cash', features: ['cash_management'] },
  { to: '/crm/audit', icon: Shield, label: 'Audit Log' , minRole: 'manager'},
  { to: '/crm/team', icon: Users2, label: 'Team' , minRole: 'manager'},
  { to: '/crm/enterprise', icon: Briefcase, label: 'Enterprise', features: ['franchise', 'multi_store'] },

  // Phase 2 features
  { to: '/crm/checkin', icon: UserCheck, label: 'Check-In', features: ['checkin', 'queue_management'] },
  { to: '/crm/id-scanner', icon: ScanLine, label: 'ID Scanner', features: ['id_verification'] },
  { to: '/crm/biotrack', icon: Database, label: 'BioTrack', features: ['biotrack'] , minRole: 'manager'},
  { to: '/crm/pay-by-bank', icon: Wallet, label: 'Pay by Bank', features: ['pay_by_bank'] },
  { to: '/crm/ai-budtender', icon: MessageCircle, label: 'AI Budtender', features: ['ai_budtender'] },
  { to: '/crm/gamified-loyalty', icon: Trophy, label: 'Challenges', features: ['gamified_loyalty'] },
  { to: '/crm/seo-pages', icon: FileSearch, label: 'SEO Pages', features: ['seo_pages'] },
  { to: '/crm/predictive-inventory', icon: TrendingUp, label: 'Forecasting', features: ['predictive_inventory'] },
  { to: '/crm/signage', icon: Tv, label: 'Signage', features: ['digital_signage'] },
  { to: '/crm/curbside', icon: Car, label: 'Curbside', features: ['curbside'] },
  { to: '/crm/equivalency', icon: Scale, label: 'Equivalency', features: ['equivalency'] },
  { to: '/crm/tax-filing', icon: Receipt, label: 'Tax Filing', features: ['tax_filing'] , minRole: 'manager'},
  // Two different screens were both called "Integrations": this one, which is the partner
  // marketplace, and the Settings tab that connects QuickBooks, Stripe and SMS. Same word, two
  // places, neither of them where the other one's job gets done. (T45 L14)
  { to: '/crm/marketplace', icon: Puzzle, label: 'Marketplace', features: ['marketplace'] , minRole: 'manager'},
  { to: '/crm/platform', icon: Activity, label: 'Platform', features: ['platform'] },
  { to: '/crm/security', icon: Shield, label: 'Security' , minRole: 'manager'},
  { to: '/crm/soc2', icon: FileCheck, label: 'SOC 2', features: ['soc2'] , minRole: 'manager'},
  { to: '/crm/grow-inputs', icon: Sprout, label: 'Grow Inputs', features: ['cultivation'] },
  { to: '/crm/qr-scanner', icon: ScanLine, label: 'QR Scanner' },
  { to: '/crm/scheduling', icon: Calendar, label: 'Scheduling', features: ['scheduling'], minRole: 'manager' },
  { to: '/crm/training', icon: GraduationCap, label: 'Training', features: ['training_lms'] },
  { to: '/crm/fraud-detection', icon: AlertTriangle, label: 'Fraud Detection', features: ['fraud_detection'], minRole: 'manager' },
  { to: '/crm/approvals', icon: CheckSquare, label: 'Approvals', features: ['approvals'], minRole: 'manager' },
  { to: '/crm/offline', icon: WifiOff, label: 'Offline Mode', features: ['offline_mode'] },
  // Every read behind these two is requireRole('manager'), so without minRole a budtender was
  // shown the entry, opened a working-looking page — date picker, Generate Report, empty History —
  // and every request it made was refused. The menu has to ask what the API asks. (T44 L1)
  { to: '/crm/eod', icon: ClipboardList, label: 'EOD Report', minRole: 'manager' },
  // What the shop pays its suppliers. Manager and up, matching the API. (T45 M21)
  { to: '/crm/purchase-orders', icon: PurchaseIcon, label: 'Purchase Orders', features: ['purchase_orders'], minRole: 'manager' },
  { to: '/crm/menu-sync', icon: RefreshCw, label: 'Menu Sync', features: ['menu_sync'] , minRole: 'manager'},
  // Both back onto requireAdmin route families (inboundMessages.ts, gbp.ts): a manager could open
  // them and every call answered 403, leaving "Failed to…" on screen. The menu follows the API. (T42 L3)
  { to: '/crm/email', icon: Mail, label: 'Email', features: ['branded_email'], minRole: 'admin' },
  { to: '/crm/google-reviews', icon: Star, label: 'Google Reviews', features: ['google_business'], minRole: 'admin' },
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
      // The ROLE test comes first, before the core-items shortcut: Settings, Team and Billing carry no
      // features array, so a check placed after that shortcut never reached them. (T39 M2)
      if (!meetsRole(user?.role, (item as any).minRole)) return false;
      // Core items (no features array) always show
      if (!item.features) return true;
      // Feature-gated items show if ANY listed feature is enabled
      return item.features.some(f => hasFeature(f));
    });
    // enabledFeatures is listed because that is what this memo actually reads — hasFeature only closes
    // over it. Today the two change together, so the sidebar does refresh when a feature is switched
    // off; the day someone wraps hasFeature in useCallback it would silently stop, and the URL gate
    // below already lists `company` while this did not. T43 N11 reported the menu going stale until a
    // reload and I could not reproduce it from the source — this is the dependency being honest about
    // what it depends on, not a diagnosis of that report.
  }, [hasFeature, company?.enabledFeatures, user?.role]);

  // A module that is not part of this tenant's vertical/plan must not be reachable by URL either:
  // the sidebar hid it, but /crm/rfis, /crm/lien-waivers… still rendered contractor pages inside a
  // salon. Gate from the same nav list so there is one source of truth. (SALON launch QA)
  const gatedItem = useMemo(() => {
    // Not until we know. `company` lands from /api/auth/me a moment after mount, and until it does
    // hasFeature() answers false for everything — which flashed "<module> isn't part of this CRM" over
    // a page the tenant owns on every hard load. Same race the roof route gate had, milder because it
    // only flashes rather than navigating away. Same answer: wait. (T18 M7)
    if (!company) return null;
    const path = location.pathname.replace(/\/+$/, '');
    const candidates: { to: string; label: string; features?: string[]; minRole?: string }[] = [
      ...ALL_NAV_ITEMS.map((i: any) => ({ to: i.to as string, label: i.label as string, features: i.features as string[] | undefined, minRole: i.minRole as string | undefined })),
      ...Object.entries(EXTRA_ROUTE_GATES).map(([to, features]) => ({ to, label: to.split('/').pop()!.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), features })),
      ...Object.entries(EXTRA_ROUTE_ROLES).map(([to, minRole]) => ({ to, label: to.split('/').pop()!.replace(/^./, (c) => c.toUpperCase()), minRole })),
    ];
    const here = candidates
      .filter((i) => path === i.to || path.startsWith(i.to + '/'))
      .sort((a, b) => b.to.length - a.to.length)[0];
    if (!here) return null;
    // A role refusal is not a "this module is not part of your CRM" — the module IS here, this
    // person may not open it. Say which, or the page lies about why it is closed. (T40 M2)
    if (!meetsRole(user?.role, (here as any).minRole)) return { ...here, reason: "role" as const };
    if (!here.features || !here.features.length) return null;
    return here.features.some((f: string) => hasFeature(f)) ? null : here;
  }, [location.pathname, company, hasFeature, user?.role]);

  /**
   * Is the blocked module one this product OFFERS and the shop has switched off? (Salon RR6)
   *
   * Same fix as packages/tenant-ui/src/shell/AppShell.tsx, which every other CRM uses. This file is
   * a FORK of that shell — 531 lines of it — so the shared fix did not reach the dispensary, and a
   * redeploy left the bundle hash unchanged, which is how I noticed. It is the third fork in this
   * codebase to bite (permissions.ts, sw.js, now the shell); the honest note is that a fix to the
   * shared shell must be checked against this file every time.
   *
   * hasFeature() is false whether a module is absent or merely off, so the CATALOGUE is what tells
   * them apart. Fetched only when this page renders; a failure keeps the original wording.
   */
  const [offeredHere, setOfferedHere] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!gatedItem || (gatedItem as any).reason === 'role' || offeredHere) return;
    let cancelled = false;
    api.get('/api/company/features/catalog')
      .then((res: any) => { if (!cancelled) setOfferedHere(new Set((res?.features || []).map((f: any) => String(f.id)))); })
      .catch(() => { if (!cancelled) setOfferedHere(new Set()); });
    return () => { cancelled = true; };
  }, [gatedItem, offeredHere]);
  const switchable = !!gatedItem && (gatedItem as any).reason !== 'role' && !!offeredHere
    && ((gatedItem as any).features || []).some((f: string) => offeredHere.has(f));
  // PUT /api/company/features is requireAdmin, so anyone else is told who to ask.
  const canSwitch = ['owner', 'admin'].includes(String(user?.role || ''));

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
            <Building className="w-8 h-8 text-orange-500 dark:text-orange-300" aria-hidden="true" />
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

        {/* Company, and the way to the signed-in person's own account.
            The email was already printed here, so this is where somebody looks for "my" settings.
            NO role gate: a budtender's PIN and authenticator are theirs. T41 found the Till PIN
            card stranded on the admin-only Settings page, which is where I had put it. (T41) */}
        <div className="px-4 py-3 border-b dark:border-slate-800">
          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{company?.name}</p>
          <NavLink
            to="/crm/account"
            className={({ isActive }) => `block text-xs truncate hover:underline ${isActive ? 'text-orange-700 dark:text-orange-200' : 'text-gray-500 dark:text-slate-400'}`}
            title="Your account — PIN and two-factor"
          >
            {user?.email}
          </NavLink>
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
                      /* orange-400 on the tinted dark panel measured 3.25:1 — the item telling you
                         where you are was the hardest one to read. orange-300 clears 4.5:1. (T21 M2) */
                      ? 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-200'
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

        {/* Settings — company configuration: tax rates, the purchase limit, features, hours. The API
            is admin and up (company:update), and the link was shown to everyone, so a budtender could
            open the full page and a manager could edit every field and only fail on Save. (T40 M2) */}
        {meetsRole(user?.role, 'admin') && (
        <div className="border-t dark:border-slate-800 p-3">

          <NavLink
            to="/crm/settings"
            className={({ isActive }) => `
              flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium
              ${isActive ? 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-200' : 'text-gray-700 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800'}
            `}
          >
            <Settings className="w-5 h-5" aria-hidden="true" />
            <span>Settings</span>
          </NavLink>
        </div>
        )}
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
                  <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center dark:bg-orange-950/40">
                    <User className="w-5 h-5 text-orange-600 dark:text-orange-300" aria-hidden="true" />
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
                        {/* same rule as the sidebar: Settings is admin and up (T40 M2) */}
                        {meetsRole(user?.role, 'admin') && (
                        <NavLink
                          to="/crm/settings"
                          className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700"
                          role="menuitem"
                          onClick={() => setUserMenuOpen(false)}
                        >
                          <Settings className="w-4 h-4" aria-hidden="true" />
                          Settings
                        </NavLink>
                        )}
                        <button
                          onClick={handleLogout}
                          className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10"
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
              <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-2">
                {(gatedItem as any).reason === 'role'
                  ? `${gatedItem.label} is not available for your role`
                  : switchable
                    ? `${gatedItem.label} is switched off`
                    : `${gatedItem.label} isn't part of this CRM`}
              </h1>
              <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">
                {(gatedItem as any).reason === 'role'
                  ? 'Your account does not have access to this screen. Ask a manager or the owner if you need it.'
                  : switchable
                    ? (canSwitch
                      ? 'It is part of this CRM and can be turned on whenever you want it — Settings → Features.'
                      : 'It is part of this CRM but is currently switched off. An owner or admin can turn it on in Settings → Features.')
                    : 'This module is not included for your business type or plan. Everything you can use is in the left menu.'}
              </p>
              {switchable && canSwitch
                ? <NavLink to="/crm/settings" className="inline-block px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold dark:bg-slate-100 dark:text-slate-900">Open Settings</NavLink>
                : <NavLink to="/crm" className="inline-block px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold dark:bg-slate-100 dark:text-slate-900">Back to dashboard</NavLink>}
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </div>
  );
}
