import { useState, useEffect, useCallback } from 'react';
import { Plus, Loader2, X, CalendarDays, Clock, User, Phone, CheckCircle2, DoorOpen } from 'lucide-react';
import api from '../../services/api';
import OwnerPicker, { ContactLite } from '../../components/vet/OwnerPicker';
import { fetchStaff, staffName, type StaffMember } from '../../lib/staff';

/**
 * Appointments — single-day list over /api/appointments?from=&to=.
 * from/to are the selected day's UTC-ISO bounds. Check-in posts to
 * /api/appointments/:id/check-in.
 */

const TYPES = ['wellness', 'sick', 'surgery', 'dental', 'recheck', 'grooming', 'euthanasia'];

const STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-gray-100 text-gray-700',
  confirmed: 'bg-blue-100 text-blue-700',
  checked_in: 'bg-teal-100 text-teal-700',
  in_progress: 'bg-purple-100 text-purple-700',
  completed: 'bg-green-100 text-green-700',
  no_show: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-red-100 text-red-700',
};

const NOT_CHECKED_IN = new Set(['scheduled', 'confirmed']);

interface Appointment {
  id: string;
  patientId?: string;
  ownerId?: string;
  providerId?: string;
  type?: string;
  status?: string;
  room?: string;
  reason?: string;
  startTime?: string;
  endTime?: string;
  notes?: string;
  patientName?: string;
  ownerName?: string;
  ownerPhone?: string;
  providerFirstName?: string;
  providerLastName?: string;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function dayBounds(day: string): { from: string; to: string } {
  // Local-day bounds, sent as ISO.
  const start = new Date(`${day}T00:00:00`);
  const end = new Date(`${day}T23:59:59.999`);
  return { from: start.toISOString(), to: end.toISOString() };
}

function fmtTime(s?: string): string {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function providerName(a: Appointment): string {
  return [a.providerFirstName, a.providerLastName].filter(Boolean).join(' ');
}

export default function AppointmentsPage() {
  const [day, setDay] = useState<string>(todayStr());
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [showForm, setShowForm] = useState<boolean>(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { from, to } = dayBounds(day);
      const res = await api.get(`/api/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      const rows: Appointment[] = res.data || [];
      rows.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
      setAppts(rows);
    } catch (error) {
      console.error('Failed to load appointments:', error);
    } finally {
      setLoading(false);
    }
  }, [day]);

  useEffect(() => { load(); }, [load]);

  const checkIn = async (a: Appointment) => {
    try {
      await api.post(`/api/appointments/${a.id}/check-in`);
      load();
    } catch (err) {
      alert((err as Error).message || 'Failed to check in');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Appointments</h1>
          <p className="text-gray-500 dark:text-slate-400">Daily schedule</p>
        </div>
        <button onClick={() => setShowForm(true)} className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700">
          <Plus className="w-4 h-4" /> New Appointment
        </button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="pl-10 pr-4 py-2 border rounded-lg" />
        </div>
        <button onClick={() => setDay(todayStr())} className="px-3 py-2 border rounded-lg text-sm hover:bg-gray-50">Today</button>
        <span className="text-sm text-gray-500 dark:text-slate-400">{appts.length} appointment{appts.length === 1 ? '' : 's'}</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : appts.length === 0 ? (
        <div className="text-center py-12 text-gray-500 bg-white rounded-xl border dark:text-slate-400 dark:bg-slate-900">No appointments this day</div>
      ) : (
        <div className="space-y-2">
          {appts.map((a) => (
            <div key={a.id} className="bg-white rounded-xl border p-4 flex items-center gap-4 flex-wrap dark:bg-slate-900">
              <div className="flex items-center gap-2 text-gray-900 font-medium w-32 dark:text-slate-100">
                <Clock className="w-4 h-4 text-gray-400" />
                {fmtTime(a.startTime)}
              </div>
              <div className="flex-1 min-w-[180px]">
                <p className="font-medium text-gray-900 dark:text-slate-100">{a.patientName || 'Patient'}</p>
                <p className="text-sm text-gray-500 flex items-center gap-2 flex-wrap dark:text-slate-400">
                  {a.ownerName && <span className="flex items-center gap-1"><User className="w-3 h-3" /> {a.ownerName}</span>}
                  {a.ownerPhone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {a.ownerPhone}</span>}
                </p>
                {a.reason && <p className="text-xs text-gray-400 mt-0.5">{a.reason}</p>}
              </div>
              <div className="flex items-center gap-2 text-sm">
                {a.type && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full capitalize dark:bg-slate-800 dark:text-slate-400">{a.type}</span>}
                {a.room && <span className="text-xs text-gray-400 flex items-center gap-1"><DoorOpen className="w-3 h-3" /> {a.room}</span>}
                {providerName(a) && <span className="text-xs text-gray-400">Dr. {providerName(a)}</span>}
              </div>
              <span className={`text-xs px-2 py-1 rounded-full capitalize ${STATUS_COLORS[a.status || ''] || 'bg-gray-100 text-gray-700'}`}>
                {(a.status || 'scheduled').replace('_', ' ')}
              </span>
              {NOT_CHECKED_IN.has(a.status || 'scheduled') && (
                <button onClick={() => checkIn(a)} className="flex items-center gap-1 px-3 py-1.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm">
                  <CheckCircle2 className="w-4 h-4" /> Check In
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <NewAppointmentModal
          defaultDay={day}
          onSave={() => { setShowForm(false); load(); }}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}

/* ---------------- New Appointment Modal ---------------- */

interface PatientOption { id: string; name?: string; ownerId?: string; ownerName?: string }

function NewAppointmentModal({ defaultDay, onSave, onClose }: { defaultDay: string; onSave: () => void; onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [providers, setProviders] = useState<StaffMember[]>([]);
  const [ownerId, setOwnerId] = useState<string>('');
  const [form, setForm] = useState({
    patientId: '', providerId: '', type: 'wellness',
    date: defaultDay, startTime: '09:00', endTime: '09:30',
    room: '', reason: '', notes: '',
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    (async () => {
      try {
        const [patRes, staff] = await Promise.all([
          api.get('/api/patients?limit=500'),
          fetchStaff(),
        ]);
        setPatients(patRes.data || []);
        setProviders(staff);
      } catch {
        /* degrade gracefully */
      }
    })();
  }, []);

  // When a patient is chosen, default its owner.
  const onPatient = (pid: string) => {
    set('patientId', pid);
    const p = patients.find((x) => x.id === pid);
    if (p?.ownerId) setOwnerId(p.ownerId);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.patientId) { alert('Patient is required'); return; }
    setSaving(true);
    try {
      const startTime = new Date(`${form.date}T${form.startTime}:00`).toISOString();
      const endTime = form.endTime ? new Date(`${form.date}T${form.endTime}:00`).toISOString() : undefined;
      const payload: Record<string, unknown> = {
        patientId: form.patientId,
        type: form.type,
        startTime,
        status: 'scheduled',
      };
      if (ownerId) payload.ownerId = ownerId;
      if (form.providerId) payload.providerId = form.providerId;
      if (endTime) payload.endTime = endTime;
      if (form.room) payload.room = form.room;
      if (form.reason) payload.reason = form.reason;
      if (form.notes) payload.notes = form.notes;
      await api.post('/api/appointments', payload);
      onSave();
    } catch (err) {
      alert((err as Error).message || 'Failed to create appointment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-start justify-center p-4 py-8">
        <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6 dark:bg-slate-900">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">New Appointment</h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Patient <span className="text-red-500">*</span></label>
              <select value={form.patientId} onChange={(e) => onPatient(e.target.value)} className="w-full px-3 py-2 border rounded-lg" required>
                <option value="">Select patient...</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>{p.name || 'Unnamed'}{p.ownerName ? ` — ${p.ownerName}` : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Owner</label>
              <OwnerPicker value={ownerId} onChange={(id) => setOwnerId(id)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Type</label>
                <select value={form.type} onChange={(e) => set('type', e.target.value)} className="w-full px-3 py-2 border rounded-lg capitalize">
                  {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Provider</label>
                <select value={form.providerId} onChange={(e) => set('providerId', e.target.value)} className="w-full px-3 py-2 border rounded-lg">
                  <option value="">Unassigned</option>
                  {providers.map((u) => <option key={u.id} value={u.id}>{staffName(u)}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Date</label>
                <input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Start</label>
                <input type="time" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">End</label>
                <input type="time" value={form.endTime} onChange={(e) => set('endTime', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Room</label>
                <input type="text" value={form.room} onChange={(e) => set('room', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Reason</label>
                <input type="text" value={form.reason} onChange={(e) => set('reason', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Notes</label>
              <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} className="w-full px-3 py-2 border rounded-lg" />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50">
                {saving ? 'Saving...' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
