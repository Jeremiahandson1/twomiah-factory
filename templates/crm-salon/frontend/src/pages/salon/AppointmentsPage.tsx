import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Loader2, X, CalendarDays, Clock, User, Phone, CheckCircle2, Armchair, Scissors } from 'lucide-react';
import api from '../../services/api';
import ClientPicker from '../../components/salon/ClientPicker';
import ServiceRecordEditorModal from '../../components/salon/ServiceRecordEditorModal';
import { fetchStaff, staffName, type StaffMember } from '../../lib/staff';

/**
 * The book — single-day list over /api/appointments?from=&to=.
 * from/to are the selected day's local bounds sent as ISO.
 *
 * Two actions matter at the desk: check in on arrival, and close the ticket by
 * writing the service record — which the backend also marks the appointment
 * completed for, so nobody has to close it twice.
 */

const STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-gray-100 text-gray-700',
  confirmed: 'bg-blue-100 text-blue-700',
  checked_in: 'bg-teal-100 text-teal-700',
  in_chair: 'bg-purple-100 text-purple-700',
  completed: 'bg-green-100 text-green-700',
  no_show: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-red-100 text-red-700',
};

const NOT_CHECKED_IN = new Set(['scheduled', 'confirmed']);
const CLOSED = new Set(['completed', 'cancelled', 'no_show']);

interface Appointment {
  id: string;
  contactId?: string;
  stylistId?: string;
  serviceId?: string;
  status?: string;
  station?: string;
  startTime?: string;
  endTime?: string;
  quotedPrice?: number | string;
  notes?: string;
  clientName?: string;
  clientPhone?: string;
  clientMobile?: string;
  serviceName?: string;
  serviceDurationMin?: number;
  stylistFirstName?: string;
  stylistLastName?: string;
}
interface ServiceOption { id: string; name?: string; durationMin?: number; price?: string | number }

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

function stylistName(a: Appointment): string {
  return [a.stylistFirstName, a.stylistLastName].filter(Boolean).join(' ');
}

