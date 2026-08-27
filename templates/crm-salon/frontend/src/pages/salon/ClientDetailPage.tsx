import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Loader2, User, AlertTriangle, Phone, Mail, Plus, Scissors, CalendarDays,
  CreditCard, ArrowLeft, X, Clock, Edit2,
} from 'lucide-react';
import api from '../../services/api';
import ServiceRecordEditorModal, { ServiceRecord } from '../../components/salon/ServiceRecordEditorModal';
import { fetchStaff, staffName, type StaffMember } from '../../lib/staff';

/**
 * Client chart — GET /api/clients/:contactId returns
 * { contact, profile, serviceRecords[], appointments[], memberships[], stats }.
 *
 * The formula history is the first tab on purpose: it is the thing a stylist
 * opens before every colour appointment, and the reason the client stays.
 */

const HAIR_TYPES = ['', 'Fine', 'Medium', 'Coarse', 'Curly', 'Coily', 'Wavy', 'Straight', 'Color-treated'];

interface Contact {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  address?: string;
}
interface Profile {
  id?: string;
  preferredStylistId?: string;
  hairType?: string;
  scalpNotes?: string;
  allergies?: string;
  patchTestAt?: string;
  preferences?: string;
  pronouns?: string;
  birthday?: string;
  notes?: string;
}
interface Appointment {
  id: string;
  status?: string;
  station?: string;
  startTime?: string;
  serviceName?: string;
  stylistFirstName?: string;
  stylistLastName?: string;
}
interface Membership {
  id: string;
  planName?: string;
  status?: string;
  creditsRemaining?: number | null;
  startDate?: string;
  renewsAt?: string;
}
interface Stats {
  visits?: number;
  lifetimeValue?: number;
  dueBackAt?: string | null;
  lastVisit?: string | null;
}
interface Detail {
  contact?: Contact;
  profile?: Profile | null;
  serviceRecords?: ServiceRecord[];
  appointments?: Appointment[];
  memberships?: Membership[];
  stats?: Stats;
}

