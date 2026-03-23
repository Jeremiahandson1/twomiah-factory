import React, { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Search, FileText, DollarSign, Clock, CheckCircle2, Send, Edit2, Trash2, Check, X } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardBody, Button, Input, Select, Modal, Table, TableHead, TableBody, TableRow, TableHeader, TableCell, StatusBadge, EmptyState, ConfirmDialog } from '../ui';
import { useCRMDataStore } from '../../stores/builderStore';

interface OutletContextType {
  instance: Record<string, unknown>;
}

const statusOptions = [
  { value: 'draft', label: 'Draft' },
  { value: 'pending', label: 'Sent/Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

interface QuoteFormData {
  title: string;
  client: string;
  amount: string | number;
  status: string;
  createdAt?: string;
}

interface QuoteFormProps {
  quote: Record<string, unknown> | null;
  clients: Record<string, unknown>[];
  onSave: (data: Record<string, unknown>) => void;
  onClose: () => void;
}

function QuoteForm({ quote, clients, onSave, onClose }: QuoteFormProps) {
  const [form, setForm] = useState<QuoteFormData>((quote as unknown as QuoteFormData) || { title: '', client: '', amount: '', status: 'draft' });
  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); onSave({ ...form, amount: Number(form.amount) || 0, createdAt: quote?.createdAt || new Date().toISOString() }); onClose(); };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="Quote Title" value={form.title} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, title: e.target.value })} required />
      <Select label="Client" value={form.client} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, client: e.target.value })} options={clients.map((c: Record<string, unknown>) => ({ value: c.id as string, label: c.name as string }))} placeholder="Select client" />
      <Input label="Amount ($)" type="number" value={form.amount} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, amount: e.target.value })} />
      <Select label="Status" value={form.status} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, status: e.target.value })} options={statusOptions} />
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{quote ? 'Update' : 'Create'} Quote</Button></div>
    </form>
  );
}

