import React, { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Search, FileQuestion, Clock, CheckCircle2, MessageSquare, Edit2, Trash2, Send, Reply } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardBody, Button, Input, Select, Modal, Textarea, Table, TableHead, TableBody, TableRow, TableHeader, TableCell, StatusBadge, EmptyState, ConfirmDialog } from '../ui';
import { useCRMDataStore } from '../../stores/builderStore';

interface OutletContextType {
  instance: Record<string, unknown>;
}

const statusOptions = [
  { value: 'draft', label: 'Draft' },
  { value: 'open', label: 'Open' },
  { value: 'responded', label: 'Responded' },
  { value: 'closed', label: 'Closed' },
];

interface RFIFormData {
  projectId: string;
  subject: string;
  description: string;
  status: string;
  dueDate: string;
  response: string;
  createdAt?: string;
}

interface RFIFormProps {
  rfi: Record<string, unknown> | null;
  projects: Record<string, unknown>[];
  onSave: (data: Record<string, unknown>) => void;
  onClose: () => void;
}

function RFIForm({ rfi, projects, onSave, onClose }: RFIFormProps) {
  const [form, setForm] = useState<RFIFormData>((rfi as unknown as RFIFormData) || { projectId: '', subject: '', description: '', status: 'draft', dueDate: '', response: '' });
  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); onSave({ ...form, createdAt: rfi?.createdAt || new Date().toISOString() }); onClose(); };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Select label="Project" value={form.projectId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, projectId: e.target.value })} options={projects.map((p: Record<string, unknown>) => ({ value: p.id as string, label: p.name as string }))} placeholder="Select project" required />
      <Input label="Subject" value={form.subject} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, subject: e.target.value })} placeholder="Brief description of the question" required />
      <Textarea label="Description" value={form.description} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, description: e.target.value })} placeholder="Full details of the RFI..." rows={4} />
      <Input label="Due Date" type="date" value={form.dueDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, dueDate: e.target.value })} />
      <Select label="Status" value={form.status} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, status: e.target.value })} options={statusOptions} />
      {(form.status === 'responded' || form.status === 'closed') && (
        <Textarea label="Response" value={form.response} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, response: e.target.value })} placeholder="Response to the RFI..." rows={4} />
      )}
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{rfi ? 'Update' : 'Create'} RFI</Button></div>
    </form>
  );
}

export function RFIsPage() {
  const { instance } = useOutletContext<OutletContextType>();
  const { rfis, projects, addRFI, updateRFI, deleteRFI } = useCRMDataStore() as {
    rfis: Record<string, unknown>[];
    projects: Record<string, unknown>[];
    addRFI: (data: Record<string, unknown>) => void;
    updateRFI: (id: unknown, updates: Record<string, unknown>) => void;
    deleteRFI: (id: unknown) => void;
  };
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [showForm, setShowForm] = useState<boolean>(false);
  const [editRFI, setEditRFI] = useState<Record<string, unknown> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Record<string, unknown> | null>(null);
  const primaryColor = (instance.primaryColor as string) || '{{PRIMARY_COLOR}}';

  const filtered = useMemo(() => rfis.filter((r: Record<string, unknown>) => {
    const matchesSearch = !search || (r.subject as string)?.toLowerCase().includes(search.toLowerCase()) || (r.number as string)?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = !statusFilter || r.status === statusFilter;
    return matchesSearch && matchesStatus;
  }), [rfis, search, statusFilter]);

  const handleSave = (data: Record<string, unknown>) => { editRFI ? updateRFI(editRFI.id, data) : addRFI(data); setEditRFI(null); setShowForm(false); };
  const handleSubmitRFI = (rfi: Record<string, unknown>) => updateRFI(rfi.id, { status: 'open' });
  const getProjectName = (id: string): string => (projects.find((p: Record<string, unknown>) => p.id === id)?.name as string) || '-';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-white">RFIs</h1><p className="text-slate-400 mt-1">Request for Information tracking</p></div>
        <Button onClick={() => setShowForm(true)} icon={Plus}>New RFI</Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total RFIs', value: rfis.length, icon: FileQuestion },
          { label: 'Open', value: rfis.filter((r: Record<string, unknown>) => r.status === 'open').length, icon: Clock },
          { label: 'Responded', value: rfis.filter((r: Record<string, unknown>) => r.status === 'responded').length, icon: Reply },
          { label: 'Closed', value: rfis.filter((r: Record<string, unknown>) => r.status === 'closed').length, icon: CheckCircle2 },
        ].map((stat, i) => (
          <Card key={i} className="p-4"><div className="flex items-center justify-between"><div><p className="text-xl font-bold text-white">{stat.value}</p><p className="text-sm text-slate-400">{stat.label}</p></div><stat.icon className="w-8 h-8" style={{ color: primaryColor }} /></div></Card>
        ))}
      </div>
      <Card><CardBody className="p-4"><div className="flex flex-col sm:flex-row gap-4"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" /><input type="text" placeholder="Search RFIs..." value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)} className="input pl-11" /></div><Select value={statusFilter} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setStatusFilter(e.target.value)} options={[{ value: '', label: 'All Status' }, ...statusOptions]} className="sm:w-48" /></div></CardBody></Card>
      <Card>
        {filtered.length > 0 ? (
          <Table><TableHead><TableRow><TableHeader>RFI #</TableHeader><TableHeader>Subject</TableHeader><TableHeader>Project</TableHeader><TableHeader>Status</TableHeader><TableHeader>Due Date</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>
            {filtered.map((rfi: Record<string, unknown>) => (
              <TableRow key={rfi.id as string}>
                <TableCell><span className="font-medium text-white">{rfi.number as string}</span></TableCell>
                <TableCell><span className="text-slate-300">{rfi.subject as string}</span></TableCell>
                <TableCell className="text-slate-400">{getProjectName(rfi.projectId as string)}</TableCell>
                <TableCell><StatusBadge status={rfi.status as string} /></TableCell>
                <TableCell className="text-slate-300">{rfi.dueDate ? format(new Date(rfi.dueDate as string), 'MMM d, yyyy') : '-'}</TableCell>
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
