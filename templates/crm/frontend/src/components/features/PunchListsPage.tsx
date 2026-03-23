import React, { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Search, ClipboardList, CheckCircle2, Circle, Clock, Edit2, Trash2, Check } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardBody, Button, Input, Select, Modal, Textarea, Table, TableHead, TableBody, TableRow, TableHeader, TableCell, StatusBadge, EmptyState, ConfirmDialog } from '../ui';
import { useCRMDataStore } from '../../stores/builderStore';

interface OutletContextType {
  instance: Record<string, unknown>;
}

const statusOptions = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'verified', label: 'Verified' },
];

interface PunchListFormData {
  projectId: string;
  description: string;
  location: string;
  assignee: string;
  priority: string;
  status: string;
  createdAt?: string;
}

interface PunchListFormProps {
  item: Record<string, unknown> | null;
  projects: Record<string, unknown>[];
  team: Record<string, unknown>[];
  onSave: (data: Record<string, unknown>) => void;
  onClose: () => void;
}

function PunchListForm({ item, projects, team, onSave, onClose }: PunchListFormProps) {
  const [form, setForm] = useState<PunchListFormData>((item as unknown as PunchListFormData) || { projectId: '', description: '', location: '', assignee: '', priority: 'medium', status: 'open' });
  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); onSave({ ...form, createdAt: item?.createdAt || new Date().toISOString() }); onClose(); };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Select label="Project" value={form.projectId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, projectId: e.target.value })} options={projects.map((p: Record<string, unknown>) => ({ value: p.id as string, label: p.name as string }))} placeholder="Select project" required />
      <Textarea label="Description" value={form.description} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, description: e.target.value })} placeholder="Describe the punch list item..." rows={3} required />
      <Input label="Location" value={form.location} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, location: e.target.value })} placeholder="e.g. Kitchen, Room 201" />
      <Select label="Assignee" value={form.assignee} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, assignee: e.target.value })} options={team.map((t: Record<string, unknown>) => ({ value: t.name as string, label: t.name as string }))} placeholder="Assign to..." />
      <div className="grid grid-cols-2 gap-4">
        <Select label="Priority" value={form.priority} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, priority: e.target.value })} options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]} />
        <Select label="Status" value={form.status} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, status: e.target.value })} options={statusOptions} />
      </div>
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{item ? 'Update' : 'Add'} Item</Button></div>
    </form>
  );
}

