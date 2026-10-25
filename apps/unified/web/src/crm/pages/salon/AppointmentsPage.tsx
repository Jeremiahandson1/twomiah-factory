// Moved from templates/crm-salon/frontend/src/pages/salon/AppointmentsPage.tsx.
import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Loader2, X, CalendarDays, Clock, User, Phone, CheckCircle2, Armchair, Scissors, AlertTriangle, RotateCcw, CalendarClock, ChevronLeft, ChevronRight } from 'lucide-react'
import { api } from '../../../api'
import ClientPicker from './ClientPicker';
import ServiceRecordEditorModal from './ServiceRecordEditorModal';
import { fetchStaff, staffName, type StaffMember } from './staff';
import { todayKey as todayStr } from '../../../shared'
import { stylistNameOf as stylistName } from './staff';
import { useToast } from '../../../shared'
import { useConfirm, useMayWrite } from '../../../shared'
import { whenTime, companyDayKey, companyMoment, companyWall, daysUntilDay } from '@twomiah/tenant-ui/src/time/companyClock'
import { addDays, dateWords } from '../../../booking/days'
import { isDayComplete, weekOf, weekHeading, viewBounds, byDay } from './bookWeek'

/**
 * The book — a day, or a week, over /api/appointments?from=&to= (the window's bounds on the company's clock, as ISO).
 *
 * Two actions matter at the desk: check in on arrival, and close the ticket by
 * writing the service record — which the backend also marks the appointment
 * completed for, so nobody has to close it twice.
 *
 * THE WEEK (salon live test, 2026-10-25: "The Book shows one day at a time"). Seven DAY columns, Sunday first as the
 * app's booking calendar, each day's appointments in time order with the stylist named on the card — not a column per
 * stylist. The desk's questions across a week are "what is on Thursday" and "when is there room", which a day column
 * answers at a glance and on a phone (the columns stack); a stylist-by-day grid is fourteen-plus cells wide and reads
 * on neither. "Whose week is this" is the stylist picker, which filters either view to one chair. The week is the same
 * request as the day (one wider window), so whoever may read the day reads the week, and nothing else; a card opens
 * the same actions the day's row has, and a day's heading opens that day.
 */

const STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-gray-100 text-gray-700 dark:text-slate-200 dark:bg-slate-800',
  confirmed: 'bg-blue-100 text-blue-700 dark:text-blue-300 dark:bg-blue-950/40',
  checked_in: 'bg-teal-100 text-teal-700 dark:text-teal-300 dark:bg-teal-950/40',
  in_chair: 'bg-purple-100 text-purple-700 dark:text-purple-300 dark:bg-purple-950/40',
  completed: 'bg-green-100 text-green-700 dark:text-green-300 dark:bg-green-950/40',
  no_show: 'bg-amber-100 text-amber-700 dark:text-amber-300 dark:bg-amber-950/40',
  cancelled: 'bg-red-100 text-red-700 dark:text-red-400 dark:bg-red-950/40',
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
  stylistMemberName?: string;
  stylistLastName?: string;
}
interface ServiceOption { id: string; name?: string; durationMin?: number; price?: string | number; requiresPatchTest?: boolean }
interface ClientProfileLite { allergies?: string | null; patchTestAt?: string | null }

// Allergy + patch-test warnings come from the client profile the salon keeps; a patch test older
// than 6 months (or none) on a service that requires one is flagged. (SALON-H3)
const PATCH_TEST_VALID_DAYS = 180;
function visitWarnings(profile: ClientProfileLite | null | undefined, service: ServiceOption | null | undefined): string[] {
  const out: string[] = [];
  if (profile?.allergies && profile.allergies.trim()) out.push(`Allergies on file: ${profile.allergies.trim()}`);
  if (service?.requiresPatchTest) {
    // Whole days since the test's day, counted from the company's today (not the browser's clock).
    const at = profile?.patchTestAt && /^\d{4}-\d{2}-\d{2}/.test(String(profile.patchTestAt)) ? String(profile.patchTestAt).slice(0, 10) : null;
    const ageDays = at ? -daysUntilDay(at) : Infinity;
    if (ageDays > PATCH_TEST_VALID_DAYS) out.push(at ? `${service.name || 'This service'} needs a patch test — last one was ${Math.round(ageDays)} days ago` : `${service.name || 'This service'} needs a patch test — none on file`);
  }
  return out;
}
async function loadProfile(contactId: string): Promise<ClientProfileLite | null> {
  try { const d = await api.get(`/api/clients/${contactId}`); return (d?.profile as ClientProfileLite) || null; } catch { return null; }
}

