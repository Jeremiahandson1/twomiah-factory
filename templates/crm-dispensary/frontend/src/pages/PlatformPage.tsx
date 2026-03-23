import { useState, useEffect } from 'react';
import { Activity, CheckSquare, Cpu, Server, Database, Shield, CreditCard, Wifi, ShoppingCart, Package, Clock, User, AlertTriangle } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { Button } from '../components/ui/DataTable';

const serviceStatusColors: Record<string, string> = {
  operational: 'bg-green-500',
  degraded: 'bg-yellow-500',
  down: 'bg-red-500',
};

const serviceStatusLabels: Record<string, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  down: 'Down',
};

export default function PlatformPage() {
  const toast = useToast();
  const [tab, setTab] = useState('health');

  // Health
  const [services, setServices] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [loadingHealth, setLoadingHealth] = useState(true);

  // Onboarding
  const [checklist, setChecklist] = useState<any[]>([]);
  const [manager, setManager] = useState<any>(null);
  const [loadingOnboarding, setLoadingOnboarding] = useState(true);

  // Hardware
  const [hardwareProducts, setHardwareProducts] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [cart, setCart] = useState<any[]>([]);
  const [loadingHardware, setLoadingHardware] = useState(true);
  const [showOrderHistory, setShowOrderHistory] = useState(false);

  useEffect(() => {
    if (tab === 'health') loadHealth();
    if (tab === 'onboarding') loadOnboarding();
    if (tab === 'hardware') loadHardware();
  }, [tab]);

  const loadHealth = async () => {
    setLoadingHealth(true);
    try {
      const [servicesData, incidentsData] = await Promise.all([
        api.get('/api/platform/health'),
        api.get('/api/platform/incidents'),
      ]);
      setServices(Array.isArray(servicesData) ? servicesData : servicesData?.services || [
        { name: 'API', status: servicesData?.api || 'operational', uptime: servicesData?.apiUptime || 99.9 },
        { name: 'Database', status: servicesData?.database || 'operational', uptime: servicesData?.dbUptime || 99.9 },
        { name: 'Metrc', status: servicesData?.metrc || 'operational', uptime: servicesData?.metrcUptime || 99.5 },
        { name: 'Payments', status: servicesData?.payments || 'operational', uptime: servicesData?.paymentsUptime || 99.9 },
      ]);
      setIncidents(Array.isArray(incidentsData) ? incidentsData : incidentsData?.data || []);
    } catch (err) {
      toast.error('Failed to load health status');
    } finally {
      setLoadingHealth(false);
    }
  };

  const loadOnboarding = async () => {
    setLoadingOnboarding(true);
    try {
      const data = await api.get('/api/platform/onboarding');
      setChecklist(Array.isArray(data) ? data : data?.steps || data?.checklist || []);
      setManager(data?.manager || null);
    } catch (err) {
      toast.error('Failed to load onboarding');
    } finally {
      setLoadingOnboarding(false);
    }
  };

  const loadHardware = async () => {
    setLoadingHardware(true);
    try {
      const [productsData, ordersData] = await Promise.all([
        api.get('/api/platform/hardware'),
        api.get('/api/platform/hardware/orders'),
      ]);
      setHardwareProducts(Array.isArray(productsData) ? productsData : productsData?.data || []);
      setOrders(Array.isArray(ordersData) ? ordersData : ordersData?.data || []);
    } catch (err) {
      toast.error('Failed to load hardware catalog');
    } finally {
      setLoadingHardware(false);
    }
  };

  const markStepComplete = async (stepId: string) => {
    try {
      await api.put(`/api/platform/onboarding/${stepId}/complete`);
      toast.success('Step marked complete');
      loadOnboarding();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update step');
    }
  };

  const addToCart = (product: any) => {
    const existing = cart.find(c => c.id === product.id);
    if (existing) {
      setCart(cart.map(c => c.id === product.id ? { ...c, quantity: c.quantity + 1 } : c));
    } else {
      setCart([...cart, { ...product, quantity: 1 }]);
    }
    toast.success(`${product.name} added to cart`);
  };

  const removeFromCart = (productId: string) => {
    setCart(cart.filter(c => c.id !== productId));
  };

  const handleOrder = async () => {
    if (cart.length === 0) {
      toast.error('Cart is empty');
      return;
    }
    try {
      await api.post('/api/platform/hardware/orders', {
        items: cart.map(c => ({ productId: c.id, quantity: c.quantity })),
      });
      toast.success('Order placed');
      setCart([]);
      loadHardware();
    } catch (err: any) {
      toast.error(err.message || 'Failed to place order');
    }
  };

  const completedSteps = checklist.filter(s => s.completed).length;
  const totalSteps = checklist.length;
  const progressPercent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  const serviceIcons: Record<string, any> = {
    API: Server,
    Database: Database,
    Metrc: Shield,
    Payments: CreditCard,
  };

  const cartTotal = cart.reduce((sum, item) => sum + (Number(item.price || 0) * item.quantity), 0);

  const tabs = [
    { id: 'health', label: 'Health', icon: Activity },
    { id: 'onboarding', label: 'Onboarding', icon: CheckSquare },
    { id: 'hardware', label: 'Hardware', icon: Cpu },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Platform</h1>
          <p className="text-gray-600">System health, onboarding, and hardware</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-green-600 text-green-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Health Tab */}
      {tab === 'health' && (
        <div className="space-y-6">
          {loadingHealth ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* Service Status Cards */}
              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
                {services.map((service, i) => {
                  const Icon = serviceIcons[service.name] || Wifi;
                  return (
                    <div key={service.name || i} className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Icon className="w-5 h-5 text-gray-600" />
                          <h3 className="font-semibold text-gray-900">{service.name}</h3>
                        </div>
                        <span className={`w-3 h-3 rounded-full ${serviceStatusColors[service.status] || 'bg-gray-400'}`} />
                      </div>
                      <p className="text-sm text-gray-600 mb-1">
                        {serviceStatusLabels[service.status] || service.status || 'Unknown'}
                      </p>
                      {service.uptime != null && (
                        <p className="text-lg font-bold text-gray-900">{service.uptime}% uptime</p>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Incidents */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-100">
                <div className="px-6 py-4 border-b">
                  <h3 className="font-semibold text-gray-900">Recent Incidents</h3>
                </div>
                <div className="divide-y">
                  {incidents.length > 0 ? incidents.map((incident, i) => (
                    <div key={incident.id || i} className="px-6 py-4 flex items-start gap-3">
                      <AlertTriangle className={`w-4 h-4 mt-0.5 ${
                        incident.severity === 'critical' ? 'text-red-500' :
                        incident.severity === 'warning' ? 'text-yellow-500' : 'text-blue-500'
                      }`} />
                      <div>
                        <p className="text-sm font-medium text-gray-900">{incident.title || incident.message}</p>
                        <p className="text-xs text-gray-500">
                          {incident.createdAt ? new Date(incident.createdAt).toLocaleString() : '—'}
                          {incident.resolved && <span className="ml-2 text-green-600">Resolved</span>}
                        </p>
                      </div>
                    </div>
                  )) : (
                    <div className="px-6 py-8 text-center text-gray-500 text-sm">
                      No recent incidents
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Onboarding Tab */}
      {tab === 'onboarding' && (
        <div className="space-y-6">
          {loadingOnboarding ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* Progress */}
              <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-900">Setup Progress</h3>
                  <span className="text-sm font-medium text-green-600">{progressPercent}% complete</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                  <div
                    className="h-3 bg-green-500 rounded-full transition-all"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <p className="text-sm text-gray-500 mt-2">{completedSteps} of {totalSteps} steps completed</p>
              </div>

              {/* Assigned Manager */}
              {manager && (
                <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100 flex items-center gap-4">
                  <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                    <User className="w-6 h-6 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Your Onboarding Manager</p>
                    <p className="font-semibold text-gray-900">{manager.name}</p>
                    {manager.email && <p className="text-sm text-gray-600">{manager.email}</p>}
                  </div>
                </div>
              )}

              {/* Checklist */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-100">
                <div className="divide-y">
                  {checklist.map((step, i) => (
                    <div key={step.id || i} className="px-6 py-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => !step.completed && markStepComplete(step.id)}
                          className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${
                            step.completed
                              ? 'bg-green-500 border-green-500 text-white'
                              : 'border-gray-300 hover:border-green-400'
                          }`}
                          disabled={step.completed}
                        >
                          {step.completed && <CheckSquare className="w-4 h-4" />}
                        </button>
                        <div>
                          <p className={`text-sm font-medium ${step.completed ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                            {step.title || step.name || `Step ${i + 1}`}
                          </p>
                          {step.description && (
                            <p className="text-xs text-gray-500">{step.description}</p>
                          )}
                        </div>
                      </div>
                      {!step.completed && (
                        <button
                          onClick={() => markStepComplete(step.id)}
                          className="px-3 py-1 text-xs font-medium text-green-700 bg-green-50 rounded-lg hover:bg-green-100"
                        >
                          Mark Complete
                        </button>
                      )}
                    </div>
                  ))}
                  {checklist.length === 0 && (
                    <div className="px-6 py-8 text-center text-gray-500 text-sm">
                      No onboarding steps configured
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Hardware Tab */}
      {tab === 'hardware' && (
        <div className="space-y-6">
          {loadingHardware ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* Cart Summary */}
              {cart.length > 0 && (
                <div className="bg-green-50 rounded-lg p-4 border border-green-200 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <ShoppingCart className="w-5 h-5 text-green-600" />
                    <span className="text-sm font-medium text-green-800">
                      {cart.reduce((sum, c) => sum + c.quantity, 0)} items in cart
                    </span>
                    <span className="text-sm font-bold text-green-900">
                      ${cartTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setCart([])}
                      className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white rounded-lg hover:bg-gray-50 border border-gray-200"
                    >
                      Clear
                    </button>
                    <Button onClick={handleOrder}>
                      Place Order
                    </Button>
                  </div>
                </div>
              )}

              {/* Product Grid */}
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {hardwareProducts.map(product => (
                  <div key={product.id} className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
                    {product.imageUrl ? (
                      <img src={product.imageUrl} alt={product.name} className="w-full h-40 object-cover bg-gray-100" />
                    ) : (
                      <div className="w-full h-40 bg-gray-100 flex items-center justify-center">
                        <Cpu className="w-12 h-12 text-gray-300" />
                      </div>
                    )}
                    <div className="p-5">
                      <h3 className="font-semibold text-gray-900 mb-1">{product.name}</h3>
                      {product.specs && (
                        <p className="text-xs text-gray-500 mb-2">{product.specs}</p>
                      )}
                      <p className="text-sm text-gray-600 mb-3">{product.description || 'No description'}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-lg font-bold text-gray-900">
                          ${Number(product.price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                        <button
                          onClick={() => addToCart(product)}
                          className="px-4 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700"
                        >
                          Add to Cart
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {hardwareProducts.length === 0 && (
                  <div className="col-span-full text-center py-12 text-gray-500">
                    <Cpu className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p>No hardware products available</p>
                  </div>
                )}
              </div>

              {/* Order History Toggle */}
              <div>
                <button
                  onClick={() => setShowOrderHistory(!showOrderHistory)}
                  className="text-sm font-medium text-green-600 hover:text-green-700"
                >
                  {showOrderHistory ? 'Hide' : 'Show'} Order History
                </button>

                {showOrderHistory && (
                  <div className="mt-4 bg-white rounded-lg shadow-sm overflow-hidden border border-gray-100">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Order #</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Items</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {orders.map(order => (
                          <tr key={order.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 font-medium text-gray-900">#{order.orderNumber || order.id?.slice(0, 8)}</td>
                            <td className="px-4 py-3 text-sm text-gray-600">
                              {order.createdAt ? new Date(order.createdAt).toLocaleDateString() : '—'}
                            </td>
                            <td className="px-4 py-3 text-right text-gray-700">{order.itemCount || order.items?.length || 0}</td>
                            <td className="px-4 py-3 text-right font-medium text-gray-900">
                              ${Number(order.total || 0).toFixed(2)}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                                order.status === 'shipped' ? 'bg-blue-100 text-blue-700' :
                                order.status === 'delivered' ? 'bg-green-100 text-green-700' :
                                order.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                                'bg-yellow-100 text-yellow-700'
                              }`}>
                                {order.status || 'pending'}
                              </span>
                            </td>
                          </tr>
                        ))}
                        {orders.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-4 py-8 text-center text-gray-500">No order history</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
