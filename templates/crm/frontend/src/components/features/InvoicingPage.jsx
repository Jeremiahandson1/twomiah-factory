import React, { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Search, CreditCard, DollarSign, Clock, CheckCircle2, AlertCircle, Edit2, Trash2, Send } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardBody, Button, Input, Select, Modal, Table, TableHead, TableBody, TableRow, TableHeader, TableCell, StatusBadge, EmptyState, ConfirmDialog } from '../ui';
import { useCRMDataStore } from '../../stores/builderStore';

const statusOptions = [
  { value: 'draft', label: 'Draft' },
  { value: 'pending', label: 'Sent/Pending' },
  { value: 'paid', label: 'Paid' },
  { value: 'overdue', label: 'Overdue' },
];

function InvoiceForm({ invoice, clients, projects, onSave, onClose }) {
  const [form, setForm] = useState(invoice || { client: '', projectId: '', amount: '', status: 'draft', dueDate: '', paid: 0 });
  const handleSubmit = (e) => { e.preventDefault(); onSave({ ...form, amount: Number(form.amount) || 0, paid: invoice?.paid || 0 }); onClose(); };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Select label="Client" value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} options={clients.map(c => ({ value: c.id, label: c.name }))} placeholder="Select client" required />
      <Select label="Project" value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} options={projects.map(p => ({ value: p.id, label: p.name }))} placeholder="Select project (optional)" />
      <Input label="Amount ($)" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
      <Input label="Due Date" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
      <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={statusOptions} />
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{invoice ? 'Update' : 'Create'} Invoice</Button></div>
    </form>
  );
}

export function InvoicingPage() {
  const { instance } = useOutletContext();
  const { invoices, contacts, projects, addInvoice, updateInvoice, deleteInvoice } = useCRMDataStore();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editInvoice, setEditInvoice] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const primaryColor = instance.primaryColor || '#ec7619';
  const clients = contacts.filter(c => c.type === 'client');

  const filtered = useMemo(() => invoices.filter(i => {
    const matchesSearch = !search || i.number?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = !statusFilter || i.status === statusFilter;
    return matchesSearch && matchesStatus;
  }), [invoices, search, statusFilter]);

  const handleSave = (data) => { editInvoice ? updateInvoice(editInvoice.id, data) : addInvoice(data); setEditInvoice(null); setShowForm(false); };
  const handleMarkPaid = (inv) => updateInvoice(inv.id, { status: 'paid', paid: inv.amount });
  const getClientName = (id) => contacts.find(c => c.id === id)?.name || 'Unknown';

  const totals = {
    total: invoices.reduce((s, i) => s + i.amount, 0),
    paid: invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.paid, 0),
    pending: invoices.filter(i => i.status === 'pending').reduce((s, i) => s + (i.amount - i.paid), 0),
    overdue: invoices.filter(i => i.status === 'overdue').reduce((s, i) => s + (i.amount - i.paid), 0),
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-white">Invoicing</h1><p className="text-slate-400 mt-1">{invoices.length} total invoices</p></div>
        <Button onClick={() => setShowForm(true)} icon={Plus}>New Invoice</Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Invoiced', value: '$' + totals.total.toLocaleString(), icon: CreditCard, color: primaryColor },
          { label: 'Collected', value: '$' + totals.paid.toLocaleString(), icon: CheckCircle2, color: '#10b981' },
          { label: 'Pending', value: '$' + totals.pending.toLocaleString(), icon: Clock, color: '#f59e0b' },
          { label: 'Overdue', value: '$' + totals.overdue.toLocaleString(), icon: AlertCircle, color: '#ef4444' },
        ].map((stat, i) => (
          <Card key={i} className="p-4"><div className="flex items-center justify-between"><div><p className="text-xl font-bold text-white">{stat.value}</p><p className="text-sm text-slate-400">{stat.label}</p></div><stat.icon className="w-8 h-8" style={{ color: stat.color }} /></div></Card>
        ))}
      </div>
      <Card><CardBody className="p-4"><div className="flex flex-col sm:flex-row gap-4"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" /><input type="text" placeholder="Search invoices..." value={search} onChange={(e) => setSearch(e.target.value)} className="input pl-11" /></div><Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} options={[{ value: '', label: 'All Status' }, ...statusOptions]} className="sm:w-48" /></div></CardBody></Card>
      <Card>
        {filtered.length > 0 ? (
          <Table><TableHead><TableRow><TableHeader>Invoice</TableHeader><TableHeader>Client</TableHeader><TableHeader>Amount</TableHeader><TableHeader>Status</TableHeader><TableHeader>Due Date</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>
            {filtered.map((inv) => (
              <TableRow key={inv.id}>
                <TableCell><span className="font-medium text-white">{inv.number}</span></TableCell>
                <TableCell className="text-slate-300">{getClientName(inv.client)}</TableCell>
                <TableCell><span className="text-white font-medium">${inv.amount.toLocaleString()}</span>{inv.paid > 0 && inv.paid < inv.amount && <p className="text-xs text-emerald-400">${inv.paid.toLocaleString()} paid</p>}</TableCell>
                <TableCell><StatusBadge status={inv.status} /></TableCell>
                <TableCell className="text-slate-300">{inv.dueDate ? format(new Date(inv.dueDate), 'MMM d, yyyy') : '-'}</TableCell>
                <TableCell><div className="flex gap-1">
                  {inv.status !== 'paid' && <button onClick={() => handleMarkPaid(inv)} className="p-1.5 hover:bg-emerald-500/20 rounded text-emerald-400" title="Mark Paid"><DollarSign className="w-4 h-4" /></button>}
                  <button onClick={() => { setEditInvoice(inv); setShowForm(true); }} className="p-1.5 hover:bg-slate-700 rounded"><Edit2 className="w-4 h-4 text-slate-400" /></button>
                  <button onClick={() => setDeleteTarget(inv)} className="p-1.5 hover:bg-red-500/20 rounded"><Trash2 className="w-4 h-4 text-red-400" /></button>
                </div></TableCell>
              </TableRow>
            ))}
          </TableBody></Table>
        ) : (<CardBody><EmptyState icon={CreditCard} title="No invoices found" description="Create your first invoice" action={<Button onClick={() => setShowForm(true)} icon={Plus}>New Invoice</Button>} /></CardBody>)}
      </Card>
      <Modal isOpen={showForm} onClose={() => { setShowForm(false); setEditInvoice(null); }} title={editInvoice ? 'Edit Invoice' : 'New Invoice'}><InvoiceForm invoice={editInvoice} clients={clients} projects={projects} onSave={handleSave} onClose={() => { setShowForm(false); setEditInvoice(null); }} /></Modal>
      <ConfirmDialog isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={() => deleteInvoice(deleteTarget?.id)} title="Delete Invoice" message={`Delete invoice "${deleteTarget?.number}"?`} confirmText="Delete" variant="danger" />
    </div>
  );
}
