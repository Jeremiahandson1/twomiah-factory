import React, { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Search, Clock, Play, Square, Calendar, DollarSign, Edit2, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardBody, Button, Input, Select, Modal, Textarea, Table, TableHead, TableBody, TableRow, TableHeader, TableCell, EmptyState, ConfirmDialog } from '../ui';
import { useCRMDataStore } from '../../stores/builderStore';

function TimeEntryForm({ entry, jobs, team, onSave, onClose }) {
  const [form, setForm] = useState(entry || { 
    userId: '', jobId: '', date: format(new Date(), 'yyyy-MM-dd'), 
    startTime: '', endTime: '', hours: '', description: '', billable: true 
  });
  const handleSubmit = (e) => { e.preventDefault(); onSave({ ...form, hours: Number(form.hours) || 0 }); onClose(); };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Select label="Team Member" value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} options={team.map(t => ({ value: t.id, label: t.name }))} placeholder="Select person" required />
        <Select label="Job" value={form.jobId} onChange={(e) => setForm({ ...form, jobId: e.target.value })} options={jobs.map(j => ({ value: j.id, label: j.title }))} placeholder="Select job" />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Input label="Date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
        <Input label="Start Time" type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
        <Input label="End Time" type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
      </div>
      <Input label="Hours" type="number" step="0.25" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} placeholder="0.00" required />
      <Textarea label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Work performed..." rows={2} />
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={form.billable} onChange={(e) => setForm({ ...form, billable: e.target.checked })} className="w-4 h-4 rounded border-slate-600 bg-slate-800" />
        <span className="text-sm text-slate-300">Billable time</span>
      </label>
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{entry ? 'Update' : 'Log'} Time</Button></div>
    </form>
  );
}

export function TimeTrackingPage() {
  const { instance } = useOutletContext();
  const { timeEntries, jobs, teamMembers, addTimeEntry, updateTimeEntry, deleteTimeEntry } = useCRMDataStore();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editEntry, setEditEntry] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [activeTimer, setActiveTimer] = useState(null);
  const primaryColor = instance.primaryColor || '#ec7619';

  const filtered = useMemo(() => timeEntries.filter(e => {
    const matchesSearch = !search || e.description?.toLowerCase().includes(search.toLowerCase());
    return matchesSearch;
  }), [timeEntries, search]);

  const handleSave = (data) => { editEntry ? updateTimeEntry(editEntry.id, data) : addTimeEntry(data); setEditEntry(null); setShowForm(false); };
  const getTeamName = (id) => teamMembers.find(t => t.id === id)?.name || '-';
  const getJobTitle = (id) => jobs.find(j => j.id === id)?.title || '-';

  const totalHours = timeEntries.reduce((s, e) => s + (e.hours || 0), 0);
  const billableHours = timeEntries.filter(e => e.billable).reduce((s, e) => s + (e.hours || 0), 0);
  const thisWeek = timeEntries.filter(e => new Date(e.date) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)).reduce((s, e) => s + (e.hours || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-white">Time Tracking</h1><p className="text-slate-400 mt-1">Track time spent on jobs</p></div>
        <div className="flex gap-2">
          {activeTimer ? (
            <Button variant="danger" onClick={() => setActiveTimer(null)} icon={Square}>Stop Timer</Button>
          ) : (
            <Button variant="secondary" onClick={() => setActiveTimer(new Date())} icon={Play}>Start Timer</Button>
          )}
          <Button onClick={() => setShowForm(true)} icon={Plus}>Log Time</Button>
        </div>
      </div>
      {activeTimer && (
        <Card className="border-2" style={{ borderColor: primaryColor }}>
          <CardBody className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
              <span className="font-medium text-white">Timer running since {format(activeTimer, 'h:mm a')}</span>
            </div>
            <Button variant="secondary" size="sm" onClick={() => { setShowForm(true); setActiveTimer(null); }}>Log & Stop</Button>
          </CardBody>
        </Card>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Hours', value: totalHours.toFixed(1), icon: Clock },
          { label: 'This Week', value: thisWeek.toFixed(1), icon: Calendar },
          { label: 'Billable Hours', value: billableHours.toFixed(1), icon: DollarSign },
          { label: 'Entries', value: timeEntries.length, icon: Clock },
        ].map((stat, i) => (
          <Card key={i} className="p-4"><div className="flex items-center justify-between"><div><p className="text-xl font-bold text-white">{stat.value}</p><p className="text-sm text-slate-400">{stat.label}</p></div><stat.icon className="w-8 h-8" style={{ color: primaryColor }} /></div></Card>
        ))}
      </div>
      <Card><CardBody className="p-4"><div className="relative max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" /><input type="text" placeholder="Search entries..." value={search} onChange={(e) => setSearch(e.target.value)} className="input pl-11" /></div></CardBody></Card>
      <Card>
        {filtered.length > 0 ? (
          <Table><TableHead><TableRow><TableHeader>Date</TableHeader><TableHeader>Team Member</TableHeader><TableHeader>Job</TableHeader><TableHeader>Hours</TableHeader><TableHeader>Description</TableHeader><TableHeader>Billable</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>
            {filtered.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell><span className="font-medium text-white">{format(new Date(entry.date), 'MMM d')}</span></TableCell>
                <TableCell className="text-slate-300">{getTeamName(entry.userId)}</TableCell>
                <TableCell className="text-slate-300">{getJobTitle(entry.jobId)}</TableCell>
                <TableCell className="text-white font-medium">{entry.hours}h</TableCell>
                <TableCell><span className="text-slate-400 line-clamp-1">{entry.description || '-'}</span></TableCell>
                <TableCell>{entry.billable ? <span className="text-emerald-400">✓</span> : <span className="text-slate-500">—</span>}</TableCell>
                <TableCell><div className="flex gap-1">
                  <button onClick={() => { setEditEntry(entry); setShowForm(true); }} className="p-1.5 hover:bg-slate-700 rounded"><Edit2 className="w-4 h-4 text-slate-400" /></button>
                  <button onClick={() => setDeleteTarget(entry)} className="p-1.5 hover:bg-red-500/20 rounded"><Trash2 className="w-4 h-4 text-red-400" /></button>
                </div></TableCell>
              </TableRow>
            ))}
          </TableBody></Table>
        ) : (<CardBody><EmptyState icon={Clock} title="No time entries" action={<Button onClick={() => setShowForm(true)} icon={Plus}>Log Time</Button>} /></CardBody>)}
      </Card>
      <Modal isOpen={showForm} onClose={() => { setShowForm(false); setEditEntry(null); }} title={editEntry ? 'Edit Time Entry' : 'Log Time'}><TimeEntryForm entry={editEntry} jobs={jobs} team={teamMembers} onSave={handleSave} onClose={() => { setShowForm(false); setEditEntry(null); }} /></Modal>
      <ConfirmDialog isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={() => deleteTimeEntry(deleteTarget?.id)} title="Delete Entry" message="Delete this time entry?" confirmText="Delete" variant="danger" />
    </div>
  );
}
