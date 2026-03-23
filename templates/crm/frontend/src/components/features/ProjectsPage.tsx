import React, { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Search, FolderOpen, Calendar, DollarSign, BarChart3, Edit2, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardHeader, CardBody, Button, Input, Select, Modal, Table, TableHead, TableBody, TableRow, TableHeader, TableCell, StatusBadge, EmptyState, ConfirmDialog } from '../ui';
import { useCRMDataStore } from '../../stores/builderStore';

interface OutletContextType {
  instance: Record<string, unknown>;
}

const statusOptions = [
  { value: 'draft', label: 'Draft' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'completed', label: 'Completed' },
];

interface ProjectFormData {
  name: string;
  client: string;
  status: string;
  budget: string | number;
  startDate: string;
  endDate: string;
  progress?: number;
  spent?: number;
}

interface ProjectFormProps {
  project: Record<string, unknown> | null;
  clients: Record<string, unknown>[];
  onSave: (data: Record<string, unknown>) => void;
  onClose: () => void;
}

function ProjectForm({ project, clients, onSave, onClose }: ProjectFormProps) {
  const [form, setForm] = useState<ProjectFormData>((project as unknown as ProjectFormData) || {
    name: '', client: '', status: 'draft', budget: '', startDate: '', endDate: ''
  });
  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); onSave({ ...form, budget: Number(form.budget) || 0, progress: project?.progress || 0, spent: project?.spent || 0 }); onClose(); };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="Project Name" value={form.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, name: e.target.value })} required />
      <Select label="Client" value={form.client} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, client: e.target.value })} options={clients.map((c: Record<string, unknown>) => ({ value: c.id as string, label: c.name as string }))} placeholder="Select client" />
      <Select label="Status" value={form.status} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, status: e.target.value })} options={statusOptions} />
      <Input label="Budget ($)" type="number" value={form.budget} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, budget: e.target.value })} />
      <div className="grid grid-cols-2 gap-4">
        <Input label="Start Date" type="date" value={form.startDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, startDate: e.target.value })} />
        <Input label="End Date" type="date" value={form.endDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, endDate: e.target.value })} />
      </div>
      <div className="flex justify-end gap-3 pt-4">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit">{project ? 'Update' : 'Create'} Project</Button>
      </div>
    </form>
  );
}

