import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Loader2, CalendarDays, Users, DoorOpen, Phone, Mail, Plus, X, ArrowLeft,
  UtensilsCrossed, Clock, Wallet, AlertTriangle, ExternalLink, Trash2, Check,
} from 'lucide-react';
import api from '../../services/api';
import { STATUSES, STATUS_COLORS, EVENT_TYPES, fmtEventDate, money, prettyType } from './EventsPage';

/**
 * The event file — GET /api/events/:id returns
 * { event, client, space, menu[], timeline[], payments[], totals }.
 *
 * Three tabs because three different people use this page: sales works the
 * menu and the money, the coordinator works the run of show, and the kitchen
 * prints the BEO that stitches all three together.
 */

const DEPARTMENTS = ['floor', 'kitchen', 'bar', 'av', 'setup'];

interface EventFull {
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
  depositRequired?: number | string;
  source?: string;
  lostReason?: string;
  dietaryRequirements?: string;
  setupNotes?: string;
  notes?: string;
  contactId?: string;
  spaceId?: string;
  coordinatorId?: string;
}
interface Client { id?: string; name?: string; email?: string; phone?: string; mobile?: string }
interface Space { id?: string; name?: string; seatedCapacity?: number; standingCapacity?: number; minimumSpend?: number | string }
interface MenuLine { id: string; name?: string; perPerson?: boolean; quantity?: number; unitPrice?: number | string; notes?: string; packageId?: string }
interface TimelineLine { id: string; time?: string; title?: string; department?: string; details?: string; sortOrder?: number }
interface PaymentLine { id: string; label?: string; amount?: number | string; dueDate?: string; paidAt?: string | null; method?: string; reference?: string }
interface Totals { menuTotal?: number; paid?: number; outstanding?: number; quoted?: number }
interface Detail {
  event?: EventFull;
  client?: Client | null;
  space?: Space | null;
  menu?: MenuLine[];
  timeline?: TimelineLine[];
  payments?: PaymentLine[];
  totals?: Totals;
}
interface PackageOption { id: string; name?: string; pricePerPerson?: number | string; minGuests?: number; category?: string }
interface SpaceOption { id: string; name?: string; seatedCapacity?: number }
interface StaffOption { id: string; firstName?: string; lastName?: string }

