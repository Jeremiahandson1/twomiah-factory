import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Edit, Trash2, Search, Star, DollarSign } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { DataTable, StatusBadge, PageHeader, Button } from '../components/ui/DataTable';
import { Modal, ConfirmModal } from '../components/ui/Modal';

const loyaltyTiers = [
  { value: '', label: 'All Tiers' },
  { value: 'bronze', label: 'Bronze', color: 'bg-amber-100 text-amber-700' },
  { value: 'silver', label: 'Silver', color: 'bg-gray-200 text-gray-700' },
  { value: 'gold', label: 'Gold', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'platinum', label: 'Platinum', color: 'bg-indigo-100 text-indigo-700' },
];

const initialFormData = {
  name: '',
  email: '',
  phone: '',
  dateOfBirth: '',
  address: '',
  city: '',
  state: '',
  zip: '',
  medicalCardNumber: '',
  medicalCardExpiry: '',
  notes: '',
  loyaltyTier: 'bronze',
};

export default function CustomersPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [page, setPage] = useState(1);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<any>(null);
  const [formData, setFormData] = useState(initialFormData);
  const [saving, setSaving] = useState(false);

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [customerToDelete, setCustomerToDelete] = useState<any>(null);
  const [deleting, setDeleting] = useState(false);

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 25 };
      if (search) params.search = search;
      if (tierFilter) params.loyaltyTier = tierFilter;

      const [customersData, statsData] = await Promise.all([
        api.get('/api/contacts', params),
        api.get('/api/contacts/stats').catch(() => null),
      ]);

      setCustomers(Array.isArray(customersData) ? customersData : customersData?.data || []);
      setPagination(customersData?.pagination || null);
      setStats(statsData);
    } catch (err) {
      toast.error('Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, [page, search, tierFilter]);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  useEffect(() => {
    setPage(1);
  }, [search, tierFilter]);

  const openCreateModal = () => {
    setEditingCustomer(null);
    setFormData(initialFormData);
    setModalOpen(true);
  };

  const openEditModal = (customer: any) => {
    setEditingCustomer(customer);
    setFormData({
      name: customer.name || '',
      email: customer.email || '',
      phone: customer.phone || '',
      dateOfBirth: customer.dateOfBirth || '',
      address: customer.address || '',
      city: customer.city || '',
      state: customer.state || '',
      zip: customer.zip || '',
      medicalCardNumber: customer.medicalCardNumber || '',
      medicalCardExpiry: customer.medicalCardExpiry || '',
      notes: customer.notes || '',
      loyaltyTier: customer.loyaltyTier || 'bronze',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error('Name is required');
      return;
    }
    setSaving(true);
    try {
      if (editingCustomer) {
        await api.put(`/api/contacts/${editingCustomer.id}`, formData);
        toast.success('Customer updated');
      } else {
        await api.post('/api/contacts', formData);
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

  const handleDelete = async () => {
    if (!customerToDelete) return;
    setDeleting(true);
    try {
      await api.delete(`/api/contacts/${customerToDelete.id}`);
      toast.success('Customer deleted');
      setDeleteModalOpen(false);
      setCustomerToDelete(null);
      loadCustomers();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete customer');
    } finally {
      setDeleting(false);
    }
  };

  const getTierBadge = (tier: string) => {
    const t = loyaltyTiers.find(l => l.value === tier);
    if (!t || !t.color) return null;
    return (
      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${t.color}`}>
        <Star className="w-3 h-3 inline mr-1" />{t.label}
      </span>
    );
  };

  const columns = [
    {
      key: 'name',
      label: 'Customer',
      render: (val: string, row: any) => (
        <div>
          <p className="font-medium text-gray-900">{val}</p>
          {row.phone && <p className="text-sm text-gray-500">{row.phone}</p>}
        </div>
      ),
    },
    {
      key: 'loyaltyTier',
      label: 'Tier',
      render: (val: string) => getTierBadge(val) || <span className="text-gray-400">—</span>,
    },
    {
      key: 'email',
      label: 'Email',
      render: (val: string) => val ? <a href={`mailto:${val}`} className="text-green-600 hover:underline">{val}</a> : <span className="text-gray-400">—</span>,
    },
    {
      key: 'totalSpent',
      label: 'Total Spent',
      render: (val: number) => (
        <span className="font-medium text-gray-900">
          <DollarSign className="w-3 h-3 inline text-gray-400" />
          {Number(val || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </span>
      ),
    },
    {
      key: 'loyaltyPoints',
      label: 'Points',
      render: (val: number) => <span className="text-gray-700">{val || 0}</span>,
    },
    {
      key: 'orderCount',
      label: 'Orders',
      render: (val: number) => <span className="text-gray-700">{val || 0}</span>,
    },
    {
      key: 'lastVisit',
      label: 'Last Visit',
      render: (val: string) => (
        <span className="text-gray-500 text-sm">
          {val ? new Date(val).toLocaleDateString() : 'Never'}
        </span>
      ),
    },
  ];

  const actions = [
    { label: 'Edit', icon: Edit, onClick: openEditModal },
    { label: 'Delete', icon: Trash2, onClick: (row: any) => { setCustomerToDelete(row); setDeleteModalOpen(true); }, className: 'text-red-600' },
  ];

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle={stats ? `${stats.total || 0} total customers` : ''}
        action={
          <Button onClick={openCreateModal}>
            <Plus className="w-4 h-4 mr-2 inline" />
            Add Customer
          </Button>
        }
      />

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {loyaltyTiers.filter(t => t.value).map(tier => (
            <button
              key={tier.value}
              onClick={() => setTierFilter(tierFilter === tier.value ? '' : tier.value)}
              className={`p-4 rounded-lg border transition-colors ${
                tierFilter === tier.value ? 'border-green-500 bg-green-50' : 'bg-white hover:border-gray-300'
              }`}
            >
              <p className="text-2xl font-bold text-gray-900">{stats[tier.value] || 0}</p>
              <p className="text-sm text-gray-500">{tier.label}</p>
            </button>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="mb-4 flex gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search customers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
          />
        </div>
        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value)}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
        >
          {loyaltyTiers.map(tier => (
            <option key={tier.value} value={tier.value}>{tier.label || 'All Tiers'}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <DataTable
        data={customers}
        columns={columns}
        loading={loading}
        pagination={pagination}
        onPageChange={setPage}
        onRowClick={(row: any) => navigate(`/crm/customers/${row.id}`)}
        actions={actions}
        emptyMessage="No customers found"
      />

      {/* Create/Edit Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingCustomer ? 'Edit Customer' : 'New Customer'}
        size="lg"
      >
        <div className="grid md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              placeholder="John Smith"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date of Birth</label>
            <input
              type="date"
              value={formData.dateOfBirth}
              onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Loyalty Tier</label>
            <select
              value={formData.loyaltyTier}
              onChange={(e) => setFormData({ ...formData, loyaltyTier: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
            >
              {loyaltyTiers.filter(t => t.value).map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Medical Card #</label>
            <input
              type="text"
              value={formData.medicalCardNumber}
              onChange={(e) => setFormData({ ...formData, medicalCardNumber: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Card Expiry</label>
            <input
              type="date"
              value={formData.medicalCardExpiry}
              onChange={(e) => setFormData({ ...formData, medicalCardExpiry: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
            <input
              type="text"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
            <input
              type="text"
              value={formData.city}
              onChange={(e) => setFormData({ ...formData, city: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
              <input
                type="text"
                value={formData.state}
                onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ZIP</label>
              <input
                type="text"
                value={formData.zip}
                onChange={(e) => setFormData({ ...formData, zip: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              />
            </div>
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={() => setModalOpen(false)}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium"
          >
            Cancel
          </button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : editingCustomer ? 'Update' : 'Create'}
          </Button>
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmModal
        isOpen={deleteModalOpen}
        onClose={() => { setDeleteModalOpen(false); setCustomerToDelete(null); }}
        onConfirm={handleDelete}
        title="Delete Customer"
        message={`Are you sure you want to delete "${customerToDelete?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        loading={deleting}
      />
    </div>
  );
}
