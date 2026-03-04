import React, { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Search, FileQuestion, Clock, CheckCircle2, MessageSquare, Edit2, Trash2, Send, Reply } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardBody, Button, Input, Select, Modal, Textarea, Table, TableHead, TableBody, TableRow, TableHeader, TableCell, StatusBadge, EmptyState, ConfirmDialog } from '../ui';
import { useCRMDataStore } from '../../stores/builderStore';

const statusOptions = [
  { value: 'draft', label: 'Draft' },
  { value: 'open', label: 'Open' },
  { value: 'responded', label: 'Responded' },
  { value: 'closed', label: 'Closed' },
];

function RFIForm({ rfi, projects, onSave, onClose }) {
  const [form, setForm] = useState(rfi || { projectId: '', subject: '', description: '', status: 'draft', dueDate: '', response: '' });
  const handleSubmit = (e) => { e.preventDefault(); onSave({ ...form, createdAt: rfi?.createdAt || new Date().toISOString() }); onClose(); };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Select label="Project" value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} options={projects.map(p => ({ value: p.id, label: p.name }))} placeholder="Select project" required />
      <Input label="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Brief description of the question" required />
      <Textarea label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Full details of the RFI..." rows={4} />
      <Input label="Due Date" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
      <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={statusOptions} />
      {(form.status === 'responded' || form.status === 'closed') && (
        <Textarea label="Response" value={form.response} onChange={(e) => setForm({ ...form, response: e.target.value })} placeholder="Response to the RFI..." rows={4} />
      )}
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{rfi ? 'Update' : 'Create'} RFI</Button></div>
    </form>
  );
}

export function RFIsPage() {
  const { instance } = useOutletContext();
  const { rfis, projects, addRFI, updateRFI, deleteRFI } = useCRMDataStore();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editRFI, setEditRFI] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const primaryColor = instance.primaryColor || '#ec7619';

  const filtered = useMemo(() => rfis.filter(r => {
    const matchesSearch = !search || r.subject?.toLowerCase().includes(search.toLowerCase()) || r.number?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = !statusFilter || r.status === statusFilter;
    return matchesSearch && matchesStatus;
  }), [rfis, search, statusFilter]);

  const handleSave = (data) => { editRFI ? updateRFI(editRFI.id, data) : addRFI(data); setEditRFI(null); setShowForm(false); };
  const handleSubmitRFI = (rfi) => updateRFI(rfi.id, { status: 'open' });
  const getProjectName = (id) => projects.find(p => p.id === id)?.name || '-';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-white">RFIs</h1><p className="text-slate-400 mt-1">Request for Information tracking</p></div>
        <Button onClick={() => setShowForm(true)} icon={Plus}>New RFI</Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total RFIs', value: rfis.length, icon: FileQuestion },
          { label: 'Open', value: rfis.filter(r => r.status === 'open').length, icon: Clock },
          { label: 'Responded', value: rfis.filter(r => r.status === 'responded').length, icon: Reply },
          { label: 'Closed', value: rfis.filter(r => r.status === 'closed').length, icon: CheckCircle2 },
        ].map((stat, i) => (
          <Card key={i} className="p-4"><div className="flex items-center justify-between"><div><p className="text-xl font-bold text-white">{stat.value}</p><p className="text-sm text-slate-400">{stat.label}</p></div><stat.icon className="w-8 h-8" style={{ color: primaryColor }} /></div></Card>
        ))}
      </div>
      <Card><CardBody className="p-4"><div className="flex flex-col sm:flex-row gap-4"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" /><input type="text" placeholder="Search RFIs..." value={search} onChange={(e) => setSearch(e.target.value)} className="input pl-11" /></div><Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} options={[{ value: '', label: 'All Status' }, ...statusOptions]} className="sm:w-48" /></div></CardBody></Card>
      <Card>
        {filtered.length > 0 ? (
          <Table><TableHead><TableRow><TableHeader>RFI #</TableHeader><TableHeader>Subject</TableHeader><TableHeader>Project</TableHeader><TableHeader>Status</TableHeader><TableHeader>Due Date</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>
            {filtered.map((rfi) => (
              <TableRow key={rfi.id}>
                <TableCell><span className="font-medium text-white">{rfi.number}</span></TableCell>
                <TableCell><span className="text-slate-300">{rfi.subject}</span></TableCell>
                <TableCell className="text-slate-400">{getProjectName(rfi.projectId)}</TableCell>
                <TableCell><StatusBadge status={rfi.status} /></TableCell>
                <TableCell className="text-slate-300">{rfi.dueDate ? format(new Date(rfi.dueDate), 'MMM d, yyyy') : '-'}</TableCell>
                <TableCell><div className="flex gap-1">
                  {rfi.status === 'draft' && <button onClick={() => handleSubmitRFI(rfi)} className="p-1.5 hover:bg-slate-700 rounded text-blue-400" title="Submit"><Send className="w-4 h-4" /></button>}
                  <button onClick={() => { setEditRFI(rfi); setShowForm(true); }} className="p-1.5 hover:bg-slate-700 rounded"><Edit2 className="w-4 h-4 text-slate-400" /></button>
                  <button onClick={() => setDeleteTarget(rfi)} className="p-1.5 hover:bg-red-500/20 rounded"><Trash2 className="w-4 h-4 text-red-400" /></button>
                </div></TableCell>
              </TableRow>
            ))}
          </TableBody></Table>
        ) : (<CardBody><EmptyState icon={FileQuestion} title="No RFIs found" action={<Button onClick={() => setShowForm(true)} icon={Plus}>New RFI</Button>} /></CardBody>)}
      </Card>
      <Modal isOpen={showForm} onClose={() => { setShowForm(false); setEditRFI(null); }} title={editRFI ? 'Edit RFI' : 'New RFI'} size="lg"><RFIForm rfi={editRFI} projects={projects} onSave={handleSave} onClose={() => { setShowForm(false); setEditRFI(null); }} /></Modal>
      <ConfirmDialog isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={() => deleteRFI(deleteTarget?.id)} title="Delete RFI" message={`Delete "${deleteTarget?.number}"?`} confirmText="Delete" variant="danger" />
    </div>
  );
}
