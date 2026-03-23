import { useState, useEffect, useCallback } from 'react';
import { Shield, Settings, Package, ShoppingCart, Truck, History, RefreshCw, CheckCircle, XCircle, AlertTriangle, Link, Search } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Button } from '../components/ui/DataTable';
import { Modal } from '../components/ui/Modal';

const US_STATES = [
  'AK','AL','AR','AZ','CA','CO','CT','DC','DE','FL','GA','HI','IA','ID','IL','IN',
  'KS','KY','LA','MA','MD','ME','MI','MN','MO','MS','MT','NC','ND','NE','NH','NJ',
  'NM','NV','NY','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VA','VT','WA',
  'WI','WV','WY',
];

const initialConfig = {
  apiKey: '',
  userKey: '',
  licenseNumber: '',
  state: '',
  autoSync: false,
  syncInterval: 60,
};

export default function MetrcPage() {
  const { isManager } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('config');

  // Config
  const [config, setConfig] = useState(initialConfig);
  const [savingConfig, setSavingConfig] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);

  // Sync status
  const [syncStatus, setSyncStatus] = useState<any>(null);

  // Packages
  const [packages, setPackages] = useState<any[]>([]);
  const [loadingPackages, setLoadingPackages] = useState(false);
  const [packageSearch, setPackageSearch] = useState('');
  const [packagePage, setPackagePage] = useState(1);
  const [packageTotal, setPackageTotal] = useState(0);

  // Sales
  const [sales, setSales] = useState<any[]>([]);
  const [loadingSales, setLoadingSales] = useState(false);
  const [salesPage, setSalesPage] = useState(1);
  const [salesTotal, setSalesTotal] = useState(0);

  // Transfers
  const [transfers, setTransfers] = useState<any[]>([]);
  const [loadingTransfers, setLoadingTransfers] = useState(false);
  const [transfersPage, setTransfersPage] = useState(1);
  const [transfersTotal, setTransfersTotal] = useState(0);

  // Sync Log
  const [syncLogs, setSyncLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Link product modal
  const [linkModal, setLinkModal] = useState(false);
  const [linkingPackage, setLinkingPackage] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  useEffect(() => {
    loadConfig();
    loadSyncStatus();
  }, []);

  useEffect(() => {
    if (tab === 'packages') loadPackages();
    if (tab === 'sales') loadSales();
    if (tab === 'transfers') loadTransfers();
    if (tab === 'sync') loadSyncLogs();
  }, [tab, packagePage, packageSearch, salesPage, transfersPage]);

  const loadConfig = async () => {
    try {
      const data = await api.get('/api/metrc/config');
      if (data) {
        setConfig({
          apiKey: data.apiKey || '',
          userKey: data.userKey || '',
          licenseNumber: data.licenseNumber || '',
          state: data.state || '',
          autoSync: data.autoSync ?? false,
          syncInterval: data.syncInterval || 60,
        });
      }
    } catch (err) {
      console.error('Failed to load Metrc config:', err);
    }
  };

  const loadSyncStatus = async () => {
    try {
      const data = await api.get('/api/metrc/sync/status');
      setSyncStatus(data);
    } catch (err) {
      console.error('Failed to load sync status:', err);
    }
  };

  const saveConfig = async () => {
    setSavingConfig(true);
    try {
      await api.put('/api/metrc/config', config);
      toast.success('Metrc configuration saved');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save configuration');
    } finally {
      setSavingConfig(false);
    }
  };

  const testConnection = async () => {
    setTestingConnection(true);
    try {
      const result = await api.post('/api/metrc/config/test', config);
      if (result?.success) {
        toast.success('Connection successful');
      } else {
        toast.error(result?.message || 'Connection failed');
      }
    } catch (err: any) {
      toast.error(err.message || 'Connection test failed');
    } finally {
      setTestingConnection(false);
    }
  };

  const loadPackages = async () => {
    setLoadingPackages(true);
    try {
      const params: any = { page: packagePage, limit: 25 };
      if (packageSearch) params.search = packageSearch;
      const data = await api.get('/api/metrc/packages', params);
      setPackages(Array.isArray(data) ? data : data?.data || []);
      setPackageTotal(data?.total || 0);
    } catch (err) {
      console.error('Failed to load packages:', err);
    } finally {
      setLoadingPackages(false);
    }
  };

  const loadSales = async () => {
    setLoadingSales(true);
    try {
      const data = await api.get('/api/metrc/sales', { page: salesPage, limit: 25 });
      setSales(Array.isArray(data) ? data : data?.data || []);
      setSalesTotal(data?.total || 0);
    } catch (err) {
      console.error('Failed to load sales:', err);
    } finally {
      setLoadingSales(false);
    }
  };

  const loadTransfers = async () => {
    setLoadingTransfers(true);
    try {
      const data = await api.get('/api/metrc/transfers', { page: transfersPage, limit: 25 });
      setTransfers(Array.isArray(data) ? data : data?.data || []);
      setTransfersTotal(data?.total || 0);
    } catch (err) {
      console.error('Failed to load transfers:', err);
    } finally {
      setLoadingTransfers(false);
    }
  };

  const loadSyncLogs = async () => {
    setLoadingLogs(true);
    try {
      const data = await api.get('/api/metrc/sync/log');
      setSyncLogs(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      console.error('Failed to load sync logs:', err);
    } finally {
      setLoadingLogs(false);
    }
  };

  const triggerSync = async () => {
    setSyncing(true);
    try {
      await api.post('/api/metrc/sync');
      toast.success('Sync started');
      loadSyncLogs();
      loadSyncStatus();
    } catch (err: any) {
      toast.error(err.message || 'Failed to start sync');
    } finally {
      setSyncing(false);
    }
  };

  const openLinkModal = async (pkg: any) => {
    setLinkingPackage(pkg);
    setLinkModal(true);
    setLoadingProducts(true);
    try {
      const data = await api.get('/api/products', { limit: 100 });
      setProducts(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      console.error('Failed to load products:', err);
    } finally {
      setLoadingProducts(false);
    }
  };

  const linkProduct = async (productId: string) => {
    try {
      await api.post(`/api/metrc/packages/${linkingPackage.id}/link`, { productId });
      toast.success('Package linked to product');
      setLinkModal(false);
      setLinkingPackage(null);
      loadPackages();
    } catch (err: any) {
      toast.error(err.message || 'Failed to link product');
    }
  };

  const tabs = [
    { id: 'config', label: 'Configuration', icon: Settings },
    { id: 'packages', label: 'Packages', icon: Package },
    { id: 'sales', label: 'Sales', icon: ShoppingCart },
    { id: 'transfers', label: 'Transfers', icon: Truck },
    { id: 'sync', label: 'Sync Log', icon: History },
  ];

  const syncStatusColor = syncStatus?.status === 'success' ? 'text-green-600' : syncStatus?.status === 'error' ? 'text-red-600' : 'text-gray-500';

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Metrc Compliance</h1>
          <p className="text-gray-600">Track-and-trace integration with Metrc</p>
        </div>
      </div>

      {/* Sync Status Bar */}
      <div className="bg-white rounded-lg shadow-sm p-4 mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            {syncStatus?.status === 'success' ? (
              <CheckCircle className="w-5 h-5 text-green-600" />
            ) : syncStatus?.status === 'error' ? (
              <XCircle className="w-5 h-5 text-red-600" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-gray-400" />
            )}
            <span className={`text-sm font-medium ${syncStatusColor}`}>
              {syncStatus?.status === 'success' ? 'Synced' : syncStatus?.status === 'error' ? 'Sync Error' : 'Not Synced'}
            </span>
          </div>
          {syncStatus?.lastSyncAt && (
            <span className="text-sm text-gray-500">
              Last sync: {new Date(syncStatus.lastSyncAt).toLocaleString()}
            </span>
          )}
          <span className="text-sm text-gray-500">
            Auto-sync: {config.autoSync ? 'On' : 'Off'}
          </span>
        </div>
        <Button onClick={triggerSync} disabled={syncing} variant="secondary" size="sm">
          <RefreshCw className={`w-4 h-4 mr-2 inline ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing...' : 'Sync Now'}
        </Button>
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

      {/* Config Tab */}
      {tab === 'config' && (
        <div className="bg-white rounded-lg shadow-sm p-6 max-w-2xl space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
            <input
              type="password"
              value={config.apiKey}
              onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              placeholder="Enter Metrc API key"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">User Key</label>
            <input
              type="password"
              value={config.userKey}
              onChange={(e) => setConfig({ ...config, userKey: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              placeholder="Enter Metrc user key"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">License Number</label>
            <input
              type="text"
              value={config.licenseNumber}
              onChange={(e) => setConfig({ ...config, licenseNumber: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              placeholder="e.g., C10-0000001-LIC"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
            <select
              value={config.state}
              onChange={(e) => setConfig({ ...config, state: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
            >
              <option value="">Select state</option>
              {US_STATES.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={config.autoSync}
                onChange={(e) => setConfig({ ...config, autoSync: e.target.checked })}
                className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
              />
              <span className="text-sm font-medium text-gray-700">Enable Auto-Sync</span>
            </label>
            {config.autoSync && (
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600">Interval (min):</label>
                <input
                  type="number"
                  min={5}
                  value={config.syncInterval}
                  onChange={(e) => setConfig({ ...config, syncInterval: parseInt(e.target.value) || 60 })}
                  className="w-20 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                />
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <Button onClick={saveConfig} disabled={savingConfig}>
              {savingConfig ? 'Saving...' : 'Save Configuration'}
            </Button>
            <Button onClick={testConnection} disabled={testingConnection} variant="secondary">
              {testingConnection ? 'Testing...' : 'Test Connection'}
            </Button>
          </div>
        </div>
      )}

      {/* Packages Tab */}
      {tab === 'packages' && (
        <div>
          <div className="mb-4">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search by tag..."
                value={packageSearch}
                onChange={(e) => { setPackageSearch(e.target.value); setPackagePage(1); }}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              />
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tag</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item Name</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Quantity</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Lab Testing</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Modified</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loadingPackages ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center">
                        <div className="w-6 h-6 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto" />
                      </td>
                    </tr>
                  ) : packages.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-gray-500">No packages found</td>
                    </tr>
                  ) : packages.map(pkg => (
                    <tr key={pkg.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-mono text-gray-900">{pkg.tag || pkg.metrcTag || '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">{pkg.itemName || pkg.name || '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{pkg.category || '—'}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-900">{pkg.quantity ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 text-xs rounded-full ${
                          pkg.labTestingState === 'TestPassed' ? 'bg-green-100 text-green-700' :
                          pkg.labTestingState === 'TestFailed' ? 'bg-red-100 text-red-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {pkg.labTestingState || 'N/A'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {pkg.productName || pkg.linkedProduct || '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {pkg.lastModified ? new Date(pkg.lastModified).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => openLinkModal(pkg)}
                          className="text-sm text-green-600 hover:text-green-700 flex items-center gap-1"
                        >
                          <Link className="w-3 h-3" /> Link Product
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {packageTotal > 25 && (
              <div className="px-4 py-3 border-t flex items-center justify-between">
                <span className="text-sm text-gray-500">
                  Page {packagePage} of {Math.ceil(packageTotal / 25)}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPackagePage(p => Math.max(1, p - 1))}
                    disabled={packagePage <= 1}
                    className="px-3 py-1 text-sm border rounded-lg disabled:opacity-50 hover:bg-gray-50"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPackagePage(p => p + 1)}
                    disabled={packagePage >= Math.ceil(packageTotal / 25)}
                    className="px-3 py-1 text-sm border rounded-lg disabled:opacity-50 hover:bg-gray-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sales Tab */}
      {tab === 'sales' && (
        <div>
          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Receipt #</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Customer Type</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Packages</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Linked Order</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loadingSales ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center">
                        <div className="w-6 h-6 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto" />
                      </td>
                    </tr>
                  ) : sales.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-gray-500">No Metrc sales found</td>
                    </tr>
                  ) : sales.map(sale => (
                    <tr key={sale.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{sale.receiptNumber || sale.id}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {sale.salesDateTime ? new Date(sale.salesDateTime).toLocaleDateString() : sale.date || '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{sale.customerType || 'Patient'}</td>
                      <td className="px-4 py-3 text-sm text-right font-medium text-gray-900">
                        ${Number(sale.totalPrice || sale.total || 0).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-gray-600">{sale.packageCount || sale.packages?.length || 0}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{sale.linkedOrderId || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {salesTotal > 25 && (
              <div className="px-4 py-3 border-t flex items-center justify-between">
                <span className="text-sm text-gray-500">
                  Page {salesPage} of {Math.ceil(salesTotal / 25)}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSalesPage(p => Math.max(1, p - 1))}
                    disabled={salesPage <= 1}
                    className="px-3 py-1 text-sm border rounded-lg disabled:opacity-50 hover:bg-gray-50"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setSalesPage(p => p + 1)}
                    disabled={salesPage >= Math.ceil(salesTotal / 25)}
                    className="px-3 py-1 text-sm border rounded-lg disabled:opacity-50 hover:bg-gray-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Transfers Tab */}
      {tab === 'transfers' && (
        <div>
          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Manifest #</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">From</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">To</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Packages</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loadingTransfers ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center">
                        <div className="w-6 h-6 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto" />
                      </td>
                    </tr>
                  ) : transfers.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-gray-500">No transfers found</td>
                    </tr>
                  ) : transfers.map(transfer => (
                    <tr key={transfer.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{transfer.manifestNumber || transfer.id}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{transfer.transferType || transfer.type || '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{transfer.shipperFacilityName || transfer.from || '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{transfer.recipientFacilityName || transfer.to || '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {transfer.createdDateTime ? new Date(transfer.createdDateTime).toLocaleDateString() : transfer.date || '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-gray-600">{transfer.packageCount || 0}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 text-xs rounded-full ${
                          transfer.status === 'Received' ? 'bg-green-100 text-green-700' :
                          transfer.status === 'In Transit' ? 'bg-blue-100 text-blue-700' :
                          transfer.status === 'Rejected' ? 'bg-red-100 text-red-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {transfer.status || 'Pending'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {transfersTotal > 25 && (
              <div className="px-4 py-3 border-t flex items-center justify-between">
                <span className="text-sm text-gray-500">
                  Page {transfersPage} of {Math.ceil(transfersTotal / 25)}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setTransfersPage(p => Math.max(1, p - 1))}
                    disabled={transfersPage <= 1}
                    className="px-3 py-1 text-sm border rounded-lg disabled:opacity-50 hover:bg-gray-50"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setTransfersPage(p => p + 1)}
                    disabled={transfersPage >= Math.ceil(transfersTotal / 25)}
                    className="px-3 py-1 text-sm border rounded-lg disabled:opacity-50 hover:bg-gray-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sync Log Tab */}
      {tab === 'sync' && (
        <div>
          <div className="flex justify-end mb-4">
            <Button onClick={triggerSync} disabled={syncing}>
              <RefreshCw className={`w-4 h-4 mr-2 inline ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing...' : 'Manual Sync'}
            </Button>
          </div>
          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Timestamp</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Records</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Duration</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loadingLogs ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center">
                      <div className="w-6 h-6 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto" />
                    </td>
                  </tr>
                ) : syncLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">No sync history</td>
                  </tr>
                ) : syncLogs.map(log => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {log.createdAt ? new Date(log.createdAt).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{log.syncType || log.type || 'Full'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 text-xs rounded-full ${
                        log.status === 'success' ? 'bg-green-100 text-green-700' :
                        log.status === 'error' ? 'bg-red-100 text-red-700' :
                        log.status === 'running' ? 'bg-blue-100 text-blue-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {log.status || 'unknown'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">{log.recordCount ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{log.duration ? `${log.duration}s` : '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 truncate max-w-xs">{log.details || log.error || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Link Product Modal */}
      <Modal
        isOpen={linkModal}
        onClose={() => { setLinkModal(false); setLinkingPackage(null); }}
        title="Link Package to Product"
      >
        <p className="text-sm text-gray-400 mb-4">
          Linking tag: <span className="font-mono text-gray-300">{linkingPackage?.tag || linkingPackage?.metrcTag}</span>
        </p>
        {loadingProducts ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : products.length === 0 ? (
          <p className="text-gray-400 text-center py-8">No products found</p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {products.map(product => (
              <button
                key={product.id}
                onClick={() => linkProduct(product.id)}
                className="w-full text-left px-4 py-3 rounded-lg hover:bg-slate-800 transition-colors flex items-center justify-between"
              >
                <div>
                  <p className="font-medium text-white">{product.name}</p>
                  <p className="text-sm text-gray-400">{product.sku || product.category || ''}</p>
                </div>
                <Link className="w-4 h-4 text-gray-500" />
              </button>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