// The day's window on the COMPANY's clock, a day's and a week's days, and the week laid out by day: ./bookWeek.ts.
export { isDayComplete } from './bookWeek';

/** The heading for a day, or null while the one being typed is not a day yet. */
export function dayHeading(day: string, today: string): string | null {
  if (!isDayComplete(day)) return null;
  if (day === today) return "Today's chairs";
  return `Chairs on ${new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}`;
}

function fmtTime(s?: string): string {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '—';
  return whenTime(d, { hour: 'numeric', minute: '2-digit' });
}

// stylistName lives in lib/staff.ts — one definition, and it knows about roster stylists. (T28 M6)

export default function AppointmentsPage() {
  // Booking and logging a service are schedule:create; everything that moves an appointment is schedule:update. The
  // read-only seat was offered New Appointment and every row's buttons. (T43 viewer round, T68)
  const mayBook = useMayWrite('schedule:create');
  const mayMove = useMayWrite('schedule:update');
  const confirm = useConfirm();
  const toast = useToast();
  const [day, setDay] = useState<string>(todayStr());
  const [view, setView] = useState<'day' | 'week'>('day');
  // One chair's book, or everyone's (''): the stylists come from the appointments on screen, roster-only ones included.
  const [stylistFilter, setStylistFilter] = useState<string>('');
  // The week's card that was clicked: its actions open over the week.
  const [picked, setPicked] = useState<Appointment | null>(null);
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [showForm, setShowForm] = useState<boolean>(false);
  const [closing, setClosing] = useState<Appointment | null>(null);
  const [resched, setResched] = useState<Appointment | null>(null);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const navigate = useNavigate();
  // The heading for the day whose rows are actually on screen — held while a new date is being typed.
  const [shownHeading, setShownHeading] = useState<string>(() => dayHeading(todayStr(), todayStr()) ?? "Today's chairs");
  useEffect(() => {
    const h = view === 'week' ? weekHeading(day) : dayHeading(day, todayStr());
    if (h) setShownHeading(h);
  }, [day, view]);
  useEffect(() => { api.get('/api/service-menu').then((r) => setServices(r.data || [])).catch(() => setServices([])); }, []);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  useEffect(() => { fetchStaff().then(setStaff).catch(() => setStaff([])); }, []);

  // Closing a visit creates the sale (backend); offer to take payment right away. (SALON-H4)
  const offerCheckout = async (invoiceId?: string | null) => {
    if (invoiceId && await confirm('Sale created for this visit. Take payment now?', { title: 'Take payment?', confirmText: 'Open the sale', danger: false })) navigate(`/crm/invoices/${invoiceId}`);
  };

  const load = useCallback(async () => {
    // Mid-keystroke the date is not a day yet. Don't fetch, don't throw, and above all don't leave the
    // previous day's rows under a heading claiming to be some other day. (T20 M5)
    if (!isDayComplete(day)) return;
    setLoading(true);
    try {
      const { from, to } = viewBounds(view, day);
      const res = await api.get(`/api/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      const rows: Appointment[] = res.data || [];
      rows.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
      setAppts(rows);
    } catch (error) {
      console.error('Failed to load appointments:', error);
    } finally {
      setLoading(false);
    }
  }, [day, view]);

  useEffect(() => { load(); }, [load]);

  const checkIn = async (a: Appointment) => {
    try {
      if (a.contactId) {
        const warnings = visitWarnings(await loadProfile(a.contactId), services.find((s) => s.id === a.serviceId));
        if (warnings.length && !(await confirm(warnings.join('\n'), { title: 'Before you check them in', confirmText: 'Check in anyway', danger: false }))) return;
      }
      await api.post(`/api/appointments/${a.id}/check-in`);
      load();
    } catch (err) {
      toast.error((err as Error).message || 'Failed to check in');
    }
  };

  // Cancel / no-show / complete so a chair can be freed and no-shows tracked. (CC-25)
  const setStatus = async (a: Appointment, status: string) => {
    if (status === 'cancelled' && !(await confirm(`Cancel ${a.clientName || 'this'} appointment? You can reopen it afterwards.`, { title: 'Cancel appointment', confirmText: 'Cancel it' }))) return;
    if (status === 'no_show' && !(await confirm(`Mark ${a.clientName || 'this client'} as a no-show? You can reopen it afterwards.`, { title: 'Mark a no-show', confirmText: 'Mark no-show' }))) return;
    try {
      const res = await api.put(`/api/appointments/${a.id}`, { status });
      load();
      if (status === 'completed') offerCheckout(res?.invoiceId as string | undefined);
    } catch (err) {
      toast.error((err as Error).message || 'Failed to update the appointment');
    }
  };

  // The picker: who holds a chair (the same list the booking form offers), and anyone else with a booking on screen.
  const stylists = Array.from(new Map([
    ...staff.map((u) => [u.id, staffName(u)] as [string, string]),
    ...appts.filter((a) => a.stylistId).map((a) => [a.stylistId as string, stylistName(a) || 'Stylist'] as [string, string]),
  ]).entries()).sort((a, b) => a[1].localeCompare(b[1]));
  const shown = stylistFilter ? appts.filter((a) => a.stylistId === stylistFilter) : appts;

  const booked = shown.filter((a) => !CLOSED.has(a.status || 'scheduled')).length;
  // Completed and cancelled are opposite outcomes; don't lump them under one label. (CC-24)
  const done = shown.filter((a) => (a.status || '') === 'completed').length;
  const cancelled = shown.filter((a) => { const s = a.status || ''; return s === 'cancelled' || s === 'no_show'; }).length;

  /**
   * What can be done to an appointment, one list for the day's row and the week's card — the same buttons on the same
   * permissions either way. `then` runs after a button is pressed (the week closes its card's dialog).
   */
  const actionsFor = (a: Appointment, then: () => void = () => {}) => (
    <>
      {mayMove && NOT_CHECKED_IN.has(a.status || 'scheduled') && (
        <button onClick={() => { then(); checkIn(a); }} className="flex items-center gap-1 px-3 py-1.5 bg-teal-700 text-white rounded-lg hover:bg-teal-800 text-sm">
          <CheckCircle2 className="w-4 h-4" /> Check In
        </button>
      )}
      {mayBook && !CLOSED.has(a.status || 'scheduled') && a.contactId && (
        <button onClick={() => { then(); setClosing(a); }} className="flex items-center gap-1 px-3 py-1.5 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 text-sm">
          <Scissors className="w-4 h-4" /> Log Service
        </button>
      )}
      {mayMove && !CLOSED.has(a.status || 'scheduled') && (
        <button onClick={() => { then(); setResched(a); }} className="flex items-center gap-1 px-3 py-1.5 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 text-sm" title="Move to another day or time">
          <CalendarClock className="w-4 h-4" /> Reschedule
        </button>
      )}
      {mayMove && CLOSED.has(a.status || 'scheduled') && a.status !== 'completed' && (
        <button onClick={() => { then(); setStatus(a, 'scheduled'); }} className="flex items-center gap-1 px-3 py-1.5 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 text-sm" title="Undo the cancellation / no-show">
          <RotateCcw className="w-4 h-4" /> Reopen
        </button>
      )}
      {mayMove && !CLOSED.has(a.status || 'scheduled') && (
        <>
          <button onClick={() => { then(); setStatus(a, 'completed'); }} className="px-3 py-1.5 border border-green-200 dark:border-green-700 text-green-700 dark:text-green-300 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/30 text-sm">Complete</button>
          <button onClick={() => { then(); setStatus(a, 'no_show'); }} className="px-3 py-1.5 border border-amber-300 dark:border-amber-600 text-amber-700 dark:text-amber-300 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/30 text-sm">No-Show</button>
          <button onClick={() => { then(); setStatus(a, 'cancelled'); }} className="px-3 py-1.5 border border-red-200 text-red-700 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-sm">Cancel</button>
        </>
      )}
    </>
  );
  const statusPill = (a: Appointment) => (
    <span className={`text-xs px-2 py-1 rounded-full capitalize ${STATUS_COLORS[a.status || ''] || 'bg-gray-100 text-gray-700 dark:text-slate-200 dark:bg-slate-800'} dark:text-slate-200`}>
      {(a.status || 'scheduled').replace('_', ' ')}
    </span>
  );
  const clientLink = (a: Appointment) => a.contactId
    ? <Link to={`/crm/clients/${a.contactId}`} className="hover:text-teal-700 dark:hover:text-teal-300">{a.clientName || 'Client'}</Link>
    : <>{a.clientName || 'Walk-in'}</>;
  const days = weekOf(isDayComplete(day) ? day : todayStr());
  const week = byDay(shown, days);
  const today = todayStr();
  const heading = view === 'week' ? (weekHeading(day) ?? shownHeading) : (dayHeading(day, today) ?? shownHeading);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">The Book</h1>
          {/* While a date is half-typed the heading HOLDS what is actually on screen rather than
              rendering "Chairs on Invalid Date" over the previous day's rows. (T20 M5) */}
          <p className="text-gray-500 dark:text-slate-400">{heading}</p>
        </div>
        {mayBook && <button onClick={() => setShowForm(true)} className="flex items-center gap-2 px-4 py-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800">
          <Plus className="w-4 h-4" /> New Appointment
        </button>}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="inline-flex rounded-lg border p-0.5" role="group" aria-label="Show the book by">
          {(['day', 'week'] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium ${view === v ? 'bg-teal-700 text-white' : 'text-gray-600 hover:bg-gray-50 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
              {v === 'day' ? 'Day' : 'Week'}
            </button>
          ))}
        </div>
        {view === 'week' && (
          <button type="button" onClick={() => isDayComplete(day) && setDay(addDays(day, -7))} aria-label="Previous week" className="p-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800"><ChevronLeft className="w-4 h-4" /></button>
        )}
        <div className="relative">
          <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label={view === 'week' ? 'A day in the week to show' : 'Day to show'} className="pl-10 pr-4 py-2 border rounded-lg" />
        </div>
        {view === 'week' && (
          <button type="button" onClick={() => isDayComplete(day) && setDay(addDays(day, 7))} aria-label="Next week" className="p-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800"><ChevronRight className="w-4 h-4" /></button>
        )}
        <button onClick={() => setDay(todayStr())} className="px-3 py-2 border rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-slate-800">Today</button>
        <select value={stylistFilter} onChange={(e) => setStylistFilter(e.target.value)} aria-label="Stylist" className="px-3 py-2 border rounded-lg text-sm">
          <option value="">All stylists</option>
          {stylists.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <span className="text-sm text-gray-500 dark:text-slate-400">
          {booked} booked{done ? ` · ${done} done` : ''}{cancelled ? ` · ${cancelled} cancelled / no-show` : ''}
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : view === 'week' ? (
        <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
          {days.map((d) => (
            <section key={d} aria-label={dateWords(d, { weekday: 'long', month: 'long', day: 'numeric' })} className="bg-white rounded-xl border min-w-0 dark:bg-slate-900">
              {/* A day's heading opens that day in the day view, where the whole row of each booking is. */}
              <button type="button" onClick={() => { setDay(d); setView('day'); }} title="Open this day"
                className={`w-full px-2 py-2 border-b text-left md:text-center rounded-t-xl ${d === today ? 'bg-teal-700 text-white' : 'text-gray-700 hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-slate-800'}`}>
                <span className="text-xs font-medium uppercase">{dateWords(d, { weekday: 'short' })}</span>{' '}
                <span className="text-sm font-bold">{dateWords(d, { month: 'short', day: 'numeric' })}</span>
                <span className={`block text-xs ${d === today ? 'text-teal-50' : 'text-gray-500 dark:text-slate-400'}`}>
                  {week[d].filter((a) => !CLOSED.has(a.status || 'scheduled')).length} booked
                </span>
              </button>
              <div className="p-1.5 space-y-1.5 md:min-h-[320px]">
                {week[d].length === 0 && <p className="text-xs text-gray-500 px-1 py-2 dark:text-slate-400">Nothing booked</p>}
                {week[d].map((a) => (
                  <button key={a.id} type="button" onClick={() => setPicked(a)}
                    className={`w-full text-left rounded-lg border px-2 py-1.5 text-xs hover:border-teal-500 dark:hover:border-teal-300 ${CLOSED.has(a.status || 'scheduled') ? 'bg-gray-50 opacity-75 dark:bg-slate-800' : 'bg-white dark:bg-slate-900'}`}>
                    <span className="block font-semibold text-gray-900 dark:text-slate-100">{fmtTime(a.startTime)}</span>
                    <span className="block truncate text-gray-900 dark:text-slate-100">{a.clientName || 'Walk-in'}</span>
                    {a.serviceName && <span className="block truncate text-gray-600 dark:text-slate-300">{a.serviceName}</span>}
                    {stylistName(a) && <span className="block truncate text-gray-500 dark:text-slate-400">{stylistName(a)}</span>}
                    {(a.status || 'scheduled') !== 'scheduled' && <span className="mt-1 inline-block">{statusPill(a)}</span>}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="text-center py-12 text-gray-500 bg-white rounded-xl border dark:text-slate-400 dark:bg-slate-900">Nothing booked this day</div>
      ) : (
        <div className="space-y-2">
          {shown.map((a) => (
            <div key={a.id} className="bg-white rounded-xl border p-4 flex items-center gap-4 flex-wrap dark:bg-slate-900">
              <div className="flex items-center gap-2 text-gray-900 font-medium w-40 dark:text-slate-100">
                <Clock className="w-4 h-4 text-gray-400" />
                {fmtTime(a.startTime)}
                {a.endTime && <span className="text-xs text-gray-500 dark:text-slate-400">– {fmtTime(a.endTime)}</span>}
              </div>
              <div className="flex-1 min-w-[180px]">
                <p className="font-medium text-gray-900 dark:text-slate-100">{clientLink(a)}</p>
                <p className="text-sm text-gray-500 flex items-center gap-2 flex-wrap dark:text-slate-400">
                  {a.serviceName && <span className="flex items-center gap-1"><Scissors className="w-3 h-3" /> {a.serviceName}</span>}
                  {(a.clientMobile || a.clientPhone) && (
                    <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {a.clientMobile || a.clientPhone}</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2 text-sm">
                {a.station && <span className="text-xs text-gray-500 dark:text-slate-400 flex items-center gap-1"><Armchair className="w-3 h-3" /> {a.station}</span>}
                {stylistName(a) && <span className="text-xs text-gray-500 dark:text-slate-400 flex items-center gap-1"><User className="w-3 h-3" /> {stylistName(a)}</span>}
              </div>
              {statusPill(a)}
              {actionsFor(a)}
            </div>
          ))}
        </div>
      )}

      {/* A week card's appointment: everything the day's row shows and the same buttons. */}
      {picked && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black/50" onClick={() => setPicked(null)} />
          <div className="relative min-h-screen flex items-start justify-center p-4 py-8">
            <div role="dialog" aria-modal="true" aria-label="Appointment" className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6 dark:bg-slate-900">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <h2 className="text-lg font-bold text-gray-900 dark:text-slate-100">{clientLink(picked)}</h2>
                  <p className="text-sm text-gray-600 dark:text-slate-300">
                    {dateWords(companyDayKey(picked.startTime), { weekday: 'long', month: 'short', day: 'numeric' })} · {fmtTime(picked.startTime)}{picked.endTime ? ` – ${fmtTime(picked.endTime)}` : ''}
                  </p>
                </div>
                <button aria-label="Close" onClick={() => setPicked(null)} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-slate-200"><X className="w-5 h-5" /></button>
              </div>
              <div className="space-y-1 text-sm text-gray-600 dark:text-slate-300 mb-4">
                {picked.serviceName && <p className="flex items-center gap-2"><Scissors className="w-4 h-4" /> {picked.serviceName}</p>}
                {stylistName(picked) && <p className="flex items-center gap-2"><User className="w-4 h-4" /> {stylistName(picked)}</p>}
                {picked.station && <p className="flex items-center gap-2"><Armchair className="w-4 h-4" /> {picked.station}</p>}
                {(picked.clientMobile || picked.clientPhone) && <p className="flex items-center gap-2"><Phone className="w-4 h-4" /> {picked.clientMobile || picked.clientPhone}</p>}
                <p>{statusPill(picked)}</p>
              </div>
              <div className="flex flex-wrap gap-2">{actionsFor(picked, () => setPicked(null))}</div>
            </div>
          </div>
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
          onSave={(saved) => { setClosing(null); load(); offerCheckout(saved?.invoiceId as string | undefined); }}
          onClose={() => setClosing(null)}
        />
      )}
      {resched && (
        <RescheduleModal appt={resched} onSave={() => { setResched(null); load(); }} onClose={() => setResched(null)} />
      )}
    </div>
  );
}

/* ---------------- Reschedule Modal ---------------- */

// A booked moment's day and time on the COMPANY's clock (now, if none) — what the reschedule boxes show.
function toLocalParts(iso?: string): { date: string; time: string } {
  return companyWall(iso ? new Date(iso) : new Date());
}

// Start + a number of minutes, as "HH:MM". One definition, because the callers used to carry a copy
// each and only one of them was ever written. (Salon T27 N3) — now at module scope, because the
// Reschedule modal needs the same arithmetic as the New Appointment modal. (T41)
const shiftTime = (from: string, minutes: number) => {
  const [h, m] = from.split(':').map(Number);
  const t = (((h * 60 + m + minutes) % 1440) + 1440) % 1440; // wall-clock minutes, no zone
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};
const minutesBetween = (from: string, to: string) => {
  const [fh, fm] = from.split(':').map(Number);
  const [th, tm] = to.split(':').map(Number);
  return (th * 60 + tm) - (fh * 60 + fm);
};

function RescheduleModal({ appt, onSave, onClose }: { appt: Appointment; onSave: () => void; onClose: () => void }) {
  const toast = useToast();
  const start = toLocalParts(appt.startTime);
  const end = appt.endTime ? toLocalParts(appt.endTime) : { date: start.date, time: '' };
  const [date, setDate] = useState(start.date);
  const [startTime, setStartTime] = useState(start.time);
  const [endTime, setEndTime] = useState(end.time);
  const [saving, setSaving] = useState(false);

  /**
   * MOVING THE START HAS TO MOVE THE END. (T41)
   *
   *   "a reschedule keeps the old End time, so the save 400s"
   *
   * The End box held a clock time, not a duration. Move a 09:00–09:45 cut to 14:00 and the modal
   * still said End 09:45, so the payload asked the server to end the appointment five hours before
   * it starts — and the server rightly refused, with a message about end times to somebody who
   * thought they had only changed the start. The New Appointment modal has always shifted the end
   * with the start; this one never did.
   *
   * The appointment's own length is preserved, which is what a reschedule means: the same service,
   * at a different time. An End the operator types by hand is left exactly as typed.
   */
  const onStart = (value: string) => {
    const length = startTime && endTime ? minutesBetween(startTime, endTime) : 0;
    setStartTime(value);
    if (length > 0) setEndTime(shiftTime(value, length));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      // The typed day and times are the company's wall clock.
      const payload: Record<string, unknown> = { startTime: companyMoment(date, startTime).toISOString() };
      if (endTime) payload.endTime = companyMoment(date, endTime).toISOString();
      await api.put(`/api/appointments/${appt.id}`, payload);
      onSave();
    } catch (err) {
      toast.error((err as Error).message || 'Failed to reschedule');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-start justify-center p-4 py-8">
        <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6 dark:bg-slate-900">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">Reschedule {appt.clientName ? `— ${appt.clientName}` : ''}</h2>
            <button aria-label="Close" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div><label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-3 py-2 border rounded-lg" required /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Start</label><input type="time" value={startTime} onChange={(e) => onStart(e.target.value)} className="w-full px-3 py-2 border rounded-lg" required /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">End</label><input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="w-full px-3 py-2 border rounded-lg" /></div>
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-400">Leave End blank to keep the service's normal duration. Stylist and chair conflicts are checked before the move is saved.</p>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800 disabled:opacity-50">{saving ? 'Saving...' : 'Move appointment'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

/* ---------------- New Appointment Modal ---------------- */

function NewAppointmentModal({ defaultDay, onSave, onClose }: { defaultDay: string; onSave: () => void; onClose: () => void }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [stylists, setStylists] = useState<StaffMember[]>([]);
  const [contactId, setContactId] = useState<string>('');
  const [profile, setProfile] = useState<ClientProfileLite | null>(null);
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
      if (svc?.durationMin && f.startTime) next.endTime = shiftTime(f.startTime, svc.durationMin);
      return next;
    });
  };

  // …and so does moving the START. This did nothing, so End kept the time it was given when the
  // service was picked: moving Start later gave a red "end must be after start", moving it EARLIER
  // saved silently as a seven-and-a-half-hour booking. The appointment keeps its LENGTH when it is
  // dragged through the day, which is what the person at the desk means. (Salon T27 N3)
  const onStart = (value: string) => {
    setForm((f) => {
      const next = { ...f, startTime: value };
      if (!value) return next;
      const svc = services.find((s) => s.id === f.serviceId);
      // the length to preserve: what is on the form now, else the service, else an hour
      const length = f.startTime && f.endTime
        ? minutesBetween(f.startTime, f.endTime)
        : (svc?.durationMin ?? 60);
      if (length > 0) next.endTime = shiftTime(value, length);
      return next;
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactId) { toast.error('A client is required'); return; }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        contactId,
        startTime: companyMoment(form.date, form.startTime).toISOString(), // the company's wall clock
        status: 'scheduled',
      };
      if (form.serviceId) payload.serviceId = form.serviceId;
      if (form.stylistId) payload.stylistId = form.stylistId;
      // Left blank, the backend derives the end from the service duration.
      if (form.endTime) payload.endTime = companyMoment(form.date, form.endTime).toISOString();
      if (form.station) payload.station = form.station;
      if (form.quotedPrice !== '') payload.quotedPrice = Number(form.quotedPrice);
      if (form.notes) payload.notes = form.notes;
      await api.post('/api/appointments', payload);
      onSave();
    } catch (err) {
      toast.error((err as Error).message || 'Failed to create appointment');
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
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Client <span className="text-red-700 dark:text-red-400">*</span></label>
              <ClientPicker value={contactId} onChange={(id) => { setContactId(id); setProfile(null); if (id) loadProfile(id).then(setProfile); }} />
            </div>
            {visitWarnings(profile, services.find((s) => s.id === form.serviceId)).length > 0 && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-sm dark:text-amber-300 dark:bg-amber-950/40">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <ul className="space-y-1">{visitWarnings(profile, services.find((s) => s.id === form.serviceId)).map((w) => <li key={w}>{w}</li>)}</ul>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Service</label>
                <select value={form.serviceId} onChange={(e) => onService(e.target.value)} className="w-full px-3 py-2 border rounded-lg">
                  <option value="">Select service...</option>
                  {services.map((s) => <option key={s.id} value={s.id}>{s.name || 'Untitled'}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Stylist</label>
                <select value={form.stylistId} onChange={(e) => set('stylistId', e.target.value)} className="w-full px-3 py-2 border rounded-lg">
                  <option value="">Unassigned</option>
                  {stylists.map((u) => <option key={u.id} value={u.id}>{staffName(u)}</option>)}
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
                <input type="time" value={form.startTime} onChange={(e) => onStart(e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">End</label>
                <input type="time" value={form.endTime} onChange={(e) => set('endTime', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Chair / Room</label>
                <input type="text" value={form.station} onChange={(e) => set('station', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Quoted price ($)</label>
                <input type="number" step="any" value={form.quotedPrice} onChange={(e) => set('quotedPrice', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Notes</label>
              <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} className="w-full px-3 py-2 border rounded-lg" />
            </div>
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
