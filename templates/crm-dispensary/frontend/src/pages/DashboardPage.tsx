import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import {
  DollarSign, ShoppingCart, TrendingUp, AlertTriangle,
  Package, Banknote, Clock, ArrowRight
} from 'lucide-react';

export default function DashboardPage() {
  const { user, company } = useAuth();
  const [stats, setStats] = useState<any>(null);
  const [lowStock, setLowStock] = useState<any[]>([]);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [topProducts, setTopProducts] = useState<any[]>([]);
  const [cashSession, setCashSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [statsData, activityData, sessionData] = await Promise.all([
        api.get('/api/dashboard/stats'),
        api.get('/api/dashboard/recent-activity').catch(() => null),
        api.get('/api/cash/sessions', { status: 'open', limit: 1 }).then((r: any) => {
          const data = r?.data || (Array.isArray(r) ? r : []);
          return data[0] || null;
        }).catch(() => null),
      ]);

      // Map stats response to what the UI expects
      setStats({
        todayRevenue: statsData?.today?.revenue || 0,
        todayOrders: statsData?.today?.orderCount || 0,
        avgOrderValue: statsData?.today?.avgOrderValue || 0,
        lowStockCount: statsData?.lowStockCount || 0,
      });
      setLowStock(Array.isArray(statsData?.lowStockAlerts) ? statsData.lowStockAlerts.map((i: any) => ({
        id: i.id, name: i.name, category: i.category, stock: Number(i.stock_quantity || 0),
      })) : []);
      setRecentOrders(activityData?.recentOrders || []);
      setTopProducts([]); // Top products requires a separate analytics query; dashboard shows what's available
      setCashSession(sessionData);
    } catch (err) {
      console.error('Failed to load dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const statCards = [
    {
      label: "Today's Revenue",
      value: `$${(stats?.todayRevenue || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
      icon: DollarSign,
      color: 'green',
      link: '/crm/orders',
    },
    {
      label: 'Orders Today',
      value: stats?.todayOrders || 0,
      icon: ShoppingCart,
      color: 'blue',
      link: '/crm/orders',
    },
    {
      label: 'Avg Order Value',
      value: `$${(stats?.avgOrderValue || 0).toFixed(2)}`,
      icon: TrendingUp,
      color: 'purple',
      link: '/crm/analytics',
    },
    {
      label: 'Low Stock Items',
      value: stats?.lowStockCount || lowStock.length,
      icon: AlertTriangle,
      color: 'amber',
      link: '/crm/products',
    },
  ];

  const colorClasses: Record<string, string> = {
    green: 'bg-green-50 text-green-600',
    blue: 'bg-blue-50 text-blue-600',
    purple: 'bg-purple-50 text-purple-600',
    amber: 'bg-amber-50 text-amber-600',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Welcome back, {user?.firstName}!</h1>
          <p className="text-gray-600">{company?.name} Dashboard</p>
        </div>
        {/* Cash Session Status */}
        <div className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${
          cashSession?.status === 'open'
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-gray-50 text-gray-600 border border-gray-200'
        }`}>
          <Banknote className="w-4 h-4" />
          {cashSession?.status === 'open' ? 'Cash Drawer Open' : 'Cash Drawer Closed'}
          <Link to="/crm/cash" className="ml-2 underline text-xs">
            {cashSession?.status === 'open' ? 'View' : 'Open'}
          </Link>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat) => (
          <Link
            key={stat.label}
            to={stat.link}
            className="bg-white rounded-lg p-5 shadow-sm hover:shadow-md transition-shadow"
          >
            <div className={`w-10 h-10 rounded-lg ${colorClasses[stat.color]} flex items-center justify-center mb-3`}>
              <stat.icon className="w-5 h-5" />
            </div>
            <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
            <p className="text-sm text-gray-500">{stat.label}</p>
          </Link>
        ))}
      </div>

      {/* Main Content */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Recent Orders */}
        <div className="lg:col-span-2 bg-white rounded-lg shadow-sm">
          <div className="p-4 border-b flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Recent Orders</h2>
            <Link to="/crm/orders" className="text-sm text-green-600 hover:text-green-700 flex items-center gap-1">
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="divide-y">
            {recentOrders.length > 0 ? recentOrders.slice(0, 8).map((order: any) => (
              <div key={order.id} className="p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">#{order.orderNumber || order.id}</p>
                  <p className="text-sm text-gray-500">{order.customerName || 'Walk-in'}</p>
                </div>
                <div className="text-right">
                  <p className="font-medium text-gray-900">${Number(order.total || 0).toFixed(2)}</p>
                  <span className={`inline-block px-2 py-0.5 text-xs rounded-full ${
                    order.status === 'completed' ? 'bg-green-100 text-green-700' :
                    order.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                    order.status === 'delivery' ? 'bg-blue-100 text-blue-700' :
                    'bg-gray-100 text-gray-700'
                  }`}>
                    {order.status || 'pending'}
                  </span>
                </div>
              </div>
            )) : (
              <p className="p-4 text-gray-500 text-sm">No orders today</p>
            )}
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Top 5 Products Today */}
          <div className="bg-white rounded-lg shadow-sm">
            <div className="p-4 border-b">
              <h2 className="font-semibold text-gray-900">Top Products Today</h2>
            </div>
            <div className="divide-y">
              {topProducts.length > 0 ? topProducts.slice(0, 5).map((product: any, idx: number) => (
                <div key={product.id || idx} className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-green-100 text-green-700 text-xs font-bold flex items-center justify-center">
                      {idx + 1}
                    </span>
                    <div>
                      <p className="font-medium text-gray-900 text-sm">{product.name}</p>
                      <p className="text-xs text-gray-500">{product.category}</p>
                    </div>
                  </div>
                  <p className="text-sm font-medium text-gray-700">{product.unitsSold || 0} sold</p>
                </div>
              )) : (
                <p className="p-4 text-gray-500 text-sm">No sales data yet</p>
              )}
            </div>
          </div>

          {/* Low Stock Alerts */}
          <div className="bg-white rounded-lg shadow-sm">
            <div className="p-4 border-b flex items-center justify-between">
              <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                Low Stock Alerts
              </h2>
              <Link to="/crm/products" className="text-sm text-green-600 hover:text-green-700">View all</Link>
            </div>
            <div className="divide-y">
              {lowStock.length > 0 ? lowStock.slice(0, 5).map((item: any) => (
                <div key={item.id} className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{item.name}</p>
                    <p className="text-xs text-gray-500">{item.category}</p>
                  </div>
                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                    item.stock <= 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {item.stock <= 0 ? 'Out of stock' : `${item.stock} left`}
                  </span>
                </div>
              )) : (
                <p className="p-4 text-gray-500 text-sm flex items-center gap-2">
                  <Package className="w-4 h-4" /> All stock levels healthy
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
