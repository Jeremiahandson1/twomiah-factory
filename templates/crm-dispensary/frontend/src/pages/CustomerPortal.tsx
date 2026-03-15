import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShoppingCart, Package, ClipboardList, Users, BarChart3,
  DollarSign, ArrowRight, Settings, Clock, LogOut, AlertTriangle
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const API_URL = import.meta.env.VITE_API_URL || '';

export default function CustomerPortal() {
  const { user, company, logout, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<any>(null);
  const [lowStock, setLowStock] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading) fetchDashboardData();
  }, [authLoading]);

  async function fetchDashboardData() {
    try {
      const token = localStorage.getItem('accessToken');
      const headers = { 'Authorization': `Bearer ${token}` };
      const [statsRes, stockRes] = await Promise.all([
        fetch(`${API_URL}/api/dashboard/stats`, { headers }).catch(() => null),
        fetch(`${API_URL}/api/products/low-stock`, { headers }).catch(() => null),
      ]);
      if (statsRes?.ok) setStats(await statsRes.json());
      if (stockRes?.ok) {
        const data = await stockRes.json();
        setLowStock(Array.isArray(data) ? data : data.products || []);
      }
    } catch (err) {
      // Stats may not be available yet
    } finally {
      setLoading(false);
    }
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-600" />
      </div>
    );
  }

  const primaryColor = company?.primaryColor || '#16a34a';
  const companyName = company?.name || import.meta.env.VITE_COMPANY_NAME || 'My Dispensary';

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const quickActions = [
    {
      title: 'POS / New Order',
      description: 'Start a new sale at the register',
      icon: ShoppingCart,
      path: '/crm/orders/new',
      color: 'emerald',
      highlight: true,
    },
    {
      title: 'Products',
      description: 'Manage inventory and menu',
      icon: Package,
      path: '/crm/products',
      color: 'violet',
    },
    {
      title: 'Orders',
      description: 'View and manage orders',
      icon: ClipboardList,
      path: '/crm/orders',
      color: 'blue',
    },
    {
      title: 'Customers',
      description: 'Customer profiles and history',
      icon: Users,
      path: '/crm/customers',
      color: 'amber',
    },
    {
      title: 'Analytics',
      description: 'Sales reports and insights',
      icon: BarChart3,
      path: '/crm/analytics',
      color: 'sky',
    },
    {
      title: 'Settings',
      description: 'Company info, users, and configuration',
      icon: Settings,
      path: '/crm/settings',
      color: 'slate',
    },
  ];

  const colorMap: Record<string, { bg: string; text: string; border: string; bar: string }> = {
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-300', bar: 'bg-emerald-500' },
    violet: { bg: 'bg-violet-50', text: 'text-violet-600', border: 'border-violet-200', bar: 'bg-violet-500' },
    blue: { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-200', bar: 'bg-blue-500' },
    amber: { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200', bar: 'bg-amber-500' },
    sky: { bg: 'bg-sky-50', text: 'text-sky-600', border: 'border-sky-200', bar: 'bg-sky-500' },
    slate: { bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200', bar: 'bg-slate-400' },
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              {company?.logo ? (
                <img src={company.logo} alt="" className="h-8 w-8 object-contain" />
              ) : (
                <div
                  className="h-8 w-8 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                  style={{ backgroundColor: primaryColor }}
                >
                  {companyName.charAt(0)}
                </div>
              )}
              <h1 className="text-lg font-bold text-slate-900">{companyName}</h1>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-slate-500">
                {user?.firstName} {user?.lastName}
              </span>
              <button
                onClick={handleLogout}
                className="text-slate-400 hover:text-slate-600 transition-colors"
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-slate-900">
            Welcome back{user?.firstName ? `, ${user.firstName}` : ''}
          </h2>
          <p className="text-slate-500 mt-1">Your dispensary hub</p>
        </div>

        {/* Today's Quick Stats */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center mb-2">
                <DollarSign className="w-4 h-4 text-green-500" />
              </div>
              <p className="text-xl font-bold text-slate-900">
                {loading ? '—' : `$${(stats.revenueToday ?? stats.revenue?.today ?? 0).toLocaleString()}`}
              </p>
              <p className="text-xs text-slate-500">Revenue Today</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center mb-2">
                <ClipboardList className="w-4 h-4 text-blue-500" />
              </div>
              <p className="text-xl font-bold text-slate-900">
                {loading ? '—' : (stats.ordersToday ?? stats.orders?.today ?? 0)}
              </p>
              <p className="text-xs text-slate-500">Orders Today</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center mb-2">
                <ShoppingCart className="w-4 h-4 text-emerald-500" />
              </div>
              <p className="text-xl font-bold text-slate-900">
                {loading ? '—' : (stats.cashSessionActive ? 'Open' : 'Closed')}
              </p>
              <p className="text-xs text-slate-500">Cash Session</p>
            </div>
          </div>
        )}

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {quickActions.map((action) => {
            const colors = colorMap[action.color] || colorMap.slate;
            return (
              <div
                key={action.title}
                onClick={() => navigate(action.path)}
                className={`bg-white rounded-xl border p-6 cursor-pointer hover:shadow-md transition-all group relative overflow-hidden ${
                  action.highlight ? `border-emerald-300 ring-1 ring-emerald-100` : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className={`absolute top-0 left-0 right-0 h-1 ${colors.bar}`} />
                <div className="flex items-start justify-between mb-4">
                  <div className={`w-12 h-12 rounded-xl ${colors.bg} flex items-center justify-center`}>
                    <action.icon className={`w-6 h-6 ${colors.text}`} />
                  </div>
                  <ArrowRight className="w-5 h-5 text-slate-300 group-hover:text-slate-500 group-hover:translate-x-1 transition-all" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 mb-1">{action.title}</h3>
                <p className="text-sm text-slate-500">{action.description}</p>
              </div>
            );
          })}
        </div>

        {/* Low Stock Alerts */}
        {lowStock.length > 0 && (
          <div className="bg-white rounded-xl border border-amber-200 mb-8">
            <div className="px-6 py-4 border-b border-amber-100 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <h3 className="font-semibold text-slate-900">Low Stock Alerts</h3>
              <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium ml-auto">
                {lowStock.length} item{lowStock.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="divide-y divide-amber-50">
              {lowStock.slice(0, 5).map((item: any) => (
                <div
                  key={item.id}
                  className="px-6 py-3 flex items-center gap-3 cursor-pointer hover:bg-amber-50/50 transition-colors"
                  onClick={() => navigate(`/crm/products/${item.id}`)}
                >
                  <div className="w-2 h-2 rounded-full bg-amber-400" />
                  <span className="text-sm text-slate-700 font-medium">{item.name}</span>
                  <span className="text-xs text-amber-600 ml-auto">
                    {item.quantity ?? item.stockQuantity ?? 0} remaining
                  </span>
                </div>
              ))}
              {lowStock.length > 5 && (
                <div
                  className="px-6 py-3 text-center cursor-pointer hover:bg-amber-50/50 transition-colors"
                  onClick={() => navigate('/crm/products?filter=low-stock')}
                >
                  <span className="text-sm text-amber-600 font-medium">
                    View all {lowStock.length} low stock items
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Empty state when no stats */}
        {!stats && !loading && (
          <div className="bg-white rounded-xl border border-slate-200 px-6 py-8 text-center mb-8">
            <Clock className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-500">No data yet</p>
            <p className="text-xs text-slate-400 mt-1">Start by adding products and processing orders</p>
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-xs text-slate-400">
            Powered by <span className="font-medium">{company?.name || 'Dispensary'}</span>
          </p>
        </div>
      </main>
    </div>
  );
}
