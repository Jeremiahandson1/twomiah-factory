import { useState, useEffect, useCallback } from 'react';
import { Plus, Search, Users, ShoppingCart, FlaskConical, Truck, FileCheck, DollarSign, ExternalLink } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { DataTable, StatusBadge, PageHeader, Button } from '../components/ui/DataTable';
import { Modal } from '../components/ui/Modal';

const orderStatusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  confirmed: 'bg-blue-100 text-blue-700',
  shipped: 'bg-purple-100 text-purple-700',
  delivered: 'bg-green-100 text-green-700',
  invoiced: 'bg-amber-100 text-amber-700',
  paid: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

const paymentStatusColors: Record<string, string> = {
  unpaid: 'bg-red-100 text-red-700',
  partial: 'bg-amber-100 text-amber-700',
  paid: 'bg-green-100 text-green-700',
};

const labStatusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

const resultColors: Record<string, string> = {
  pass: 'bg-green-100 text-green-700',
  fail: 'bg-red-100 text-red-700',
  pending: 'bg-yellow-100 text-yellow-700',
};

const contaminantTests = ['pesticides', 'heavyMetals', 'microbials', 'mycotoxins', 'residualSolvents', 'foreignMatter'];

const tabs = [
  { id: 'customers', label: 'Customers', icon: Users },
  { id: 'orders', label: 'Orders', icon: ShoppingCart },
  { id: 'lab-tests', label: 'Lab Tests', icon: FlaskConical },
];

export default function WholesalePage() {
  const [activeTab, setActiveTab] = useState('customers');

  return (
    <div>
      <PageHeader title="Wholesale & Distribution" subtitle="Manage B2B customers, orders, and lab testing" />

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

      {activeTab === 'customers' && <CustomersTab />}
      {activeTab === 'orders' && <OrdersTab />}
      {activeTab === 'lab-tests' && <LabTestsTab />}
    </div>
  );
}

