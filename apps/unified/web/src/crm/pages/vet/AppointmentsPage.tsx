// Moved from templates/crm-vet/frontend/src/pages/vet/AppointmentsPage.tsx.
import { useState, useEffect, useCallback, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Loader2, X, CalendarDays, Clock, User, Phone, CheckCircle2, DoorOpen } from 'lucide-react'
import { api } from '../../../api'
import { useMayWrite, useToast } from '../../../shared'
import OwnerPicker from './OwnerPicker'
import { fetchStaff, useMayPickStaff, staffName, type StaffMember, APPOINTMENT_TYPES, appointmentTypeLabel } from './vetHelpers'
import { whenTime, companyDayBounds, companyMoment, companyTodayKey } from '@twomiah/tenant-ui/src/time/companyClock'

/** A refusal from the API client: its body rides on `data` ({ error, code }). */
type Refusal = Error & { data?: { code?: string } }

/**
 * Appointments — single-day list over /api/appointments?from=&to=.
 * from/to are the selected day's UTC-ISO bounds. Check-in posts to
 * /api/appointments/:id/check-in.
 */

// the types themselves live in lib/appointmentTypes, so the form and the schedule cannot disagree

const STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-gray-100 text-gray-700 dark:text-slate-200 dark:bg-slate-800',
  confirmed: 'bg-blue-100 text-blue-700 dark:text-blue-300 dark:bg-blue-950/40',
  checked_in: 'bg-teal-100 text-teal-700 dark:text-teal-300 dark:bg-teal-950/40',
  in_progress: 'bg-purple-100 text-purple-700 dark:text-purple-300 dark:bg-purple-950/40',
  completed: 'bg-green-100 text-green-700 dark:text-green-300 dark:bg-green-950/40',
  no_show: 'bg-amber-100 text-amber-700 dark:text-amber-300 dark:bg-amber-950/40',
  cancelled: 'bg-red-100 text-red-700 dark:text-red-400 dark:bg-red-950/40',
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

// Today on the company's calendar — UTC's day (toISOString) opened the book on tomorrow every evening.
const todayStr = (): string => companyTodayKey();

// The day's window on the COMPANY's clock (its midnight to the next), as the book's times are — the browser's day
// fetched the wrong evening's appointments for a viewer in another zone (2026-10-23).
const dayBounds = (day: string): { from: string; to: string } => companyDayBounds(day);

function fmtTime(s?: string): string {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '—';
  return whenTime(d, { hour: 'numeric', minute: '2-digit' });
}

function providerName(a: Appointment): string {
  return [a.providerFirstName, a.providerLastName].filter(Boolean).join(' ');
}

