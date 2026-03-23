import React, { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Search, ShieldCheck, ClipboardCheck, Eye, AlertTriangle, CheckCircle2, Clock, Edit2, Trash2, Check } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardHeader, CardBody, Button, Input, Select, Modal, Textarea, Table, TableHead, TableBody, TableRow, TableHeader, TableCell, StatusBadge, EmptyState, ConfirmDialog, Tabs, TabsList, TabsTrigger, TabsContent } from '../ui';
import { useCRMDataStore } from '../../stores/builderStore';

interface OutletContextType {
  instance: Record<string, unknown>;
}

const inspectionStatusOptions = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'passed', label: 'Passed' },
  { value: 'failed', label: 'Failed' },
];

const severityOptions = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

const incidentTypeOptions = [
  { value: 'injury', label: 'Injury' },
  { value: 'near_miss', label: 'Near Miss' },
  { value: 'property_damage', label: 'Property Damage' },
  { value: 'environmental', label: 'Environmental' },
  { value: 'other', label: 'Other' },
];

interface InspectionFormData {
  projectId: string;
  type: string;
  inspector: string;
  scheduledDate: string;
  status: string;
  notes: string;
  result: string;
  createdAt?: string;
}

interface FormProps {
  item: Record<string, unknown> | null;
  projects: Record<string, unknown>[];
  onSave: (data: Record<string, unknown>) => void;
  onClose: () => void;
}

// INSPECTION FORM
function InspectionForm({ item, projects, onSave, onClose }: FormProps) {
  const [form, setForm] = useState<InspectionFormData>((item as unknown as InspectionFormData) || { projectId: '', type: '', inspector: '', scheduledDate: '', status: 'scheduled', notes: '', result: '' });
  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); onSave({ ...form, createdAt: item?.createdAt || new Date().toISOString() }); onClose(); };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Select label="Project" value={form.projectId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, projectId: e.target.value })} options={projects.map((p: Record<string, unknown>) => ({ value: p.id as string, label: p.name as string }))} placeholder="Select project" required />
      <Input label="Inspection Type" value={form.type} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, type: e.target.value })} placeholder="e.g. Framing, Electrical, Final" required />
      <div className="grid grid-cols-2 gap-4">
        <Input label="Inspector" value={form.inspector} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, inspector: e.target.value })} placeholder="Inspector name" />
        <Input label="Scheduled Date" type="date" value={form.scheduledDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, scheduledDate: e.target.value })} />
      </div>
      <Select label="Status" value={form.status} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, status: e.target.value })} options={inspectionStatusOptions} />
      <Textarea label="Notes" value={form.notes} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, notes: e.target.value })} rows={3} />
      {(form.status === 'passed' || form.status === 'failed') && (
        <Textarea label="Result Details" value={form.result} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, result: e.target.value })} placeholder="Inspection findings..." rows={3} />
      )}
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{item ? 'Update' : 'Schedule'}</Button></div>
    </form>
  );
}

interface ObservationFormData {
  projectId: string;
  location: string;
  description: string;
  severity: string;
  status: string;
  assignee: string;
  createdAt?: string;
}

// OBSERVATION FORM
function ObservationForm({ item, projects, onSave, onClose }: FormProps) {
  const [form, setForm] = useState<ObservationFormData>((item as unknown as ObservationFormData) || { projectId: '', location: '', description: '', severity: 'low', status: 'open', assignee: '' });
  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); onSave({ ...form, createdAt: item?.createdAt || new Date().toISOString() }); onClose(); };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Select label="Project" value={form.projectId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, projectId: e.target.value })} options={projects.map((p: Record<string, unknown>) => ({ value: p.id as string, label: p.name as string }))} placeholder="Select project" required />
      <Input label="Location" value={form.location} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, location: e.target.value })} placeholder="Where was this observed?" />
      <Textarea label="Description" value={form.description} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, description: e.target.value })} placeholder="Describe what you observed..." rows={3} required />
      <div className="grid grid-cols-2 gap-4">
        <Select label="Severity" value={form.severity} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, severity: e.target.value })} options={severityOptions} />
        <Select label="Status" value={form.status} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, status: e.target.value })} options={[{ value: 'open', label: 'Open' }, { value: 'in_review', label: 'In Review' }, { value: 'resolved', label: 'Resolved' }]} />
      </div>
      <Input label="Assigned To" value={form.assignee} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, assignee: e.target.value })} placeholder="Who should address this?" />
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{item ? 'Update' : 'Record'}</Button></div>
    </form>
  );
}

