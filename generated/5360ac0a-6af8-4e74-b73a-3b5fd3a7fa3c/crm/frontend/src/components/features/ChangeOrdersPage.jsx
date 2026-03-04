import React, { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Search, FileEdit, DollarSign, Clock, CheckCircle2, Edit2, Trash2, Check, X } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardBody, Button, Input, Select, Modal, Textarea, Table, TableHead, TableBody, TableRow, TableHeader, TableCell, StatusBadge, EmptyState, ConfirmDialog } from '../ui';
import { useCRMDataStore } from '../../stores/builderStore';

const statusOptions = [
  { value: 'draft', label: 'Draft' },
  { value: 'pending', label: 'Pending Approval' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

function ChangeOrderForm({ co, projects, onSave, onClose }) {
  const [form, setForm] = useState(co || { projectId: '', title: '', description: '', amount: '', status: 'draft' });
  const handleSubmit = (e) => { e.preventDefault(); onSave({ ...form, amount: Number(form.amount) || 0, createdAt: co?.createdAt || new Date().toISOString() }); onClose(); };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Select label="Project" value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} options={projects.map(p => ({ value: p.id, label: p.name }))} placeholder="Select project" required />
      <Input label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Change order title" required />
      <Textarea label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Describe the change..." rows={3} />
      <Input label="Amount ($)" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />
      <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={statusOptions} />
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{co ? 'Update' : 'Create'}</Button></div>
    </form>
  );
}

export function ChangeOrdersPage() {
  const { instance } = useOutletContext();
  const { changeOrders, projects, addChangeOrder, updateChangeOrder, deleteChangeOrder } = useCRMDataStore();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editCO, setEditCO] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const primaryColor = instance.primaryColor || '#ec7619';

  const filtered = useMemo(() => changeOrders.filter(c => {
    const matchesSearch = !search || c.title?.toLowerCase().includes(search.toLowerCase()) || c.number?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = !statusFilter || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  }), [changeOrders, search, statusFilter]);

  const handleSave = (data) => { editCO ? updateChangeOrder(editCO.id, data) : addChangeOrder(data); setEditCO(null); setShowForm(false); };
  const handleApprove = (co) => updateChangeOrder(co.id, { status: 'approved' });
  const handleReject = (co) => updateChangeOrder(co.id, { status: 'rejected' });
  const getProjectName = (id) => projects.find(p => p.id === id)?.name || '-';

  const totals = {
    pending: changeOrders.filter(c => c.status === 'pending').reduce((s, c) => s + c.amount, 0),
    approved: changeOrders.filter(c => c.status === 'approved').reduce((s, c) => s + c.amount, 0),
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-white">Change Orders</h1><p className="text-slate-400 mt-1">Track project scope changes</p></div>
        <Button onClick={() => setShowForm(true)} icon={Plus}>New Change Order</Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total COs', value: changeOrders.length, icon: FileEdit },
          { label: 'Pending Value', value: '$' + totals.pending.toLocaleString(), icon: Clock },
          { label: 'Approved Value', value: '$' + totals.approved.toLocaleString(), icon: CheckCircle2 },
          { label: 'Pending Count', value: changeOrders.filter(c => c.status === 'pending').length, icon: DollarSign },
        ].map((stat, i) => (
          <Card key={i} className="p-4"><div className="flex items-center justify-between"><div><p className="text-xl font-bold text-white">{stat.value}</p><p className="text-sm text-slate-400">{stat.label}</p></div><stat.icon className="w-8 h-8" style={{ color: primaryColor }} /></div></Card>
        ))}
      </div>
      <Card><CardBody className="p-4"><div className="flex flex-col sm:flex-row gap-4"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" /><input type="text" placeholder="Search change orders..." value={search} onChange={(e) => setSearch(e.target.value)} className="input pl-11" /></div><Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} options={[{ value: '', label: 'All Status' }, ...statusOptions]} className="sm:w-48" /></div></CardBody></Card>
      <Card>
        {filtered.length > 0 ? (
          <Table><TableHead><TableRow><TableHeader>CO #</TableHeader><TableHeader>Title</TableHeader><TableHeader>Project</TableHeader><TableHeader>Amount</TableHeader><TableHeader>Status</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>
            {filtered.map((co) => (
              <TableRow key={co.id}>
                <TableCell><span className="font-medium text-white">{co.number}</span></TableCell>
                <TableCell><span className="text-slate-300">{co.title}</span></TableCell>
                <TableCell className="text-slate-400">{getProjectName(co.projectId)}</TableCell>
                <TableCell className={co.amount >= 0 ? 'text-emerald-400' : 'text-red-400'}>{co.amount >= 0 ? '+' : ''}${Math.abs(co.amount).toLocaleString()}</TableCell>
                <TableCell><StatusBadge status={co.status} /></TableCell>
                <TableCell><div className="flex gap-1">
                  {co.status === 'pending' && <><button onClick={() => handleApprove(co)} className="p-1.5 hover:bg-emerald-500/20 rounded text-emerald-400" title="Approve"><Check className="w-4 h-4" /></button><button onClick={() => handleReject(co)} className="p-1.5 hover:bg-red-500/20 rounded text-red-400" title="Reject"><X className="w-4 h-4" /></button></>}
                  <button onClick={() => { setEditCO(co); setShowForm(true); }} className="p-1.5 hover:bg-slate-700 rounded"><Edit2 className="w-4 h-4 text-slate-400" /></button>
                  <button onClick={() => setDeleteTarget(co)} className="p-1.5 hover:bg-red-500/20 rounded"><Trash2 className="w-4 h-4 text-red-400" /></button>
                </div></TableCell>
              </TableRow>
            ))}
          </TableBody></Table>
        ) : (<CardBody><EmptyState icon={FileEdit} title="No change orders found" action={<Button onClick={() => setShowForm(true)} icon={Plus}>New Change Order</Button>} /></CardBody>)}
      </Card>
      <Modal isOpen={showForm} onClose={() => { setShowForm(false); setEditCO(null); }} title={editCO ? 'Edit Change Order' : 'New Change Order'}><ChangeOrderForm co={editCO} projects={projects} onSave={handleSave} onClose={() => { setShowForm(false); setEditCO(null); }} /></Modal>
      <ConfirmDialog isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={() => deleteChangeOrder(deleteTarget?.id)} title="Delete Change Order" message={`Delete "${deleteTarget?.number}"?`} confirmText="Delete" variant="danger" />
    </div>
  );
}