export function PunchListsPage() {
  const { instance } = useOutletContext<OutletContextType>();
  const store = useCRMDataStore();
  const punchListItems = store.punchListItems as Record<string, unknown>[];
  const projects = store.projects as Record<string, unknown>[];
  const teamMembers = store.teamMembers as Record<string, unknown>[];
  const addPunchListItem = store.addPunchListItem as (data: Record<string, unknown>) => void;
  const updatePunchListItem = store.updatePunchListItem as (id: unknown, data: Record<string, unknown>) => void;
  const deletePunchListItem = store.deletePunchListItem as (id: unknown) => void;
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [showForm, setShowForm] = useState<boolean>(false);
  const [editItem, setEditItem] = useState<Record<string, unknown> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Record<string, unknown> | null>(null);
  const primaryColor = (instance.primaryColor as string) || '{{PRIMARY_COLOR}}';

  const filtered = useMemo(() => punchListItems.filter((i: Record<string, unknown>) => {
    const matchesSearch = !search || (i.description as string)?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = !statusFilter || i.status === statusFilter;
    return matchesSearch && matchesStatus;
  }), [punchListItems, search, statusFilter]);

  const handleSave = (data: Record<string, unknown>) => { editItem ? updatePunchListItem(editItem.id, data) : addPunchListItem(data); setEditItem(null); setShowForm(false); };
  const handleComplete = (item: Record<string, unknown>) => updatePunchListItem(item.id, { status: 'completed' });
  const getProjectName = (id: string) => (projects.find((p: Record<string, unknown>) => p.id === id)?.name as string) || '-';

  const priorityColors: Record<string, string> = { high: 'text-red-400', medium: 'text-amber-400', low: 'text-slate-400' };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-white">Punch Lists</h1><p className="text-slate-400 mt-1">Track completion items</p></div>
        <Button onClick={() => setShowForm(true)} icon={Plus}>Add Item</Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Items', value: punchListItems.length, icon: ClipboardList },
          { label: 'Open', value: punchListItems.filter((i: Record<string, unknown>) => i.status === 'open').length, icon: Circle },
          { label: 'In Progress', value: punchListItems.filter((i: Record<string, unknown>) => i.status === 'in_progress').length, icon: Clock },
          { label: 'Completed', value: punchListItems.filter((i: Record<string, unknown>) => ['completed', 'verified'].includes(i.status as string)).length, icon: CheckCircle2 },
        ].map((stat, i) => (
          <Card key={i} className="p-4"><div className="flex items-center justify-between"><div><p className="text-xl font-bold text-white">{stat.value}</p><p className="text-sm text-slate-400">{stat.label}</p></div><stat.icon className="w-8 h-8" style={{ color: primaryColor }} /></div></Card>
        ))}
      </div>
      <Card><CardBody className="p-4"><div className="flex flex-col sm:flex-row gap-4"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" /><input type="text" placeholder="Search items..." value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)} className="input pl-11" /></div><Select value={statusFilter} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setStatusFilter(e.target.value)} options={[{ value: '', label: 'All Status' }, ...statusOptions]} className="sm:w-48" /></div></CardBody></Card>
      <Card>
        {filtered.length > 0 ? (
          <Table><TableHead><TableRow><TableHeader>Description</TableHeader><TableHeader>Project</TableHeader><TableHeader>Location</TableHeader><TableHeader>Assignee</TableHeader><TableHeader>Priority</TableHeader><TableHeader>Status</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>
            {filtered.map((item: Record<string, unknown>) => (
              <TableRow key={item.id as string}>
                <TableCell><span className="text-slate-300">{item.description as string}</span></TableCell>
                <TableCell className="text-slate-400">{getProjectName(item.projectId as string)}</TableCell>
                <TableCell className="text-slate-400">{(item.location as string) || '-'}</TableCell>
                <TableCell className="text-slate-300">{(item.assignee as string) || '-'}</TableCell>
                <TableCell><span className={`text-sm font-medium ${priorityColors[item.priority as string]}`}>{item.priority as string}</span></TableCell>
                <TableCell><StatusBadge status={item.status as string} /></TableCell>
                <TableCell><div className="flex gap-1">
                  {item.status !== 'completed' && item.status !== 'verified' && <button onClick={() => handleComplete(item)} className="p-1.5 hover:bg-emerald-500/20 rounded text-emerald-400" title="Complete"><Check className="w-4 h-4" /></button>}
                  <button onClick={() => { setEditItem(item); setShowForm(true); }} className="p-1.5 hover:bg-slate-700 rounded"><Edit2 className="w-4 h-4 text-slate-400" /></button>
                  <button onClick={() => setDeleteTarget(item)} className="p-1.5 hover:bg-red-500/20 rounded"><Trash2 className="w-4 h-4 text-red-400" /></button>
                </div></TableCell>
              </TableRow>
            ))}
          </TableBody></Table>
        ) : (<CardBody><EmptyState icon={ClipboardList} title="No punch list items" action={<Button onClick={() => setShowForm(true)} icon={Plus}>Add Item</Button>} /></CardBody>)}
      </Card>
      <Modal isOpen={showForm} onClose={() => { setShowForm(false); setEditItem(null); }} title={editItem ? 'Edit Item' : 'New Punch List Item'}><PunchListForm item={editItem} projects={projects} team={teamMembers} onSave={handleSave} onClose={() => { setShowForm(false); setEditItem(null); }} /></Modal>
      <ConfirmDialog isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={() => deletePunchListItem(deleteTarget?.id)} title="Delete Item" message="Delete this punch list item?" confirmText="Delete" variant="danger" />
    </div>
  );
}
