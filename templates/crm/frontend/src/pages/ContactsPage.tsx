import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Edit, Trash2, UserCheck, Search } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { DataTable, StatusBadge, PageHeader, Button } from '../components/ui/DataTable';
import { Modal, ConfirmModal } from '../components/ui/Modal';

const contactTypes = [
  { value: 'lead', label: 'Lead' },
  { value: 'client', label: 'Client' },
  { value: 'subcontractor', label: 'Subcontractor' },
  { value: 'vendor', label: 'Vendor' },
];

const initialFormData = {
  type: 'lead',
  name: '',
  company: '',
  email: '',
  phone: '',
  mobile: '',
  address: '',
  city: '',
  state: '',
  zip: '',
  source: '',
  notes: '',
};

export default function ContactsPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [contacts, setContacts] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState(null);
  const [formData, setFormData] = useState(initialFormData);
  const [saving, setSaving] = useState(false);

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [contactToDelete, setContactToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadContacts = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 25 };
      if (search) params.search = search;
      if (typeFilter) params.type = typeFilter;
      
      const [contactsData, statsData] = await Promise.all([
        api.contacts.list(params),
        api.contacts.stats(),
      ]);
      
      setContacts(contactsData.data);
      setPagination(contactsData.pagination);
      setStats(statsData);
    } catch (err) {
      toast.error('Failed to load contacts');
    } finally {
      setLoading(false);
    }
  }, [page, search, typeFilter]);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  useEffect(() => {
    setPage(1);
  }, [search, typeFilter]);

  const openCreateModal = () => {
    setEditingContact(null);
    setFormData(initialFormData);
    setModalOpen(true);
  };

  const openEditModal = (contact) => {
    setEditingContact(contact);
    setFormData({
      type: contact.type || 'lead',
      name: contact.name || '',
      company: contact.company || '',
      email: contact.email || '',
      phone: contact.phone || '',
      mobile: contact.mobile || '',
      address: contact.address || '',
      city: contact.city || '',
      state: contact.state || '',
      zip: contact.zip || '',
      source: contact.source || '',
      notes: contact.notes || '',
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
      if (editingContact) {
        await api.contacts.update(editingContact.id, formData);
        toast.success('Contact updated');
      } else {
        await api.contacts.create(formData);
        toast.success('Contact created');
      }
      setModalOpen(false);
      loadContacts();
    } catch (err) {
      toast.error(err.message || 'Failed to save contact');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!contactToDelete) return;
    setDeleting(true);
    try {
      await api.contacts.delete(contactToDelete.id);
      toast.success('Contact deleted');
      setDeleteModalOpen(false);
      setContactToDelete(null);
      loadContacts();
    } catch (err) {
      toast.error(err.message || 'Failed to delete contact');
    } finally {
      setDeleting(false);
    }
  };

  const handleConvert = async (contact) => {
    try {
      await api.contacts.convert(contact.id);
      toast.success('Lead converted to client');
      loadContacts();
    } catch (err) {
      toast.error(err.message || 'Failed to convert lead');
    }
  };

  const columns = [
    {
      key: 'name',
      label: 'Name',
      render: (val, row) => (
        <div>
          <p className="font-medium text-gray-900">{val}</p>
          {row.company && <p className="text-sm text-gray-500">{row.company}</p>}
        </div>
      ),
    },
    {
      key: 'type',
      label: 'Type',
      render: (val) => <StatusBadge status={val} />,
    },
    {
      key: 'email',
      label: 'Email',
      render: (val) => val ? <a href={`mailto:${val}`} className="text-orange-500 hover:underline">{val}</a> : '-',
    },
    {
      key: 'phone',
      label: 'Phone',
      render: (val) => <span className="text-gray-700">{val || '-'}</span>,
    },
    {
      key: 'city',
      label: 'Location',
      render: (val, row) => <span className="text-gray-700">{row.city && row.state ? `${row.city}, ${row.state}` : row.city || row.state || '-'}</span>,
    },
  ];

  const actions = [
    { label: 'Edit', icon: Edit, onClick: openEditModal },
    { label: 'Delete', icon: Trash2, onClick: (row) => { setContactToDelete(row); setDeleteModalOpen(true); }, className: 'text-red-600' },
  ];

  return (
    <div>
      <PageHeader
        title="Contacts"
        subtitle={stats ? `${stats.total} total contacts` : ''}
        action={
          <Button onClick={openCreateModal}>
            <Plus className="w-4 h-4 mr-2 inline" />
            Add Contact
          </Button>
        }
      />

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {contactTypes.map(type => (
            <button
              key={type.value}
              onClick={() => setTypeFilter(typeFilter === type.value ? '' : type.value)}
              className={`p-4 rounded-lg border transition-colors ${
                typeFilter === type.value ? 'border-orange-500 bg-orange-50' : 'bg-white hover:border-gray-300'
              }`}
            >
              <p className="text-2xl font-bold text-gray-900">{stats[type.value] || 0}</p>
              <p className="text-sm text-gray-500">{type.label}s</p>
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
            placeholder="Search contacts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
        >
          <option value="">All Types</option>
          {contactTypes.map(type => (
            <option key={type.value} value={type.value}>{type.label}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <DataTable
        onRowClick={(row) => navigate(`/crm/contacts/${row.id}`)}
        data={contacts}
        columns={columns}
        loading={loading}
        pagination={pagination}
        onPageChange={setPage}
        actions={actions}
        emptyMessage="No contacts found"
      />

      {/* Create/Edit Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingContact ? 'Edit Contact' : 'New Contact'}
        size="lg"
      >
        <div className="grid md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <select
              value={formData.type}
              onChange={(e) => setFormData({ ...formData, type: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
            >
              {contactTypes.map(type => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
              placeholder="John Smith"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Company</label>
            <input
              type="text"
              value={formData.company}
              onChange={(e) => setFormData({ ...formData, company: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mobile</label>
            <input
              type="tel"
              value={formData.mobile}
              onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Source</label>
            <input
              type="text"
              value={formData.source}
              onChange={(e) => setFormData({ ...formData, source: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
              placeholder="Referral, Website, etc."
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
            <input
              type="text"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
            <input
              type="text"
              value={formData.city}
              onChange={(e) => setFormData({ ...formData, city: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
              <input
                type="text"
                value={formData.state}
                onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ZIP</label>
              <input
                type="text"
                value={formData.zip}
                onChange={(e) => setFormData({ ...formData, zip: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
              />
            </div>
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
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
            {saving ? 'Saving...' : editingContact ? 'Update' : 'Create'}
          </Button>
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmModal
        isOpen={deleteModalOpen}
        onClose={() => { setDeleteModalOpen(false); setContactToDelete(null); }}
        onConfirm={handleDelete}
        title="Delete Contact"
        message={`Are you sure you want to delete "${contactToDelete?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        loading={deleting}
      />
    </div>
  );
}
