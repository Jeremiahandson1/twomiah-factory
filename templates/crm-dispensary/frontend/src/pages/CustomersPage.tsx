import { useState, useEffect, useCallback } from 'react';
import { formatDate } from '../utils/date';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Edit, Trash2, Search, Star } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { DataTable, StatusBadge, PageHeader, Button } from '../components/ui/DataTable';
import { Modal, ConfirmModal } from '../components/ui/Modal';

const loyaltyTiers = [
  { value: '', label: 'All Tiers' },
  // Three of these four had no dark partner, so a loyalty tier rendered as a bright lozenge on a
  // black page — the owner saw it as "the Bronze chip". Platinum below has had one all along, which
  // is the tell: a set where one member is right and the rest were never looked at in the other
  // theme. No contrast sweep can find these; dark text on a pale chip passes AA comfortably. It is
  // a theme fault, not a contrast fault. (T58i, same shape as the Expired licence chip)
  { value: 'bronze', label: 'Bronze', color: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' },
  { value: 'silver', label: 'Silver', color: 'bg-gray-200 text-gray-700 dark:bg-slate-800 dark:text-slate-300' },
  { value: 'gold', label: 'Gold', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-300' },
  { value: 'platinum', label: 'Platinum', color: 'bg-indigo-100 text-indigo-700 dark:text-indigo-300 dark:bg-indigo-950/40' },
];

const initialFormData = {
  // What this screen creates. (T49 / T53 M3)
  //
  // The form sent no type at all, so POST /api/contacts fell through to its schema default of
  // 'lead' and every person added from the Customers page was stored as a lead. Marketing's
  // Customer segment read 9 contacts and 0 with an email while Lead held 14 reachable ones, so an
  // owner choosing Segment → Customer to email their customers reached nobody — and could not tell
  // why, because the screen they added those people on is called Customers.
  //
  // No picker: on a screen titled Customers, "is this a customer?" is not a question worth asking.
  // The other four creators already say what they make — order-ahead and the external-POS import
  // both write 'customer', the leads route writes a lead, the CSV importer maps the column — so
  // this was the one door that stayed silent. The API normalises 'customer' onto the stored 'client',
  // which is the single value every writer now uses. (T55 M3)
  type: 'customer',
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
  // Actions this person cannot use are hidden rather than shown-and-refused, and the test is the
  // PERMISSION the server enforces, not the rank. (T53 L11, T55 leftovers, T56 R1)
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [page, setPage] = useState(1);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<any>(null);
  // What the server changed about what was typed. Held in state rather than thrown at a toast: this is
  // the one message that has to survive the modal closing, and it has gone unseen in four test runs.
  // (Dispensary T34 L3)
  const [savedWarnings, setSavedWarnings] = useState<string[]>([]);
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
      setError(null);
    } catch (err) {
      // Real error + Retry in the table, not a transient toast + misleading
      // "No customers found" empty state (S11).
      const e = err as any;
      setCustomers([]);
      setError(e?.message || 'Failed to load customers. Please try again.');
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

  /**
   * /crm/customers?edit=<id> opens that customer's form. (T56 R1 — the High.)
   *
   * The customer's own page has always had an Edit button and it links HERE, with the id in the
   * query string — and nothing on this page ever read it. So Edit sent you back to the list and
   * stopped, which is why the round was reported as "nobody can edit a customer in any role": the
   * server was fine, both ways in were broken, and the other way in (the row ⋮) put you on this
   * page by accident when you dismissed it.
   *
   * The row is fetched by id rather than looked up in the current page of the list, because the
   * person arriving here came from that customer's page and the list may be on page 3 or filtered.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const editId = searchParams.get('edit');
  useEffect(() => {
    if (!editId) return;
    let cancelled = false;
    (async () => {
      try {
        const res: any = await api.get(`/api/contacts/${editId}`);
        const row = res?.data || res;
        if (cancelled) return;
        if (row?.id) openEditModal(row);
        else toast.error('That customer could not be found');
      } catch (err: any) {
        if (!cancelled) toast.error(err?.message || 'That customer could not be found');
      } finally {
        // Take the id out of the URL either way: a refresh should not reopen a form the person closed,
        // and a failed open should not sit there retrying.
        if (!cancelled) setSearchParams((p) => { const next = new URLSearchParams(p); next.delete('edit'); return next; }, { replace: true });
      }
    })();
    return () => { cancelled = true; };
  }, [editId]);

  const openCreateModal = () => {
    setSavedWarnings([]);
    setEditingCustomer(null);
    setFormData(initialFormData);
    setModalOpen(true);
  };

  const openEditModal = (customer: any) => {
    setSavedWarnings([]);
    setEditingCustomer(customer);
    setFormData({
      // Editing preserves what the record IS; only CREATE decides it is a customer. This list shows
      // leads as well as customers, so without this an edit to a lead's phone number would quietly
      // promote them. It happened to be safe before only because `type` was absent from this object
      // and JSON dropped the undefined — an accident one added line would have turned into a bug.
      type: customer.type || 'customer',
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
    let warned: string[] = [];
    try {
      if (editingCustomer) {
        const saved: any = await api.put(`/api/contacts/${editingCustomer.id}`, formData);
        toast.success('Customer updated');
        warned = saved?.warnings || [];
      } else {
        let created: any;
        try {
          created = await api.post('/api/contacts', formData);
        } catch (err: any) {
          // 409 + existingId: this email/phone already belongs to a customer — offer that record or an explicit duplicate.
          if (err?.status !== 409 || !err?.data?.existingId) throw err;
          if (!confirm(`${err.data.error}\n\nOK = create this customer anyway.\nCancel = open the existing record.`)) {
            const existing: any = await api.get(`/api/contacts/${err.data.existingId}`).catch(() => null);
            setModalOpen(false);
            if (existing) openEditModal(existing);
            return;
          }
          created = await api.post('/api/contacts', { ...formData, allowDuplicate: true });
        }
        toast.success('Customer created');
        warned = created?.warnings || [];
        // If the notice is going to hold the modal open, it has to hold it open on the record that was
        // just CREATED — otherwise a second Save from the same form makes a duplicate customer.
        if (warned.length && created?.id) {
          setEditingCustomer(created);
          // …and show what was actually STORED. The notice says the value changed; the field beside
          // it was still showing the text as typed, so the form contradicted the record it had just
          // written. (Dispensary T38 L3)
          setFormData((f: any) => ({ ...f, name: created.name ?? f.name, notes: created.notes ?? '', address: created.address ?? '' }));
        }
      }
      // The list refreshes either way; the modal only closes when there is nothing to tell them.
      loadCustomers();
      setSavedWarnings(warned);
      if (!warned.length) setModalOpen(false);
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
          {/* title, so a name the cell has to wrap is still readable in full on hover (T21 M1) */}
          <p className="font-medium text-gray-900 dark:text-slate-100 break-words" title={val}>{val}</p>
          {row.phone && <p className="text-sm text-gray-500 dark:text-slate-400">{row.phone}</p>}
        </div>
      ),
    },
    {
      key: 'loyaltyTier',
      label: 'Tier',
      render: (val: string) => getTierBadge(val) || <span className="text-gray-500 dark:text-slate-400">—</span>,
    },
    {
      key: 'email',
      label: 'Email',
      render: (val: string) => val ? <a href={`mailto:${val}`} className="text-green-700 hover:underline dark:text-green-400">{val}</a> : <span className="text-gray-500 dark:text-slate-400">—</span>,
    },
    {
      key: 'totalSpent',
      label: 'Total Spent',
      render: (val: number) => (
        <span className="font-medium text-gray-900 dark:text-slate-100">
          ${Number(val || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      ),
    },
    {
      key: 'loyaltyPoints',
      label: 'Points',
      render: (val: number) => <span className="text-gray-700 dark:text-slate-200">{val || 0}</span>,
    },
    {
      key: 'orderCount',
      label: 'Orders',
      render: (val: number) => <span className="text-gray-700 dark:text-slate-200">{val || 0}</span>,
    },
    {
      key: 'lastVisit',
      label: 'Last Visit',
      render: (val: string) => (
        <span className="text-gray-500 text-sm dark:text-slate-400">
          {val ? formatDate(val) : 'Never'}
        </span>
      ),
    },
  ];

  const actions = [
    { label: 'Edit', icon: Edit, onClick: openEditModal, show: () => can('contacts:update') },
    // A budtender was offered this and always got a 403. (T55 L11)
    //
    // Two things were wrong with the first attempt. It asked the RANK — and rank is not permission,
    // so a shop that grants a senior budtender contacts:delete still had it hidden — and the table
    // this page uses ignored `show` entirely, so the control never actually disappeared. Both fixed;
    // the gate is now the permission the server enforces. (T56 R1)
    { label: 'Delete', icon: Trash2, onClick: (row: any) => { setCustomerToDelete(row); setDeleteModalOpen(true); }, className: 'text-red-600', show: () => can('contacts:delete') },
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
              /* The card had no dark variant, so in dark mode it stayed WHITE while its number kept
                 dark:text-slate-100 — near-white on white, 2.56:1, and the counts were effectively
                 unreadable. The card follows the theme now, so the text on it can be trusted. (T21 M2) */
              className={`p-4 rounded-lg border transition-colors ${
                tierFilter === tier.value
                  ? 'border-green-500 bg-green-50 dark:bg-green-900/30 dark:border-green-500'
                  : 'bg-white hover:border-gray-300 dark:bg-slate-900 dark:border-slate-700 dark:hover:border-slate-500'
              }`}
            >
              <p className="text-2xl font-bold text-gray-900 dark:text-slate-100">{stats[tier.value] || 0}</p>
              <p className="text-sm text-gray-500 dark:text-slate-400">{tier.label}</p>
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
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
          />
        </div>
        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value)}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
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
        error={error}
        onRetry={loadCustomers}
      />

      {/* Create/Edit Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingCustomer ? 'Edit Customer' : 'New Customer'}
        size="lg"
      >
        {savedWarnings.length > 0 && (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
            <p className="font-semibold mb-1">Saved — but not exactly as typed</p>
            <ul className="list-disc pl-5 space-y-1 text-sm">
              {savedWarnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
            <button
              type="button"
              onClick={() => { setSavedWarnings([]); setModalOpen(false); }}
              className="mt-3 px-3 py-1.5 rounded-lg bg-amber-700 text-white text-sm font-medium hover:bg-amber-800"
            >Got it</button>
          </div>
        )}
        <div className="grid md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
              placeholder="John Smith"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Phone</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Date of Birth</label>
            <input
              type="date"
              value={formData.dateOfBirth}
              onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Loyalty Tier</label>
            <select
              value={formData.loyaltyTier}
              onChange={(e) => setFormData({ ...formData, loyaltyTier: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
            >
              {loyaltyTiers.filter(t => t.value).map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Medical Card #</label>
            <input
              type="text"
              value={formData.medicalCardNumber}
              onChange={(e) => setFormData({ ...formData, medicalCardNumber: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Card Expiry</label>
            <input
              type="date"
              value={formData.medicalCardExpiry}
              onChange={(e) => setFormData({ ...formData, medicalCardExpiry: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Address</label>
            <input
              type="text"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">City</label>
            <input
              type="text"
              value={formData.city}
              onChange={(e) => setFormData({ ...formData, city: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">State</label>
              <input
                type="text"
                value={formData.state}
                onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">ZIP</label>
              <input
                type="text"
                value={formData.zip}
                onChange={(e) => setFormData({ ...formData, zip: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
              />
            </div>
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={() => setModalOpen(false)}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg font-medium dark:text-slate-200"
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
