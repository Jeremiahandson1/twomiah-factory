import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { Home, Briefcase, Receipt, PenTool, LogOut, Menu, X } from 'lucide-react';

const NAV_ITEMS = [
  { to: '/portal/dashboard', label: 'Dashboard', icon: Home },
  { to: '/portal/jobs', label: 'Jobs', icon: Briefcase },
  { to: '/portal/invoices', label: 'Invoices', icon: Receipt },
  { to: '/portal/service-request', label: 'Service Request', icon: PenTool },
];

export function usePortalToken() {
  const token = localStorage.getItem('portalToken');
  return token;
}

export function portalHeaders() {
  const token = localStorage.getItem('portalToken');
  return { Authorization: `Bearer ${token}` };
}

export default function PortalLayout() {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = () => {
    localStorage.removeItem('portalToken');
    navigate('/portal/login');
  };

  const token = localStorage.getItem('portalToken');
  if (!token) {
    navigate('/portal/login');
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Top Nav */}
      <header className="bg-gray-800 border-b border-gray-700 px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <Home className="w-4 h-4 text-white" />
            </div>
            <span className="text-white font-semibold text-sm">My Portal</span>
          </div>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                    isActive ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'
                  }`
                }
              >
                <Icon className="w-4 h-4" />
                {label}
              </NavLink>
            ))}
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-red-400 hover:bg-gray-700/50 ml-2"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </nav>

          {/* Mobile Menu Toggle */}
          <button onClick={() => setMenuOpen(!menuOpen)} className="md:hidden text-gray-400 hover:text-white">
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Mobile Nav */}
        {menuOpen && (
          <nav className="md:hidden mt-3 space-y-1">
            {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm ${
                    isActive ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'
                  }`
                }
              >
                <Icon className="w-4 h-4" />
                {label}
              </NavLink>
            ))}
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-gray-400 hover:text-red-400 w-full"
            >
              <LogOut className="w-4 h-4" /> Sign Out
            </button>
          </nav>
        )}
      </header>

      {/* Content */}
      <main>
        <Outlet />
      </main>
    </div>
  );
}
