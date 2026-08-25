import { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Search, Loader2, X, CalendarDays, Users, DoorOpen, LayoutGrid, List } from 'lucide-react';
import api from '../../services/api';
import ClientPicker from '../../components/events/ClientPicker';
import { fetchStaff, staffName, type StaffMember } from '../../lib/staff';

/**
 * Events — the pipeline and the book, over the same list.
 *
 * "Pipeline" groups by status so a coordinator can see what needs chasing;
 * "List" is date-ordered for the operational view. Both read GET /api/events,
 * so the two views can never disagree about what is booked.
 */

export const STATUSES = ['enquiry', 'tentative', 'confirmed', 'completed', 'lost', 'cancelled'] as const;
export type EventStatus = typeof STATUSES[number];

export const STATUS_COLORS: Record<string, string> = {
  enquiry: 'bg-amber-100 text-amber-700',
  tentative: 'bg-blue-100 text-blue-700',
  confirmed: 'bg-green-100 text-green-700',
  completed: 'bg-gray-100 text-gray-700',
  lost: 'bg-red-100 text-red-700',
  cancelled: 'bg-red-100 text-red-700',
};

export const EVENT_TYPES = ['private_dining', 'wedding', 'corporate', 'birthday', 'anniversary', 'funeral', 'christmas_party', 'other'];

export interface EventRow {
  id: string;
  name?: string;
  eventType?: string;
  status?: string;
  eventDate?: string;
  startTime?: string;
  endTime?: string;
  guestCount?: number;
  guestCountFinal?: number;
  quotedTotal?: number | string;
  contactId?: string;
  clientName?: string;
  clientPhone?: string;
  spaceName?: string;
  coordinatorFirstName?: string;
  coordinatorLastName?: string;
}

export function fmtEventDate(s?: string): string {
  if (!s) return '—';
  // eventDate is a plain YYYY-MM-DD; parsing it as a Date would shift it a day
  // in negative-offset timezones, so format the parts directly.
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return s;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export function money(v: number | string | undefined | null): string {
  if (v === null || v === undefined || v === '') return '—';
  return `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function prettyType(t?: string): string {
  return (t || '').replace(/_/g, ' ');
}

type View = 'pipeline' | 'list';

export default function EventsPage() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>('');
  const [view, setView] = useState<View>('pipeline');
  const [showForm, setShowForm] = useState<boolean>(false);
  // "Create Event" from a contact lands here with ?contactId= — open the form
  // pre-selected on that contact (H-02: you can now create an event from a contact).
  const [searchParams, setSearchParams] = useSearchParams();
  const contactIdParam = searchParams.get('contactId') || '';
  useEffect(() => {
    if (contactIdParam) setShowForm(true);
  }, [contactIdParam]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/api/events?search=${encodeURIComponent(search)}`);
      setEvents(res.data || []);
    } catch (error) {
      console.error('Failed to load events:', error);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const open = events.filter((e) => e.status !== 'lost' && e.status !== 'cancelled');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Events</h1>
          <p className="text-gray-500">Every enquiry, booking and party in one place</p>
        </div>
        <button onClick={() => setShowForm(true)} className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700">
          <Plus className="w-4 h-4" /> New Enquiry
        </button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by event or client name..."
            className="w-full pl-10 pr-4 py-2 border rounded-lg"
          />
        </div>
        <div className="flex border rounded-lg overflow-hidden">
          <button
            onClick={() => setView('pipeline')}
            className={`flex items-center gap-1 px-3 py-2 text-sm ${view === 'pipeline' ? 'bg-teal-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            <LayoutGrid className="w-4 h-4" /> Pipeline
          </button>
          <button
            onClick={() => setView('list')}
            className={`flex items-center gap-1 px-3 py-2 text-sm ${view === 'list' ? 'bg-teal-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            <List className="w-4 h-4" /> List
          </button>
        </div>
        <span className="text-sm text-gray-500">{open.length} open · {events.length} total</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : events.length === 0 ? (
        <div className="text-center py-12 text-gray-500 bg-white rounded-xl border">No events yet</div>
      ) : view === 'pipeline' ? (
        <PipelineView events={events} />
      ) : (
        <ListView events={events} />
      )}

      {showForm && (
        <NewEventModal initialContactId={contactIdParam} onSave={() => { setShowForm(false); if (contactIdParam) setSearchParams({}); load(); }} onClose={() => { setShowForm(false); if (contactIdParam) setSearchParams({}); }} />
      )}
    </div>
  );
}

