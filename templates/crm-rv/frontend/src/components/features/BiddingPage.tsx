import React, { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Search, Gavel, DollarSign, Clock, TrendingUp, CheckCircle2, XCircle, Edit2, Trash2, Send, FileText } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardHeader, CardBody, Button, Input, Select, Modal, Textarea, Table, TableHead, TableBody, TableRow, TableHeader, TableCell, StatusBadge, EmptyState, ConfirmDialog } from '../ui';
import { useCRMDataStore } from '../../stores/builderStore';

interface OutletContextType {
  instance: Record<string, unknown>;
}

const statusOptions = [
  { value: 'draft', label: 'Draft' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
  { value: 'no_bid', label: 'No Bid' },
];

const bidTypeOptions = [
  { value: 'lump_sum', label: 'Lump Sum' },
  { value: 'unit_price', label: 'Unit Price' },
  { value: 'cost_plus', label: 'Cost Plus' },
  { value: 'gmp', label: 'GMP' },
  { value: 'design_build', label: 'Design-Build' },
];

interface BidFormData {
  projectName: string;
  client: string;
  bidType: string;
  dueDate: string;
  dueTime: string;
  estimatedValue: string | number;
  bidAmount: string | number;
  bondRequired: boolean;
  bondAmount: string | number;
  prebidDate: string;
  prebidLocation: string;
  scope: string;
  notes: string;
  status: string;
  createdAt?: string;
}

interface BidFormProps {
  bid: Record<string, unknown> | null;
  contacts: Record<string, unknown>[];
  onSave: (data: Record<string, unknown>) => void;
  onClose: () => void;
}

function BidForm({ bid, contacts, onSave, onClose }: BidFormProps) {
  const [form, setForm] = useState<BidFormData>((bid as unknown as BidFormData) || {
    projectName: '', client: '', bidType: 'lump_sum', dueDate: '', dueTime: '',
    estimatedValue: '', bidAmount: '', bondRequired: false, bondAmount: '',
    prebidDate: '', prebidLocation: '', scope: '', notes: '', status: 'draft'
  });
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...form,
      estimatedValue: Number(form.estimatedValue) || 0,
      bidAmount: Number(form.bidAmount) || 0,
      bondAmount: Number(form.bondAmount) || 0,
      createdAt: bid?.createdAt || new Date().toISOString()
    });
    onClose();
  };
  const clients = contacts.filter((c: Record<string, unknown>) => c.type === 'client');

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="Project Name" value={form.projectName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, projectName: e.target.value })} placeholder="Project being bid" required />
      <div className="grid grid-cols-2 gap-4">
        <Select label="Client / Owner" value={form.client} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, client: e.target.value })} options={clients.map((c: Record<string, unknown>) => ({ value: c.id as string, label: c.name as string }))} placeholder="Select client" />
        <Select label="Bid Type" value={form.bidType} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, bidType: e.target.value })} options={bidTypeOptions} />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Input label="Due Date" type="date" value={form.dueDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, dueDate: e.target.value })} />
        <Input label="Due Time" type="time" value={form.dueTime} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, dueTime: e.target.value })} />
        <Input label="Estimated Value ($)" type="number" value={form.estimatedValue} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, estimatedValue: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Input label="Bid Amount ($)" type="number" value={form.bidAmount} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, bidAmount: e.target.value })} placeholder="Your bid amount" />
        <Select label="Status" value={form.status} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, status: e.target.value })} options={statusOptions} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Input label="Pre-Bid Meeting Date" type="date" value={form.prebidDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, prebidDate: e.target.value })} />
        <Input label="Pre-Bid Location" value={form.prebidLocation} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, prebidLocation: e.target.value })} />
      </div>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.bondRequired} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, bondRequired: e.target.checked })} className="w-4 h-4 rounded border-slate-600 bg-slate-800" />
          <span className="text-sm text-slate-300">Bid Bond Required</span>
        </label>
        {form.bondRequired && <Input placeholder="Bond Amount ($)" type="number" value={form.bondAmount} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, bondAmount: e.target.value })} className="flex-1" />}
      </div>
      <Textarea label="Scope of Work" value={form.scope} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, scope: e.target.value })} placeholder="Brief description of scope..." rows={2} />
      <Textarea label="Notes" value={form.notes} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, notes: e.target.value })} rows={2} />
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{bid ? 'Update' : 'Create'} Bid</Button></div>
    </form>
  );
}