/* ─── Customers Tab ─── */
function CustomersTab() {
  const toast = useToast();
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '', licenseNumber: '', contactName: '', contactEmail: '', contactPhone: '', paymentTerms: 'net30', address: '',
  });

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 25 };
      if (search) params.search = search;
      const data = await api.get('/api/wholesale/customers', params);
      setCustomers(Array.isArray(data) ? data : data?.data || []);
      setPagination(data?.pagination || null);
    } catch {
      toast.error('Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { loadCustomers(); }, [loadCustomers]);
  useEffect(() => { setPage(1); }, [search]);

  const openCreate = () => {
    setEditingCustomer(null);
    setFormData({ name: '', licenseNumber: '', contactName: '', contactEmail: '', contactPhone: '', paymentTerms: 'net30', address: '' });
    setModalOpen(true);
  };

  const openEdit = (customer: any) => {
    setEditingCustomer(customer);
    setFormData({
      name: customer.name || '',
      licenseNumber: customer.licenseNumber || '',
      contactName: customer.contactName || '',
      contactEmail: customer.contactEmail || '',
      contactPhone: customer.contactPhone || '',
      paymentTerms: customer.paymentTerms || 'net30',
      address: customer.address || '',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      if (editingCustomer) {
        await api.put(`/api/wholesale/customers/${editingCustomer.id}`, formData);
        toast.success('Customer updated');
      } else {
        await api.post('/api/wholesale/customers', formData);
        toast.success('Customer created');
      }
      setModalOpen(false);
      loadCustomers();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save customer');
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { key: 'name', label: 'Name', render: (val: string) => <span className="font-medium text-gray-900">{val}</span> },
    { key: 'licenseNumber', label: 'License #', render: (val: string) => val ? <span className="font-mono text-sm text-gray-700">{val}</span> : <span className="text-gray-400">--</span> },
    { key: 'contactName', label: 'Contact', render: (val: string, row: any) => (
      <div>
        <p className="text-gray-700">{val || '--'}</p>
        {row.contactEmail && <p className="text-xs text-gray-500">{row.contactEmail}</p>}
      </div>
    )},
    { key: 'paymentTerms', label: 'Payment Terms', render: (val: string) => <span className="capitalize text-gray-700">{val?.replace(/([A-Z])/g, ' $1') || '--'}</span> },
    { key: 'balance', label: 'Balance', render: (val: number) => val ? <span className={`font-medium ${val > 0 ? 'text-red-600' : 'text-green-600'}`}>${Number(val).toFixed(2)}</span> : <span className="text-gray-400">$0.00</span> },
  ];

  return (
    <>
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search customers..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900" />
        </div>
        <Button onClick={openCreate} className="ml-auto"><Plus className="w-4 h-4 mr-2 inline" />Add Customer</Button>
      </div>

      <DataTable data={customers} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} onRowClick={openEdit} emptyMessage="No wholesale customers" />

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editingCustomer ? 'Edit Customer' : 'Add Customer'} size="lg">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-300 mb-1">Business Name *</label>
            <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="Green Valley Dispensary" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">License Number</label>
            <input type="text" value={formData.licenseNumber} onChange={(e) => setFormData({ ...formData, licenseNumber: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="C10-0000001" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Payment Terms</label>
            <select value={formData.paymentTerms} onChange={(e) => setFormData({ ...formData, paymentTerms: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500">
              <option value="cod">COD</option>
              <option value="net15">Net 15</option>
              <option value="net30">Net 30</option>
              <option value="net60">Net 60</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Contact Name</label>
            <input type="text" value={formData.contactName} onChange={(e) => setFormData({ ...formData, contactName: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Contact Email</label>
            <input type="email" value={formData.contactEmail} onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Contact Phone</label>
            <input type="tel" value={formData.contactPhone} onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Address</label>
            <input type="text" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-slate-300 hover:bg-slate-800 rounded-lg font-medium">Cancel</button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : editingCustomer ? 'Update' : 'Create'}</Button>
        </div>
      </Modal>
    </>
  );
}

/* ─── Orders Tab ─── */
function OrdersTab() {
  const toast = useToast();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [shipModalOpen, setShipModalOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState({
    customerId: '', shippingAddress: '', notes: '',
  });
  const [lineItems, setLineItems] = useState<any[]>([{ productName: '', batchId: '', quantity: '', price: '', metrcTag: '' }]);
  const [manifestNumber, setManifestNumber] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('check');

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 25 };
      if (search) params.search = search;
      const data = await api.get('/api/wholesale/orders', params);
      setOrders(Array.isArray(data) ? data : data?.data || []);
      setPagination(data?.pagination || null);
    } catch {
      toast.error('Failed to load orders');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { loadOrders(); }, [loadOrders]);
  useEffect(() => { setPage(1); }, [search]);

  const addLineItem = () => {
    setLineItems([...lineItems, { productName: '', batchId: '', quantity: '', price: '', metrcTag: '' }]);
  };

  const updateLineItem = (idx: number, field: string, value: string) => {
    const updated = [...lineItems];
    updated[idx] = { ...updated[idx], [field]: value };
    setLineItems(updated);
  };

  const removeLineItem = (idx: number) => {
    if (lineItems.length <= 1) return;
    setLineItems(lineItems.filter((_, i) => i !== idx));
  };

  const handleCreateOrder = async () => {
    if (!formData.customerId) { toast.error('Select a customer'); return; }
    const items = lineItems.filter(li => li.productName && li.quantity && li.price).map(li => ({
      ...li,
      quantity: parseInt(li.quantity),
      price: parseFloat(li.price),
    }));
    if (items.length === 0) { toast.error('Add at least one line item'); return; }
    setSaving(true);
    try {
      await api.post('/api/wholesale/orders', {
        customerId: formData.customerId,
        shippingAddress: formData.shippingAddress || undefined,
        notes: formData.notes || undefined,
        lineItems: items,
      });
      toast.success('Order created');
      setCreateModalOpen(false);
      setFormData({ customerId: '', shippingAddress: '', notes: '' });
      setLineItems([{ productName: '', batchId: '', quantity: '', price: '', metrcTag: '' }]);
      loadOrders();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create order');
    } finally {
      setSaving(false);
    }
  };

  const handleAction = async (orderId: string, action: string, data?: any) => {
    try {
      await api.post(`/api/wholesale/orders/${orderId}/${action}`, data || {});
      toast.success(`Order ${action}ed`);
      loadOrders();
    } catch (err: any) {
      toast.error(err.message || `Failed to ${action} order`);
    }
  };

  const handleShip = async () => {
    if (!selectedOrder) return;
    setSaving(true);
    try {
      await api.post(`/api/wholesale/orders/${selectedOrder.id}/ship`, { manifestNumber });
      toast.success('Order shipped');
      setShipModalOpen(false);
      setManifestNumber('');
      loadOrders();
    } catch (err: any) {
      toast.error(err.message || 'Failed to ship order');
    } finally {
      setSaving(false);
    }
  };

  const handlePayment = async () => {
    if (!selectedOrder || !paymentAmount) return;
    setSaving(true);
    try {
      await api.post(`/api/wholesale/orders/${selectedOrder.id}/payment`, {
        amount: parseFloat(paymentAmount),
        method: paymentMethod,
      });
      toast.success('Payment recorded');
      setPaymentModalOpen(false);
      setPaymentAmount('');
      loadOrders();
    } catch (err: any) {
      toast.error(err.message || 'Failed to record payment');
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { key: 'orderNumber', label: 'Order #', render: (val: string) => <span className="font-mono font-medium text-gray-900">{val || '--'}</span> },
    { key: 'customerName', label: 'Customer', render: (val: string) => <span className="text-gray-700">{val || '--'}</span> },
    { key: 'status', label: 'Status', render: (val: string) => <StatusBadge status={val} statusColors={orderStatusColors} /> },
    { key: 'total', label: 'Total', render: (val: number) => <span className="font-medium text-gray-900">${Number(val || 0).toFixed(2)}</span> },
    { key: 'paymentStatus', label: 'Payment', render: (val: string) => <StatusBadge status={val} statusColors={paymentStatusColors} /> },
    { key: 'dueDate', label: 'Due Date', render: (val: string) => val ? new Date(val).toLocaleDateString() : <span className="text-gray-400">--</span> },
  ];

  const actions = [
    { label: 'Confirm', icon: FileCheck, onClick: (row: any) => handleAction(row.id, 'confirm') },
    { label: 'Ship', icon: Truck, onClick: (row: any) => { setSelectedOrder(row); setShipModalOpen(true); } },
    { label: 'Deliver', icon: FileCheck, onClick: (row: any) => handleAction(row.id, 'deliver') },
    { label: 'Invoice', icon: DollarSign, onClick: (row: any) => handleAction(row.id, 'invoice') },
    { label: 'Record Payment', icon: DollarSign, onClick: (row: any) => { setSelectedOrder(row); setPaymentAmount(''); setPaymentModalOpen(true); } },
  ];

  return (
    <>
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search orders..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900" />
        </div>
        <Button onClick={() => setCreateModalOpen(true)} className="ml-auto"><Plus className="w-4 h-4 mr-2 inline" />Create Order</Button>
      </div>

      <DataTable data={orders} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} actions={actions} emptyMessage="No wholesale orders" />

      {/* Create Order Modal */}
      <Modal isOpen={createModalOpen} onClose={() => setCreateModalOpen(false)} title="Create Wholesale Order" size="xl">
        <div className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Customer ID *</label>
              <input type="text" value={formData.customerId} onChange={(e) => setFormData({ ...formData, customerId: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="Customer ID" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Shipping Address</label>
              <input type="text" value={formData.shippingAddress} onChange={(e) => setFormData({ ...formData, shippingAddress: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-slate-300">Line Items</label>
              <button onClick={addLineItem} className="text-sm text-orange-400 hover:text-orange-300">+ Add Item</button>
            </div>
            <div className="space-y-3">
              {lineItems.map((item, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-3">
                    {idx === 0 && <label className="block text-xs text-slate-400 mb-1">Product</label>}
                    <input type="text" value={item.productName} onChange={(e) => updateLineItem(idx, 'productName', e.target.value)} className="w-full px-2 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-orange-500" placeholder="Product" />
                  </div>
                  <div className="col-span-2">
                    {idx === 0 && <label className="block text-xs text-slate-400 mb-1">Batch</label>}
                    <input type="text" value={item.batchId} onChange={(e) => updateLineItem(idx, 'batchId', e.target.value)} className="w-full px-2 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-orange-500" placeholder="Batch" />
                  </div>
                  <div className="col-span-1">
                    {idx === 0 && <label className="block text-xs text-slate-400 mb-1">Qty</label>}
                    <input type="number" value={item.quantity} onChange={(e) => updateLineItem(idx, 'quantity', e.target.value)} className="w-full px-2 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-orange-500" placeholder="0" />
                  </div>
                  <div className="col-span-2">
                    {idx === 0 && <label className="block text-xs text-slate-400 mb-1">Price</label>}
                    <input type="number" step="0.01" value={item.price} onChange={(e) => updateLineItem(idx, 'price', e.target.value)} className="w-full px-2 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-orange-500" placeholder="0.00" />
                  </div>
                  <div className="col-span-3">
                    {idx === 0 && <label className="block text-xs text-slate-400 mb-1">Metrc Tag</label>}
                    <input type="text" value={item.metrcTag} onChange={(e) => updateLineItem(idx, 'metrcTag', e.target.value)} className="w-full px-2 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm font-mono focus:ring-2 focus:ring-orange-500" placeholder="Tag" />
                  </div>
                  <div className="col-span-1">
                    {idx === 0 && <label className="block text-xs text-slate-400 mb-1">&nbsp;</label>}
                    <button onClick={() => removeLineItem(idx)} className="px-2 py-2 text-red-400 hover:text-red-300 hover:bg-slate-800 rounded-lg" disabled={lineItems.length <= 1}>x</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Notes</label>
            <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={2} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setCreateModalOpen(false)} className="px-4 py-2 text-slate-300 hover:bg-slate-800 rounded-lg font-medium">Cancel</button>
          <Button onClick={handleCreateOrder} disabled={saving}>{saving ? 'Creating...' : 'Create Order'}</Button>
        </div>
      </Modal>

      {/* Ship Modal */}
      <Modal isOpen={shipModalOpen} onClose={() => setShipModalOpen(false)} title="Ship Order" size="sm">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Manifest Number</label>
          <input type="text" value={manifestNumber} onChange={(e) => setManifestNumber(e.target.value)} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="MANIFEST-001" />
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setShipModalOpen(false)} className="px-4 py-2 text-slate-300 hover:bg-slate-800 rounded-lg font-medium">Cancel</button>
          <Button onClick={handleShip} disabled={saving}>{saving ? 'Shipping...' : 'Ship Order'}</Button>
        </div>
      </Modal>

      {/* Payment Modal */}
      <Modal isOpen={paymentModalOpen} onClose={() => setPaymentModalOpen(false)} title="Record Payment" size="sm">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Amount ($)</label>
            <input type="number" step="0.01" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="0.00" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Method</label>
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500">
              <option value="check">Check</option>
              <option value="wire">Wire Transfer</option>
              <option value="ach">ACH</option>
              <option value="cash">Cash</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setPaymentModalOpen(false)} className="px-4 py-2 text-slate-300 hover:bg-slate-800 rounded-lg font-medium">Cancel</button>
          <Button onClick={handlePayment} disabled={saving}>{saving ? 'Saving...' : 'Record Payment'}</Button>
        </div>
      </Modal>
    </>
  );
}

/* ─── Lab Tests Tab ─── */
function LabTestsTab() {
  const toast = useToast();
  const [tests, setTests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [resultsModalOpen, setResultsModalOpen] = useState(false);
  const [selectedTest, setSelectedTest] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState({
    sampleId: '', batchId: '', labName: '', notes: '',
  });
  const [resultsData, setResultsData] = useState({
    thc: '', cbd: '', totalCannabinoids: '', terpenes: '',
    pesticides: 'pass', heavyMetals: 'pass', microbials: 'pass', mycotoxins: 'pass', residualSolvents: 'pass', foreignMatter: 'pass',
    overallResult: 'pass',
  });

  const loadTests = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 25 };
      if (search) params.search = search;
      const data = await api.get('/api/wholesale/lab-tests', params);
      setTests(Array.isArray(data) ? data : data?.data || []);
      setPagination(data?.pagination || null);
    } catch {
      toast.error('Failed to load lab tests');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { loadTests(); }, [loadTests]);
  useEffect(() => { setPage(1); }, [search]);

  const handleCreate = async () => {
    if (!formData.sampleId.trim()) { toast.error('Sample ID is required'); return; }
    setSaving(true);
    try {
      await api.post('/api/wholesale/lab-tests', formData);
      toast.success('Lab test created');
      setCreateModalOpen(false);
      setFormData({ sampleId: '', batchId: '', labName: '', notes: '' });
      loadTests();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create lab test');
    } finally {
      setSaving(false);
    }
  };

  const openResults = (test: any) => {
    setSelectedTest(test);
    setResultsData({
      thc: test.thc?.toString() || '',
      cbd: test.cbd?.toString() || '',
      totalCannabinoids: test.totalCannabinoids?.toString() || '',
      terpenes: test.terpenes?.toString() || '',
      pesticides: test.pesticides || 'pass',
      heavyMetals: test.heavyMetals || 'pass',
      microbials: test.microbials || 'pass',
      mycotoxins: test.mycotoxins || 'pass',
      residualSolvents: test.residualSolvents || 'pass',
      foreignMatter: test.foreignMatter || 'pass',
      overallResult: test.overallResult || 'pass',
    });
    setResultsModalOpen(true);
  };

  const handleSaveResults = async () => {
    if (!selectedTest) return;
    setSaving(true);
    try {
      await api.put(`/api/wholesale/lab-tests/${selectedTest.id}/results`, {
        ...resultsData,
        thc: resultsData.thc ? parseFloat(resultsData.thc) : null,
        cbd: resultsData.cbd ? parseFloat(resultsData.cbd) : null,
        totalCannabinoids: resultsData.totalCannabinoids ? parseFloat(resultsData.totalCannabinoids) : null,
        terpenes: resultsData.terpenes ? parseFloat(resultsData.terpenes) : null,
      });
      toast.success('Results saved');
      setResultsModalOpen(false);
      loadTests();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save results');
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { key: 'sampleId', label: 'Sample ID', render: (val: string) => <span className="font-mono font-medium text-gray-900">{val}</span> },
    { key: 'batchId', label: 'Batch', render: (val: string) => val ? <span className="font-mono text-sm text-gray-700">{val}</span> : <span className="text-gray-400">--</span> },
    { key: 'labName', label: 'Lab', render: (val: string) => val || <span className="text-gray-400">--</span> },
    { key: 'status', label: 'Status', render: (val: string) => <StatusBadge status={val} statusColors={labStatusColors} /> },
    { key: 'thc', label: 'THC%', render: (val: number) => val != null ? <span className="text-gray-700">{val}%</span> : <span className="text-gray-400">--</span> },
    { key: 'cbd', label: 'CBD%', render: (val: number) => val != null ? <span className="text-gray-700">{val}%</span> : <span className="text-gray-400">--</span> },
    { key: 'overallResult', label: 'Result', render: (val: string) => val ? <StatusBadge status={val} statusColors={resultColors} /> : <span className="text-gray-400">--</span> },
  ];

  const tableActions = [
    { label: 'Enter Results', icon: FlaskConical, onClick: openResults },
    { label: 'View CoA', icon: ExternalLink, onClick: (row: any) => { if (row.coaUrl) window.open(row.coaUrl, '_blank'); else toast.error('No CoA available'); } },
  ];

  return (
    <>
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search tests..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900" />
        </div>
        <Button onClick={() => { setFormData({ sampleId: '', batchId: '', labName: '', notes: '' }); setCreateModalOpen(true); }} className="ml-auto">
          <Plus className="w-4 h-4 mr-2 inline" />New Test
        </Button>
      </div>

      <DataTable data={tests} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} actions={tableActions} emptyMessage="No lab tests" />

      {/* Create Test Modal */}
      <Modal isOpen={createModalOpen} onClose={() => setCreateModalOpen(false)} title="New Lab Test" size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Sample ID *</label>
            <input type="text" value={formData.sampleId} onChange={(e) => setFormData({ ...formData, sampleId: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="SAMPLE-001" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Batch ID</label>
            <input type="text" value={formData.batchId} onChange={(e) => setFormData({ ...formData, batchId: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Lab Name</label>
            <input type="text" value={formData.labName} onChange={(e) => setFormData({ ...formData, labName: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="Confident Cannabis" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Notes</label>
            <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={2} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setCreateModalOpen(false)} className="px-4 py-2 text-slate-300 hover:bg-slate-800 rounded-lg font-medium">Cancel</button>
          <Button onClick={handleCreate} disabled={saving}>{saving ? 'Creating...' : 'Create Test'}</Button>
        </div>
      </Modal>

      {/* Results Entry Modal */}
      <Modal isOpen={resultsModalOpen} onClose={() => setResultsModalOpen(false)} title={`Lab Results - ${selectedTest?.sampleId || ''}`} size="lg">
        <div className="space-y-6">
          {/* Cannabinoids */}
          <div>
            <h4 className="text-sm font-semibold text-slate-200 mb-3">Cannabinoids</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">THC %</label>
                <input type="number" step="0.01" value={resultsData.thc} onChange={(e) => setResultsData({ ...resultsData, thc: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-orange-500" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">CBD %</label>
                <input type="number" step="0.01" value={resultsData.cbd} onChange={(e) => setResultsData({ ...resultsData, cbd: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-orange-500" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Total Cannabinoids %</label>
                <input type="number" step="0.01" value={resultsData.totalCannabinoids} onChange={(e) => setResultsData({ ...resultsData, totalCannabinoids: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-orange-500" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Terpenes %</label>
                <input type="number" step="0.01" value={resultsData.terpenes} onChange={(e) => setResultsData({ ...resultsData, terpenes: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-orange-500" />
              </div>
            </div>
          </div>

          {/* Contaminant Tests */}
          <div>
            <h4 className="text-sm font-semibold text-slate-200 mb-3">Contaminant Screening</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {contaminantTests.map((test) => (
                <div key={test}>
                  <label className="block text-xs text-slate-400 mb-1 capitalize">{test.replace(/([A-Z])/g, ' $1')}</label>
                  <select
                    value={(resultsData as any)[test]}
                    onChange={(e) => setResultsData({ ...resultsData, [test]: e.target.value })}
                    className={`w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-orange-500 ${
                      (resultsData as any)[test] === 'pass' ? 'bg-green-900/20 border-green-700 text-green-400' : 'bg-red-900/20 border-red-700 text-red-400'
                    }`}
                  >
                    <option value="pass">Pass</option>
                    <option value="fail">Fail</option>
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* Overall */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Overall Result</label>
            <select
              value={resultsData.overallResult}
              onChange={(e) => setResultsData({ ...resultsData, overallResult: e.target.value })}
              className={`w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-orange-500 ${
                resultsData.overallResult === 'pass' ? 'bg-green-900/20 border-green-700 text-green-400' : 'bg-red-900/20 border-red-700 text-red-400'
              }`}
            >
              <option value="pass">Pass</option>
              <option value="fail">Fail</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setResultsModalOpen(false)} className="px-4 py-2 text-slate-300 hover:bg-slate-800 rounded-lg font-medium">Cancel</button>
          <Button onClick={handleSaveResults} disabled={saving}>{saving ? 'Saving...' : 'Save Results'}</Button>
        </div>
      </Modal>
    </>
  );
}
