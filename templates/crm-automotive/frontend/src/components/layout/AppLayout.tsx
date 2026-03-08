import { useState, useEffect, useMemo } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Menu, X, Home, Users, Car, Target, Wrench, Bell, Settings,
  LogOut, Search, ChevronDown, Building, User, Sun, Moon, Monitor,
  LifeBuoy, BookOpen
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useSocket, EVENTS } from '../../contexts/SocketContext';
import { SkipLink, RouteAnnouncer } from '../common/Accessibility';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { useTheme } from '../../hooks/useTheme';

const ALL_NAV_ITEMS = [
  { to: '/crm', icon: Home, label: 'Dashboard', exact: true },
  { to: '/crm/inventory', icon: Car, label: 'Inventory' },
  { to: '/crm/leads', icon: Target, label: 'Sales Leads' },
  { to: '/crm/service', icon: Wrench, label: 'Service' },
  { to: '/crm/alerts', icon: Bell, label: 'Alerts' },
  { to: '/crm/contacts', icon: Users, label: 'Contacts' },
  { to: '/crm/team', icon: Users, label: 'Team' },
  { to: '/crm/support', icon: LifeBuoy, label: 'Support' },
  { to: '/crm/help', icon: BookOpen, label: 'Help' },
];

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const { user, company, logout } = useAuth();
  const { connected, subscribe } = useSocket();
  const { theme, setTheme, isDark } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const navItems = ALL_NAV_ITEMS;

  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [location, isMobile]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSidebarOpen(false);
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, []);

  // Alert badge count — fetched once on connect, updated in real time via socket
  const [alertCount, setAlertCount] = useState(0);
  const { token } = useAuth();

  // Fetch count once on mount and whenever socket reconnects
  useEffect(() => {
    if (!token) return;
    fetch('/api/alerts/count', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setAlertCount(d.count || 0))
      .catch(() => {});
  }, [token, connected]);

  // Increment badge in real time when a new alert arrives via WebSocket
  useEffect(() => {
    if (!connected) return;
    return subscribe(EVENTS.ALERT_CREATED, () => {
      setAlertCount(prev => prev + 1);
    });
  }, [connected, subscribe]);

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-950">
      <SkipLink />

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-30 w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 transform transition-transform duration-200 ${sidebarOpen || !isMobile ? 'translate-x-0' : '-translate-x-full'} ${!isMobile ? 'relative' : ''}`}>
        <div className="flex items-center justify-between h-16 px-4 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <Car className="w-6 h-6 text-blue-600" />
            <span className="text-lg font-bold text-gray-900 dark:text-white">Twomiah Drive</span>
          </div>
          {isMobile && (
            <button onClick={() => setSidebarOpen(false)} className="p-1 text-gray-400 hover:text-gray-600">
              <X size={20} />
            </button>
          )}
        </div>

        <nav className="p-3 space-y-1 overflow-y-auto" style={{ height: 'calc(100% - 4rem)' }}>
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.exact}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-400'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white'
                }`
              }
            >
              <item.icon size={18} />
              <span>{item.label}</span>
              {item.label === 'Alerts' && alertCount > 0 && (
                <span className="ml-auto bg-red-500 text-white text-xs font-bold rounded-full px-2 py-0.5">{alertCount}</span>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Overlay for mobile */}
      {isMobile && sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/30" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-10 flex items-center justify-between h-16 px-4 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-3">
            {isMobile && (
              <button onClick={() => setSidebarOpen(true)} className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white">
                <Menu size={20} />
              </button>
            )}
            <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">
              {company?.name || 'Twomiah Drive'}
            </h2>
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} title={connected ? 'Connected' : 'Disconnected'} />
          </div>

          <div className="flex items-center gap-2">
            {/* Theme toggle */}
            <button
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              {isDark ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            {/* User menu */}
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-sm"
              >
                <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-400 text-xs font-bold">
                  {user?.firstName?.[0]}{user?.lastName?.[0]}
                </div>
                <span className="hidden sm:block text-gray-700 dark:text-gray-300">{user?.firstName}</span>
                <ChevronDown size={14} className="text-gray-400" />
              </button>

              {userMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                  <div className="absolute right-0 z-50 mt-1 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1">
                    <button onClick={() => { navigate('/crm/settings'); setUserMenuOpen(false); }} className="flex items-center gap-2 w-full px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                      <Settings size={16} /> Settings
                    </button>
                    <button onClick={() => { logout(); setUserMenuOpen(false); }} className="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-600 hover:bg-gray-50 dark:hover:bg-gray-700">
                      <LogOut size={16} /> Sign Out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main id="main-content" className="flex-1 overflow-auto">
          <RouteAnnouncer />
          <Outlet />
        </main>
      </div>
    </div>
  );
}
