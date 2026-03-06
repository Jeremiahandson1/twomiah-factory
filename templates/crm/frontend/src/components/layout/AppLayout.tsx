import { useState, useEffect, useMemo } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { 
  Menu, X, Home, Users, FolderKanban, Briefcase, FileText, Receipt, 
  Calendar, Clock, DollarSign, FileQuestion, ClipboardList, CheckSquare,
  BookOpen, ClipboardCheck, Target, Settings, LogOut, Bell, Search,
  ChevronDown, Building, User, FolderOpen, Package, Truck, Warehouse,
  Wrench, Megaphone, CreditCard, Repeat, Scissors, ListTodo,
  MessageSquare, BarChart3, Star, ShieldCheck, Phone
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useSocket } from '../../contexts/SocketContext';
import { SkipLink, RouteAnnouncer } from '../common/Accessibility';
import { useIsMobile } from '../../hooks/useMediaQuery';

// Nav items with optional feature gating.
// Items without `features` are always visible (core).
// Items with `features` show if ANY listed feature is enabled.
const ALL_NAV_ITEMS = [
  { to: '/crm', icon: Home, label: 'Dashboard', exact: true },
  { to: '/crm/contacts', icon: Users, label: 'Contacts' },
  { to: '/crm/jobs', icon: Briefcase, label: 'Jobs' },
  { to: '/crm/quotes', icon: FileText, label: 'Quotes' },
  { to: '/crm/invoices', icon: Receipt, label: 'Invoices' },
  { to: '/crm/schedule', icon: Calendar, label: 'Schedule' },
  { to: '/crm/time', icon: Clock, label: 'Time' },
  { to: '/crm/expenses', icon: DollarSign, label: 'Expenses' },
  { to: '/crm/documents', icon: FolderOpen, label: 'Documents' },
  { to: '/crm/team', icon: Users, label: 'Team' },
  { to: '/crm/projects', icon: FolderKanban, label: 'Projects', features: ['projects'] },
  { to: '/crm/rfis', icon: FileQuestion, label: 'RFIs', features: ['rfis'] },
  { to: '/crm/change-orders', icon: ClipboardList, label: 'Change Orders', features: ['change_orders'] },
  { to: '/crm/punch-lists', icon: CheckSquare, label: 'Punch Lists', features: ['punch_lists'] },
  { to: '/crm/daily-logs', icon: BookOpen, label: 'Daily Logs', features: ['daily_logs'] },
  { to: '/crm/inspections', icon: ClipboardCheck, label: 'Inspections', features: ['inspections'] },
  { to: '/crm/bids', icon: Target, label: 'Bids', features: ['bid_management'] },
  { to: '/crm/fleet', icon: Truck, label: 'Fleet', features: ['fleet'] },
  { to: '/crm/inventory', icon: Warehouse, label: 'Inventory', features: ['inventory'] },
  { to: '/crm/equipment', icon: Wrench, label: 'Equipment', features: ['equipment_tracking'] },
  { to: '/crm/marketing', icon: Megaphone, label: 'Marketing', features: ['google_reviews', 'email_marketing', 'referral_program'] },
  { to: '/crm/pricebook', icon: CreditCard, label: 'Pricebook', features: ['pricebook'] },
  { to: '/crm/agreements', icon: ShieldCheck, label: 'Agreements', features: ['service_agreements'] },
  { to: '/crm/warranties', icon: Star, label: 'Warranties', features: ['warranties'] },
  { to: '/crm/call-tracking', icon: Phone, label: 'Call Tracking', features: ['call_tracking'] },
  { to: '/crm/recurring', icon: Repeat, label: 'Recurring', features: ['recurring_jobs'] },
  { to: '/crm/takeoffs', icon: Scissors, label: 'Takeoffs', features: ['takeoff_tools'] },
  { to: '/crm/tasks', icon: ListTodo, label: 'Tasks', features: ['projects'] },
  { to: '/crm/messages', icon: MessageSquare, label: 'Messages', features: ['two_way_texting'] },
  { to: '/crm/reports', icon: BarChart3, label: 'Reports', features: ['reports'] },
  { to: '/crm/selections', icon: CheckSquare, label: 'Selections', features: ['selections'] },
];

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const { user, company, logout, hasFeature } = useAuth();
  const { connected } = useSocket();
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
    <div className="min-h-screen bg-gray-50">
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
          fixed inset-y-0 left-0 z-50 w-64 bg-white border-r flex flex-col overflow-hidden
          transform transition-transform duration-200 ease-out
          lg:translate-x-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
        aria-label="Main navigation"
      >
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-4 border-b">
          <div className="flex items-center gap-2">
            <Building className="w-8 h-8 text-orange-500" aria-hidden="true" />
            <span className="font-bold text-lg text-gray-900">{{COMPANY_NAME}}</span>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-2 hover:bg-gray-100 rounded-lg"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Company */}
        <div className="px-4 py-3 border-b">
          <p className="text-sm font-medium text-gray-900 truncate">{company?.name}</p>
          <p className="text-xs text-gray-500 truncate">{user?.email}</p>
        </div>

        {/* Back to Portal */}
        <div className="px-3 pt-3">
          <NavLink
            to="/"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
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
                      ? 'bg-orange-50 text-orange-600' 
                      : 'text-gray-700 hover:bg-gray-100'
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
        <div className="border-t p-3">
          
          <NavLink
            to="/settings"
            className={({ isActive }) => `
              flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium
              ${isActive ? 'bg-orange-50 text-orange-600' : 'text-gray-700 hover:bg-gray-100'}
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
        <header className="sticky top-0 z-30 bg-white border-b h-16">
          <div className="h-full px-4 flex items-center justify-between">
            {/* Mobile menu button */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 -ml-2 hover:bg-gray-100 rounded-lg"
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
                  className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
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

              {/* Notifications */}
              <button
                className="p-2 hover:bg-gray-100 rounded-lg relative"
                aria-label="Notifications"
              >
                <Bell className="w-5 h-5 text-gray-600" />
              </button>

              {/* User menu */}
              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center gap-2 p-2 hover:bg-gray-100 rounded-lg"
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
                      className="absolute right-0 top-full mt-2 w-56 bg-white rounded-lg shadow-lg border z-50"
                      role="menu"
                    >
                      <div className="p-3 border-b">
                        <p className="font-medium text-gray-900">{user?.firstName} {user?.lastName}</p>
                        <p className="text-sm text-gray-500 truncate">{user?.email}</p>
                      </div>
                      <div className="py-1">
                        <NavLink
                          to="/settings"
                          className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
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