export default function AppointmentsPage() {
  const toast = useToast();
  // Booking is contacts:create; check-in, start, complete, no-show and cancel are contacts:update (appointments.ts). (T43 viewer round, T68)
  const mayBook = useMayWrite('contacts:create');
  const mayWork = useMayWrite('contacts:update');
  const [day, setDay] = useState<string>(todayStr());
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [showForm, setShowForm] = useState<boolean>(false);
  // An owner's "Book Appointment" quick action (verticals/vet/settings.ts: ?ownerId=<contact>) opens the form for them;
  // it had linked to the bare day view, where the desk picked the owner again.
  const [searchParams, setSearchParams] = useSearchParams();
  const [presetOwner, setPresetOwner] = useState<string>('');
  useEffect(() => {
    const owner = searchParams.get('ownerId');
    if (!owner || !mayBook) return;
    setPresetOwner(owner); setShowForm(true);
    const next = new URLSearchParams(searchParams); next.delete('ownerId'); setSearchParams(next, { replace: true });
  }, [searchParams, mayBook]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { from, to } = dayBounds(day);
      // A list reply: { data, pagination } — the whole day in one page.
      const res: { data?: Appointment[] } = await api.get(`/api/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      const rows: Appointment[] = res?.data || [];
      rows.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
      setAppts(rows);
    } catch (error) {
      toast.error((error as Error).message || 'Could not load the day');
    } finally {
      setLoading(false);
    }
  }, [day]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const checkIn = async (a: Appointment) => {
    try {
      await api.post(`/api/appointments/${a.id}/check-in`);
      load();
    } catch (err) {
      toast.error((err as Error).message || 'Failed to check in');
    }
  };

  // Move an appointment through its lifecycle. Without this the card stopped at Check In,
  // so a booked slot could never be freed and the day sheet filled with stale rows. (VET-13)
  const setStatus = async (a: Appointment, status: string) => {
    try {
      await api.put(`/api/appointments/${a.id}`, { status });
      load();
    } catch (err) {
      toast.error((err as Error).message || 'Failed to update appointment');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Appointments</h1>
          <p className="text-gray-500 dark:text-slate-400">Daily schedule</p>
        </div>
        {mayBook && <button onClick={() => setShowForm(true)} className="flex items-center gap-2 px-4 py-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800">
          <Plus className="w-4 h-4" /> New Appointment
        </button>}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="pl-10 pr-4 py-2 border rounded-lg" />
        </div>
        <button onClick={() => setDay(todayStr())} className="px-3 py-2 border rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-slate-800">Today</button>
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
                {a.reason && <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{a.reason}</p>}
              </div>
              <div className="flex items-center gap-2 text-sm">
                {a.type && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full dark:bg-slate-800 dark:text-slate-400">{appointmentTypeLabel(a.type)}</span>}
                {a.room && <span className="text-xs text-gray-500 dark:text-slate-400 flex items-center gap-1"><DoorOpen className="w-3 h-3" /> {a.room}</span>}
                {providerName(a) && <span className="text-xs text-gray-500 dark:text-slate-400">Dr. {providerName(a)}</span>}
              </div>
              <span className={`text-xs px-2 py-1 rounded-full capitalize ${STATUS_COLORS[a.status || ''] || 'bg-gray-100 text-gray-700 dark:text-slate-200 dark:bg-slate-800'} dark:text-slate-200`}>
                {(a.status || 'scheduled').replace('_', ' ')}
              </span>
              {mayWork && NOT_CHECKED_IN.has(a.status || 'scheduled') && (
                <button onClick={() => checkIn(a)} className="flex items-center gap-1 px-3 py-1.5 bg-teal-700 text-white rounded-lg hover:bg-teal-800 text-sm">
                  <CheckCircle2 className="w-4 h-4" /> Check In
                </button>
              )}
              {mayWork && a.status === 'checked_in' && (
                <button onClick={() => setStatus(a, 'in_progress')} className="px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm">Start</button>
              )}
              {mayWork && a.status === 'in_progress' && (
                <button onClick={() => setStatus(a, 'completed')} className="px-3 py-1.5 bg-green-700 text-white rounded-lg hover:bg-green-800 text-sm">Complete</button>
              )}
              {mayWork && ['scheduled', 'confirmed', 'checked_in'].includes(a.status || 'scheduled') && (
                <button onClick={() => setStatus(a, 'no_show')} className="px-3 py-1.5 border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-50 text-sm dark:text-amber-300">No-Show</button>
              )}
              {mayWork && !['completed', 'cancelled', 'no_show'].includes(a.status || 'scheduled') && (
                <button onClick={() => setStatus(a, 'cancelled')} className="px-3 py-1.5 border border-red-200 text-red-700 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-sm">Cancel</button>
              )}
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <NewAppointmentModal
          defaultDay={day}
          defaultOwner={presetOwner}
          onSave={() => { setShowForm(false); setPresetOwner(''); load(); }}
          onClose={() => { setShowForm(false); setPresetOwner(''); }}
        />
      )}
    </div>
  );
}

/* ---------------- New Appointment Modal ---------------- */

interface PatientOption { id: string; name?: string; ownerId?: string; ownerName?: string }

interface AppointmentForm { patientId: string; providerId: string; type: string; date: string; startTime: string; endTime: string; room: string; reason: string; notes: string }

function NewAppointmentModal({ defaultDay, defaultOwner = '', onSave, onClose }: { defaultDay: string; defaultOwner?: string; onSave: () => void; onClose: () => void }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [providers, setProviders] = useState<StaffMember[]>([]);
  const [ownerId, setOwnerId] = useState<string>(defaultOwner);
  const [form, setForm] = useState<AppointmentForm>({
    patientId: '', providerId: '', type: 'wellness',
    date: defaultDay, startTime: '09:00', endTime: '09:30',
    room: '', reason: '', notes: '',
  });
  const set = (k: keyof AppointmentForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Separately: a refused provider list took the patient list down with it (Promise.all), and the desk could not book.
  const mayPickStaff = useMayPickStaff();
  useEffect(() => {
    api.get('/api/patients?limit=500').then((r: { data?: PatientOption[] }) => {
      const rows = r?.data || [];
      setPatients(rows);
      // Booked from an owner with one patient: that patient.
      const theirs = defaultOwner ? rows.filter((p) => p.ownerId === defaultOwner) : [];
      if (theirs.length === 1) setForm((f) => (f.patientId ? f : { ...f, patientId: theirs[0].id }));
    }).catch(() => setPatients([]));
  }, []);
  useEffect(() => {
    if (mayPickStaff) fetchStaff().then(setProviders).catch(() => setProviders([]));
  }, [mayPickStaff]);

  // When a patient is chosen, default its owner.
  const onPatient = (pid: string) => {
    set('patientId', pid);
    const p = patients.find((x) => x.id === pid);
    if (p?.ownerId) setOwnerId(p.ownerId);
  };

  const submit = async (e?: FormEvent, allowConflict = false) => {
    e?.preventDefault();
    if (!form.patientId) { toast.error('Patient is required'); return; }
    setSaving(true);
    try {
      // The typed day and times are the company's wall clock.
      const startTime = companyMoment(form.date, form.startTime).toISOString();
      const endTime = form.endTime ? companyMoment(form.date, form.endTime).toISOString() : undefined;
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
      if (allowConflict) payload.allowConflict = true;
      await api.post('/api/appointments', payload);
      onSave();
    } catch (err) {
      const msg = (err as Error).message || 'Failed to create appointment';
      // A double-book returns 409 appointment_conflict. Surface it as an explicit choice with an override, instead of
      // dumping the raw error at the receptionist (VET-22). Read by its code, so a room that is taken gets the same
      // choice as a provider who is busy (the template matched the provider's sentence only).
      if (!allowConflict && (err as Refusal).data?.code === 'appointment_conflict') {
        setConflictMsg(msg);
      } else {
        toast.error(msg);
      }
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
            <button aria-label="Close" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Patient <span className="text-red-700 dark:text-red-400">*</span></label>
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
                <select value={form.type} onChange={(e) => set('type', e.target.value)} className="w-full px-3 py-2 border rounded-lg">
                  {APPOINTMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
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
            {conflictMsg && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:text-amber-300 dark:bg-amber-950/40">
                <p className="font-medium">{conflictMsg}</p>
                <p className="mt-1 text-amber-700 dark:text-amber-300">Book this appointment anyway, or change the time or provider.</p>
                <div className="flex gap-2 mt-2">
                  <button type="button" disabled={saving} onClick={() => { setConflictMsg(null); submit(undefined, true); }} className="px-3 py-1.5 bg-amber-700 text-white rounded-lg hover:bg-amber-800 disabled:opacity-50">Book anyway</button>
                  <button type="button" onClick={() => setConflictMsg(null)} className="px-3 py-1.5 border border-amber-300 rounded-lg hover:bg-amber-100">Change time</button>
                </div>
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800 disabled:opacity-50">
                {saving ? 'Saving...' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