export function ProjectsPage() {
  const { instance } = useOutletContext<OutletContextType>();
  const store = useCRMDataStore();
  const projects = store.projects as Record<string, unknown>[];
  const contacts = store.contacts as Record<string, unknown>[];
  const addProject = store.addProject as (data: Record<string, unknown>) => void;
  const updateProject = store.updateProject as (id: unknown, data: Record<string, unknown>) => void;
  const deleteProject = store.deleteProject as (id: unknown) => void;
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [showForm, setShowForm] = useState<boolean>(false);
  const [editProject, setEditProject] = useState<Record<string, unknown> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Record<string, unknown> | null>(null);
  const primaryColor = (instance.primaryColor as string) || '{{PRIMARY_COLOR}}';
  const clients = contacts.filter((c: Record<string, unknown>) => c.type === 'client');

  const filtered = useMemo(() => projects.filter((p: Record<string, unknown>) => {
    const matchesSearch = !search || (p.name as string).toLowerCase().includes(search.toLowerCase());
    const matchesStatus = !statusFilter || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  }), [projects, search, statusFilter]);

  const handleSave = (data: Record<string, unknown>) => { editProject ? updateProject(editProject.id, data) : addProject(data); setEditProject(null); setShowForm(false); };
  const getClientName = (id: string) => (contacts.find((c: Record<string, unknown>) => c.id === id)?.name as string) || 'Unknown';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-white">Projects</h1><p className="text-slate-400 mt-1">{projects.length} total projects</p></div>
        <Button onClick={() => setShowForm(true)} icon={Plus}>New Project</Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Projects', value: projects.length, icon: FolderOpen },
          { label: 'In Progress', value: projects.filter((p: Record<string, unknown>) => p.status === 'in_progress').length, icon: BarChart3 },
          { label: 'Total Budget', value: '$' + projects.reduce((s: number, p: Record<string, unknown>) => s + (p.budget as number), 0).toLocaleString(), icon: DollarSign },
          { label: 'Total Spent', value: '$' + projects.reduce((s: number, p: Record<string, unknown>) => s + (p.spent as number), 0).toLocaleString(), icon: DollarSign },
        ].map((stat, i) => (
          <Card key={i} className="p-4"><div className="flex items-center justify-between"><div><p className="text-xl font-bold text-white">{stat.value}</p><p className="text-sm text-slate-400">{stat.label}</p></div><stat.icon className="w-8 h-8" style={{ color: primaryColor }} /></div></Card>
        ))}
      </div>
      <Card><CardBody className="p-4"><div className="flex flex-col sm:flex-row gap-4"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" /><input type="text" placeholder="Search projects..." value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)} className="input pl-11" /></div><Select value={statusFilter} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setStatusFilter(e.target.value)} options={[{ value: '', label: 'All Status' }, ...statusOptions]} className="sm:w-48" /></div></CardBody></Card>
      <Card>
        {filtered.length > 0 ? (
          <Table><TableHead><TableRow><TableHeader>Project</TableHeader><TableHeader>Client</TableHeader><TableHeader>Status</TableHeader><TableHeader>Progress</TableHeader><TableHeader>Budget</TableHeader><TableHeader className="w-16"></TableHeader></TableRow></TableHead><TableBody>
            {filtered.map((p: Record<string, unknown>) => (
              <TableRow key={p.id as string}>
                <TableCell><span className="font-medium text-white">{p.name as string}</span><p className="text-xs text-slate-500">{p.startDate ? format(new Date(p.startDate as string), 'MMM d') : ''} - {p.endDate ? format(new Date(p.endDate as string), 'MMM d, yyyy') : ''}</p></TableCell>
                <TableCell className="text-slate-300">{getClientName(p.client as string)}</TableCell>
                <TableCell><StatusBadge status={p.status as string} /></TableCell>
                <TableCell><div className="w-24"><div className="flex items-center justify-between text-xs mb-1"><span className="text-slate-400">Progress</span><span className="text-white">{p.progress as number}%</span></div><div className="h-1.5 bg-slate-700 rounded-full"><div className="h-full rounded-full" style={{ width: `${p.progress}%`, backgroundColor: primaryColor }} /></div></div></TableCell>
                <TableCell><span className="text-white">${(p.budget as number)?.toLocaleString()}</span><p className="text-xs text-slate-500">${(p.spent as number)?.toLocaleString()} spent</p></TableCell>
                <TableCell><div className="flex gap-1"><button onClick={() => { setEditProject(p); setShowForm(true); }} className="p-1.5 hover:bg-slate-700 rounded"><Edit2 className="w-4 h-4 text-slate-400" /></button><button onClick={() => setDeleteTarget(p)} className="p-1.5 hover:bg-red-500/20 rounded"><Trash2 className="w-4 h-4 text-red-400" /></button></div></TableCell>
              </TableRow>
            ))}
          </TableBody></Table>
        ) : (<CardBody><EmptyState icon={FolderOpen} title="No projects found" description="Create your first project" action={<Button onClick={() => setShowForm(true)} icon={Plus}>New Project</Button>} /></CardBody>)}
      </Card>
      <Modal isOpen={showForm} onClose={() => { setShowForm(false); setEditProject(null); }} title={editProject ? 'Edit Project' : 'New Project'}><ProjectForm project={editProject} clients={clients} onSave={handleSave} onClose={() => { setShowForm(false); setEditProject(null); }} /></Modal>
      <ConfirmDialog isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={() => deleteProject(deleteTarget?.id)} title="Delete Project" message={`Delete "${deleteTarget?.name}"?`} confirmText="Delete" variant="danger" />
    </div>
  );
}
