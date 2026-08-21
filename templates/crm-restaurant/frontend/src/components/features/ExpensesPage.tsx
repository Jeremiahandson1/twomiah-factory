import React, { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Search, Receipt, DollarSign, CreditCard, Truck, Edit2, Trash2, Camera } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardBody, Button, Input, Select, Modal, Textarea, Table, TableHead, TableBody, TableRow, TableHeader, TableCell, EmptyState, ConfirmDialog } from '../ui';
import { useCRMDataStore } from '../../stores/builderStore';

interface OutletContextType {
  instance: Record<string, unknown>;
}

const categoryOptions = [
  { value: 'materials', label: 'Materials' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'labor', label: 'Labor' },
  { value: 'subcontractor', label: 'Subcontractor' },
  { value: 'travel', label: 'Travel' },
  { value: 'supplies', label: 'Supplies' },
  { value: 'other', label: 'Other' },
];

interface ExpenseFormData {
  projectId: string;
  date: string;
  category: string;
  vendor: string;
  description: string;
  amount: string | number;
  receipt: string | null;
  reimbursable: boolean;
}

interface ExpenseFormProps {
  expense: Record<string, unknown> | null;
  projects: Record<string, unknown>[];
  onSave: (data: Record<string, unknown>) => void;
  onClose: () => void;
}

function ExpenseForm({ expense, projects, onSave, onClose }: ExpenseFormProps) {
  const [form, setForm] = useState<ExpenseFormData>((expense as unknown as ExpenseFormData) || {
    projectId: '', date: format(new Date(), 'yyyy-MM-dd'), category: 'materials',
    vendor: '', description: '', amount: '', receipt: null, reimbursable: false
  });
  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); onSave({ ...form, amount: Number(form.amount) || 0 }); onClose(); };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Select label="Project" value={form.projectId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, projectId: e.target.value })} options={projects.map((p: Record<string, unknown>) => ({ value: p.id as string, label: p.name as string }))} placeholder="Select project" />
        <Input label="Date" type="date" value={form.date} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, date: e.target.value })} required />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Select label="Category" value={form.category} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, category: e.target.value })} options={categoryOptions} />
        <Input label="Vendor" value={form.vendor} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, vendor: e.target.value })} placeholder="Store or vendor name" />
      </div>
      <Textarea label="Description" value={form.description} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, description: e.target.value })} placeholder="What was purchased..." rows={2} />
      <Input label="Amount ($)" type="number" step="0.01" value={form.amount} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, amount: e.target.value })} required />
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.reimbursable} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, reimbursable: e.target.checked })} className="w-4 h-4 rounded border-slate-600 bg-slate-800" />
          <span className="text-sm text-slate-300">Reimbursable expense</span>
        </label>
        <Button type="button" variant="ghost" size="sm" icon={Camera}>Attach Receipt</Button>
      </div>
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{expense ? 'Update' : 'Add'} Expense</Button></div>
    </form>
  );
}

export function ExpensesPage() {
  const { instance } = useOutletContext<OutletContextType>();
  const { expenses = [], projects, addExpense, updateExpense, deleteExpense } = useCRMDataStore() as {
    expenses: Record<string, unknown>[];
    projects: Record<string, unknown>[];
    addExpense?: (data: Record<string, unknown>) => void;
    updateExpense?: (id: unknown, data: Record<string, unknown>) => void;
    deleteExpense?: (id: unknown) => void;
  };
  const [search, setSearch] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [showForm, setShowForm] = useState<boolean>(false);
  const [editExpense, setEditExpense] = useState<Record<string, unknown> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Record<string, unknown> | null>(null);
  const primaryColor = (instance.primaryColor as string) || '{{PRIMARY_COLOR}}';

  const filtered = useMemo(() => (expenses || []).filter((e: Record<string, unknown>) => {
    const matchesSearch = !search || (e.description as string)?.toLowerCase().includes(search.toLowerCase()) || (e.vendor as string)?.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = !categoryFilter || e.category === categoryFilter;
    return matchesSearch && matchesCategory;
  }), [expenses, search, categoryFilter]);

  const handleSave = (data: Record<string, unknown>) => { editExpense ? updateExpense?.(editExpense.id, data) : addExpense?.(data); setEditExpense(null); setShowForm(false); };
  const getProjectName = (id: string): string => (projects.find((p: Record<string, unknown>) => p.id === id)?.name as string) || 'Unassigned';

  const totalExpenses = expenses.reduce((s: number, e: Record<string, unknown>) => s + ((e.amount as number) || 0), 0);
  const byCategory = categoryOptions.reduce((acc: Record<string, number>, cat) => {
    acc[cat.value] = expenses.filter((e: Record<string, unknown>) => e.category === cat.value).reduce((s: number, e: Record<string, unknown>) => s + ((e.amount as number) || 0), 0);
    return acc;
  }, {} as Record<string, number>);

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
      <Card><CardBody className="p-4"><div className="flex flex-col sm:flex-row gap-4"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" /><input type="text" placeholder="Search expenses..." value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)} className="input pl-11" /></div><Select value={categoryFilter} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setCategoryFilter(e.target.value)} options={[{ value: '', label: 'All Categories' }, ...categoryOptions]} className="sm:w-48" /></div></CardBody></Card>
      <Card>
        {filtered.length > 0 ? (
          <Table><TableHead><TableRow><TableHeader>Date</TableHeader><TableHeader>Project</TableHeader><TableHeader>Category</TableHeader><TableHeader>Vendor</TableHeader><TableHeader>Description</TableHeader><TableHeader>Amount</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>
            {filtered.map((exp: Record<string, unknown>) => (
              <TableRow key={exp.id as string}>
                <TableCell><span className="font-medium text-white">{format(new Date(exp.date as string), 'MMM d')}</span></TableCell>
                <TableCell className="text-slate-300">{getProjectName(exp.projectId as string)}</TableCell>
                <TableCell><span className="text-sm px-2 py-0.5 rounded bg-slate-700 text-slate-300">{exp.category as string}</span></TableCell>
                <TableCell className="text-slate-300">{(exp.vendor as string) || '-'}</TableCell>
                <TableCell><span className="text-slate-400 line-clamp-1">{(exp.description as string) || '-'}</span></TableCell>
                <TableCell className="text-white font-medium">${(exp.amount as number)?.toLocaleString()}</TableCell>
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
