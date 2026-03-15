import { useState, useEffect, useMemo } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Menu, X, Home, Users, Settings, LogOut, Bell, Search,
  ChevronDown, Building, User, Package, Truck, ShoppingCart,
  BarChart3, Star, Shield, DollarSign, Sun, Moon,
  ShoppingBag, LayoutDashboard, Users2
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useSocket } from '../../contexts/SocketContext';
import { SkipLink, RouteAnnouncer } from '../common/Accessibility';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { useTheme } from '../../hooks/useTheme';

// Nav items with optional feature gating.
// Items without `features` are always visible (core).
// Items with `features` show if ANY listed feature is enabled.
const ALL_NAV_ITEMS = [
  { to: '/crm', icon: LayoutDashboard, label: 'Dashboard', exact: true },
  { to: '/crm/products', icon: Package, label: 'Products' },
  { to: '/crm/orders', icon: ShoppingCart, label: 'Orders (POS)' },
  { to: '/crm/customers', icon: Users, label: 'Customers' },
  { to: '/crm/loyalty', icon: Star, label: 'Loyalty' },
  { to: '/crm/delivery', icon: Truck, label: 'Delivery', features: ['delivery'] },
  { to: '/crm/merch', icon: ShoppingBag, label: 'Merch Store', features: ['merch_store'] },
  { to: '/crm/analytics', icon: BarChart3, label: 'Analytics' },
  { to: '/crm/cash', icon: DollarSign, label: 'Cash' },
  { to: '/crm/audit', icon: Shield, label: 'Audit Log' },
  { to: '/crm/team', icon: Users2, label: 'Team' },
];

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
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

            {/* Search (desktop) */}
            <div className="hidden md:block flex-1 max-w-md ml-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" aria-hidden="true" />
                <input
                  type="search"
                  placeholder="Search..."
                  className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                  aria-label="Search"
                />
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
                  : <Moon className="w-5 h-5 text-gray-600" />
                }
              </button>

              {/* Notifications */}
              <button
                className="p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg relative"
                aria-label="Notifications"
              >
                <Bell className="w-5 h-5 text-gray-600 dark:text-slate-300" />
              </button>

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
          <Outlet />
        </main>
      </div>
    </div>
  );
}
