import { useState, useEffect, useCallback, type FormEvent } from 'react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { ChevronLeft, ChevronRight, Calendar, Plus, X } from 'lucide-react';

interface ScheduleEvent {
  id: string;
  title: string;
  type: string | null;
  start: string;
  end: string | null;
  status: string | null;
  notes: string | null;
}

interface Booking {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  customerAddress: string | null;
  serviceName: string | null;
  assignedUser: { id: string; email: string; name: string | null } | null;
}

export default function SchedulePage() {
  const toast = useToast();
  const [jobs, setJobs] = useState<any[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showNew, setShowNew] = useState(false);
  const [newDate, setNewDate] = useState<Date | null>(null);

  const load = useCallback(() => {
    const startOfWeek = new Date(currentDate);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    setLoading(true);
    Promise.all([
      api.jobs.list({ startDate: startOfWeek.toISOString(), endDate: endOfWeek.toISOString(), limit: 100 })
        .then((res: any) => res.data)
        .catch(() => []),
      // Bookings come from the connected website-premium service; fail
      // silently if not configured (older tenants without bookings).
      fetch('/api/bookings/external?from=' + startOfWeek.toISOString() + '&to=' + endOfWeek.toISOString(), {
        credentials: 'include',
      })
        .then(r => r.ok ? r.json() : { bookings: [] })
        .then(data => data.bookings || [])
        .catch(() => []),
      // Appointments (test drives, service drop-offs, deliveries, follow-ups).
      api.get('/api/schedule-events', { from: startOfWeek.toISOString(), to: endOfWeek.toISOString() })
        .then((res: any) => res.data || [])
        .catch(() => { toast.error('Failed to load appointments'); return []; }),
    ]).then(([jobs, bookings, events]) => {
      setJobs(jobs); setBookings(bookings); setEvents(events);
    }).finally(() => setLoading(false));
  }, [currentDate, toast]);

  useEffect(() => { load(); }, [load]);

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const startOfWeek = new Date(currentDate);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startOfWeek);
    d.setDate(d.getDate() + i);
    return d;
  });

  const getJobsForDay = (date: Date) => jobs.filter((j: any) => j.scheduledDate && new Date(j.scheduledDate).toDateString() === date.toDateString());
  const getBookingsForDay = (date: Date) => bookings.filter(b => new Date(b.startAt).toDateString() === date.toDateString() && b.status !== 'cancelled');
  const getEventsForDay = (date: Date) => events.filter(e => new Date(e.start).toDateString() === date.toDateString() && e.status !== 'cancelled');

  const openNew = (date?: Date) => { setNewDate(date || new Date()); setShowNew(true); };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Schedule</h1>
        <div className="flex items-center gap-4">
          <button onClick={() => openNew()} className="inline-flex items-center gap-1.5 px-3 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-medium"><Plus className="w-4 h-4" />New Appointment</button>
          <button onClick={() => { const d = new Date(currentDate); d.setDate(d.getDate() - 7); setCurrentDate(d); }} className="p-2 hover:bg-gray-100 rounded-lg"><ChevronLeft className="w-5 h-5" /></button>
          <span className="font-medium">{startOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {days[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          <button onClick={() => { const d = new Date(currentDate); d.setDate(d.getDate() + 7); setCurrentDate(d); }} className="p-2 hover:bg-gray-100 rounded-lg"><ChevronRight className="w-5 h-5" /></button>
        </div>
      </div>
      {bookings.length > 0 && (
        <div className="flex items-center gap-4 mb-4 text-xs text-gray-600 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-gray-300" />Job</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-orange-300" />Booking</span>
        </div>
      )}
      {loading ? <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" /></div> : (
        <div className="grid grid-cols-7 gap-4">
          {days.map((day, i) => (
            <div key={i} className={`bg-white rounded-lg shadow-sm overflow-hidden ${day.toDateString() === new Date().toDateString() ? 'ring-2 ring-orange-500' : ''}`}>
              <div className={`px-3 py-2 text-center border-b ${day.toDateString() === new Date().toDateString() ? 'bg-orange-500 text-white' : 'bg-gray-50'}`}>
                <p className="text-xs font-medium">{weekDays[i]}</p>
                <p className="text-lg font-bold">{day.getDate()}</p>
              </div>
              <div className="p-2 space-y-2 min-h-[200px]">
                {getJobsForDay(day).map((job: any) => (
                  <div key={job.id} className={`p-2 rounded text-xs ${job.status === 'completed' ? 'bg-green-50 border-l-2 border-green-500' : job.status === 'in_progress' ? 'bg-blue-50 border-l-2 border-blue-500' : 'bg-gray-50 border-l-2 border-gray-300'}`}>
                    <p className="font-medium truncate">{job.title}</p>
                    {job.scheduledTime && <p className="text-gray-500 dark:text-slate-400">{job.scheduledTime}</p>}
                  </div>
                ))}
                {getBookingsForDay(day).map(b => {
                  const time = new Date(b.startAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                  return (
                    <div key={b.id} className="p-2 rounded text-xs bg-orange-50 border-l-2 border-orange-500" title={(b.serviceName || 'Booking') + ' — ' + b.customerName + (b.customerAddress ? ' @ ' + b.customerAddress : '')}>
                      <p className="font-medium truncate flex items-center gap-1"><Calendar className="w-3 h-3 shrink-0" />{b.customerName}</p>
                      <p className="text-gray-500 truncate dark:text-slate-400">{time}{b.serviceName ? ' · ' + b.serviceName : ''}</p>
                    </div>
                  );
                })}
                {getEventsForDay(day).map(e => {
                  const time = e.allDay ? 'All day' : new Date(e.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                  return (
                    <div key={e.id} className="p-2 rounded text-xs bg-indigo-50 border-l-2 border-indigo-500" title={(e.notes || e.title)}>
                      <p className="font-medium truncate">{e.title}</p>
                      <p className="text-gray-500 truncate dark:text-slate-400">{time}{e.type ? ' · ' + e.type : ''}</p>
                    </div>
                  );
                })}
                <button onClick={() => openNew(day)} className="w-full text-xs text-gray-400 hover:text-orange-500 py-1">+ Add</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {showNew && newDate && (
        <NewAppointmentModal date={newDate} onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load(); }} toast={toast} />
      )}
    </div>
  );
}

function NewAppointmentModal({ date, onClose, onSaved, toast }: { date: Date; onClose: () => void; onSaved: () => void; toast: any }) {
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const [form, setForm] = useState({ title: '', type: 'appointment', date: dateStr, startTime: '09:00', endTime: '10:00', notes: '' });
  const [saving, setSaving] = useState(false);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!form.title.trim()) { toast.error('A title is required'); return; }
    const start = new Date(`${form.date}T${form.startTime}:00`);
    const end = new Date(`${form.date}T${form.endTime}:00`);
    if (end < start) { toast.error('End time cannot be before start time'); return; }
    setSaving(true);
    try {
      await api.post('/api/schedule-events', {
        title: form.title.trim(), type: form.type,
        start: start.toISOString(), end: end.toISOString(), notes: form.notes || undefined,
      });
      toast.success('Appointment created');
      onSaved();
    } catch (err) {
      toast.error((err as Error).message || 'Failed to create appointment');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-md dark:bg-slate-900" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="font-bold text-lg">New Appointment</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Title *</label>
            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Test drive — John Smith" className="w-full px-3 py-2 border border-gray-300 rounded-lg dark:border-slate-700" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Type</label>
            <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg dark:border-slate-700">
              <option value="appointment">Appointment</option>
              <option value="test_drive">Test Drive</option>
              <option value="service">Service Drop-off</option>
              <option value="delivery">Delivery</option>
              <option value="follow_up">Follow-up</option>
            </select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Date</label><input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg dark:border-slate-700" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Start</label><input type="time" value={form.startTime} onChange={e => setForm({ ...form, startTime: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg dark:border-slate-700" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">End</label><input type="time" value={form.endTime} onChange={e => setForm({ ...form, endTime: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg dark:border-slate-700" /></div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Notes</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg dark:border-slate-700" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg dark:border-slate-700">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg">{saving ? 'Saving…' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