function money2(v: number | string | undefined | null): string {
  return `$${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function lineTotal(l: MenuLine): number {
  return Number(l.unitPrice || 0) * Number(l.quantity || 0);
}
function isOverdue(dueDate?: string, paidAt?: string | null): boolean {
  if (paidAt || !dueDate) return false;
  return dueDate < new Date().toISOString().slice(0, 10);
}

type Tab = 'menu' | 'runsheet' | 'money';

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [tab, setTab] = useState<Tab>('menu');
  const [showEdit, setShowEdit] = useState<boolean>(false);
  const [showMenu, setShowMenu] = useState<boolean>(false);
  const [showTimeline, setShowTimeline] = useState<boolean>(false);
  const [showPayment, setShowPayment] = useState<boolean>(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await api.get(`/api/events/${id}`);
      setDetail(res || {});
    } catch (error) {
      console.error('Failed to load event:', error);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (status: string) => {
    if (!id) return;
    try {
      await api.put(`/api/events/${id}`, { status });
      load();
    } catch (err) {
      // A 409 here is the double-book guard: another event already holds the room.
      alert((err as Error).message || 'Failed to change status');
    }
  };

  const removeLine = async (kind: 'menu' | 'timeline' | 'payments', lineId: string) => {
    if (!id) return;
    try {
      await api.delete(`/api/events/${id}/${kind}`, lineId);
      load();
    } catch {
      alert('Failed to remove');
    }
  };

  const markPaid = async (p: PaymentLine) => {
    if (!id) return;
    try {
      await api.put(`/api/events/${id}/payments/${p.id}`, { paidAt: new Date().toISOString() });
      load();
    } catch (err) {
      alert((err as Error).message || 'Failed to mark paid');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const ev = detail.event;
  if (!ev) {
    return (
      <div className="text-center py-12 text-gray-500">
        Event not found. <Link to="/crm/events" className="text-teal-600">Back to events</Link>
      </div>
    );
  }

  const client = detail.client;
  const space = detail.space;
  const menu = detail.menu || [];
  const timeline = detail.timeline || [];
  const payments = detail.payments || [];
  const totals = detail.totals || {};
  const heads = ev.guestCountFinal ?? ev.guestCount ?? 0;

  // The minimum-spend check is the whole reason a venue takes private events —
  // showing it here means nobody has to work it out on a calculator mid-call.
  const minSpend = Number(space?.minimumSpend || 0);
  const belowMinimum = minSpend > 0 && Number(totals.menuTotal || 0) < minSpend;

  const tabs: { id: Tab; label: string; icon: React.ReactNode; count: number }[] = [
    { id: 'menu', label: 'Food & Beverage', icon: <UtensilsCrossed className="w-4 h-4" />, count: menu.length },
    { id: 'runsheet', label: 'Run of Show', icon: <Clock className="w-4 h-4" />, count: timeline.length },
    { id: 'money', label: 'Payments', icon: <Wallet className="w-4 h-4" />, count: payments.length },
  ];

  return (
    <div className="space-y-6">
      <Link to="/crm/events" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="w-4 h-4" /> Events
      </Link>

      {/* Header */}
      <div className="bg-white rounded-xl border p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{ev.name || 'Untitled event'}</h1>
            <p className="text-gray-500 capitalize">
              {prettyType(ev.eventType)}
              {client?.name ? ` · ${client.name}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={ev.status || 'enquiry'}
              onChange={(e) => setStatus(e.target.value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize border ${STATUS_COLORS[ev.status || ''] || 'bg-gray-100 text-gray-700'}`}
            >
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={() => setShowEdit(true)} className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50">Edit</button>
            <button
              onClick={() => window.open(`/api/events/${ev.id}/beo`, '_blank')}
              className="flex items-center gap-1 px-3 py-1.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm"
            >
              <ExternalLink className="w-4 h-4" /> Print BEO
            </button>
          </div>
        </div>

        {ev.dietaryRequirements && (
          <div className="mt-4 flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 rounded-lg p-3">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Dietary requirements</p>
              <p className="text-sm">{ev.dietaryRequirements}</p>
            </div>
          </div>
        )}

        {belowMinimum && (
          <div className="mt-4 flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Below minimum spend</p>
              <p className="text-sm">
                {space?.name} has a {money2(minSpend)} minimum. This event is at {money2(totals.menuTotal)} —
                {' '}{money2(minSpend - Number(totals.menuTotal || 0))} short.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <div className="border rounded-lg p-3">
            <p className="text-xs text-gray-400 uppercase">Date</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{fmtEventDate(ev.eventDate)}</p>
            {ev.startTime && <p className="text-xs text-gray-400">{ev.startTime}{ev.endTime ? ` – ${ev.endTime}` : ''}</p>}
          </div>
          <div className="border rounded-lg p-3">
            <p className="text-xs text-gray-400 uppercase">Guests</p>
            <p className="text-xl font-bold text-gray-900">{heads || '—'}</p>
            <p className="text-xs text-gray-400">{ev.guestCountFinal ? 'guaranteed' : 'estimated'}</p>
          </div>
          <div className="border rounded-lg p-3">
            <p className="text-xs text-gray-400 uppercase">F&amp;B Total</p>
            <p className="text-xl font-bold text-gray-900">{money2(totals.menuTotal)}</p>
            {heads > 0 && <p className="text-xs text-gray-400">{money2(Number(totals.menuTotal || 0) / heads)} / head</p>}
          </div>
          <div className={`border rounded-lg p-3 ${Number(totals.outstanding || 0) > 0 ? 'bg-amber-50 border-amber-200' : ''}`}>
            <p className="text-xs text-gray-400 uppercase">Outstanding</p>
            <p className="text-xl font-bold text-gray-900">{money2(totals.outstanding)}</p>
            <p className="text-xs text-gray-400">{money2(totals.paid)} paid</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div className="border rounded-lg p-3">
            <p className="text-xs font-medium text-gray-400 uppercase mb-2">Client</p>
            {client ? (
              <>
                <p className="font-medium text-gray-900">
                  {ev.contactId ? <Link to={`/crm/contacts`} className="hover:text-teal-600">{client.name}</Link> : client.name}
                </p>
                {(client.mobile || client.phone) && <p className="text-sm text-gray-500 flex items-center gap-2 mt-1"><Phone className="w-3 h-3" /> {client.mobile || client.phone}</p>}
                {client.email && <p className="text-sm text-gray-500 flex items-center gap-2 mt-1"><Mail className="w-3 h-3" /> {client.email}</p>}
              </>
            ) : <p className="text-sm text-gray-400">No client attached</p>}
          </div>
          <div className="border rounded-lg p-3">
            <p className="text-xs font-medium text-gray-400 uppercase mb-2">Space</p>
            {space ? (
              <>
                <p className="font-medium text-gray-900 flex items-center gap-2"><DoorOpen className="w-4 h-4 text-gray-400" /> {space.name}</p>
                <p className="text-sm text-gray-500 mt-1 flex items-center gap-2">
                  <Users className="w-3 h-3" />
                  {space.seatedCapacity ? `${space.seatedCapacity} seated` : ''}
                  {space.standingCapacity ? ` · ${space.standingCapacity} standing` : ''}
                </p>
                {minSpend > 0 && <p className="text-xs text-gray-400 mt-1">Minimum spend {money2(minSpend)}</p>}
              </>
            ) : <p className="text-sm text-gray-400">No space assigned</p>}
          </div>
        </div>

        {ev.setupNotes && (
          <div className="mt-4">
            <p className="text-xs font-medium text-gray-400 uppercase mb-1">Setup</p>
            <p className="text-sm text-gray-600 whitespace-pre-wrap">{ev.setupNotes}</p>
          </div>
        )}
        {ev.notes && <p className="text-sm text-gray-500 mt-3 whitespace-pre-wrap">{ev.notes}</p>}
        {ev.status === 'lost' && ev.lostReason && (
          <p className="text-sm text-red-700 mt-3"><span className="font-medium">Lost:</span> {ev.lostReason}</p>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${
              tab === t.id ? 'border-teal-600 text-teal-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.icon} {t.label}
            <span className="text-xs bg-gray-100 text-gray-500 px-1.5 rounded-full">{t.count}</span>
          </button>
        ))}
      </div>

      {/* Food & beverage */}
      {tab === 'menu' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => setShowMenu(true)} className="flex items-center gap-2 px-3 py-1.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm">
              <Plus className="w-4 h-4" /> Add Line
            </button>
          </div>
          {menu.length === 0 ? (
            <div className="text-center py-10 text-gray-400 bg-white rounded-xl border">Nothing on the menu yet</div>
          ) : (
            <div className="bg-white rounded-xl border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">Item</th>
                    <th className="px-4 py-3 font-medium">Basis</th>
                    <th className="px-4 py-3 font-medium text-right">Qty</th>
                    <th className="px-4 py-3 font-medium text-right">Unit</th>
                    <th className="px-4 py-3 font-medium text-right">Total</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {menu.map((l) => (
                    <tr key={l.id}>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {l.name}
                        {l.notes && <span className="block text-xs text-gray-400 font-normal">{l.notes}</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{l.perPerson ? 'per person' : 'flat'}</td>
                      <td className="px-4 py-3 text-gray-600 text-right">{l.quantity}</td>
                      <td className="px-4 py-3 text-gray-600 text-right">{money2(l.unitPrice)}</td>
                      <td className="px-4 py-3 text-gray-900 font-medium text-right">{money2(lineTotal(l))}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => removeLine('menu', l.id)} className="text-gray-400 hover:text-red-600" title="Remove"><Trash2 className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50">
                    <td colSpan={4} className="px-4 py-3 text-right font-semibold text-gray-700">Total</td>
                    <td className="px-4 py-3 text-right font-bold text-gray-900">{money2(totals.menuTotal)}</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Run of show */}
      {tab === 'runsheet' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => setShowTimeline(true)} className="flex items-center gap-2 px-3 py-1.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm">
              <Plus className="w-4 h-4" /> Add Step
            </button>
          </div>
          {timeline.length === 0 ? (
            <div className="text-center py-10 text-gray-400 bg-white rounded-xl border">No run of show yet</div>
          ) : (
            <div className="space-y-2">
              {timeline.map((t) => (
                <div key={t.id} className="bg-white rounded-xl border p-4 flex items-start gap-4">
                  <div className="w-16 font-medium text-gray-900">{t.time}</div>
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">{t.title}</p>
                    {t.details && <p className="text-sm text-gray-500 mt-0.5">{t.details}</p>}
                  </div>
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full capitalize">{t.department}</span>
                  <button onClick={() => removeLine('timeline', t.id)} className="text-gray-400 hover:text-red-600" title="Remove"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Payments */}
      {tab === 'money' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => setShowPayment(true)} className="flex items-center gap-2 px-3 py-1.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm">
              <Plus className="w-4 h-4" /> Schedule Payment
            </button>
          </div>
          {payments.length === 0 ? (
            <div className="text-center py-10 text-gray-400 bg-white rounded-xl border">No payment schedule yet</div>
          ) : (
            <div className="bg-white rounded-xl border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">Stage</th>
                    <th className="px-4 py-3 font-medium">Due</th>
                    <th className="px-4 py-3 font-medium text-right">Amount</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {payments.map((p) => (
                    <tr key={p.id} className={isOverdue(p.dueDate, p.paidAt) ? 'bg-red-50' : ''}>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {p.label}
                        {p.method && <span className="block text-xs text-gray-400 font-normal">{p.method}{p.reference ? ` · ${p.reference}` : ''}</span>}
                      </td>
                      <td className={`px-4 py-3 ${isOverdue(p.dueDate, p.paidAt) ? 'text-red-700 font-medium' : 'text-gray-600'}`}>
                        {p.dueDate || '—'}{isOverdue(p.dueDate, p.paidAt) ? ' (overdue)' : ''}
                      </td>
                      <td className="px-4 py-3 text-gray-900 font-medium text-right">{money2(p.amount)}</td>
                      <td className="px-4 py-3">
                        {p.paidAt ? (
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                            Paid {new Date(p.paidAt).toISOString().slice(0, 10)}
                          </span>
                        ) : (
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">Scheduled</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {!p.paidAt && (
                          <button onClick={() => markPaid(p)} className="inline-flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 mr-3">
                            <Check className="w-3 h-3" /> Mark paid
                          </button>
                        )}
                        <button onClick={() => removeLine('payments', p.id)} className="text-gray-400 hover:text-red-600" title="Remove"><Trash2 className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50">
                    <td colSpan={2} className="px-4 py-3 text-right font-semibold text-gray-700">Paid / Outstanding</td>
                    <td className="px-4 py-3 text-right font-bold text-gray-900">{money2(totals.paid)} / {money2(totals.outstanding)}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showEdit && <EditEventModal event={ev} onSave={() => { setShowEdit(false); load(); }} onClose={() => setShowEdit(false)} />}
      {showMenu && <MenuLineModal eventId={ev.id} heads={heads} onSave={() => { setShowMenu(false); load(); }} onClose={() => setShowMenu(false)} />}
      {showTimeline && <TimelineModal eventId={ev.id} nextOrder={timeline.length + 1} onSave={() => { setShowTimeline(false); load(); }} onClose={() => setShowTimeline(false)} />}
      {showPayment && <PaymentModal eventId={ev.id} suggested={Number(totals.outstanding || 0)} onSave={() => { setShowPayment(false); load(); }} onClose={() => setShowPayment(false)} />}
    </div>
  );
}

/* ---------------- Shared modal shell ---------------- */

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-start justify-center p-4 py-8">
        <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">{title}</h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

function FormButtons({ saving, onClose, label = 'Save' }: { saving: boolean; onClose: () => void; label?: string }) {
  return (
    <div className="flex gap-3 pt-2">
      <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50">Cancel</button>
      <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50">
        {saving ? 'Saving...' : label}
      </button>
    </div>
  );
}

/* ---------------- Edit Event ---------------- */

function EditEventModal({ event: ev, onSave, onClose }: { event: EventFull; onSave: () => void; onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  const [spaces, setSpaces] = useState<SpaceOption[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [form, setForm] = useState({
    name: ev.name || '',
    eventType: ev.eventType || 'private_dining',
    eventDate: ev.eventDate || '',
    startTime: ev.startTime || '',
    endTime: ev.endTime || '',
    guestCount: ev.guestCount?.toString() || '',
    guestCountFinal: ev.guestCountFinal?.toString() || '',
    spaceId: ev.spaceId || '',
    coordinatorId: ev.coordinatorId || '',
    quotedTotal: ev.quotedTotal?.toString() || '',
    depositRequired: ev.depositRequired?.toString() || '',
    dietaryRequirements: ev.dietaryRequirements || '',
    setupNotes: ev.setupNotes || '',
    lostReason: ev.lostReason || '',
    notes: ev.notes || '',
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    (async () => {
      try {
        const [spaceRes, teamRes] = await Promise.all([
          api.get('/api/event-spaces'),
          api.get('/api/team?limit=500'),
        ]);
        setSpaces(spaceRes.data || []);
        setStaff(teamRes.data || []);
      } catch { /* the rest of the form still works */ }
    })();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { alert('Event name is required'); return; }
    setSaving(true);
    try {
      await api.put(`/api/events/${ev.id}`, {
        name: form.name.trim(),
        eventType: form.eventType,
        eventDate: form.eventDate,
        startTime: form.startTime || null,
        endTime: form.endTime || null,
        guestCount: form.guestCount === '' ? null : Number(form.guestCount),
        guestCountFinal: form.guestCountFinal === '' ? null : Number(form.guestCountFinal),
        spaceId: form.spaceId || null,
        coordinatorId: form.coordinatorId || null,
        quotedTotal: form.quotedTotal === '' ? null : Number(form.quotedTotal),
        depositRequired: form.depositRequired === '' ? null : Number(form.depositRequired),
        dietaryRequirements: form.dietaryRequirements || null,
        setupNotes: form.setupNotes || null,
        lostReason: form.lostReason || null,
        notes: form.notes || null,
      });
      onSave();
    } catch (err) {
      alert((err as Error).message || 'Failed to save event');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Edit Event" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Event name <span className="text-red-500">*</span></label>
          <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} className="w-full px-3 py-2 border rounded-lg" required />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
            <input type="date" value={form.eventDate} onChange={(e) => set('eventDate', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
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
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <select value={form.eventType} onChange={(e) => set('eventType', e.target.value)} className="w-full px-3 py-2 border rounded-lg capitalize">
              {EVENT_TYPES.map((t) => <option key={t} value={t}>{prettyType(t)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Guests (est.)</label>
            <input type="number" value={form.guestCount} onChange={(e) => set('guestCount', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Guaranteed</label>
            <input type="number" value={form.guestCountFinal} onChange={(e) => set('guestCountFinal', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Space</label>
            <select value={form.spaceId} onChange={(e) => set('spaceId', e.target.value)} className="w-full px-3 py-2 border rounded-lg">
              <option value="">Not decided yet</option>
              {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Coordinator</label>
            <select value={form.coordinatorId} onChange={(e) => set('coordinatorId', e.target.value)} className="w-full px-3 py-2 border rounded-lg">
              <option value="">Unassigned</option>
              {staff.map((u) => <option key={u.id} value={u.id}>{[u.firstName, u.lastName].filter(Boolean).join(' ') || u.id}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Quoted total ($)</label>
            <input type="number" step="any" value={form.quotedTotal} onChange={(e) => set('quotedTotal', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Deposit required ($)</label>
            <input type="number" step="any" value={form.depositRequired} onChange={(e) => set('depositRequired', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Dietary requirements <span className="text-xs text-gray-400">(shown as a red banner)</span></label>
          <input type="text" value={form.dietaryRequirements} onChange={(e) => set('dietaryRequirements', e.target.value)} className="w-full px-3 py-2 border rounded-lg" placeholder="2 x vegan, 1 x severe nut allergy" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Setup notes</label>
          <textarea value={form.setupNotes} onChange={(e) => set('setupNotes', e.target.value)} rows={2} className="w-full px-3 py-2 border rounded-lg" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Lost reason <span className="text-xs text-gray-400">(only used when status is Lost)</span></label>
          <input type="text" value={form.lostReason} onChange={(e) => set('lostReason', e.target.value)} className="w-full px-3 py-2 border rounded-lg" placeholder="Price, date unavailable, went elsewhere..." />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} className="w-full px-3 py-2 border rounded-lg" />
        </div>
        <FormButtons saving={saving} onClose={onClose} />
      </form>
    </ModalShell>
  );
}

/* ---------------- Menu line ---------------- */

function MenuLineModal({ eventId, heads, onSave, onClose }: { eventId: string; heads: number; onSave: () => void; onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  const [packages, setPackages] = useState<PackageOption[]>([]);
  const [form, setForm] = useState({
    packageId: '', name: '', perPerson: true,
    quantity: heads ? String(heads) : '1', unitPrice: '', notes: '',
  });
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/api/menu-packages');
        setPackages(res.data || []);
      } catch { /* a free-text line still works */ }
    })();
  }, []);

  // Picking a package fills name and per-head price, which is what the line is
  // 90% of the time; the coordinator can still override either.
  const onPackage = (id: string) => {
    const pkg = packages.find((p) => p.id === id);
    setForm((f) => ({
      ...f,
      packageId: id,
      name: pkg?.name || f.name,
      perPerson: true,
      unitPrice: pkg?.pricePerPerson !== undefined && pkg?.pricePerPerson !== null ? String(pkg.pricePerPerson) : f.unitPrice,
    }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.packageId && !form.name.trim()) { alert('Pick a package or type a line name'); return; }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        perPerson: form.perPerson,
        quantity: form.quantity === '' ? 1 : Number(form.quantity),
      };
      if (form.packageId) payload.packageId = form.packageId;
      if (form.name.trim()) payload.name = form.name.trim();
      if (form.unitPrice !== '') payload.unitPrice = Number(form.unitPrice);
      if (form.notes) payload.notes = form.notes;
      await api.post(`/api/events/${eventId}/menu`, payload);
      onSave();
    } catch (err) {
      // A 400 here is usually the package minimum-guest guard.
      alert((err as Error).message || 'Failed to add line');
    } finally {
      setSaving(false);
    }
  };

  const selected = packages.find((p) => p.id === form.packageId);

  return (
    <ModalShell title="Add Menu Line" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Package</label>
          <select value={form.packageId} onChange={(e) => onPackage(e.target.value)} className="w-full px-3 py-2 border rounded-lg">
            <option value="">Free line (room hire, cake fee, bar tab...)</option>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.pricePerPerson ? ` — $${p.pricePerPerson}/head` : ''}{p.minGuests ? ` (min ${p.minGuests})` : ''}
              </option>
            ))}
          </select>
          {selected?.minGuests && heads > 0 && heads < selected.minGuests && (
            <p className="text-xs text-amber-700 mt-1">
              This package needs {selected.minGuests} guests and the event has {heads} — it will be rejected.
            </p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Line name</label>
          <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} className="w-full px-3 py-2 border rounded-lg" placeholder={form.packageId ? 'Leave blank to use the package name' : 'Room hire, cake cutting, bar tab...'} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
            <input type="number" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
            <p className="text-xs text-gray-400 mt-1">{form.perPerson ? 'Number of guests' : 'Number of units'}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Unit price ($)</label>
            <input type="number" step="any" value={form.unitPrice} onChange={(e) => set('unitPrice', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input id="perPerson" type="checkbox" checked={form.perPerson} onChange={(e) => set('perPerson', e.target.checked)} className="w-4 h-4" />
          <label htmlFor="perPerson" className="text-sm font-medium text-gray-700">Priced per person</label>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <input type="text" value={form.notes} onChange={(e) => set('notes', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
        </div>
        <FormButtons saving={saving} onClose={onClose} label="Add" />
      </form>
    </ModalShell>
  );
}

/* ---------------- Timeline line ---------------- */

function TimelineModal({ eventId, nextOrder, onSave, onClose }: { eventId: string; nextOrder: number; onSave: () => void; onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ time: '', title: '', department: 'floor', details: '' });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.time.trim()) { alert('Time is required'); return; }
    if (!form.title.trim()) { alert('Title is required'); return; }
    setSaving(true);
    try {
      await api.post(`/api/events/${eventId}/timeline`, {
        time: form.time.trim(),
        title: form.title.trim(),
        department: form.department,
        details: form.details || null,
        sortOrder: nextOrder,
      });
      onSave();
    } catch (err) {
      alert((err as Error).message || 'Failed to add step');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Add Run-of-Show Step" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Time <span className="text-red-500">*</span></label>
            <input type="time" value={form.time} onChange={(e) => set('time', e.target.value)} className="w-full px-3 py-2 border rounded-lg" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
            <select value={form.department} onChange={(e) => set('department', e.target.value)} className="w-full px-3 py-2 border rounded-lg capitalize">
              {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">What happens <span className="text-red-500">*</span></label>
          <input type="text" value={form.title} onChange={(e) => set('title', e.target.value)} className="w-full px-3 py-2 border rounded-lg" placeholder="Guests arrive — canapes passed" required />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Details</label>
          <textarea value={form.details} onChange={(e) => set('details', e.target.value)} rows={2} className="w-full px-3 py-2 border rounded-lg" />
        </div>
        <FormButtons saving={saving} onClose={onClose} label="Add" />
      </form>
    </ModalShell>
  );
}

/* ---------------- Payment ---------------- */

function PaymentModal({ eventId, suggested, onSave, onClose }: { eventId: string; suggested: number; onSave: () => void; onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    label: 'Deposit',
    amount: suggested > 0 ? String(suggested) : '',
    dueDate: '',
    method: '',
    reference: '',
    paidNow: false,
  });
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.amount === '') { alert('Amount is required'); return; }
    setSaving(true);
    try {
      await api.post(`/api/events/${eventId}/payments`, {
        label: form.label.trim() || 'Payment',
        amount: Number(form.amount),
        dueDate: form.dueDate || null,
        paidAt: form.paidNow ? new Date().toISOString() : null,
        method: form.method || null,
        reference: form.reference || null,
      });
      onSave();
    } catch (err) {
      alert((err as Error).message || 'Failed to schedule payment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Schedule Payment" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Stage</label>
            <input type="text" value={form.label} onChange={(e) => set('label', e.target.value)} className="w-full px-3 py-2 border rounded-lg" placeholder="Deposit, Final balance..." />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Amount ($) <span className="text-red-500">*</span></label>
            <input type="number" step="any" value={form.amount} onChange={(e) => set('amount', e.target.value)} className="w-full px-3 py-2 border rounded-lg" required />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Due date</label>
          <input type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
        </div>
        <div className="flex items-center gap-2">
          <input id="paidNow" type="checkbox" checked={form.paidNow} onChange={(e) => set('paidNow', e.target.checked)} className="w-4 h-4" />
          <label htmlFor="paidNow" className="text-sm font-medium text-gray-700">Already paid</label>
        </div>
        {form.paidNow && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Method</label>
              <input type="text" value={form.method} onChange={(e) => set('method', e.target.value)} className="w-full px-3 py-2 border rounded-lg" placeholder="Card, transfer, cash" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reference</label>
              <input type="text" value={form.reference} onChange={(e) => set('reference', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
            </div>
          </div>
        )}
        <FormButtons saving={saving} onClose={onClose} label="Schedule" />
      </form>
    </ModalShell>
  );
}