function fmtDate(s?: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtDateTime(s?: string): string {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function money(v: number | string | undefined | null): string {
  return `$${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}
function isPast(dateStr?: string | null): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return !isNaN(d.getTime()) && d.getTime() < Date.now();
}
function stylistName(r: { stylistFirstName?: string; stylistLastName?: string }): string {
  return [r.stylistFirstName, r.stylistLastName].filter(Boolean).join(' ');
}

type Tab = 'formula' | 'appointments' | 'memberships';

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [tab, setTab] = useState<Tab>('formula');
  const [showRecord, setShowRecord] = useState<boolean>(false);
  const [editRecord, setEditRecord] = useState<ServiceRecord | null>(null);
  const [showProfile, setShowProfile] = useState<boolean>(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await api.get(`/api/clients/${id}`);
      setDetail(res || {});
    } catch (error) {
      console.error('Failed to load client:', error);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const ct = detail.contact;
  if (!ct) {
    return (
      <div className="text-center py-12 text-gray-500 dark:text-slate-400">
        Client not found. <Link to="/crm/clients" className="text-teal-600">Back to clients</Link>
      </div>
    );
  }

  const profile = detail.profile || {};
  const records = detail.serviceRecords || [];
  const appointments = detail.appointments || [];
  const memberships = detail.memberships || [];
  const stats = detail.stats || {};

  const tabs: { id: Tab; label: string; icon: React.ReactNode; count: number }[] = [
    { id: 'formula', label: 'Formula History', icon: <Scissors className="w-4 h-4" />, count: records.length },
    { id: 'appointments', label: 'Appointments', icon: <CalendarDays className="w-4 h-4" />, count: appointments.length },
    { id: 'memberships', label: 'Memberships', icon: <CreditCard className="w-4 h-4" />, count: memberships.length },
  ];

  return (
    <div className="space-y-6">
      <Link to="/crm/clients" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-slate-400">
        <ArrowLeft className="w-4 h-4" /> Clients
      </Link>

      {/* Header */}
      <div className="bg-white rounded-xl border p-5 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-teal-50 rounded-lg">
              <User className="w-6 h-6 text-teal-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{ct.name || 'Unnamed'}</h1>
              <p className="text-gray-500 dark:text-slate-400">
                {[profile.pronouns, profile.hairType].filter(Boolean).join(' · ') || 'No profile details yet'}
              </p>
            </div>
          </div>
          <button onClick={() => setShowProfile(true)} className="flex items-center gap-2 px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50">
            <Edit2 className="w-4 h-4" /> Edit Profile
          </button>
        </div>

        {profile.allergies && (
          <div className="mt-4 flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 rounded-lg p-3">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Allergy / sensitivity</p>
              <p className="text-sm">{profile.allergies}</p>
              <p className="text-xs mt-1">
                Last patch test: {fmtDate(profile.patchTestAt)}
              </p>
            </div>
          </div>
        )}

        {/* Retention strip — the numbers the front desk needs at a glance. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <div className="border rounded-lg p-3">
            <p className="text-xs text-gray-400 uppercase">Visits</p>
            <p className="text-xl font-bold text-gray-900 dark:text-slate-100">{stats.visits ?? 0}</p>
          </div>
          <div className="border rounded-lg p-3">
            <p className="text-xs text-gray-400 uppercase">Lifetime Value</p>
            <p className="text-xl font-bold text-gray-900 dark:text-slate-100">{money(stats.lifetimeValue)}</p>
          </div>
          <div className="border rounded-lg p-3">
            <p className="text-xs text-gray-400 uppercase">Last Visit</p>
            <p className="text-sm font-medium text-gray-900 mt-1 dark:text-slate-100">{fmtDate(stats.lastVisit)}</p>
          </div>
          <div className={`border rounded-lg p-3 ${isPast(stats.dueBackAt) ? 'bg-red-50 border-red-200' : ''}`}>
            <p className="text-xs text-gray-400 uppercase">Due Back</p>
            <p className={`text-sm font-medium mt-1 ${isPast(stats.dueBackAt) ? 'text-red-700' : 'text-gray-900'}`}>
              {fmtDate(stats.dueBackAt)}{isPast(stats.dueBackAt) ? ' (overdue)' : ''}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div className="border rounded-lg p-3">
            <p className="text-xs font-medium text-gray-400 uppercase mb-2">Contact</p>
            {(ct.mobile || ct.phone) && <p className="text-sm text-gray-600 flex items-center gap-2 dark:text-slate-400"><Phone className="w-3 h-3" /> {ct.mobile || ct.phone}</p>}
            {ct.email && <p className="text-sm text-gray-600 flex items-center gap-2 mt-1 dark:text-slate-400"><Mail className="w-3 h-3" /> {ct.email}</p>}
            {!ct.mobile && !ct.phone && !ct.email && <p className="text-sm text-gray-400">No contact details</p>}
          </div>
          <div className="border rounded-lg p-3">
            <p className="text-xs font-medium text-gray-400 uppercase mb-2">Preferences</p>
            <dl className="text-sm text-gray-600 space-y-1 dark:text-slate-400">
              {profile.hairType && <div className="flex justify-between"><dt className="text-gray-400">Hair</dt><dd>{profile.hairType}</dd></div>}
              {profile.scalpNotes && <div className="flex justify-between gap-4"><dt className="text-gray-400">Scalp</dt><dd className="text-right">{profile.scalpNotes}</dd></div>}
              {profile.birthday && <div className="flex justify-between"><dt className="text-gray-400">Birthday</dt><dd>{fmtDate(profile.birthday)}</dd></div>}
              {profile.preferences && <div className="flex justify-between gap-4"><dt className="text-gray-400">Notes</dt><dd className="text-right">{profile.preferences}</dd></div>}
              {!profile.hairType && !profile.scalpNotes && !profile.birthday && !profile.preferences && (
                <p className="text-gray-400">Nothing recorded yet</p>
              )}
            </dl>
          </div>
        </div>
        {profile.notes && <p className="text-sm text-gray-500 mt-3 whitespace-pre-wrap dark:text-slate-400">{profile.notes}</p>}
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
            <span className="text-xs bg-gray-100 text-gray-500 px-1.5 rounded-full dark:bg-slate-800 dark:text-slate-400">{t.count}</span>
          </button>
        ))}
      </div>

      {/* Formula history */}
      {tab === 'formula' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => { setEditRecord(null); setShowRecord(true); }} className="flex items-center gap-2 px-3 py-1.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm">
              <Plus className="w-4 h-4" /> New Service Record
            </button>
          </div>
          {records.length === 0 ? (
            <div className="text-center py-10 text-gray-400 bg-white rounded-xl border dark:bg-slate-900">No services recorded yet</div>
          ) : (
            <div className="space-y-3">
              {records.map((r) => (
                <div key={r.id} className="bg-white rounded-xl border p-4 dark:bg-slate-900">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-slate-100">
                        {fmtDate(r.performedAt)}{r.serviceName ? ` — ${r.serviceName}` : ''}
                      </p>
                      {stylistName(r) && <p className="text-xs text-gray-400">with {stylistName(r)}</p>}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-gray-700 dark:text-slate-200">{money(r.priceCharged)}</span>
                      <button onClick={() => { setEditRecord(r); setShowRecord(true); }} className="text-sm text-teal-600 hover:text-teal-700">Edit</button>
                    </div>
                  </div>

                  {(r.formula || []).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(r.formula || []).map((line, i) => (
                        <span key={i} className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">
                          {[line.product, line.shade].filter(Boolean).join(' ')}{line.parts ? ` (${line.parts})` : ''}
                        </span>
                      ))}
                    </div>
                  )}

                  {(r.developerVolume || r.processingMin) && (
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-400">
                      {r.developerVolume ? <span>Developer {r.developerVolume}</span> : null}
                      {r.processingMin ? <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {r.processingMin} min</span> : null}
                    </div>
                  )}
                  {r.productsUsed && <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">{r.productsUsed}</p>}
                  {r.result && <p className="mt-1 text-sm text-gray-600 dark:text-slate-400"><span className="font-medium text-gray-500 dark:text-slate-400">Result:</span> {r.result}</p>}
                  {r.notes && <p className="mt-1 text-xs text-gray-400">{r.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Appointments */}
      {tab === 'appointments' && (
        <div>
          {appointments.length === 0 ? (
            <div className="text-center py-10 text-gray-400 bg-white rounded-xl border dark:bg-slate-900">No appointments yet</div>
          ) : (
            <div className="bg-white rounded-xl border overflow-x-auto dark:bg-slate-900">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-left dark:bg-slate-900 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">When</th>
                    <th className="px-4 py-3 font-medium">Service</th>
                    <th className="px-4 py-3 font-medium">Stylist</th>
                    <th className="px-4 py-3 font-medium">Chair</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {appointments.map((a) => (
                    <tr key={a.id}>
                      <td className="px-4 py-3 text-gray-900 dark:text-slate-100">{fmtDateTime(a.startTime)}</td>
                      <td className="px-4 py-3 text-gray-600 dark:text-slate-400">{a.serviceName || '—'}</td>
                      <td className="px-4 py-3 text-gray-600 dark:text-slate-400">{stylistName(a) || '—'}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-slate-400">{a.station || '—'}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full capitalize dark:bg-slate-800 dark:text-slate-400">
                          {(a.status || 'scheduled').replace('_', ' ')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Memberships */}
      {tab === 'memberships' && (
        <div>
          {memberships.length === 0 ? (
            <div className="text-center py-10 text-gray-400 bg-white rounded-xl border dark:bg-slate-900">
              Not enrolled in a membership.{' '}
              <Link to="/crm/memberships" className="text-teal-600">Browse plans</Link>
            </div>
          ) : (
            <div className="space-y-2">
              {memberships.map((m) => (
                <div key={m.id} className="bg-white rounded-xl border p-4 flex items-center justify-between gap-3 flex-wrap dark:bg-slate-900">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-slate-100">{m.planName || 'Membership'}</p>
                    <p className="text-xs text-gray-400">
                      Started {fmtDate(m.startDate)}{m.renewsAt ? ` · renews ${fmtDate(m.renewsAt)}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {m.creditsRemaining !== null && m.creditsRemaining !== undefined && (
                      <span className="text-sm text-gray-600 dark:text-slate-400">{m.creditsRemaining} credit{m.creditsRemaining === 1 ? '' : 's'} left</span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${m.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {m.status || 'active'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showRecord && (
        <ServiceRecordEditorModal
          contactId={ct.id}
          record={editRecord}
          onSave={() => { setShowRecord(false); setEditRecord(null); load(); }}
          onClose={() => { setShowRecord(false); setEditRecord(null); }}
        />
      )}
      {showProfile && (
        <ProfileModal
          contactId={ct.id}
          profile={profile}
          onSave={() => { setShowProfile(false); load(); }}
          onClose={() => setShowProfile(false)}
        />
      )}
    </div>
  );
}

/* ---------------- Profile Modal ---------------- */

function ProfileModal({ contactId, profile, onSave, onClose }: { contactId: string; profile: Profile; onSave: () => void; onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  const [stylists, setStylists] = useState<StaffMember[]>([]);
  const [form, setForm] = useState({
    preferredStylistId: profile.preferredStylistId || '',
    hairType: profile.hairType || '',
    scalpNotes: profile.scalpNotes || '',
    allergies: profile.allergies || '',
    patchTestAt: profile.patchTestAt || '',
    preferences: profile.preferences || '',
    pronouns: profile.pronouns || '',
    birthday: profile.birthday || '',
    notes: profile.notes || '',
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    (async () => {
      try {
        setStylists(await fetchStaff());
      } catch { /* the rest of the form still works */ }
    })();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      // Send every field, blanks included — the route maps '' to null, which is
      // how a stylist clears an allergy note that no longer applies.
      await api.put(`/api/clients/${contactId}/profile`, form);
      onSave();
    } catch (err) {
      alert((err as Error).message || 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-start justify-center p-4 py-8">
        <div className="relative bg-white rounded-xl shadow-xl max-w-2xl w-full p-6 dark:bg-slate-900">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">Client Profile</h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Hair Type</label>
                <select value={form.hairType} onChange={(e) => set('hairType', e.target.value)} className="w-full px-3 py-2 border rounded-lg">
                  {HAIR_TYPES.map((h) => <option key={h} value={h}>{h || '—'}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Pronouns</label>
                <input type="text" value={form.pronouns} onChange={(e) => set('pronouns', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Birthday</label>
                <input type="date" value={form.birthday} onChange={(e) => set('birthday', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Patch Test</label>
                <input type="date" value={form.patchTestAt} onChange={(e) => set('patchTestAt', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Regular Stylist</label>
              <select value={form.preferredStylistId} onChange={(e) => set('preferredStylistId', e.target.value)} className="w-full px-3 py-2 border rounded-lg">
                <option value="">No preference</option>
                {stylists.map((u) => <option key={u.id} value={u.id}>{staffName(u)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Allergies / sensitivities</label>
              <input type="text" value={form.allergies} onChange={(e) => set('allergies', e.target.value)} className="w-full px-3 py-2 border rounded-lg" placeholder="PPD sensitivity, latex, fragrance..." />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Scalp notes</label>
              <input type="text" value={form.scalpNotes} onChange={(e) => set('scalpNotes', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Preferences</label>
              <input type="text" value={form.preferences} onChange={(e) => set('preferences', e.target.value)} className="w-full px-3 py-2 border rounded-lg" placeholder="Drink order, quiet appointment, parking..." />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Notes</label>
              <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} className="w-full px-3 py-2 border rounded-lg" />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50">
                {saving ? 'Saving...' : 'Save Profile'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
