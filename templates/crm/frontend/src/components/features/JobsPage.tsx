import React, { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Search, Wrench, Clock, CheckCircle2, Calendar, Edit2, Trash2, Play, Pause, Check } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardHeader, CardBody, Button, Input, Select, Modal, Table, TableHead, TableBody, TableRow, TableHeader, TableCell, StatusBadge, EmptyState, ConfirmDialog } from '../ui';
import { useCRMDataStore } from '../../stores/builderStore';

const statusOptions = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

function JobForm({ job, projects, team, onSave, onClose }) {
  const [form, setForm] = useState(job || { title: '', projectId: '', status: 'scheduled', assignee: '', scheduledDate: '', estimatedHours: '' });
  const handleSubmit = (e) => { e.preventDefault(); onSave({ ...form, estimatedHours: Number(form.estimatedHours) || 0 }); onClose(); };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="Job Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
      <Select label="Project" value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} options={projects.map(p => ({ value: p.id, label: p.name }))} placeholder="Select project" />
      <Select label="Assignee" value={form.assignee} onChange={(e) => setForm({ ...form, assignee: e.target.value })} options={team.map(t => ({ value: t.name, label: t.name }))} placeholder="Select assignee" />
      <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={statusOptions} />
      <div className="grid grid-cols-2 gap-4">
        <Input label="Scheduled Date" type="date" value={form.scheduledDate} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} />
        <Input label="Est. Hours" type="number" value={form.estimatedHours} onChange={(e) => setForm({ ...form, estimatedHours: e.target.value })} />
      </div>
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{job ? 'Update' : 'Create'} Job</Button></div>
    </form>
  );
}

export function JobsPage() {
  const { instance } = useOutletContext();
  const { jobs, projects, teamMembers, addJob, updateJob, deleteJob } = useCRMDataStore();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editJob, setEditJob] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const primaryColor = instance.primaryColor || '#ec7619';

  const filtered = useMemo(() => jobs.filter(j => {
    const matchesSearch = !search || j.title.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = !statusFilter || j.status === statusFilter;
    return matchesSearch && matchesStatus;
  }), [jobs, search, statusFilter]);

  const handleSave = (data) => { editJob ? updateJob(editJob.id, data) : addJob(data); setEditJob(null); setShowForm(false); };
  const handleStatusChange = (job, newStatus) => updateJob(job.id, { status: newStatus });
  const getProjectName = (id) => projects.find(p => p.id === id)?.name || '-';

  const statusActions = {
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
          { label: 'Scheduled', value: jobs.filter(j => j.status === 'scheduled').length, icon: Calendar },
          { label: 'In Progress', value: jobs.filter(j => j.status === 'in_progress').length, icon: Clock },
          { label: 'Completed', value: jobs.filter(j => j.status === 'completed').length, icon: CheckCircle2 },
        ].map((stat, i) => (
          <Card key={i} className="p-4"><div className="flex items-center justify-between"><div><p className="text-xl font-bold text-white">{stat.value}</p><p className="text-sm text-slate-400">{stat.label}</p></div><stat.icon className="w-8 h-8" style={{ color: primaryColor }} /></div></Card>
        ))}
      </div>
      <Card><CardBody className="p-4"><div className="flex flex-col sm:flex-row gap-4"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" /><input type="text" placeholder="Search jobs..." value={search} onChange={(e) => setSearch(e.target.value)} className="input pl-11" /></div><Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} options={[{ value: '', label: 'All Status' }, ...statusOptions]} className="sm:w-48" /></div></CardBody></Card>
      <Card>
        {filtered.length > 0 ? (
          <Table><TableHead><TableRow><TableHeader>Job</TableHeader><TableHeader>Project</TableHeader><TableHeader>Assignee</TableHeader><TableHeader>Scheduled</TableHeader><TableHeader>Status</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>
            {filtered.map((j) => (
              <TableRow key={j.id}>
                <TableCell><span className="font-medium text-white">{j.title}</span><p className="text-xs text-slate-500">{j.estimatedHours}h estimated</p></TableCell>
                <TableCell className="text-slate-300">{getProjectName(j.projectId)}</TableCell>
                <TableCell className="text-slate-300">{j.assignee || '-'}</TableCell>
                <TableCell className="text-slate-300">{j.scheduledDate ? format(new Date(j.scheduledDate), 'MMM d, yyyy') : '-'}</TableCell>
                <TableCell><StatusBadge status={j.status} /></TableCell>
                <TableCell><div className="flex gap-1">{statusActions[j.status]?.map((a, i) => (<button key={i} onClick={() => handleStatusChange(j, a.status)} className={`p-1.5 hover:bg-slate-700 rounded ${a.color}`} title={a.label}><a.icon className="w-4 h-4" /></button>))}<button onClick={() => { setEditJob(j); setShowForm(true); }} className="p-1.5 hover:bg-slate-700 rounded"><Edit2 className="w-4 h-4 text-slate-400" /></button><button onClick={() => setDeleteTarget(j)} className="p-1.5 hover:bg-red-500/20 rounded"><Trash2 className="w-4 h-4 text-red-400" /></button></div></TableCell>
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
