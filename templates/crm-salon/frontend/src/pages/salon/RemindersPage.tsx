import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2, BellRing, RotateCcw, UserX, Cake, Send, X, CheckCircle2, AlertCircle,
} from 'lucide-react';
import api from '../../services/api';

/**
 * Rebooking — the retention page.
 * Tab 1: Due to Rebook  (GET /api/reminders/due?window=)
 * Tab 2: Lapsed Clients (GET /api/reminders/lapsed?months=)
 * Tab 3: Birthdays      (GET /api/reminders/birthdays?window=)
 * Checked rows collect contactIds → POST /api/reminders/send { contactIds, message }.
 */

interface DueRow {
  recordId: string;
  contactId?: string;
  clientName?: string;
  clientEmail?: string;
  clientPhone?: string;
  clientMobile?: string;
  serviceName?: string;
  dueDate?: string;
  overdue?: boolean;
  stylistFirstName?: string;
  stylistLastName?: string;
}
interface LapsedRow {
  contactId?: string;
  clientName?: string;
  clientEmail?: string;
  clientPhone?: string;
  clientMobile?: string;
  lastVisit?: string;
  visits?: number;
  lifetimeValue?: number;
}
interface BirthdayRow {
  contactId?: string;
  clientName?: string;
  clientEmail?: string;
  clientPhone?: string;
  clientMobile?: string;
  nextBirthday?: string;
  daysAway?: number;
}

