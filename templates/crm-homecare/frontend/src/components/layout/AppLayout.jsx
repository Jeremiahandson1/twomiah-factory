import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';
import {
  LayoutDashboard, Users, UserCheck, Calendar, Clock, Receipt,
  DollarSign, BarChart2, Shield, MessageSquare, FileText, Activity,
  Bell, Settings, LogOut, ClipboardList, ChevronLeft, ChevronRight,
  AlertTriangle, FileCheck, Truck
} from 'lucide-react';
import { useState } from 'react';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/clients', label: 'Clients', icon: Users },
  { to: '/caregivers', label: 'Caregivers', icon: UserCheck },
  { to: '/scheduling', label: 'Scheduling', icon: Calendar },
  { to: '/time-tracking', label: 'Time & GPS', icon: Clock },
  { to: '/billing', label: 'Billing', icon: Receipt },
  { to: '/claims', label: 'Claims & EDI', icon: FileCheck },
  { to: '/evv', label: 'EVV', icon: Activity },
  { to: '/payroll', label: 'Payroll', icon: DollarSign },
  { to: '/compliance', label: 'Compliance', icon: Shield },
  { to: '/communication', label: 'Communication', icon: MessageSquare },
  { to: '/forms', label: 'Forms', icon: ClipboardList },
  { to: '/documents', label: 'Documents', icon: FileText },
  { to: '/reports', label: 'Reports', icon: BarChart2 },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/audit', label: 'Audit Log', icon: AlertTriangle },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Sidebar */}
      <aside className={`flex flex-col bg-gray-900 text-white transition-all duration-300 ${collapsed ? 'w-16' : 'w-60'} flex-shrink-0`}>
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-800 min-h-[64px]">
          {!collapsed && (
            <div>
              <div className="font-bold text-sm leading-tight text-white">{{COMPANY_NAME}}</div>
              <div className="text-xs text-gray-400">Care Platform</div>
            </div>
          )}
          <button onClick={() => setCollapsed(!collapsed)} className="ml-auto p-1 rounded hover:bg-gray-800 text-gray-400">
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-2 scrollbar-thin">
          {navItems.map(({ to, label, icon: Icon, exact }) => (
            <NavLink
              key={to}
              to={to}
              end={exact}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                  isActive ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                }`
              }
              title={collapsed ? label : undefined}
            >
              <Icon size={18} className="flex-shrink-0" />
              {!collapsed && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* User */}
        <div className="border-t border-gray-800 p-4">
          {!collapsed && (
            <div className="text-xs text-gray-400 mb-2 truncate">{user?.firstName} {user?.lastName}</div>
          )}
          <button onClick={handleLogout} className="flex items-center gap-2 text-gray-400 hover:text-white text-sm w-full">
            <LogOut size={16} />
            {!collapsed && 'Sign out'}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
