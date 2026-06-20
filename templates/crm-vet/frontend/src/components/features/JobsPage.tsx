import React, { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Search, Wrench, Clock, CheckCircle2, Calendar, Edit2, Trash2, Play, Pause, Check } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardHeader, CardBody, Button, Input, Select, Modal, Table, TableHead, TableBody, TableRow, TableHeader, TableCell, StatusBadge, EmptyState, ConfirmDialog } from '../ui';
import { useCRMDataStore } from '../../stores/builderStore';

interface OutletContextType {
  instance: Record<string, unknown>;
}

const statusOptions = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

interface JobFormData {
  title: string;
  projectId: string;
  status: string;
  assignee: string;
  scheduledDate: string;
  estimatedHours: string | number;
}

interface JobFormProps {
  job: Record<string, unknown> | null;
  projects: Record<string, unknown>[];
  team: Record<string, unknown>[];
  onSave: (data: Record<string, unknown>) => void;
  onClose: () => void;
}

function JobForm({ job, projects, team, onSave, onClose }: JobFormProps) {
  const [form, setForm] = useState<JobFormData>((job as unknown as JobFormData) || { title: '', projectId: '', status: 'scheduled', assignee: '', scheduledDate: '', estimatedHours: '' });
  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); onSave({ ...form, estimatedHours: Number(form.estimatedHours) || 0 }); onClose(); };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="Job Title" value={form.title} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, title: e.target.value })} required />
      <Select label="Project" value={form.projectId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, projectId: e.target.value })} options={projects.map((p: Record<string, unknown>) => ({ value: p.id as string, label: p.name as string }))} placeholder="Select project" />
      <Select label="Assignee" value={form.assignee} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, assignee: e.target.value })} options={team.map((t: Record<string, unknown>) => ({ value: t.name as string, label: t.name as string }))} placeholder="Select assignee" />
      <Select label="Status" value={form.status} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, status: e.target.value })} options={statusOptions} />
      <div className="grid grid-cols-2 gap-4">
        <Input label="Scheduled Date" type="date" value={form.scheduledDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, scheduledDate: e.target.value })} />
        <Input label="Est. Hours" type="number" value={form.estimatedHours} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, estimatedHours: e.target.value })} />
      </div>
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{job ? 'Update' : 'Create'} Job</Button></div>
    </form>
  );
}

interface StatusAction {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  status: string;
  color: string;
}