/* ---------------- Pipeline ---------------- */

function PipelineView({ events }: { events: EventRow[] }) {
  // Lost and cancelled are deliberately not columns — they'd take a third of
  // the width to show work nobody is doing. The List view has them.
  const columns: EventStatus[] = ['enquiry', 'tentative', 'confirmed', 'completed'];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {columns.map((col) => {
        const rows = events.filter((e) => (e.status || 'enquiry') === col);
        return (
          <div key={col} className="bg-gray-50 rounded-xl border p-3">
            <div className="flex items-center justify-between mb-3 px-1">
              <h2 className="font-semibold text-gray-700 capitalize text-sm">{col}</h2>
              <span className="text-xs bg-white text-gray-500 px-2 py-0.5 rounded-full border">{rows.length}</span>
            </div>
            <div className="space-y-2">
              {rows.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-6">Nothing here</p>
              ) : rows.map((e) => (
                <Link key={e.id} to={`/crm/events/${e.id}`} className="block bg-white rounded-lg border p-3 hover:shadow-md transition">
                  <p className="font-medium text-gray-900 text-sm">{e.name || 'Untitled'}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{e.clientName || 'No client attached'}</p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-400 flex-wrap">
                    <span className="flex items-center gap-1"><CalendarDays className="w-3 h-3" /> {fmtEventDate(e.eventDate)}</span>
                    {(e.guestCountFinal || e.guestCount) && (
                      <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {e.guestCountFinal ?? e.guestCount}</span>
                    )}
                  </div>
                  {e.spaceName && <p className="text-xs text-gray-400 mt-1 flex items-center gap-1"><DoorOpen className="w-3 h-3" /> {e.spaceName}</p>}
                  {e.quotedTotal ? <p className="text-sm font-semibold text-gray-700 mt-2">{money(e.quotedTotal)}</p> : null}
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- List ---------------- */

function ListView({ events }: { events: EventRow[] }) {
  return (
    <div className="bg-white rounded-xl border overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-500 text-left">
          <tr>
            <th className="px-4 py-3 font-medium">Date</th>
            <th className="px-4 py-3 font-medium">Event</th>
            <th className="px-4 py-3 font-medium">Client</th>
            <th className="px-4 py-3 font-medium">Space</th>
            <th className="px-4 py-3 font-medium">Guests</th>
            <th className="px-4 py-3 font-medium">Value</th>
            <th className="px-4 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {events.map((e) => (
            <tr key={e.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                {fmtEventDate(e.eventDate)}
                {e.startTime && <span className="block text-xs text-gray-400">{e.startTime}{e.endTime ? `–${e.endTime}` : ''}</span>}
              </td>
              <td className="px-4 py-3">
                <Link to={`/crm/events/${e.id}`} className="font-medium text-gray-900 hover:text-teal-600">{e.name || 'Untitled'}</Link>
                <span className="block text-xs text-gray-400 capitalize">{prettyType(e.eventType)}</span>
              </td>
              <td className="px-4 py-3 text-gray-600">{e.clientName || '—'}</td>
              <td className="px-4 py-3 text-gray-600">{e.spaceName || '—'}</td>
              <td className="px-4 py-3 text-gray-600">{e.guestCountFinal ?? e.guestCount ?? '—'}</td>
              <td className="px-4 py-3 text-gray-600">{money(e.quotedTotal)}</td>
              <td className="px-4 py-3">
                <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[e.status || ''] || 'bg-gray-100 text-gray-700'}`}>
                  {e.status || 'enquiry'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- New Event Modal ---------------- */

interface SpaceOption { id: string; name?: string; seatedCapacity?: number; standingCapacity?: number }

function NewEventModal({ onSave, onClose, initialContactId }: { onSave: () => void; onClose: () => void; initialContactId?: string }) {
  const [saving, setSaving] = useState(false);
  const [spaces, setSpaces] = useState<SpaceOption[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [contactId, setContactId] = useState<string>(initialContactId || '');
  const [form, setForm] = useState({
    name: '', eventType: 'private_dining', eventDate: '', startTime: '', endTime: '',
    guestCount: '', spaceId: '', coordinatorId: '', source: '', notes: '',
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    (async () => {
      try {
        const [spaceRes, people] = await Promise.all([
          api.get('/api/event-spaces'),
          fetchStaff(),
        ]);
        setSpaces(spaceRes.data || []);
        setStaff(people);
      } catch {
        /* degrade gracefully — an enquiry can be logged without either */
      }
    })();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { alert('Event name is required'); return; }
    if (!form.eventDate) { alert('Event date is required'); return; }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        eventType: form.eventType,
        eventDate: form.eventDate,
        status: 'enquiry',
      };
      if (contactId) payload.contactId = contactId;
      if (form.startTime) payload.startTime = form.startTime;
      if (form.endTime) payload.endTime = form.endTime;
      if (form.guestCount !== '') payload.guestCount = Number(form.guestCount);
      if (form.spaceId) payload.spaceId = form.spaceId;
      if (form.coordinatorId) payload.coordinatorId = form.coordinatorId;
      if (form.source) payload.source = form.source;
      if (form.notes) payload.notes = form.notes;
      await api.post('/api/events', payload);
      onSave();
    } catch (err) {
      alert((err as Error).message || 'Failed to create event');
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
            <h2 className="text-lg font-bold">New Enquiry</h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Event name <span className="text-red-500">*</span></label>
              <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} className="w-full px-3 py-2 border rounded-lg" placeholder="Harper / Diaz wedding" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Client</label>
              <ClientPicker value={contactId} onChange={(id) => setContactId(id)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select value={form.eventType} onChange={(e) => set('eventType', e.target.value)} className="w-full px-3 py-2 border rounded-lg capitalize">
                  {EVENT_TYPES.map((t) => <option key={t} value={t}>{prettyType(t)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Guests</label>
                <input type="number" value={form.guestCount} onChange={(e) => set('guestCount', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date <span className="text-red-500">*</span></label>
                <input type="date" value={form.eventDate} onChange={(e) => set('eventDate', e.target.value)} className="w-full px-3 py-2 border rounded-lg" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">From</label>
                <input type="time" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
                <input type="time" value={form.endTime} onChange={(e) => set('endTime', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Space</label>
                <select value={form.spaceId} onChange={(e) => set('spaceId', e.target.value)} className="w-full px-3 py-2 border rounded-lg">
                  <option value="">Not decided yet</option>
                  {spaces.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}{s.seatedCapacity ? ` (${s.seatedCapacity} seated)` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Coordinator</label>
                <select value={form.coordinatorId} onChange={(e) => set('coordinatorId', e.target.value)} className="w-full px-3 py-2 border rounded-lg">
                  <option value="">Unassigned</option>
                  {staff.map((u) => <option key={u.id} value={u.id}>{staffName(u)}</option>)}
                </select>
              </div>
            </div>
            <p className="text-xs text-gray-400 -mt-2">
              An enquiry doesn't hold the room — the space is only blocked once you move it to Tentative.
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">How did they find you?</label>
              <input type="text" value={form.source} onChange={(e) => set('source', e.target.value)} className="w-full px-3 py-2 border rounded-lg" placeholder="Website, walk-in, referral..." />
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
