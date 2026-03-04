import React, { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { 
  Plus, Search, Filter, MoreVertical, Phone, Mail, MapPin,
  Building, User, Truck, Edit2, Trash2, Eye
} from 'lucide-react';
import { 
  Card, CardHeader, CardBody, Button, Input, Select, Modal,
  Table, TableHead, TableBody, TableRow, TableHeader, TableCell,
  StatusBadge, EmptyState, ConfirmDialog
} from '../ui';
import { useCRMDataStore } from '../../stores/builderStore';

const contactTypes = [
  { value: 'client', label: 'Client', icon: User },
  { value: 'subcontractor', label: 'Subcontractor', icon: Truck },
  { value: 'vendor', label: 'Vendor', icon: Building },
  { value: 'lead', label: 'Lead', icon: User },
];

function ContactForm({ contact, onSave, onClose }) {
  const [form, setForm] = useState(contact || {
    type: 'client',
    name: '',
    email: '',
    phone: '',
    company: '',
    address: '',
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(form);
    onClose();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Select
        label="Contact Type"
        value={form.type}
        onChange={(e) => setForm({ ...form, type: e.target.value })}
        options={contactTypes}
      />
      <Input
        label="Name"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        placeholder="Full name"
        required
      />
      <Input
        label="Email"
        type="email"
        value={form.email}
        onChange={(e) => setForm({ ...form, email: e.target.value })}
        placeholder="email@example.com"
      />
      <Input
        label="Phone"
        value={form.phone}
        onChange={(e) => setForm({ ...form, phone: e.target.value })}
        placeholder="555-0100"
      />
      <Input
        label="Company"
        value={form.company}
        onChange={(e) => setForm({ ...form, company: e.target.value })}
        placeholder="Company name"
      />
      <Input
        label="Address"
        value={form.address}
        onChange={(e) => setForm({ ...form, address: e.target.value })}
        placeholder="123 Main St, City, State"
      />
      <div className="flex justify-end gap-3 pt-4">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit">{contact ? 'Update' : 'Create'} Contact</Button>
      </div>
    </form>
  );
}

function ContactDetail({ contact, onClose, onEdit }) {
  const { instance } = useOutletContext();
  const primaryColor = instance.primaryColor || '#ec7619';
  const TypeIcon = contactTypes.find(t => t.value === contact.type)?.icon || User;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div 
          className="w-16 h-16 rounded-xl flex items-center justify-center text-white text-2xl font-bold"
          style={{ backgroundColor: primaryColor }}
        >
          {contact.name?.[0]?.toUpperCase()}
        </div>
        <div>
          <h3 className="text-xl font-semibold text-white">{contact.name}</h3>
          <StatusBadge status={contact.type} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {contact.email && (
          <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-lg">
            <Mail className="w-5 h-5 text-slate-400" />
            <div>
              <p className="text-xs text-slate-500">Email</p>
              <p className="text-sm text-white">{contact.email}</p>
            </div>
          </div>
        )}
        {contact.phone && (
          <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-lg">
            <Phone className="w-5 h-5 text-slate-400" />
            <div>
              <p className="text-xs text-slate-500">Phone</p>
              <p className="text-sm text-white">{contact.phone}</p>
            </div>
          </div>
        )}
        {contact.company && (
          <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-lg">
            <Building className="w-5 h-5 text-slate-400" />
            <div>
              <p className="text-xs text-slate-500">Company</p>
              <p className="text-sm text-white">{contact.company}</p>
            </div>
          </div>
        )}
        {contact.address && (
          <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-lg">
            <MapPin className="w-5 h-5 text-slate-400" />
            <div>
              <p className="text-xs text-slate-500">Address</p>
              <p className="text-sm text-white">{contact.address}</p>
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
        <Button variant="ghost" onClick={onClose}>Close</Button>
        <Button onClick={() => onEdit(contact)} icon={Edit2}>Edit Contact</Button>
      </div>
    </div>
  );
}

export function ContactsPage() {
  const { instance } = useOutletContext();
  const { contacts, addContact, updateContact, deleteContact } = useCRMDataStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editContact, setEditContact] = useState(null);
  const [viewContact, setViewContact] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const primaryColor = instance.primaryColor || '#ec7619';

  const filteredContacts = useMemo(() => {
    return contacts.filter(c => {
      const matchesSearch = !searchQuery || 
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.company?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesType = !typeFilter || c.type === typeFilter;
      return matchesSearch && matchesType;
    });
  }, [contacts, searchQuery, typeFilter]);

  const handleSave = (contactData) => {
    if (editContact) {
      updateContact(editContact.id, contactData);
    } else {
      addContact(contactData);
    }
    setEditContact(null);
    setShowForm(false);
  };

  const handleEdit = (contact) => {
    setViewContact(null);
    setEditContact(contact);
    setShowForm(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Contacts</h1>
          <p className="text-slate-400 mt-1">{contacts.length} total contacts</p>
        </div>
        <Button onClick={() => setShowForm(true)} icon={Plus}>
          Add Contact
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardBody className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
              <input
                type="text"
                placeholder="Search contacts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input pl-11"
              />
            </div>
            <Select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              options={[{ value: '', label: 'All Types' }, ...contactTypes]}
              className="sm:w-48"
            />
          </div>
        </CardBody>
      </Card>

      {/* Table */}
      <Card>
        {filteredContacts.length > 0 ? (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader>Name</TableHeader>
                <TableHeader>Type</TableHeader>
                <TableHeader>Email</TableHeader>
                <TableHeader>Phone</TableHeader>
                <TableHeader>Company</TableHeader>
                <TableHeader className="w-16"></TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredContacts.map((contact) => (
                <TableRow key={contact.id} onClick={() => setViewContact(contact)}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div 
                        className="w-9 h-9 rounded-lg flex items-center justify-center text-white text-sm font-medium"
                        style={{ backgroundColor: primaryColor }}
                      >
                        {contact.name?.[0]?.toUpperCase()}
                      </div>
                      <span className="font-medium text-white">{contact.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={contact.type} />
                  </TableCell>
                  <TableCell className="text-slate-300">{contact.email || '-'}</TableCell>
                  <TableCell className="text-slate-300">{contact.phone || '-'}</TableCell>
                  <TableCell className="text-slate-300">{contact.company || '-'}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleEdit(contact); }}
                        className="p-1.5 hover:bg-slate-700 rounded"
                      >
                        <Edit2 className="w-4 h-4 text-slate-400" />
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(contact); }}
                        className="p-1.5 hover:bg-red-500/20 rounded"
                      >
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <CardBody>
            <EmptyState
              icon={User}
              title="No contacts found"
              description={searchQuery || typeFilter ? "Try adjusting your filters" : "Add your first contact to get started"}
              action={!searchQuery && !typeFilter && (
                <Button onClick={() => setShowForm(true)} icon={Plus}>Add Contact</Button>
              )}
            />
          </CardBody>
        )}
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditContact(null); }}
        title={editContact ? 'Edit Contact' : 'New Contact'}
      >
        <ContactForm
          contact={editContact}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditContact(null); }}
        />
      </Modal>

      {/* View Modal */}
      <Modal
        isOpen={!!viewContact}
        onClose={() => setViewContact(null)}
        title="Contact Details"
        size="md"
      >
        {viewContact && (
          <ContactDetail
            contact={viewContact}
            onClose={() => setViewContact(null)}
            onEdit={handleEdit}
          />
        )}
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteContact(deleteTarget?.id)}
        title="Delete Contact"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
}
