import { useState, useEffect, useCallback } from 'react';
import { Plus, Search, Building2, BarChart3, CreditCard, FileCode2, MapPin, ChevronRight, DollarSign, ShieldCheck, Package } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { DataTable, StatusBadge, PageHeader, Button } from '../components/ui/DataTable';
import { Modal } from '../components/ui/Modal';

const tabs = [
  { id: 'store-groups', label: 'Store Groups', icon: Building2 },
  { id: 'reports', label: 'Multi-Store Reports', icon: BarChart3 },
  { id: 'ach', label: 'ACH Payments', icon: CreditCard },
  { id: 'api-docs', label: 'API Documentation', icon: FileCode2 },
];

const txStatusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  processing: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  returned: 'bg-red-100 text-red-700',
};

export default function EnterprisePage() {
  const [activeTab, setActiveTab] = useState('store-groups');

  return (
    <div>
      <PageHeader title="Enterprise" subtitle="Multi-store management and enterprise features" />

      <div className="flex gap-1 mb-6 overflow-x-auto pb-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-colors ${
              activeTab === tab.id
                ? 'bg-orange-500 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'store-groups' && <StoreGroupsTab />}
      {activeTab === 'reports' && <MultiStoreReportsTab />}
      {activeTab === 'ach' && <ACHTab />}
      {activeTab === 'api-docs' && <APIDocsTab />}
    </div>
  );
}