export function BiddingPage() {
  const { instance } = useOutletContext<OutletContextType>();
  const store = useCRMDataStore();
  const contacts = store.contacts as Record<string, unknown>[];
  const bids = (store.bids || []) as Record<string, unknown>[];
  const addBid = store.addBid as ((item: Record<string, unknown>) => void) | undefined;
  const updateBid = store.updateBid as ((id: unknown, updates: Record<string, unknown>) => void) | undefined;
  const deleteBid = store.deleteBid as ((id: unknown) => void) | undefined;
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [showForm, setShowForm] = useState<boolean>(false);
  const [editBid, setEditBid] = useState<Record<string, unknown> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Record<string, unknown> | null>(null);
  const primaryColor = (instance.primaryColor as string) || '{{PRIMARY_COLOR}}';

  const filtered = useMemo(() => (bids || []).filter((b: Record<string, unknown>) => {
    const matchesSearch = !search || (b.projectName as string)?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = !statusFilter || b.status === statusFilter;
    return matchesSearch && matchesStatus;
  }), [bids, search, statusFilter]);

  const handleSave = (data: Record<string, unknown>) => { editBid ? updateBid?.(editBid.id, data) : addBid?.(data); setEditBid(null); setShowForm(false); };
  const getClientName = (id: string): string => (contacts.find((c: Record<string, unknown>) => c.id === id)?.name as string) || '-';

  const totalValue = bids.reduce((s: number, b: Record<string, unknown>) => s + ((b.bidAmount as number) || (b.estimatedValue as number) || 0), 0);
  const wonValue = bids.filter((b: Record<string, unknown>) => b.status === 'won').reduce((s: number, b: Record<string, unknown>) => s + ((b.bidAmount as number) || 0), 0);
  const pendingCount = bids.filter((b: Record<string, unknown>) => ['submitted', 'under_review'].includes(b.status as string)).length;
  const winRate = bids.filter((b: Record<string, unknown>) => ['won', 'lost'].includes(b.status as string)).length > 0
    ? Math.round(bids.filter((b: Record<string, unknown>) => b.status === 'won').length / bids.filter((b: Record<string, unknown>) => ['won', 'lost'].includes(b.status as string)).length * 100)
    : 0;

  const statusColors: Record<string, string> = { won: 'text-emerald-400', lost: 'text-red-400', submitted: 'text-blue-400', under_review: 'text-amber-400', draft: 'text-slate-400', no_bid: 'text-slate-500' };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-white">Bidding</h1><p className="text-slate-400 mt-1">Manage bids and track win rates</p></div>
        <Button onClick={() => { setEditBid(null); setShowForm(true); }} icon={Plus}>New Bid</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Pipeline', value: '$' + (totalValue / 1000).toFixed(0) + 'K', icon: Gavel },
          { label: 'Won Value', value: '$' + (wonValue / 1000).toFixed(0) + 'K', icon: DollarSign, color: 'text-emerald-400' },
          { label: 'Pending', value: pendingCount, icon: Clock },
          { label: 'Win Rate', value: winRate + '%', icon: TrendingUp },
        ].map((s, i) => (
          <Card key={i} className="p-4"><div className="flex items-center justify-between"><div><p className={`text-xl font-bold ${s.color || 'text-white'}`}>{s.value}</p><p className="text-sm text-slate-400">{s.label}</p></div><s.icon className="w-8 h-8" style={{ color: primaryColor }} /></div></Card>
        ))}
      </div>

      <Card><CardBody className="p-4"><div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" /><input type="text" placeholder="Search bids..." value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)} className="input pl-11" /></div>
        <Select value={statusFilter} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setStatusFilter(e.target.value)} options={[{ value: '', label: 'All Status' }, ...statusOptions]} className="sm:w-48" />
      </div></CardBody></Card>

      <Card>
        {filtered.length > 0 ? (
          <Table><TableHead><TableRow><TableHeader>Project</TableHeader><TableHeader>Client</TableHeader><TableHeader>Bid Amount</TableHeader><TableHeader>Due Date</TableHeader><TableHeader>Status</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>
            {filtered.map((bid: Record<string, unknown>) => (
              <TableRow key={bid.id as string}>
                <TableCell><span className="font-medium text-white">{bid.projectName as string}</span><p className="text-xs text-slate-500">{(bid.bidType as string)?.replace('_', ' ')}</p></TableCell>
                <TableCell className="text-slate-300">{getClientName(bid.client as string)}</TableCell>
                <TableCell><span className="text-white font-medium">${((bid.bidAmount as number) || (bid.estimatedValue as number) || 0).toLocaleString()}</span></TableCell>
                <TableCell>
                  <span className="text-slate-300">{bid.dueDate ? format(new Date(bid.dueDate as string), 'MMM d, yyyy') : '-'}</span>
                  {(bid.dueTime as string) && <span className="text-slate-500 text-xs ml-1">{bid.dueTime as string}</span>}
                </TableCell>
                <TableCell><span className={`font-medium ${statusColors[bid.status as string]}`}>{(bid.status as string)?.replace('_', ' ')}</span></TableCell>
                <TableCell><div className="flex gap-1">
                  {bid.status === 'draft' && <button onClick={() => updateBid?.(bid.id, { status: 'submitted' })} className="p-1.5 hover:bg-blue-500/20 rounded text-blue-400" title="Submit"><Send className="w-4 h-4" /></button>}
                  {bid.status === 'submitted' && <><button onClick={() => updateBid?.(bid.id, { status: 'won' })} className="p-1.5 hover:bg-emerald-500/20 rounded text-emerald-400" title="Won"><CheckCircle2 className="w-4 h-4" /></button><button onClick={() => updateBid?.(bid.id, { status: 'lost' })} className="p-1.5 hover:bg-red-500/20 rounded text-red-400" title="Lost"><XCircle className="w-4 h-4" /></button></>}
                  <button onClick={() => { setEditBid(bid); setShowForm(true); }} className="p-1.5 hover:bg-slate-700 rounded"><Edit2 className="w-4 h-4 text-slate-400" /></button>
                  <button onClick={() => setDeleteTarget(bid)} className="p-1.5 hover:bg-red-500/20 rounded"><Trash2 className="w-4 h-4 text-red-400" /></button>
                </div></TableCell>
              </TableRow>
            ))}
          </TableBody></Table>
        ) : (<CardBody><EmptyState icon={Gavel} title="No bids" description="Start tracking your bids" action={<Button onClick={() => setShowForm(true)} icon={Plus}>New Bid</Button>} /></CardBody>)}
      </Card>

      <Modal isOpen={showForm} onClose={() => { setShowForm(false); setEditBid(null); }} title={editBid ? 'Edit Bid' : 'New Bid'} size="lg">
        <BidForm bid={editBid} contacts={contacts} onSave={handleSave} onClose={() => { setShowForm(false); setEditBid(null); }} />
      </Modal>

      <ConfirmDialog isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={() => deleteBid?.(deleteTarget?.id)} title="Delete Bid" message={`Delete bid for "${deleteTarget?.projectName}"?`} confirmText="Delete" variant="danger" />
    </div>
  );
}
