import React, { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Search, CreditCard, DollarSign, Clock, CheckCircle2, AlertCircle, Edit2, Trash2, Send } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardBody, Button, Input, Select, Modal, Table, TableHead, TableBody, TableRow, TableHeader, TableCell, StatusBadge, EmptyState, ConfirmDialog } from '../ui';
import { useCRMDataStore } from '../../stores/builderStore';

interface OutletContextType {
  instance: Record<string, unknown>;
}

const statusOptions = [
  { value: 'draft', label: 'Draft' },
  { value: 'pending', label: 'Sent/Pending' },
  { value: 'paid', label: 'Paid' },
  { value: 'overdue', label: 'Overdue' },
];

interface InvoiceFormData {
  client: string;
  projectId: string;
  amount: string | number;
  status: string;
  dueDate: string;
  paid: number;
}

interface InvoiceFormProps {
  invoice: Record<string, unknown> | null;
  clients: Record<string, unknown>[];
  projects: Record<string, unknown>[];
  onSave: (data: Record<string, unknown>) => void;
  onClose: () => void;
}

function InvoiceForm({ invoice, clients, projects, onSave, onClose }: InvoiceFormProps) {
  const [form, setForm] = useState<InvoiceFormData>((invoice as unknown as InvoiceFormData) || { client: '', projectId: '', amount: '', status: 'draft', dueDate: '', paid: 0 });
  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); onSave({ ...form, amount: Number(form.amount) || 0, paid: invoice?.paid || 0 }); onClose(); };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Select label="Client" value={form.client} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, client: e.target.value })} options={clients.map((c: Record<string, unknown>) => ({ value: c.id as string, label: c.name as string }))} placeholder="Select client" required />
      <Select label="Project" value={form.projectId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, projectId: e.target.value })} options={projects.map((p: Record<string, unknown>) => ({ value: p.id as string, label: p.name as string }))} placeholder="Select project (optional)" />
      <Input label="Amount ($)" type="number" value={form.amount} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, amount: e.target.value })} required />
      <Input label="Due Date" type="date" value={form.dueDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, dueDate: e.target.value })} />
      <Select label="Status" value={form.status} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, status: e.target.value })} options={statusOptions} />
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{invoice ? 'Update' : 'Create'} Invoice</Button></div>
    </form>
  );
}

export function InvoicingPage() {
  const { instance } = useOutletContext<OutletContextType>();
  const store = useCRMDataStore();
  const invoices = store.invoices as Record<string, unknown>[];
  const contacts = store.contacts as Record<string, unknown>[];
  const projects = store.projects as Record<string, unknown>[];
  const addInvoice = store.addInvoice as (data: Record<string, unknown>) => void;
  const updateInvoice = store.updateInvoice as (id: unknown, data: Record<string, unknown>) => void;
  const deleteInvoice = store.deleteInvoice as (id: unknown) => void;
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [showForm, setShowForm] = useState<boolean>(false);
  const [editInvoice, setEditInvoice] = useState<Record<string, unknown> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Record<string, unknown> | null>(null);
  const primaryColor = (instance.primaryColor as string) || '{{PRIMARY_COLOR}}';
  const clients = contacts.filter((c: Record<string, unknown>) => c.type === 'client');

  const filtered = useMemo(() => invoices.filter((i: Record<string, unknown>) => {
    const matchesSearch = !search || (i.number as string)?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = !statusFilter || i.status === statusFilter;
    return matchesSearch && matchesStatus;
  }), [invoices, search, statusFilter]);

  const handleSave = (data: Record<string, unknown>) => { editInvoice ? updateInvoice(editInvoice.id, data) : addInvoice(data); setEditInvoice(null); setShowForm(false); };
  const handleMarkPaid = (inv: Record<string, unknown>) => updateInvoice(inv.id, { status: 'paid', paid: inv.amount });
  const getClientName = (id: string) => (contacts.find((c: Record<string, unknown>) => c.id === id)?.name as string) || 'Unknown';

  const totals = {
    total: invoices.reduce((s: number, i: Record<string, unknown>) => s + (i.amount as number), 0),
    paid: invoices.filter((i: Record<string, unknown>) => i.status === 'paid').reduce((s: number, i: Record<string, unknown>) => s + (i.paid as number), 0),
    pending: invoices.filter((i: Record<string, unknown>) => i.status === 'pending').reduce((s: number, i: Record<string, unknown>) => s + ((i.amount as number) - (i.paid as number)), 0),
    overdue: invoices.filter((i: Record<string, unknown>) => i.status === 'overdue').reduce((s: number, i: Record<string, unknown>) => s + ((i.amount as number) - (i.paid as number)), 0),
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
      <Card><CardBody className="p-4"><div className="flex flex-col sm:flex-row gap-4"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" /><input type="text" placeholder="Search invoices..." value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)} className="input pl-11" /></div><Select value={statusFilter} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setStatusFilter(e.target.value)} options={[{ value: '', label: 'All Status' }, ...statusOptions]} className="sm:w-48" /></div></CardBody></Card>
      <Card>
        {filtered.length > 0 ? (
          <Table><TableHead><TableRow><TableHeader>Invoice</TableHeader><TableHeader>Client</TableHeader><TableHeader>Amount</TableHeader><TableHeader>Status</TableHeader><TableHeader>Due Date</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>
            {filtered.map((inv: Record<string, unknown>) => (
              <TableRow key={inv.id as string}>
                <TableCell><span className="font-medium text-white">{inv.number as string}</span></TableCell>
                <TableCell className="text-slate-300">{getClientName(inv.client as string)}</TableCell>
                <TableCell><span className="text-white font-medium">${(inv.amount as number).toLocaleString()}</span>{(inv.paid as number) > 0 && (inv.paid as number) < (inv.amount as number) && <p className="text-xs text-emerald-400">${(inv.paid as number).toLocaleString()} paid</p>}</TableCell>
                <TableCell><StatusBadge status={inv.status as string} /></TableCell>
                <TableCell className="text-slate-300">{inv.dueDate ? format(new Date(inv.dueDate as string), 'MMM d, yyyy') : '-'}</TableCell>
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