/* ─── Store Groups Tab ─── */
function StoreGroupsTab() {
  const toast = useToast();
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGroup, setSelectedGroup] = useState<any>(null);
  const [groupDashboard, setGroupDashboard] = useState<any>(null);
  const [dashLoading, setDashLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [addLocModalOpen, setAddLocModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({ name: '', description: '' });
  const [locationId, setLocationId] = useState('');

  const loadGroups = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/enterprise/store-groups');
      setGroups(Array.isArray(data) ? data : data?.data || []);
    } catch {
      toast.error('Failed to load store groups');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  const loadGroupDashboard = async (group: any) => {
    setSelectedGroup(group);
    setDashLoading(true);
    try {
      const data = await api.get(`/api/enterprise/store-groups/${group.id}/dashboard`);
      setGroupDashboard(data);
    } catch {
      toast.error('Failed to load group dashboard');
    } finally {
      setDashLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!formData.name.trim()) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      await api.post('/api/enterprise/store-groups', formData);
      toast.success('Store group created');
      setModalOpen(false);
      setFormData({ name: '', description: '' });
      loadGroups();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create group');
    } finally {
      setSaving(false);
    }
  };

  const handleAddLocation = async () => {
    if (!selectedGroup || !locationId.trim()) { toast.error('Enter a location ID'); return; }
    setSaving(true);
    try {
      await api.post(`/api/enterprise/store-groups/${selectedGroup.id}/locations`, { locationId });
      toast.success('Location added');
      setAddLocModalOpen(false);
      setLocationId('');
      loadGroups();
      loadGroupDashboard(selectedGroup);
    } catch (err: any) {
      toast.error(err.message || 'Failed to add location');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button onClick={() => { setFormData({ name: '', description: '' }); setModalOpen(true); }}>
          <Plus className="w-4 h-4 mr-2 inline" />Create Group
        </Button>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {/* Groups List */}
        <div className="md:col-span-1 space-y-3">
          {groups.length === 0 ? (
            <div className="bg-white rounded-lg shadow-sm p-8 text-center text-gray-500">No store groups yet</div>
          ) : groups.map((group) => (
            <div
              key={group.id}
              onClick={() => loadGroupDashboard(group)}
              className={`bg-white rounded-lg shadow-sm p-4 cursor-pointer hover:shadow-md transition-shadow ${selectedGroup?.id === group.id ? 'ring-2 ring-orange-500' : ''}`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900">{group.name}</h3>
                  {group.description && <p className="text-sm text-gray-500">{group.description}</p>}
                  <div className="flex items-center gap-1 mt-1 text-sm text-gray-400">
                    <MapPin className="w-3 h-3" />
                    {group.locationCount || 0} locations
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400" />
              </div>
            </div>
          ))}
        </div>

        {/* Group Dashboard */}
        <div className="md:col-span-2">
          {!selectedGroup ? (
            <div className="bg-white rounded-lg shadow-sm p-12 text-center text-gray-500">Select a store group to view its dashboard</div>
          ) : dashLoading ? (
            <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">{selectedGroup.name} Dashboard</h2>
                <Button variant="secondary" size="sm" onClick={() => { setLocationId(''); setAddLocModalOpen(true); }}>
                  <Plus className="w-3 h-3 mr-1 inline" />Add Location
                </Button>
              </div>

              {groupDashboard && (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-white rounded-lg shadow-sm p-4">
                      <p className="text-xs text-gray-500">Total Revenue</p>
                      <p className="text-xl font-bold text-gray-900">${Number(groupDashboard.totalRevenue || 0).toLocaleString()}</p>
                    </div>
                    <div className="bg-white rounded-lg shadow-sm p-4">
                      <p className="text-xs text-gray-500">Total Orders</p>
                      <p className="text-xl font-bold text-gray-900">{groupDashboard.totalOrders || 0}</p>
                    </div>
                    <div className="bg-white rounded-lg shadow-sm p-4">
                      <p className="text-xs text-gray-500">Total Products</p>
                      <p className="text-xl font-bold text-gray-900">{groupDashboard.totalProducts || 0}</p>
                    </div>
                    <div className="bg-white rounded-lg shadow-sm p-4">
                      <p className="text-xs text-gray-500">Avg Order Value</p>
                      <p className="text-xl font-bold text-gray-900">${Number(groupDashboard.avgOrderValue || 0).toFixed(2)}</p>
                    </div>
                  </div>

                  {/* Location breakdown */}
                  {groupDashboard.locations && groupDashboard.locations.length > 0 && (
                    <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                      <div className="px-4 py-3 border-b">
                        <h3 className="font-semibold text-gray-900">Location Breakdown</h3>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-gray-50 border-b">
                            <tr>
                              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Location</th>
                              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Revenue</th>
                              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Orders</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {groupDashboard.locations.map((loc: any, i: number) => (
                              <tr key={i} className="hover:bg-gray-50">
                                <td className="px-4 py-3 text-gray-900 font-medium">{loc.name}</td>
                                <td className="px-4 py-3 text-gray-700">${Number(loc.revenue || 0).toLocaleString()}</td>
                                <td className="px-4 py-3 text-gray-700">{loc.orders || 0}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Create Group Modal */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Create Store Group" size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Group Name *</label>
            <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="West Coast Stores" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Description</label>
            <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} rows={3} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-slate-300 hover:bg-slate-800 rounded-lg font-medium">Cancel</button>
          <Button onClick={handleCreate} disabled={saving}>{saving ? 'Creating...' : 'Create Group'}</Button>
        </div>
      </Modal>

      {/* Add Location Modal */}
      <Modal isOpen={addLocModalOpen} onClose={() => setAddLocModalOpen(false)} title="Add Location to Group" size="sm">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Location ID</label>
          <input type="text" value={locationId} onChange={(e) => setLocationId(e.target.value)} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="loc_abc123" />
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setAddLocModalOpen(false)} className="px-4 py-2 text-slate-300 hover:bg-slate-800 rounded-lg font-medium">Cancel</button>
          <Button onClick={handleAddLocation} disabled={saving}>{saving ? 'Adding...' : 'Add Location'}</Button>
        </div>
      </Modal>
    </>
  );
}

/* ─── Multi-Store Reports Tab ─── */
function MultiStoreReportsTab() {
  const toast = useToast();
  const [salesData, setSalesData] = useState<any[]>([]);
  const [inventoryData, setInventoryData] = useState<any[]>([]);
  const [complianceData, setComplianceData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get('/api/enterprise/multi-store/sales').catch(() => []),
      api.get('/api/enterprise/multi-store/inventory').catch(() => []),
      api.get('/api/enterprise/multi-store/compliance').catch(() => []),
    ]).then(([sales, inventory, compliance]) => {
      setSalesData(Array.isArray(sales) ? sales : sales?.data || []);
      setInventoryData(Array.isArray(inventory) ? inventory : inventory?.data || []);
      setComplianceData(Array.isArray(compliance) ? compliance : compliance?.data || []);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Sales Comparison */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-gray-400" />
          <h3 className="font-semibold text-gray-900">Location Sales Comparison</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Location</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Today</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">This Week</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">This Month</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Orders</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Avg Ticket</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {salesData.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No sales data</td></tr>
              ) : salesData.map((loc, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-900 font-medium">{loc.name}</td>
                  <td className="px-4 py-3 text-gray-700">${Number(loc.today || 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-700">${Number(loc.thisWeek || 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-700">${Number(loc.thisMonth || 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-700">{loc.orderCount || 0}</td>
                  <td className="px-4 py-3 text-gray-700">${Number(loc.avgTicket || 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Inventory Across Locations */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center gap-2">
          <Package className="w-4 h-4 text-gray-400" />
          <h3 className="font-semibold text-gray-900">Inventory Across Locations</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Location</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Total SKUs</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Total Units</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Low Stock</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Out of Stock</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {inventoryData.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No inventory data</td></tr>
              ) : inventoryData.map((loc, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-900 font-medium">{loc.name}</td>
                  <td className="px-4 py-3 text-gray-700">{loc.totalSkus || 0}</td>
                  <td className="px-4 py-3 text-gray-700">{(loc.totalUnits || 0).toLocaleString()}</td>
                  <td className="px-4 py-3"><span className={`font-medium ${(loc.lowStock || 0) > 0 ? 'text-amber-600' : 'text-gray-400'}`}>{loc.lowStock || 0}</span></td>
                  <td className="px-4 py-3"><span className={`font-medium ${(loc.outOfStock || 0) > 0 ? 'text-red-600' : 'text-gray-400'}`}>{loc.outOfStock || 0}</span></td>
                  <td className="px-4 py-3 text-gray-700">${Number(loc.value || 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Compliance Status */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-gray-400" />
          <h3 className="font-semibold text-gray-900">Compliance Status</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Location</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">License Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Metrc Sync</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Last Audit</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Issues</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {complianceData.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No compliance data</td></tr>
              ) : complianceData.map((loc, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-900 font-medium">{loc.name}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${loc.licenseStatus === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {loc.licenseStatus || 'unknown'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${loc.metrcSync === 'synced' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      {loc.metrcSync || 'unknown'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{loc.lastAudit ? new Date(loc.lastAudit).toLocaleDateString() : '--'}</td>
                  <td className="px-4 py-3"><span className={`font-medium ${(loc.issues || 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>{loc.issues || 0}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─── ACH Payments Tab ─── */
function ACHTab() {
  const toast = useToast();
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [setupModalOpen, setSetupModalOpen] = useState(false);
  const [chargeModalOpen, setChargeModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bankData, setBankData] = useState({ routingNumber: '', accountNumber: '', accountName: '', accountType: 'checking' });
  const [chargeData, setChargeData] = useState({ amount: '', description: '', customerId: '' });

  const loadTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 25 };
      const data = await api.get('/api/enterprise/ach/transactions', params);
      setTransactions(Array.isArray(data) ? data : data?.data || []);
      setPagination(data?.pagination || null);
    } catch {
      toast.error('Failed to load transactions');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { loadTransactions(); }, [loadTransactions]);

  const handleSetup = async () => {
    if (!bankData.routingNumber || !bankData.accountNumber) { toast.error('Bank details are required'); return; }
    setSaving(true);
    try {
      await api.post('/api/enterprise/ach/setup', bankData);
      toast.success('ACH account configured');
      setSetupModalOpen(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to setup ACH');
    } finally {
      setSaving(false);
    }
  };

  const handleCharge = async () => {
    if (!chargeData.amount || !chargeData.customerId) { toast.error('Amount and customer are required'); return; }
    setSaving(true);
    try {
      await api.post('/api/enterprise/ach/charge', {
        amount: parseFloat(chargeData.amount),
        description: chargeData.description || undefined,
        customerId: chargeData.customerId,
      });
      toast.success('ACH charge initiated');
      setChargeModalOpen(false);
      setChargeData({ amount: '', description: '', customerId: '' });
      loadTransactions();
    } catch (err: any) {
      toast.error(err.message || 'Failed to initiate charge');
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { key: 'id', label: 'Transaction ID', render: (val: string) => <span className="font-mono text-sm text-gray-900">{val?.slice(0, 12)}...</span> },
    { key: 'type', label: 'Type', render: (val: string) => <span className="capitalize text-gray-700">{val}</span> },
    { key: 'amount', label: 'Amount', render: (val: number) => <span className="font-medium text-gray-900">${Number(val || 0).toFixed(2)}</span> },
    { key: 'status', label: 'Status', render: (val: string) => <StatusBadge status={val} statusColors={txStatusColors} /> },
    { key: 'customerName', label: 'Customer', render: (val: string) => val || <span className="text-gray-400">--</span> },
    { key: 'description', label: 'Description', render: (val: string) => val || <span className="text-gray-400">--</span> },
    { key: 'createdAt', label: 'Date', render: (val: string) => val ? new Date(val).toLocaleDateString() : '--' },
  ];

  return (
    <>
      <div className="flex gap-3 mb-4 justify-end">
        <Button variant="secondary" onClick={() => { setBankData({ routingNumber: '', accountNumber: '', accountName: '', accountType: 'checking' }); setSetupModalOpen(true); }}>
          <CreditCard className="w-4 h-4 mr-2 inline" />ACH Setup
        </Button>
        <Button onClick={() => { setChargeData({ amount: '', description: '', customerId: '' }); setChargeModalOpen(true); }}>
          <DollarSign className="w-4 h-4 mr-2 inline" />Initiate Charge
        </Button>
      </div>

      <DataTable data={transactions} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} emptyMessage="No ACH transactions" />

      {/* ACH Setup Modal */}
      <Modal isOpen={setupModalOpen} onClose={() => setSetupModalOpen(false)} title="ACH Account Setup" size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Account Name</label>
            <input type="text" value={bankData.accountName} onChange={(e) => setBankData({ ...bankData, accountName: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="Business Name" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Routing Number *</label>
            <input type="text" value={bankData.routingNumber} onChange={(e) => setBankData({ ...bankData, routingNumber: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white font-mono focus:ring-2 focus:ring-orange-500" placeholder="021000021" maxLength={9} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Account Number *</label>
            <input type="text" value={bankData.accountNumber} onChange={(e) => setBankData({ ...bankData, accountNumber: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white font-mono focus:ring-2 focus:ring-orange-500" placeholder="1234567890" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Account Type</label>
            <select value={bankData.accountType} onChange={(e) => setBankData({ ...bankData, accountType: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500">
              <option value="checking">Checking</option>
              <option value="savings">Savings</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setSetupModalOpen(false)} className="px-4 py-2 text-slate-300 hover:bg-slate-800 rounded-lg font-medium">Cancel</button>
          <Button onClick={handleSetup} disabled={saving}>{saving ? 'Saving...' : 'Save Account'}</Button>
        </div>
      </Modal>

      {/* Charge Modal */}
      <Modal isOpen={chargeModalOpen} onClose={() => setChargeModalOpen(false)} title="Initiate ACH Charge" size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Customer ID *</label>
            <input type="text" value={chargeData.customerId} onChange={(e) => setChargeData({ ...chargeData, customerId: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="Customer ID" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Amount ($) *</label>
            <input type="number" step="0.01" value={chargeData.amount} onChange={(e) => setChargeData({ ...chargeData, amount: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="0.00" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Description</label>
            <input type="text" value={chargeData.description} onChange={(e) => setChargeData({ ...chargeData, description: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="Wholesale order payment" />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setChargeModalOpen(false)} className="px-4 py-2 text-slate-300 hover:bg-slate-800 rounded-lg font-medium">Cancel</button>
          <Button onClick={handleCharge} disabled={saving}>{saving ? 'Processing...' : 'Initiate Charge'}</Button>
        </div>
      </Modal>
    </>
  );
}

/* ─── API Documentation Tab ─── */
function APIDocsTab() {
  const toast = useToast();
  const [spec, setSpec] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [expandedEndpoint, setExpandedEndpoint] = useState<string | null>(null);

  useEffect(() => {
    api.get('/api/enterprise/api-docs')
      .then(setSpec)
      .catch(() => toast.error('Failed to load API documentation'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" /></div>;
  }

  if (!spec) {
    return <div className="bg-white rounded-lg shadow-sm p-12 text-center text-gray-500">No API documentation available</div>;
  }

  const methodColors: Record<string, string> = {
    get: 'bg-blue-100 text-blue-700',
    post: 'bg-green-100 text-green-700',
    put: 'bg-amber-100 text-amber-700',
    patch: 'bg-orange-100 text-orange-700',
    delete: 'bg-red-100 text-red-700',
  };

  // Parse OpenAPI spec paths
  const endpoints: any[] = [];
  if (spec.paths) {
    Object.entries(spec.paths).forEach(([path, methods]: [string, any]) => {
      Object.entries(methods).forEach(([method, details]: [string, any]) => {
        endpoints.push({ path, method, ...details, id: `${method}-${path}` });
      });
    });
  }

  return (
    <div className="space-y-4">
      {/* API Info */}
      <div className="bg-white rounded-lg shadow-sm p-5">
        <h2 className="text-lg font-semibold text-gray-900">{spec.info?.title || 'API Documentation'}</h2>
        {spec.info?.description && <p className="text-gray-600 mt-1">{spec.info.description}</p>}
        <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
          {spec.info?.version && <span>Version {spec.info.version}</span>}
          {spec.servers?.[0]?.url && <span className="font-mono">{spec.servers[0].url}</span>}
        </div>
      </div>

      {/* Endpoints */}
      {endpoints.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm p-8 text-center text-gray-500">No endpoints documented</div>
      ) : (
        <div className="space-y-2">
          {endpoints.map((ep) => {
            const isExpanded = expandedEndpoint === ep.id;
            return (
              <div key={ep.id} className="bg-white rounded-lg shadow-sm overflow-hidden">
                <button
                  onClick={() => setExpandedEndpoint(isExpanded ? null : ep.id)}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 text-left"
                >
                  <span className={`px-2 py-0.5 text-xs font-bold rounded uppercase ${methodColors[ep.method] || 'bg-gray-100 text-gray-700'}`}>
                    {ep.method}
                  </span>
                  <span className="font-mono text-sm text-gray-900">{ep.path}</span>
                  <span className="text-sm text-gray-500 ml-2">{ep.summary || ''}</span>
                  <ChevronRight className={`w-4 h-4 text-gray-400 ml-auto transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-gray-100 pt-3">
                    {ep.description && <p className="text-sm text-gray-600 mb-3">{ep.description}</p>}

                    {/* Parameters */}
                    {ep.parameters && ep.parameters.length > 0 && (
                      <div className="mb-3">
                        <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Parameters</h4>
                        <div className="space-y-1">
                          {ep.parameters.map((param: any, i: number) => (
                            <div key={i} className="flex items-center gap-2 text-sm">
                              <span className="font-mono text-gray-900">{param.name}</span>
                              <span className="text-xs text-gray-400">({param.in})</span>
                              {param.required && <span className="text-xs text-red-500">required</span>}
                              {param.description && <span className="text-gray-500">- {param.description}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Request Body */}
                    {ep.requestBody && (
                      <div className="mb-3">
                        <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Request Body</h4>
                        <pre className="bg-gray-900 text-green-400 p-3 rounded-lg text-xs overflow-x-auto">
                          {JSON.stringify(
                            ep.requestBody.content?.['application/json']?.schema || ep.requestBody,
                            null,
                            2
                          )}
                        </pre>
                      </div>
                    )}

                    {/* Responses */}
                    {ep.responses && (
                      <div>
                        <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Responses</h4>
                        <div className="space-y-2">
                          {Object.entries(ep.responses).map(([code, resp]: [string, any]) => (
                            <div key={code} className="text-sm">
                              <div className="flex items-center gap-2">
                                <span className={`font-mono font-bold ${code.startsWith('2') ? 'text-green-600' : code.startsWith('4') ? 'text-red-600' : 'text-gray-600'}`}>
                                  {code}
                                </span>
                                <span className="text-gray-600">{resp.description || ''}</span>
                              </div>
                              {resp.content?.['application/json']?.schema && (
                                <pre className="bg-gray-900 text-green-400 p-3 rounded-lg text-xs overflow-x-auto mt-1">
                                  {JSON.stringify(resp.content['application/json'].schema, null, 2)}
                                </pre>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