function fmtDate(s?: string): string {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function money(v: number | undefined): string {
  return `$${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
function contactLine(r: { clientMobile?: string; clientPhone?: string; clientEmail?: string }): string {
  return [r.clientMobile || r.clientPhone, r.clientEmail].filter(Boolean).join(' · ') || '—';
}

type Tab = 'due' | 'lapsed' | 'birthdays';

const DEFAULT_MESSAGE: Record<Tab, string> = {
  due: "Hi! It's about time for your next appointment — reply or give us a call and we'll get you booked in.",
  lapsed: "Hi! We haven't seen you in a while and we'd love to get you back in the chair. Reply and we'll find you a time.",
  birthdays: 'Happy birthday from all of us! Book any service this month and we have a little treat waiting for you.',
};

export default function RemindersPage() {
  const [tab, setTab] = useState<Tab>('due');

  const [windowDays, setWindowDays] = useState<number>(14);
  const [dueRows, setDueRows] = useState<DueRow[]>([]);
  const [dueCount, setDueCount] = useState<number>(0);
  const [overdueCount, setOverdueCount] = useState<number>(0);

  const [months, setMonths] = useState<number>(6);
  const [lapsedRows, setLapsedRows] = useState<LapsedRow[]>([]);

  const [bdayWindow, setBdayWindow] = useState<number>(30);
  const [bdayRows, setBdayRows] = useState<BirthdayRow[]>([]);

  const [loading, setLoading] = useState<boolean>(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showSend, setShowSend] = useState<boolean>(false);

  const loadDue = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/api/reminders/due?window=${windowDays}`);
      setDueRows(res.data || []);
      setDueCount(res.count || 0);
      setOverdueCount(res.overdue || 0);
    } catch (error) {
      console.error('Failed to load rebooking list:', error);
    } finally {
      setLoading(false);
    }
  }, [windowDays]);

  const loadLapsed = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/api/reminders/lapsed?months=${months}`);
      setLapsedRows(res.data || []);
    } catch (error) {
      console.error('Failed to load lapsed clients:', error);
    } finally {
      setLoading(false);
    }
  }, [months]);

  const loadBirthdays = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/api/reminders/birthdays?window=${bdayWindow}`);
      setBdayRows(res.data || []);
    } catch (error) {
      console.error('Failed to load birthdays:', error);
    } finally {
      setLoading(false);
    }
  }, [bdayWindow]);

  useEffect(() => {
    setSelected(new Set());
    if (tab === 'due') loadDue();
    else if (tab === 'lapsed') loadLapsed();
    else loadBirthdays();
  }, [tab, loadDue, loadLapsed, loadBirthdays]);

  const toggle = (contactId?: string) => {
    if (!contactId) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  };

  const rows: { contactId?: string }[] = tab === 'due' ? dueRows : tab === 'lapsed' ? lapsedRows : bdayRows;
  const allIds = Array.from(new Set(rows.map((r) => r.contactId).filter(Boolean))) as string[];
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(allIds));
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'due', label: 'Due to Rebook', icon: <RotateCcw className="w-4 h-4" /> },
    { id: 'lapsed', label: 'Lapsed Clients', icon: <UserX className="w-4 h-4" /> },
    { id: 'birthdays', label: 'Birthdays', icon: <Cake className="w-4 h-4" /> },
  ];

  const emptyText: Record<Tab, string> = {
    due: 'Nobody is due to rebook in this window',
    lapsed: 'No lapsed clients',
    birthdays: 'No birthdays in this window',
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 dark:text-slate-100">
          <BellRing className="w-6 h-6 text-teal-600" /> Rebooking
        </h1>
        <p className="text-gray-500 dark:text-slate-400">Get clients back in the chair on cadence</p>
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
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          {tab === 'due' && (
            <>
              <label className="text-sm text-gray-500 dark:text-slate-400">Due within</label>
              <select value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))} className="px-3 py-2 border rounded-lg">
                <option value={7}>7 days</option>
                <option value={14}>14 days</option>
                <option value={30}>30 days</option>
              </select>
              <span className="text-sm text-gray-500 dark:text-slate-400">
                {dueCount} due · <span className="text-red-600 font-medium">{overdueCount} overdue</span>
              </span>
            </>
          )}
          {tab === 'lapsed' && (
            <>
              <label className="text-sm text-gray-500 dark:text-slate-400">No visit in</label>
              <select value={months} onChange={(e) => setMonths(Number(e.target.value))} className="px-3 py-2 border rounded-lg">
                <option value={3}>3 months</option>
                <option value={6}>6 months</option>
                <option value={12}>12 months</option>
                <option value={24}>24 months</option>
              </select>
              <span className="text-sm text-gray-500 dark:text-slate-400">{lapsedRows.length} lapsed</span>
            </>
          )}
          {tab === 'birthdays' && (
            <>
              <label className="text-sm text-gray-500 dark:text-slate-400">Within</label>
              <select value={bdayWindow} onChange={(e) => setBdayWindow(Number(e.target.value))} className="px-3 py-2 border rounded-lg">
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
                <option value={60}>60 days</option>
              </select>
              <span className="text-sm text-gray-500 dark:text-slate-400">{bdayRows.length} upcoming</span>
            </>
          )}
        </div>
        <button
          onClick={() => setShowSend(true)}
          disabled={selected.size === 0}
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50"
        >
          <Send className="w-4 h-4" /> Send Text{selected.size > 0 ? ` (${selected.size})` : ''}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-gray-500 bg-white rounded-xl border dark:text-slate-400 dark:bg-slate-900">{emptyText[tab]}</div>
      ) : (
        <div className="bg-white rounded-xl border overflow-x-auto dark:bg-slate-900">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-left dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3 w-10">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} className="w-4 h-4" />
                </th>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Contact</th>
                {tab === 'due' && (
                  <>
                    <th className="px-4 py-3 font-medium">Service</th>
                    <th className="px-4 py-3 font-medium">Due</th>
                  </>
                )}
                {tab === 'lapsed' && (
                  <>
                    <th className="px-4 py-3 font-medium">Last Visit</th>
                    <th className="px-4 py-3 font-medium">Visits</th>
                    <th className="px-4 py-3 font-medium">Lifetime</th>
                  </>
                )}
                {tab === 'birthdays' && (
                  <>
                    <th className="px-4 py-3 font-medium">Birthday</th>
                    <th className="px-4 py-3 font-medium">In</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y">
              {tab === 'due' && dueRows.map((r) => (
                <tr key={r.recordId} className={r.overdue ? 'bg-red-50' : ''}>
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={!!r.contactId && selected.has(r.contactId)} onChange={() => toggle(r.contactId)} disabled={!r.contactId} className="w-4 h-4" />
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-slate-100">
                    {r.contactId ? <Link to={`/crm/clients/${r.contactId}`} className="hover:text-teal-600">{r.clientName || '—'}</Link> : (r.clientName || '—')}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs dark:text-slate-400">{contactLine(r)}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-slate-400">
                    {r.serviceName || '—'}
                    {[r.stylistFirstName, r.stylistLastName].filter(Boolean).length > 0 && (
                      <span className="block text-xs text-gray-400">with {[r.stylistFirstName, r.stylistLastName].filter(Boolean).join(' ')}</span>
                    )}
                  </td>
                  <td className={`px-4 py-3 ${r.overdue ? 'text-red-700 font-medium' : 'text-gray-600'}`}>
                    {fmtDate(r.dueDate)}{r.overdue ? ' (overdue)' : ''}
                  </td>
                </tr>
              ))}

              {tab === 'lapsed' && lapsedRows.map((r, i) => (
                <tr key={r.contactId || i}>
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={!!r.contactId && selected.has(r.contactId)} onChange={() => toggle(r.contactId)} disabled={!r.contactId} className="w-4 h-4" />
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-slate-100">
                    {r.contactId ? <Link to={`/crm/clients/${r.contactId}`} className="hover:text-teal-600">{r.clientName || '—'}</Link> : (r.clientName || '—')}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs dark:text-slate-400">{contactLine(r)}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-slate-400">{fmtDate(r.lastVisit)}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-slate-400">{r.visits ?? 0}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-slate-400">{money(r.lifetimeValue)}</td>
                </tr>
              ))}

              {tab === 'birthdays' && bdayRows.map((r, i) => (
                <tr key={r.contactId || i}>
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={!!r.contactId && selected.has(r.contactId)} onChange={() => toggle(r.contactId)} disabled={!r.contactId} className="w-4 h-4" />
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-slate-100">
                    {r.contactId ? <Link to={`/crm/clients/${r.contactId}`} className="hover:text-teal-600">{r.clientName || '—'}</Link> : (r.clientName || '—')}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs dark:text-slate-400">{contactLine(r)}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-slate-400">{fmtDate(r.nextBirthday)}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-slate-400">
                    {r.daysAway === 0 ? 'Today' : `${r.daysAway} day${r.daysAway === 1 ? '' : 's'}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showSend && (
        <SendReminderModal
          contactIds={Array.from(selected)}
          defaultMessage={DEFAULT_MESSAGE[tab]}
          onDone={() => { setShowSend(false); setSelected(new Set()); }}
          onClose={() => setShowSend(false)}
        />
      )}
    </div>
  );
}

/* ---------------- Send Reminder Modal ---------------- */

function SendReminderModal({ contactIds, defaultMessage, onDone, onClose }: { contactIds: string[]; defaultMessage: string; onDone: () => void; onClose: () => void }) {
  const [message, setMessage] = useState<string>(defaultMessage);
  const [sending, setSending] = useState<boolean>(false);
  const [result, setResult] = useState<{ sent?: number; failed?: number } | null>(null);

  const send = async () => {
    if (!message.trim()) { alert('Message is required'); return; }
    setSending(true);
    try {
      const res = await api.post('/api/reminders/send', { contactIds, message: message.trim() });
      setResult({ sent: res.sent || 0, failed: res.failed || 0 });
    } catch (err) {
      alert((err as Error).message || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-start justify-center p-4 py-8">
        <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6 dark:bg-slate-900">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold flex items-center gap-2"><Send className="w-5 h-5 text-teal-600" /> Send Text</h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>

          {result ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-green-700">
                <CheckCircle2 className="w-5 h-5" />
                <span className="font-medium">{result.sent} text{result.sent === 1 ? '' : 's'} sent</span>
              </div>
              {(result.failed || 0) > 0 && (
                <div className="flex items-center gap-2 text-amber-700">
                  <AlertCircle className="w-5 h-5" />
                  <span>{result.failed} failed (usually a missing mobile number)</span>
                </div>
              )}
              <button onClick={onDone} className="w-full px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700">Done</button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-gray-500 dark:text-slate-400">Sending to {contactIds.length} client{contactIds.length === 1 ? '' : 's'}.</p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Message</label>
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50">Cancel</button>
                <button onClick={send} disabled={sending || contactIds.length === 0} className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50">
                  {sending ? 'Sending...' : 'Send'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
