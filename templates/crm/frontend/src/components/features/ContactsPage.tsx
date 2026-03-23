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

interface OutletContextType {
  instance: Record<string, unknown>;
}

const contactTypes = [
  { value: 'client', label: 'Client', icon: User },
  { value: 'subcontractor', label: 'Subcontractor', icon: Truck },
  { value: 'vendor', label: 'Vendor', icon: Building },
  { value: 'lead', label: 'Lead', icon: User },
];

interface ContactFormData {
  type: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  address: string;
}

interface ContactFormProps {
  contact: Record<string, unknown> | null;
  onSave: (data: ContactFormData) => void;
  onClose: () => void;
}

function ContactForm({ contact, onSave, onClose }: ContactFormProps) {
  const [form, setForm] = useState<ContactFormData>((contact as unknown as ContactFormData) || {
    type: 'client',
    name: '',
    email: '',
    phone: '',
    company: '',
    address: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
    onClose();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Select
        label="Contact Type"
        value={form.type}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, type: e.target.value })}
        options={contactTypes}
      />
      <Input
        label="Name"
        value={form.name}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, name: e.target.value })}
        placeholder="Full name"
        required
      />
      <Input
        label="Email"
        type="email"
        value={form.email}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, email: e.target.value })}
        placeholder="email@example.com"
      />
      <Input
        label="Phone"
        value={form.phone}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, phone: e.target.value })}
        placeholder="555-0100"
      />
      <Input
        label="Company"
        value={form.company}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, company: e.target.value })}
        placeholder="Company name"
      />
      <Input
        label="Address"
        value={form.address}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, address: e.target.value })}
        placeholder="123 Main St, City, State"
      />
      <div className="flex justify-end gap-3 pt-4">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit">{contact ? 'Update' : 'Create'} Contact</Button>
      </div>
    </form>
  );
}

interface ContactDetailProps {
  contact: Record<string, unknown>;
  onClose: () => void;
  onEdit: (contact: Record<string, unknown>) => void;
}

function ContactDetail({ contact, onClose, onEdit }: ContactDetailProps) {
  const { instance } = useOutletContext<OutletContextType>();
  const primaryColor = (instance.primaryColor as string) || '{{PRIMARY_COLOR}}';
  const TypeIcon = contactTypes.find(t => t.value === contact.type)?.icon || User;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div
          className="w-16 h-16 rounded-xl flex items-center justify-center text-white text-2xl font-bold"
          style={{ backgroundColor: primaryColor }}
        >
          {(contact.name as string)?.[0]?.toUpperCase()}
        </div>
        <div>
          <h3 className="text-xl font-semibold text-white">{contact.name as string}</h3>
          <StatusBadge status={contact.type as string} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {!!contact.email && (
          <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-lg">
            <Mail className="w-5 h-5 text-slate-400" />
            <div>
              <p className="text-xs text-slate-500">Email</p>
              <p className="text-sm text-white">{contact.email as string}</p>
            </div>
          </div>
        )}
        {!!contact.phone && (
          <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-lg">
            <Phone className="w-5 h-5 text-slate-400" />
            <div>
              <p className="text-xs text-slate-500">Phone</p>
              <p className="text-sm text-white">{contact.phone as string}</p>
            </div>
          </div>
        )}
        {!!contact.company && (
          <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-lg">
            <Building className="w-5 h-5 text-slate-400" />
            <div>
              <p className="text-xs text-slate-500">Company</p>
              <p className="text-sm text-white">{contact.company as string}</p>
            </div>
          </div>
        )}
        {!!contact.address && (
          <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-lg">
            <MapPin className="w-5 h-5 text-slate-400" />
            <div>
              <p className="text-xs text-slate-500">Address</p>
              <p className="text-sm text-white">{contact.address as string}</p>
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
  const { instance } = useOutletContext<OutletContextType>();
  const { contacts, addContact, updateContact, deleteContact } = useCRMDataStore() as {
    contacts: Record<string, unknown>[];
    addContact: (data: Record<string, unknown> | ContactFormData) => void;
    updateContact: (id: unknown, data: Record<string, unknown> | ContactFormData) => void;
    deleteContact: (id: unknown) => void;
  };
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [showForm, setShowForm] = useState<boolean>(false);
  const [editContact, setEditContact] = useState<Record<string, unknown> | null>(null);
  const [viewContact, setViewContact] = useState<Record<string, unknown> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Record<string, unknown> | null>(null);

  const primaryColor = (instance.primaryColor as string) || '{{PRIMARY_COLOR}}';

  const filteredContacts = useMemo(() => {
    return contacts.filter((c: Record<string, unknown>) => {
      const matchesSearch = !searchQuery ||
        (c.name as string).toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.email as string)?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.company as string)?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesType = !typeFilter || c.type === typeFilter;
      return matchesSearch && matchesType;
    });
  }, [contacts, searchQuery, typeFilter]);

  const handleSave = (contactData: ContactFormData) => {
    if (editContact) {
      updateContact(editContact.id, contactData);
    } else {
      addContact(contactData);
    }
    setEditContact(null);
    setShowForm(false);
  };

  const handleEdit = (contact: Record<string, unknown>) => {
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
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
                className="input pl-11"
              />
            </div>
            <Select
              value={typeFilter}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setTypeFilter(e.target.value)}
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
              {filteredContacts.map((contact: Record<string, unknown>) => (
                <TableRow key={contact.id as string} onClick={() => setViewContact(contact)}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center text-white text-sm font-medium"
                        style={{ backgroundColor: primaryColor }}
                      >
                        {(contact.name as string)?.[0]?.toUpperCase()}
                      </div>
                      <span className="font-medium text-white">{contact.name as string}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={contact.type as string} />
                  </TableCell>
                  <TableCell className="text-slate-300">{(contact.email as string) || '-'}</TableCell>
                  <TableCell className="text-slate-300">{(contact.phone as string) || '-'}</TableCell>
                  <TableCell className="text-slate-300">{(contact.company as string) || '-'}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleEdit(contact); }}
                        className="p-1.5 hover:bg-slate-700 rounded"
                      >
                        <Edit2 className="w-4 h-4 text-slate-400" />
                      </button>
                      <button
                        onClick={(e: React.MouseEvent) => { e.stopPropagation(); setDeleteTarget(contact); }}
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
