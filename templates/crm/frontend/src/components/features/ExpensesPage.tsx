import React, { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Search, Receipt, DollarSign, CreditCard, Truck, Edit2, Trash2, Camera } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardBody, Button, Input, Select, Modal, Textarea, Table, TableHead, TableBody, TableRow, TableHeader, TableCell, EmptyState, ConfirmDialog } from '../ui';
import { useCRMDataStore } from '../../stores/builderStore';

const categoryOptions = [
  { value: 'materials', label: 'Materials' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'labor', label: 'Labor' },
  { value: 'subcontractor', label: 'Subcontractor' },
  { value: 'travel', label: 'Travel' },
  { value: 'supplies', label: 'Supplies' },
  { value: 'other', label: 'Other' },
];

function ExpenseForm({ expense, projects, onSave, onClose }) {
  const [form, setForm] = useState(expense || { 
    projectId: '', date: format(new Date(), 'yyyy-MM-dd'), category: 'materials',
    vendor: '', description: '', amount: '', receipt: null, reimbursable: false
  });
  const handleSubmit = (e) => { e.preventDefault(); onSave({ ...form, amount: Number(form.amount) || 0 }); onClose(); };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Select label="Project" value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} options={projects.map(p => ({ value: p.id, label: p.name }))} placeholder="Select project" />
        <Input label="Date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Select label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} options={categoryOptions} />
        <Input label="Vendor" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="Store or vendor name" />
      </div>
      <Textarea label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What was purchased..." rows={2} />
      <Input label="Amount ($)" type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.reimbursable} onChange={(e) => setForm({ ...form, reimbursable: e.target.checked })} className="w-4 h-4 rounded border-slate-600 bg-slate-800" />
          <span className="text-sm text-slate-300">Reimbursable expense</span>
        </label>
        <Button type="button" variant="ghost" size="sm" icon={Camera}>Attach Receipt</Button>
      </div>
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{expense ? 'Update' : 'Add'} Expense</Button></div>
    </form>
  );
}

export function ExpensesPage() {
  const { instance } = useOutletContext();
  const { expenses = [], projects, addExpense, updateExpense, deleteExpense } = useCRMDataStore();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editExpense, setEditExpense] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const primaryColor = instance.primaryColor || '#ec7619';

  const filtered = useMemo(() => (expenses || []).filter(e => {
    const matchesSearch = !search || e.description?.toLowerCase().includes(search.toLowerCase()) || e.vendor?.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = !categoryFilter || e.category === categoryFilter;
    return matchesSearch && matchesCategory;
  }), [expenses, search, categoryFilter]);

  const handleSave = (data) => { editExpense ? updateExpense?.(editExpense.id, data) : addExpense?.(data); setEditExpense(null); setShowForm(false); };
  const getProjectName = (id) => projects.find(p => p.id === id)?.name || 'Unassigned';

  const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const byCategory = categoryOptions.reduce((acc, cat) => {
    acc[cat.value] = expenses.filter(e => e.category === cat.value).reduce((s, e) => s + (e.amount || 0), 0);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-white">Expenses</h1><p className="text-slate-400 mt-1">Track project expenses and receipts</p></div>
        <Button onClick={() => setShowForm(true)} icon={Plus}>Add Expense</Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Expenses', value: '$' + totalExpenses.toLocaleString(), icon: DollarSign },
          { label: 'Materials', value: '$' + (byCategory.materials || 0).toLocaleString(), icon: Truck },
          { label: 'Labor', value: '$' + (byCategory.labor || 0).toLocaleString(), icon: CreditCard },
          { label: 'Receipts', value: expenses.length, icon: Receipt },
        ].map((stat, i) => (
          <Card key={i} className="p-4"><div className="flex items-center justify-between"><div><p className="text-xl font-bold text-white">{stat.value}</p><p className="text-sm text-slate-400">{stat.label}</p></div><stat.icon className="w-8 h-8" style={{ color: primaryColor }} /></div></Card>
        ))}
      </div>
      <Card><CardBody className="p-4"><div className="flex flex-col sm:flex-row gap-4"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" /><input type="text" placeholder="Search expenses..." value={search} onChange={(e) => setSearch(e.target.value)} className="input pl-11" /></div><Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} options={[{ value: '', label: 'All Categories' }, ...categoryOptions]} className="sm:w-48" /></div></CardBody></Card>
      <Card>
        {filtered.length > 0 ? (
          <Table><TableHead><TableRow><TableHeader>Date</TableHeader><TableHeader>Project</TableHeader><TableHeader>Category</TableHeader><TableHeader>Vendor</TableHeader><TableHeader>Description</TableHeader><TableHeader>Amount</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>
            {filtered.map((exp) => (
              <TableRow key={exp.id}>
                <TableCell><span className="font-medium text-white">{format(new Date(exp.date), 'MMM d')}</span></TableCell>
                <TableCell className="text-slate-300">{getProjectName(exp.projectId)}</TableCell>
                <TableCell><span className="text-sm px-2 py-0.5 rounded bg-slate-700 text-slate-300">{exp.category}</span></TableCell>
                <TableCell className="text-slate-300">{exp.vendor || '-'}</TableCell>
                <TableCell><span className="text-slate-400 line-clamp-1">{exp.description || '-'}</span></TableCell>
                <TableCell className="text-white font-medium">${exp.amount?.toLocaleString()}</TableCell>
                <TableCell><div className="flex gap-1">
                  <button onClick={() => { setEditExpense(exp); setShowForm(true); }} className="p-1.5 hover:bg-slate-700 rounded"><Edit2 className="w-4 h-4 text-slate-400" /></button>
                  <button onClick={() => setDeleteTarget(exp)} className="p-1.5 hover:bg-red-500/20 rounded"><Trash2 className="w-4 h-4 text-red-400" /></button>
                </div></TableCell>
              </TableRow>
            ))}
          </TableBody></Table>
        ) : (<CardBody><EmptyState icon={Receipt} title="No expenses" action={<Button onClick={() => setShowForm(true)} icon={Plus}>Add Expense</Button>} /></CardBody>)}
      </Card>
      <Modal isOpen={showForm} onClose={() => { setShowForm(false); setEditExpense(null); }} title={editExpense ? 'Edit Expense' : 'Add Expense'}><ExpenseForm expense={editExpense} projects={projects} onSave={handleSave} onClose={() => { setShowForm(false); setEditExpense(null); }} /></Modal>
      <ConfirmDialog isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={() => deleteExpense?.(deleteTarget?.id)} title="Delete Expense" message="Delete this expense?" confirmText="Delete" variant="danger" />
    </div>
  );
}