interface IncidentFormData {
  projectId: string;
  type: string;
  date: string;
  time: string;
  location: string;
  description: string;
  injuries: string;
  witnesses: string;
  actionTaken: string;
  status: string;
  createdAt?: string;
}

// INCIDENT FORM
function IncidentForm({ item, projects, onSave, onClose }: FormProps) {
  const [form, setForm] = useState<IncidentFormData>((item as unknown as IncidentFormData) || { projectId: '', type: 'near_miss', date: format(new Date(), 'yyyy-MM-dd'), time: '', location: '', description: '', injuries: '', witnesses: '', actionTaken: '', status: 'reported' });
  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); onSave({ ...form, createdAt: item?.createdAt || new Date().toISOString() }); onClose(); };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Select label="Project" value={form.projectId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, projectId: e.target.value })} options={projects.map((p: Record<string, unknown>) => ({ value: p.id as string, label: p.name as string }))} placeholder="Select project" required />
        <Select label="Incident Type" value={form.type} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, type: e.target.value })} options={incidentTypeOptions} />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Input label="Date" type="date" value={form.date} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, date: e.target.value })} required />
        <Input label="Time" type="time" value={form.time} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, time: e.target.value })} />
        <Input label="Location" value={form.location} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, location: e.target.value })} />
      </div>
      <Textarea label="Description" value={form.description} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, description: e.target.value })} placeholder="What happened?" rows={3} required />
      <div className="grid grid-cols-2 gap-4">
        <Input label="Injuries (if any)" value={form.injuries} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, injuries: e.target.value })} placeholder="Describe any injuries" />
        <Input label="Witnesses" value={form.witnesses} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, witnesses: e.target.value })} placeholder="Names of witnesses" />
      </div>
      <Textarea label="Action Taken" value={form.actionTaken} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, actionTaken: e.target.value })} placeholder="Immediate actions taken..." rows={2} />
      <Select label="Status" value={form.status} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, status: e.target.value })} options={[{ value: 'reported', label: 'Reported' }, { value: 'investigating', label: 'Investigating' }, { value: 'closed', label: 'Closed' }]} />
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{item ? 'Update' : 'Report'}</Button></div>
    </form>
  );
}