export default function AppointmentsPage() {
  const [day, setDay] = useState<string>(todayStr());
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [showForm, setShowForm] = useState<boolean>(false);
  const [closing, setClosing] = useState<Appointment | null>(null);

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

  const booked = appts.filter((a) => !CLOSED.has(a.status || 'scheduled')).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">The Book</h1>
          <p className="text-gray-500">Today's chairs</p>
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
        <span className="text-sm text-gray-500">
          {booked} booked{appts.length !== booked ? ` · ${appts.length - booked} closed/cancelled` : ''}
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : appts.length === 0 ? (
        <div className="text-center py-12 text-gray-500 bg-white rounded-xl border">Nothing booked this day</div>
      ) : (
        <div className="space-y-2">
          {appts.map((a) => (
            <div key={a.id} className="bg-white rounded-xl border p-4 flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2 text-gray-900 font-medium w-40">
                <Clock className="w-4 h-4 text-gray-400" />
                {fmtTime(a.startTime)}
                {a.endTime && <span className="text-xs text-gray-400">– {fmtTime(a.endTime)}</span>}
              </div>
              <div className="flex-1 min-w-[180px]">
                <p className="font-medium text-gray-900">
                  {a.contactId ? (
                    <Link to={`/crm/clients/${a.contactId}`} className="hover:text-teal-600">{a.clientName || 'Client'}</Link>
                  ) : (
                    a.clientName || 'Walk-in'
                  )}
                </p>
                <p className="text-sm text-gray-500 flex items-center gap-2 flex-wrap">
                  {a.serviceName && <span className="flex items-center gap-1"><Scissors className="w-3 h-3" /> {a.serviceName}</span>}
                  {(a.clientMobile || a.clientPhone) && (
                    <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {a.clientMobile || a.clientPhone}</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2 text-sm">
                {a.station && <span className="text-xs text-gray-400 flex items-center gap-1"><Armchair className="w-3 h-3" /> {a.station}</span>}
                {stylistName(a) && <span className="text-xs text-gray-400 flex items-center gap-1"><User className="w-3 h-3" /> {stylistName(a)}</span>}
              </div>
              <span className={`text-xs px-2 py-1 rounded-full capitalize ${STATUS_COLORS[a.status || ''] || 'bg-gray-100 text-gray-700'}`}>
                {(a.status || 'scheduled').replace('_', ' ')}
              </span>
              {NOT_CHECKED_IN.has(a.status || 'scheduled') && (
                <button onClick={() => checkIn(a)} className="flex items-center gap-1 px-3 py-1.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm">
                  <CheckCircle2 className="w-4 h-4" /> Check In
                </button>
              )}
              {!CLOSED.has(a.status || 'scheduled') && a.contactId && (
                <button onClick={() => setClosing(a)} className="flex items-center gap-1 px-3 py-1.5 border rounded-lg hover:bg-gray-50 text-sm">
                  <Scissors className="w-4 h-4" /> Log Service
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
      {closing && closing.contactId && (
        <ServiceRecordEditorModal
          contactId={closing.contactId}
          appointmentId={closing.id}
          record={{ serviceId: closing.serviceId, stylistId: closing.stylistId, priceCharged: closing.quotedPrice, performedAt: closing.startTime }}
          onSave={() => { setClosing(null); load(); }}
          onClose={() => setClosing(null)}
        />
      )}
    </div>
  );
}

/* ---------------- New Appointment Modal ---------------- */

function NewAppointmentModal({ defaultDay, onSave, onClose }: { defaultDay: string; onSave: () => void; onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [stylists, setStylists] = useState<StaffMember[]>([]);
  const [contactId, setContactId] = useState<string>('');
  const [form, setForm] = useState({
    serviceId: '', stylistId: '',
    date: defaultDay, startTime: '09:00', endTime: '',
    station: '', quotedPrice: '', notes: '',
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    (async () => {
      try {
        const [svcRes, staff] = await Promise.all([
          api.get('/api/service-menu'),
          fetchStaff(),
        ]);
        setServices(svcRes.data || []);
        setStylists(staff);
      } catch {
        /* degrade gracefully */
      }
    })();
  }, []);

  // Choosing a service fills in price and end time from the menu — the desk
  // should not have to do duration arithmetic.
  const onService = (id: string) => {
    const svc = services.find((s) => s.id === id);
    setForm((f) => {
      const next = { ...f, serviceId: id };
      if (svc?.price && !f.quotedPrice) next.quotedPrice = String(svc.price);
      if (svc?.durationMin && f.startTime) {
        const [h, m] = f.startTime.split(':').map(Number);
        const end = new Date(2000, 0, 1, h, m + svc.durationMin);
        next.endTime = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
      }
      return next;
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactId) { alert('A client is required'); return; }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        contactId,
        startTime: new Date(`${form.date}T${form.startTime}:00`).toISOString(),
        status: 'scheduled',
      };
      if (form.serviceId) payload.serviceId = form.serviceId;
      if (form.stylistId) payload.stylistId = form.stylistId;
      // Left blank, the backend derives the end from the service duration.
      if (form.endTime) payload.endTime = new Date(`${form.date}T${form.endTime}:00`).toISOString();
      if (form.station) payload.station = form.station;
      if (form.quotedPrice !== '') payload.quotedPrice = Number(form.quotedPrice);
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
        <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">New Appointment</h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Client <span className="text-red-500">*</span></label>
              <ClientPicker value={contactId} onChange={(id) => setContactId(id)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Service</label>
                <select value={form.serviceId} onChange={(e) => onService(e.target.value)} className="w-full px-3 py-2 border rounded-lg">
                  <option value="">Select service...</option>
                  {services.map((s) => <option key={s.id} value={s.id}>{s.name || 'Untitled'}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Stylist</label>
                <select value={form.stylistId} onChange={(e) => set('stylistId', e.target.value)} className="w-full px-3 py-2 border rounded-lg">
                  <option value="">Unassigned</option>
                  {stylists.map((u) => <option key={u.id} value={u.id}>{staffName(u)}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                <input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start</label>
                <input type="time" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End</label>
                <input type="time" value={form.endTime} onChange={(e) => set('endTime', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Chair / Room</label>
                <input type="text" value={form.station} onChange={(e) => set('station', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Quoted price ($)</label>
                <input type="number" step="any" value={form.quotedPrice} onChange={(e) => set('quotedPrice', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
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