export function QuotesPage() {
  const { instance } = useOutletContext<OutletContextType>();
  const store = useCRMDataStore();
  const quotes = store.quotes as Record<string, unknown>[];
  const contacts = store.contacts as Record<string, unknown>[];
  const addQuote = store.addQuote as (data: Record<string, unknown>) => void;
  const updateQuote = store.updateQuote as (id: unknown, data: Record<string, unknown>) => void;
  const deleteQuote = store.deleteQuote as (id: unknown) => void;
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [showForm, setShowForm] = useState<boolean>(false);
  const [editQuote, setEditQuote] = useState<Record<string, unknown> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Record<string, unknown> | null>(null);
  const primaryColor = (instance.primaryColor as string) || '{{PRIMARY_COLOR}}';
  const clients = contacts.filter((c: Record<string, unknown>) => c.type === 'client');

  const filtered = useMemo(() => quotes.filter((q: Record<string, unknown>) => {
    const matchesSearch = !search || (q.title as string).toLowerCase().includes(search.toLowerCase()) || (q.number as string)?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = !statusFilter || q.status === statusFilter;
    return matchesSearch && matchesStatus;
  }), [quotes, search, statusFilter]);

  const handleSave = (data: Record<string, unknown>) => { editQuote ? updateQuote(editQuote.id, data) : addQuote(data); setEditQuote(null); setShowForm(false); };
  const handleStatusChange = (quote: Record<string, unknown>, newStatus: string) => updateQuote(quote.id, { status: newStatus });
  const getClientName = (id: string) => (contacts.find((c: Record<string, unknown>) => c.id === id)?.name as string) || 'Unknown';

  const totals = {
    total: quotes.reduce((s: number, q: Record<string, unknown>) => s + (q.amount as number), 0),
    pending: quotes.filter((q: Record<string, unknown>) => q.status === 'pending').reduce((s: number, q: Record<string, unknown>) => s + (q.amount as number), 0),
    approved: quotes.filter((q: Record<string, unknown>) => q.status === 'approved').reduce((s: number, q: Record<string, unknown>) => s + (q.amount as number), 0),
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-white">Quotes</h1><p className="text-slate-400 mt-1">{quotes.length} total quotes</p></div>
        <Button onClick={() => setShowForm(true)} icon={Plus}>New Quote</Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Quoted', value: '$' + totals.total.toLocaleString(), icon: FileText },
          { label: 'Pending', value: '$' + totals.pending.toLocaleString(), icon: Clock },
          { label: 'Approved', value: '$' + totals.approved.toLocaleString(), icon: CheckCircle2 },
          { label: 'Win Rate', value: quotes.length > 0 ? Math.round(quotes.filter((q: Record<string, unknown>) => q.status === 'approved').length / quotes.length * 100) + '%' : '0%', icon: DollarSign },
        ].map((stat, i) => (
          <Card key={i} className="p-4"><div className="flex items-center justify-between"><div><p className="text-xl font-bold text-white">{stat.value}</p><p className="text-sm text-slate-400">{stat.label}</p></div><stat.icon className="w-8 h-8" style={{ color: primaryColor }} /></div></Card>
        ))}
      </div>
      <Card><CardBody className="p-4"><div className="flex flex-col sm:flex-row gap-4"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" /><input type="text" placeholder="Search quotes..." value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)} className="input pl-11" /></div><Select value={statusFilter} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setStatusFilter(e.target.value)} options={[{ value: '', label: 'All Status' }, ...statusOptions]} className="sm:w-48" /></div></CardBody></Card>
      <Card>
        {filtered.length > 0 ? (
          <Table><TableHead><TableRow><TableHeader>Quote</TableHeader><TableHeader>Client</TableHeader><TableHeader>Amount</TableHeader><TableHeader>Status</TableHeader><TableHeader>Created</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>
            {filtered.map((q: Record<string, unknown>) => (
              <TableRow key={q.id as string}>
                <TableCell><span className="font-medium text-white">{q.title as string}</span><p className="text-xs text-slate-500">{q.number as string}</p></TableCell>
                <TableCell className="text-slate-300">{getClientName(q.client as string)}</TableCell>
                <TableCell className="text-white font-medium">${(q.amount as number).toLocaleString()}</TableCell>
                <TableCell><StatusBadge status={q.status as string} /></TableCell>
                <TableCell className="text-slate-300">{q.createdAt ? format(new Date(q.createdAt as string), 'MMM d, yyyy') : '-'}</TableCell>
                <TableCell><div className="flex gap-1">
                  {q.status === 'draft' && <button onClick={() => handleStatusChange(q, 'pending')} className="p-1.5 hover:bg-slate-700 rounded text-blue-400" title="Send"><Send className="w-4 h-4" /></button>}
                  {q.status === 'pending' && <><button onClick={() => handleStatusChange(q, 'approved')} className="p-1.5 hover:bg-slate-700 rounded text-emerald-400" title="Approve"><Check className="w-4 h-4" /></button><button onClick={() => handleStatusChange(q, 'rejected')} className="p-1.5 hover:bg-slate-700 rounded text-red-400" title="Reject"><X className="w-4 h-4" /></button></>}
                  <button onClick={() => { setEditQuote(q); setShowForm(true); }} className="p-1.5 hover:bg-slate-700 rounded"><Edit2 className="w-4 h-4 text-slate-400" /></button>
                  <button onClick={() => setDeleteTarget(q)} className="p-1.5 hover:bg-red-500/20 rounded"><Trash2 className="w-4 h-4 text-red-400" /></button>
                </div></TableCell>
              </TableRow>
            ))}
          </TableBody></Table>
        ) : (<CardBody><EmptyState icon={FileText} title="No quotes found" description="Create your first quote" action={<Button onClick={() => setShowForm(true)} icon={Plus}>New Quote</Button>} /></CardBody>)}
      </Card>
      <Modal isOpen={showForm} onClose={() => { setShowForm(false); setEditQuote(null); }} title={editQuote ? 'Edit Quote' : 'New Quote'}><QuoteForm quote={editQuote} clients={clients} onSave={handleSave} onClose={() => { setShowForm(false); setEditQuote(null); }} /></Modal>
      <ConfirmDialog isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={() => deleteQuote(deleteTarget?.id)} title="Delete Quote" message={`Delete "${deleteTarget?.title}"?`} confirmText="Delete" variant="danger" />
    </div>
  );
}