export function QualityPage() {
  const { instance } = useOutletContext<OutletContextType>();
  const store = useCRMDataStore();
  const projects = store.projects as Record<string, unknown>[];
  const inspections = (store.inspections || []) as Record<string, unknown>[];
  const observations = (store.observations || []) as Record<string, unknown>[];
  const incidents = (store.incidents || []) as Record<string, unknown>[];
  const addInspection = store.addInspection as ((item: Record<string, unknown>) => void) | undefined;
  const updateInspection = store.updateInspection as ((id: unknown, updates: Record<string, unknown>) => void) | undefined;
  const deleteInspection = store.deleteInspection as ((id: unknown) => void) | undefined;
  const addObservation = store.addObservation as ((item: Record<string, unknown>) => void) | undefined;
  const updateObservation = store.updateObservation as ((id: unknown, updates: Record<string, unknown>) => void) | undefined;
  const deleteObservation = store.deleteObservation as ((id: unknown) => void) | undefined;
  const addIncident = store.addIncident as ((item: Record<string, unknown>) => void) | undefined;
  const updateIncident = store.updateIncident as ((id: unknown, updates: Record<string, unknown>) => void) | undefined;
  const deleteIncident = store.deleteIncident as ((id: unknown) => void) | undefined;
  const [activeTab, setActiveTab] = useState<string>('inspections');
  const [search, setSearch] = useState<string>('');
  const [showForm, setShowForm] = useState<boolean>(false);
  const [editItem, setEditItem] = useState<Record<string, unknown> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Record<string, unknown> | null>(null);
  const primaryColor = (instance.primaryColor as string) || '{{PRIMARY_COLOR}}';

  const filteredInspections = useMemo(() => (inspections || []).filter((i: Record<string, unknown>) => !search || (i.type as string)?.toLowerCase().includes(search.toLowerCase())), [inspections, search]);
  const filteredObservations = useMemo(() => (observations || []).filter((o: Record<string, unknown>) => !search || (o.description as string)?.toLowerCase().includes(search.toLowerCase())), [observations, search]);
  const filteredIncidents = useMemo(() => (incidents || []).filter((i: Record<string, unknown>) => !search || (i.description as string)?.toLowerCase().includes(search.toLowerCase())), [incidents, search]);

  const getProjectName = (id: string): string => (projects.find((p: Record<string, unknown>) => p.id === id)?.name as string) || '-';
  const severityColors: Record<string, string> = { low: 'text-slate-400', medium: 'text-amber-400', high: 'text-orange-400', critical: 'text-red-400' };

  const handleSave = (data: Record<string, unknown>) => {
    if (activeTab === 'inspections') { editItem ? updateInspection?.(editItem.id, data) : addInspection?.(data); }
    else if (activeTab === 'observations') { editItem ? updateObservation?.(editItem.id, data) : addObservation?.(data); }
    else if (activeTab === 'incidents') { editItem ? updateIncident?.(editItem.id, data) : addIncident?.(data); }
    setEditItem(null); setShowForm(false);
  };

  const handleDelete = () => {
    if (activeTab === 'inspections') deleteInspection?.(deleteTarget?.id);
    else if (activeTab === 'observations') deleteObservation?.(deleteTarget?.id);
    else if (activeTab === 'incidents') deleteIncident?.(deleteTarget?.id);
    setDeleteTarget(null);
  };

  const handlePassFail = (insp: Record<string, unknown>, result: string) => updateInspection?.(insp.id, { status: result });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-white">Quality & Safety</h1><p className="text-slate-400 mt-1">Inspections, observations, and incident tracking</p></div>
        <Button onClick={() => { setEditItem(null); setShowForm(true); }} icon={Plus}>
          {activeTab === 'inspections' ? 'Schedule Inspection' : activeTab === 'observations' ? 'Record Observation' : 'Report Incident'}
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { label: 'Inspections', value: inspections.length, icon: ClipboardCheck },
          { label: 'Pass Rate', value: inspections.length > 0 ? Math.round(inspections.filter((i: Record<string, unknown>) => i.status === 'passed').length / inspections.filter((i: Record<string, unknown>) => ['passed', 'failed'].includes(i.status as string)).length * 100) || 0 : 0, suffix: '%', icon: CheckCircle2 },
          { label: 'Open Observations', value: observations.filter((o: Record<string, unknown>) => o.status === 'open').length, icon: Eye },
          { label: 'Incidents (YTD)', value: incidents.length, icon: AlertTriangle },
        ].map((s, i) => (
          <Card key={i} className="p-4"><div className="flex items-center justify-between"><div><p className="text-xl font-bold text-white">{s.value}{s.suffix}</p><p className="text-sm text-slate-400">{s.label}</p></div><s.icon className="w-8 h-8" style={{ color: primaryColor }} /></div></Card>
        ))}
      </div>

      <Card><CardBody className="p-4"><div className="relative max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" /><input type="text" placeholder="Search..." value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)} className="input pl-11" /></div></CardBody></Card>

      <Tabs value={activeTab} onChange={(v: string) => { setActiveTab(v); setSearch(''); }}>
        <TabsList>
          <TabsTrigger value="inspections">Inspections ({inspections.length})</TabsTrigger>
          <TabsTrigger value="observations">Observations ({observations.length})</TabsTrigger>
          <TabsTrigger value="incidents">Incidents ({incidents.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="inspections">
          <Card>
            {filteredInspections.length > 0 ? (
              <Table><TableHead><TableRow><TableHeader>Type</TableHeader><TableHeader>Project</TableHeader><TableHeader>Inspector</TableHeader><TableHeader>Date</TableHeader><TableHeader>Status</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>
                {filteredInspections.map((insp: Record<string, unknown>) => (
                  <TableRow key={insp.id as string}>
                    <TableCell className="font-medium text-white">{insp.type as string}</TableCell>
                    <TableCell className="text-slate-300">{getProjectName(insp.projectId as string)}</TableCell>
                    <TableCell className="text-slate-300">{(insp.inspector as string) || '-'}</TableCell>
                    <TableCell className="text-slate-300">{insp.scheduledDate ? format(new Date(insp.scheduledDate as string), 'MMM d, yyyy') : '-'}</TableCell>
                    <TableCell><StatusBadge status={insp.status === 'passed' ? 'completed' : insp.status === 'failed' ? 'rejected' : insp.status as string} /></TableCell>
                    <TableCell><div className="flex gap-1">
                      {insp.status === 'scheduled' && <button onClick={() => updateInspection?.(insp.id, { status: 'in_progress' })} className="p-1.5 hover:bg-slate-700 rounded text-blue-400" title="Start"><Clock className="w-4 h-4" /></button>}
                      {insp.status === 'in_progress' && <><button onClick={() => handlePassFail(insp, 'passed')} className="p-1.5 hover:bg-emerald-500/20 rounded text-emerald-400" title="Pass"><Check className="w-4 h-4" /></button><button onClick={() => handlePassFail(insp, 'failed')} className="p-1.5 hover:bg-red-500/20 rounded text-red-400" title="Fail"><AlertTriangle className="w-4 h-4" /></button></>}
                      <button onClick={() => { setEditItem(insp); setShowForm(true); }} className="p-1.5 hover:bg-slate-700 rounded"><Edit2 className="w-4 h-4 text-slate-400" /></button>
                      <button onClick={() => setDeleteTarget(insp)} className="p-1.5 hover:bg-red-500/20 rounded"><Trash2 className="w-4 h-4 text-red-400" /></button>
                    </div></TableCell>
                  </TableRow>
                ))}
              </TableBody></Table>
            ) : (<CardBody><EmptyState icon={ClipboardCheck} title="No inspections" action={<Button onClick={() => setShowForm(true)} icon={Plus}>Schedule Inspection</Button>} /></CardBody>)}
          </Card>
        </TabsContent>

        <TabsContent value="observations">
          <Card>
            {filteredObservations.length > 0 ? (
              <Table><TableHead><TableRow><TableHeader>Description</TableHeader><TableHeader>Project</TableHeader><TableHeader>Location</TableHeader><TableHeader>Severity</TableHeader><TableHeader>Status</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>
                {filteredObservations.map((obs: Record<string, unknown>) => (
                  <TableRow key={obs.id as string}>
                    <TableCell className="text-slate-300 max-w-xs truncate">{obs.description as string}</TableCell>
                    <TableCell className="text-slate-300">{getProjectName(obs.projectId as string)}</TableCell>
                    <TableCell className="text-slate-400">{(obs.location as string) || '-'}</TableCell>
                    <TableCell><span className={`font-medium ${severityColors[obs.severity as string]}`}>{obs.severity as string}</span></TableCell>
                    <TableCell><StatusBadge status={obs.status === 'resolved' ? 'completed' : obs.status as string} /></TableCell>
                    <TableCell><div className="flex gap-1">
                      {obs.status !== 'resolved' && <button onClick={() => updateObservation?.(obs.id, { status: 'resolved' })} className="p-1.5 hover:bg-emerald-500/20 rounded text-emerald-400" title="Resolve"><Check className="w-4 h-4" /></button>}
                      <button onClick={() => { setEditItem(obs); setShowForm(true); }} className="p-1.5 hover:bg-slate-700 rounded"><Edit2 className="w-4 h-4 text-slate-400" /></button>
                      <button onClick={() => setDeleteTarget(obs)} className="p-1.5 hover:bg-red-500/20 rounded"><Trash2 className="w-4 h-4 text-red-400" /></button>
                    </div></TableCell>
                  </TableRow>
                ))}
              </TableBody></Table>
            ) : (<CardBody><EmptyState icon={Eye} title="No observations" action={<Button onClick={() => setShowForm(true)} icon={Plus}>Record Observation</Button>} /></CardBody>)}
          </Card>
        </TabsContent>

        <TabsContent value="incidents">
          <Card>
            {filteredIncidents.length > 0 ? (
              <Table><TableHead><TableRow><TableHeader>Date</TableHeader><TableHeader>Type</TableHeader><TableHeader>Project</TableHeader><TableHeader>Description</TableHeader><TableHeader>Status</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>
                {filteredIncidents.map((inc: Record<string, unknown>) => (
                  <TableRow key={inc.id as string}>
                    <TableCell className="font-medium text-white">{inc.date ? format(new Date(inc.date as string), 'MMM d') : '-'}</TableCell>
                    <TableCell><span className="px-2 py-0.5 rounded bg-red-500/20 text-red-400 text-xs">{(inc.type as string)?.replace('_', ' ')}</span></TableCell>
                    <TableCell className="text-slate-300">{getProjectName(inc.projectId as string)}</TableCell>
                    <TableCell className="text-slate-300 max-w-xs truncate">{inc.description as string}</TableCell>
                    <TableCell><StatusBadge status={inc.status === 'closed' ? 'completed' : inc.status === 'investigating' ? 'in_progress' : 'pending'} /></TableCell>
                    <TableCell><div className="flex gap-1">
                      <button onClick={() => { setEditItem(inc); setShowForm(true); }} className="p-1.5 hover:bg-slate-700 rounded"><Edit2 className="w-4 h-4 text-slate-400" /></button>
                      <button onClick={() => setDeleteTarget(inc)} className="p-1.5 hover:bg-red-500/20 rounded"><Trash2 className="w-4 h-4 text-red-400" /></button>
                    </div></TableCell>
                  </TableRow>
                ))}
              </TableBody></Table>
            ) : (<CardBody><EmptyState icon={AlertTriangle} title="No incidents reported" description="Keep up the safe work!" /></CardBody>)}
          </Card>
        </TabsContent>
      </Tabs>

      <Modal isOpen={showForm} onClose={() => { setShowForm(false); setEditItem(null); }} title={activeTab === 'inspections' ? (editItem ? 'Edit Inspection' : 'Schedule Inspection') : activeTab === 'observations' ? (editItem ? 'Edit Observation' : 'Record Observation') : (editItem ? 'Edit Incident' : 'Report Incident')} size="lg">
        {activeTab === 'inspections' && <InspectionForm item={editItem} projects={projects} onSave={handleSave} onClose={() => { setShowForm(false); setEditItem(null); }} />}
        {activeTab === 'observations' && <ObservationForm item={editItem} projects={projects} onSave={handleSave} onClose={() => { setShowForm(false); setEditItem(null); }} />}
        {activeTab === 'incidents' && <IncidentForm item={editItem} projects={projects} onSave={handleSave} onClose={() => { setShowForm(false); setEditItem(null); }} />}
      </Modal>

      <ConfirmDialog isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete} title={`Delete ${activeTab.slice(0, -1)}`} message={`Delete this ${activeTab.slice(0, -1)}?`} confirmText="Delete" variant="danger" />
    </div>
  );
}
