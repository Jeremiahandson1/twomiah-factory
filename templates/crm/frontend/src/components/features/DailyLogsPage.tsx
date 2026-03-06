import React, { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Search, FileText, Cloud, Users, Truck, Package, Edit2, Trash2, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardBody, Button, Input, Select, Modal, Textarea, Table, TableHead, TableBody, TableRow, TableHeader, TableCell, EmptyState, ConfirmDialog } from '../ui';
import { useCRMDataStore } from '../../stores/builderStore';

const weatherOptions = [
  { value: 'sunny', label: '☀️ Sunny' },
  { value: 'cloudy', label: '☁️ Cloudy' },
  { value: 'rain', label: '🌧️ Rain' },
  { value: 'snow', label: '❄️ Snow' },
  { value: 'windy', label: '💨 Windy' },
];

function DailyLogForm({ log, projects, onSave, onClose }) {
  const [form, setForm] = useState(log || { 
    projectId: '', date: format(new Date(), 'yyyy-MM-dd'), weather: 'sunny', 
    temperature: '', manpower: '', workPerformed: '', materialsDelivered: '', 
    equipmentUsed: '', issues: '', notes: '' 
  });
  const handleSubmit = (e) => { e.preventDefault(); onSave({ ...form, manpower: Number(form.manpower) || 0 }); onClose(); };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Select label="Project" value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} options={projects.map(p => ({ value: p.id, label: p.name }))} placeholder="Select project" required />
        <Input label="Date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Select label="Weather" value={form.weather} onChange={(e) => setForm({ ...form, weather: e.target.value })} options={weatherOptions} />
        <Input label="Temperature" value={form.temperature} onChange={(e) => setForm({ ...form, temperature: e.target.value })} placeholder="e.g. 72°F" />
        <Input label="Manpower" type="number" value={form.manpower} onChange={(e) => setForm({ ...form, manpower: e.target.value })} placeholder="# of workers" />
      </div>
      <Textarea label="Work Performed" value={form.workPerformed} onChange={(e) => setForm({ ...form, workPerformed: e.target.value })} placeholder="Describe work completed today..." rows={3} />
      <div className="grid grid-cols-2 gap-4">
        <Textarea label="Materials Delivered" value={form.materialsDelivered} onChange={(e) => setForm({ ...form, materialsDelivered: e.target.value })} placeholder="List materials received..." rows={2} />
        <Textarea label="Equipment Used" value={form.equipmentUsed} onChange={(e) => setForm({ ...form, equipmentUsed: e.target.value })} placeholder="List equipment used..." rows={2} />
      </div>
      <Textarea label="Issues / Delays" value={form.issues} onChange={(e) => setForm({ ...form, issues: e.target.value })} placeholder="Any problems or delays..." rows={2} />
      <Textarea label="Additional Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{log ? 'Update' : 'Create'} Log</Button></div>
    </form>
  );
}

export function DailyLogsPage() {
  const { instance } = useOutletContext();
  const { dailyLogs = [], projects, addDailyLog, updateDailyLog, deleteDailyLog } = useCRMDataStore();
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editLog, setEditLog] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const primaryColor = instance.primaryColor || '#ec7619';

  const filtered = useMemo(() => (dailyLogs || []).filter(l => {
    const matchesSearch = !search || l.workPerformed?.toLowerCase().includes(search.toLowerCase());
    const matchesProject = !projectFilter || l.projectId === projectFilter;
    return matchesSearch && matchesProject;
  }), [dailyLogs, search, projectFilter]);

  const handleSave = (data) => { 
    if (editLog) {
      updateDailyLog?.(editLog.id, data);
    } else {
      addDailyLog?.(data);
    }
    setEditLog(null); 
    setShowForm(false); 
  };
  const getProjectName = (id) => projects.find(p => p.id === id)?.name || '-';
  const getWeatherEmoji = (w) => weatherOptions.find(o => o.value === w)?.label?.split(' ')[0] || '☀️';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-white">Daily Logs</h1><p className="text-slate-400 mt-1">Record daily job site activity</p></div>
        <Button onClick={() => setShowForm(true)} icon={Plus}>New Log</Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Logs', value: dailyLogs.length, icon: FileText },
          { label: 'This Week', value: dailyLogs.filter(l => new Date(l.date) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)).length, icon: Calendar },
          { label: 'Total Manpower', value: dailyLogs.reduce((s, l) => s + (l.manpower || 0), 0), icon: Users },
          { label: 'Projects Logged', value: new Set(dailyLogs.map(l => l.projectId)).size, icon: Truck },
        ].map((stat, i) => (
          <Card key={i} className="p-4"><div className="flex items-center justify-between"><div><p className="text-xl font-bold text-white">{stat.value}</p><p className="text-sm text-slate-400">{stat.label}</p></div><stat.icon className="w-8 h-8" style={{ color: primaryColor }} /></div></Card>
        ))}
      </div>
      <Card><CardBody className="p-4"><div className="flex flex-col sm:flex-row gap-4"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" /><input type="text" placeholder="Search logs..." value={search} onChange={(e) => setSearch(e.target.value)} className="input pl-11" /></div><Select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} options={[{ value: '', label: 'All Projects' }, ...projects.map(p => ({ value: p.id, label: p.name }))]} className="sm:w-48" /></div></CardBody></Card>
      <Card>
        {filtered.length > 0 ? (
          <Table><TableHead><TableRow><TableHeader>Date</TableHeader><TableHeader>Project</TableHeader><TableHeader>Weather</TableHeader><TableHeader>Manpower</TableHeader><TableHeader>Work Performed</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>
            {filtered.map((log) => (
              <TableRow key={log.id}>
                <TableCell><span className="font-medium text-white">{format(new Date(log.date), 'MMM d, yyyy')}</span></TableCell>
                <TableCell className="text-slate-300">{getProjectName(log.projectId)}</TableCell>
                <TableCell><span className="text-lg">{getWeatherEmoji(log.weather)}</span> <span className="text-slate-400">{log.temperature}</span></TableCell>
                <TableCell className="text-slate-300">{log.manpower || 0} workers</TableCell>
                <TableCell><span className="text-slate-300 line-clamp-1">{log.workPerformed || '-'}</span></TableCell>
                <TableCell><div className="flex gap-1">
                  <button onClick={() => { setEditLog(log); setShowForm(true); }} className="p-1.5 hover:bg-slate-700 rounded"><Edit2 className="w-4 h-4 text-slate-400" /></button>
                  <button onClick={() => setDeleteTarget(log)} className="p-1.5 hover:bg-red-500/20 rounded"><Trash2 className="w-4 h-4 text-red-400" /></button>
                </div></TableCell>
              </TableRow>
            ))}
          </TableBody></Table>
        ) : (<CardBody><EmptyState icon={FileText} title="No daily logs" description="Start recording daily activity" action={<Button onClick={() => setShowForm(true)} icon={Plus}>New Log</Button>} /></CardBody>)}
      </Card>
      <Modal isOpen={showForm} onClose={() => { setShowForm(false); setEditLog(null); }} title={editLog ? 'Edit Daily Log' : 'New Daily Log'} size="lg"><DailyLogForm log={editLog} projects={projects} onSave={handleSave} onClose={() => { setShowForm(false); setEditLog(null); }} /></Modal>
      <ConfirmDialog isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={() => deleteDailyLog?.(deleteTarget?.id)} title="Delete Log" message="Delete this daily log?" confirmText="Delete" variant="danger" />
    </div>
  );
}