export function JobsPage() {
  const { instance } = useOutletContext<OutletContextType>();
  const store = useCRMDataStore();
  const jobs = store.jobs as Record<string, unknown>[];
  const projects = store.projects as Record<string, unknown>[];
  const teamMembers = store.teamMembers as Record<string, unknown>[];
  const addJob = store.addJob as (data: Record<string, unknown>) => void;
  const updateJob = store.updateJob as (id: unknown, data: Record<string, unknown>) => void;
  const deleteJob = store.deleteJob as (id: unknown) => void;
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [showForm, setShowForm] = useState<boolean>(false);
  const [editJob, setEditJob] = useState<Record<string, unknown> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Record<string, unknown> | null>(null);
  const primaryColor = (instance.primaryColor as string) || '{{PRIMARY_COLOR}}';

  const filtered = useMemo(() => jobs.filter((j: Record<string, unknown>) => {
    const matchesSearch = !search || (j.title as string).toLowerCase().includes(search.toLowerCase());
    const matchesStatus = !statusFilter || j.status === statusFilter;
    return matchesSearch && matchesStatus;
  }), [jobs, search, statusFilter]);

  const handleSave = (data: Record<string, unknown>) => { editJob ? updateJob(editJob.id, data) : addJob(data); setEditJob(null); setShowForm(false); };
  const handleStatusChange = (job: Record<string, unknown>, newStatus: string) => updateJob(job.id, { status: newStatus });
  const getProjectName = (id: string) => (projects.find((p: Record<string, unknown>) => p.id === id)?.name as string) || '-';

  const statusActions: Record<string, StatusAction[]> = {
    scheduled: [{ label: 'Start', icon: Play, status: 'in_progress', color: 'text-blue-400' }],
    in_progress: [{ label: 'Complete', icon: Check, status: 'completed', color: 'text-emerald-400' }, { label: 'Pause', icon: Pause, status: 'scheduled', color: 'text-amber-400' }],
    completed: [],
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-white">Jobs</h1><p className="text-slate-400 mt-1">{jobs.length} total jobs</p></div>
        <Button onClick={() => setShowForm(true)} icon={Plus}>New Job</Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Jobs', value: jobs.length, icon: Wrench },
          { label: 'Scheduled', value: jobs.filter((j: Record<string, unknown>) => j.status === 'scheduled').length, icon: Calendar },
          { label: 'In Progress', value: jobs.filter((j: Record<string, unknown>) => j.status === 'in_progress').length, icon: Clock },
          { label: 'Completed', value: jobs.filter((j: Record<string, unknown>) => j.status === 'completed').length, icon: CheckCircle2 },
        ].map((stat, i) => (
          <Card key={i} className="p-4"><div className="flex items-center justify-between"><div><p className="text-xl font-bold text-white">{stat.value}</p><p className="text-sm text-slate-400">{stat.label}</p></div><stat.icon className="w-8 h-8" style={{ color: primaryColor }} /></div></Card>
        ))}
      </div>
      <Card><CardBody className="p-4"><div className="flex flex-col sm:flex-row gap-4"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" /><input type="text" placeholder="Search jobs..." value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)} className="input pl-11" /></div><Select value={statusFilter} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setStatusFilter(e.target.value)} options={[{ value: '', label: 'All Status' }, ...statusOptions]} className="sm:w-48" /></div></CardBody></Card>
      <Card>
        {filtered.length > 0 ? (
          <Table><TableHead><TableRow><TableHeader>Job</TableHeader><TableHeader>Project</TableHeader><TableHeader>Assignee</TableHeader><TableHeader>Scheduled</TableHeader><TableHeader>Status</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>
            {filtered.map((j: Record<string, unknown>) => (
              <TableRow key={j.id as string}>
                <TableCell><span className="font-medium text-white">{j.title as string}</span><p className="text-xs text-slate-500">{j.estimatedHours as number}h estimated</p></TableCell>
                <TableCell className="text-slate-300">{getProjectName(j.projectId as string)}</TableCell>
                <TableCell className="text-slate-300">{(j.assignee as string) || '-'}</TableCell>
                <TableCell className="text-slate-300">{j.scheduledDate ? format(new Date(j.scheduledDate as string), 'MMM d, yyyy') : '-'}</TableCell>
                <TableCell><StatusBadge status={j.status as string} /></TableCell>
                <TableCell><div className="flex gap-1">{(statusActions[j.status as string] || []).map((a: StatusAction, i: number) => (<button key={i} onClick={() => handleStatusChange(j, a.status)} className={`p-1.5 hover:bg-slate-700 rounded ${a.color}`} title={a.label}><a.icon className="w-4 h-4" /></button>))}<button onClick={() => { setEditJob(j); setShowForm(true); }} className="p-1.5 hover:bg-slate-700 rounded"><Edit2 className="w-4 h-4 text-slate-400" /></button><button onClick={() => setDeleteTarget(j)} className="p-1.5 hover:bg-red-500/20 rounded"><Trash2 className="w-4 h-4 text-red-400" /></button></div></TableCell>
              </TableRow>
            ))}
          </TableBody></Table>
        ) : (<CardBody><EmptyState icon={Wrench} title="No jobs found" description="Create your first job" action={<Button onClick={() => setShowForm(true)} icon={Plus}>New Job</Button>} /></CardBody>)}
      </Card>
      <Modal isOpen={showForm} onClose={() => { setShowForm(false); setEditJob(null); }} title={editJob ? 'Edit Job' : 'New Job'}><JobForm job={editJob} projects={projects} team={teamMembers} onSave={handleSave} onClose={() => { setShowForm(false); setEditJob(null); }} /></Modal>
      <ConfirmDialog isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={() => deleteJob(deleteTarget?.id)} title="Delete Job" message={`Delete "${deleteTarget?.title}"?`} confirmText="Delete" variant="danger" />
    </div>
  );
}
