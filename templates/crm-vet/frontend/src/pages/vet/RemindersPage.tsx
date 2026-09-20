import { useState, useEffect, useCallback } from 'react';
import {
  Loader2, BellRing, Syringe, UserX, Send, X, CheckCircle2, AlertCircle,
} from 'lucide-react';
import api from '../../services/api';

/**
 * Reminders — the retention page.
 * Tab 1: Vaccines Due  (GET /api/reminders/due?window=)
 * Tab 2: Lapsed Clients (GET /api/reminders/lapsed?months=)
 * Checked rows collect ownerIds → POST /api/reminders/send { contactIds, message }.
 */

interface DueRow {
  vaccinationId: string;
  vaccine?: string;
  dueDate?: string;
  overdue?: boolean;
  patientId?: string;
  patientName?: string;
  species?: string;
  ownerId?: string;
  ownerName?: string;
  ownerEmail?: string;
  ownerPhone?: string;
  ownerMobile?: string;
  // what chasing has already been done about this due date (T12 M9)
  lastRemindedAt?: string | null;
  reminderCount?: number;
  remindedRecently?: boolean;
}
interface LapsedRow {
  patientId?: string;
  patientName?: string;
  species?: string;
  ownerId?: string;
  ownerName?: string;
  ownerEmail?: string;
  ownerPhone?: string;
  ownerMobile?: string;
  lastVisit?: string;
  lastRemindedAt?: string | null;
}

function fmtDate(s?: string): string {
  if (!s) return '—';
  // Date-only / midnight-UTC values must render at local midnight, or a negative
  // UTC offset shows the previous day (VET-03). Datetimes render as-is.
  const str = String(s);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(str) || /T00:00:00(\.000)?Z?$/.test(str);
  const d = dateOnly ? new Date(str.slice(0, 10) + 'T00:00:00') : new Date(str);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// "3d ago" reads faster than a date when the question is only "have we already chased this?" (T12 M9)
function ago(s?: string | null): string {
  if (!s) return '—';
  const then = new Date(s).getTime();
  if (isNaN(then)) return '—';
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  return fmtDate(s);
}

type Tab = 'due' | 'lapsed';

export default function RemindersPage() {
  const [tab, setTab] = useState<Tab>('due');

  // Vaccines due
  const [windowDays, setWindowDays] = useState<number>(30);
  const [dueRows, setDueRows] = useState<DueRow[]>([]);
  const [dueCount, setDueCount] = useState<number>(0);
  const [overdueCount, setOverdueCount] = useState<number>(0);

  // Lapsed
  const [months, setMonths] = useState<number>(12);
  const [lapsedRows, setLapsedRows] = useState<LapsedRow[]>([]);

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
      console.error('Failed to load due reminders:', error);
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

  useEffect(() => {
    setSelected(new Set());
    if (tab === 'due') loadDue();
    else loadLapsed();
  }, [tab, loadDue, loadLapsed]);

  // Select by row, not by owner. A patient with two vaccines due is two rows; keying the
  // checkbox by ownerId made ticking the second row toggle the first back off (VET-11).
  // Due rows are keyed by vaccinationId; lapsed rows (one per client) stay keyed by ownerId.
  const toggle = (key?: string) => {
    if (!key) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const rows = tab === 'due' ? dueRows : lapsedRows;
  const rowKey = (r: DueRow | LapsedRow): string | undefined =>
    tab === 'due' ? (r as DueRow).vaccinationId : (r as LapsedRow).ownerId;
  const allRowKeys = Array.from(new Set(rows.map(rowKey).filter(Boolean))) as string[];
  const allSelected = allRowKeys.length > 0 && allRowKeys.every((id) => selected.has(id));

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(allRowKeys));
  };

  // At send time, resolve the selected rows down to unique owner contact ids.
  const selectedContactIds = tab === 'due'
    ? Array.from(new Set(dueRows.filter((r) => selected.has(r.vaccinationId) && r.ownerId).map((r) => r.ownerId as string)))
    : Array.from(selected);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 dark:text-slate-100">
          <BellRing className="w-6 h-6 text-teal-600" /> Reminders
        </h1>
        <p className="text-gray-500 dark:text-slate-400">Bring patients back in for the care they're due</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        <button
          onClick={() => { setTab('due'); setSelected(new Set()); }}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            tab === 'due' ? 'border-teal-600 text-teal-700' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Syringe className="w-4 h-4" /> Vaccines Due
        </button>
        <button
          onClick={() => { setTab('lapsed'); setSelected(new Set()); }}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            tab === 'lapsed' ? 'border-teal-600 text-teal-700' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <UserX className="w-4 h-4" /> Lapsed Clients
        </button>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          {tab === 'due' ? (
            <>
              <label className="text-sm text-gray-500 dark:text-slate-400">Window</label>
              <select value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))} className="px-3 py-2 border rounded-lg">
                <option value={30}>30 days</option>
                <option value={60}>60 days</option>
                <option value={90}>90 days</option>
              </select>
              <span className="text-sm text-gray-500 dark:text-slate-400">
                {dueCount} due · <span className="text-red-600 font-medium">{overdueCount} overdue</span>
              </span>
            </>
          ) : (
            <>
              <label className="text-sm text-gray-500 dark:text-slate-400">No visit in</label>
              <select value={months} onChange={(e) => setMonths(Number(e.target.value))} className="px-3 py-2 border rounded-lg">
                <option value={6}>6 months</option>
                <option value={12}>12 months</option>
                <option value={18}>18 months</option>
                <option value={24}>24 months</option>
              </select>
              <span className="text-sm text-gray-500 dark:text-slate-400">{lapsedRows.length} lapsed</span>
            </>
          )}
        </div>
        <button
          onClick={() => setShowSend(true)}
          disabled={selected.size === 0}
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50"
        >
          <Send className="w-4 h-4" /> Send Reminder{selected.size > 0 ? ` (${selected.size})` : ''}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-gray-500 bg-white rounded-xl border dark:text-slate-400 dark:bg-slate-900">
          {tab === 'due' ? 'No vaccines due in this window' : 'No lapsed clients'}
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-x-auto dark:bg-slate-900">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-left dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3 w-10">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} className="w-4 h-4" />
                </th>
                <th className="px-4 py-3 font-medium">Patient</th>
                <th className="px-4 py-3 font-medium">Owner</th>
                <th className="px-4 py-3 font-medium">Contact</th>
                {tab === 'due' ? (
                  <>
                    <th className="px-4 py-3 font-medium">Vaccine</th>
                    <th className="px-4 py-3 font-medium">Due</th>
                    <th className="px-4 py-3 font-medium">Reminded</th>
                  </>
                ) : (
                  <>
                    <th className="px-4 py-3 font-medium">Last Visit</th>
                    <th className="px-4 py-3 font-medium">Reminded</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y">
              {tab === 'due'
                ? dueRows.map((r) => (
                    <tr key={r.vaccinationId} className={r.overdue ? 'bg-red-50' : ''}>
                      <td className="px-4 py-3">
                        <input type="checkbox" checked={selected.has(r.vaccinationId)} onChange={() => toggle(r.vaccinationId)} disabled={!r.ownerId} className="w-4 h-4" />
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-slate-100">
                        {r.patientName || '—'} <span className="text-xs text-gray-500 dark:text-slate-400 capitalize">{r.species}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-slate-400">{r.ownerName || '—'}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs dark:text-slate-400">
                        {[r.ownerMobile || r.ownerPhone, r.ownerEmail].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-slate-400">{r.vaccine || '—'}</td>
                      <td className={`px-4 py-3 ${r.overdue ? 'text-red-700 font-medium' : 'text-gray-600'}`}>
                        {fmtDate(r.dueDate)}{r.overdue ? ' (overdue)' : ''}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {r.lastRemindedAt ? (
                          <span className={r.remindedRecently ? 'text-amber-700' : 'text-gray-500 dark:text-slate-400'}>
                            {ago(r.lastRemindedAt)}{(r.reminderCount || 0) > 1 ? ` · ${r.reminderCount}×` : ''}
                          </span>
                        ) : (
                          <span className="text-gray-500 dark:text-slate-400">Not yet</span>
                        )}
                      </td>
                    </tr>
                  ))
                : lapsedRows.map((r, i) => (
                    <tr key={`${r.patientId || r.ownerId || i}`}>
                      <td className="px-4 py-3">
                        <input type="checkbox" checked={!!r.ownerId && selected.has(r.ownerId)} onChange={() => toggle(r.ownerId)} disabled={!r.ownerId} className="w-4 h-4" />
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-slate-100">
                        {r.patientName || '—'} <span className="text-xs text-gray-500 dark:text-slate-400 capitalize">{r.species}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-slate-400">{r.ownerName || '—'}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs dark:text-slate-400">
                        {[r.ownerMobile || r.ownerPhone, r.ownerEmail].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-slate-400">{fmtDate(r.lastVisit)}</td>
                      <td className="px-4 py-3 text-xs">
                        {r.lastRemindedAt ? <span className="text-gray-500 dark:text-slate-400">{ago(r.lastRemindedAt)}</span> : <span className="text-gray-500 dark:text-slate-400">Not yet</span>}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}

      {showSend && (
        <SendReminderModal
          contactIds={selectedContactIds}
          vaccinationIds={tab === 'due' ? Array.from(selected) : []}
          // reload, so the Reminded column shows what was just sent rather than going stale (T12 M9)
          onDone={() => { setShowSend(false); setSelected(new Set()); if (tab === 'due') loadDue(); else loadLapsed(); }}
          onClose={() => setShowSend(false)}
        />
      )}
    </div>
  );
}

/* ---------------- Send Reminder Modal ---------------- */

function SendReminderModal({ contactIds, vaccinationIds, onDone, onClose }: { contactIds: string[]; vaccinationIds: string[]; onDone: () => void; onClose: () => void }) {
  // The fields in {{ }} are filled in per recipient by the server. The old template said "your pet is due
  // for care" to everyone, which is a message nobody acts on, while the list on screen already knew the pet,
  // the vaccine and the date. (Vet T12 L7)
  const [message, setMessage] = useState<string>(
    vaccinationIds.length
      ? "Hi {{owner_name}}, it's {{clinic_name}} — {{pet_name}} is due for {{vaccine}} on {{due_date}}. Call us and we'll get it booked in."
      : "Hi {{owner_name}}, it's {{clinic_name}} — we haven't seen {{pet_name}} in a while. Call us any time to book a check-up."
  );
  const [sending, setSending] = useState<boolean>(false);
  const [result, setResult] = useState<{ sent?: number; failed?: number; error?: string } | null>(null);

  const send = async () => {
    if (!message.trim()) { alert('Message is required'); return; }
    setSending(true);
    try {
      const res = await api.post('/api/reminders/send', { contactIds, vaccinationIds, message: message.trim() });
      setResult({ sent: res.sent || 0, failed: res.failed || 0 });
    } catch (err) {
      alert((err as Error).message || 'Failed to send reminders');
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
            <h2 className="text-lg font-bold flex items-center gap-2"><Send className="w-5 h-5 text-teal-600" /> Send Reminder</h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>

          {result ? (
            <div className="space-y-4">
              {/* Nothing sent is not a success. When the reason is the same for everyone — messaging paused
                  on an empty usage wallet, say — say it, instead of reporting "0 reminders sent" in green
                  next to a row that claims it was reminded. (T24 M9) */}
              {(result.sent || 0) > 0 ? (
                <div className="flex items-center gap-2 text-green-700">
                  <CheckCircle2 className="w-5 h-5" />
                  <span className="font-medium">{result.sent} reminder{result.sent === 1 ? '' : 's'} sent</span>
                </div>
              ) : (
                <div role="alert" className="flex items-start gap-2 text-red-700">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <span className="font-medium">{result.error || 'Nothing was sent.'}</span>
                </div>
              )}
              {(result.failed || 0) > 0 && (
                <div className="flex items-center gap-2 text-amber-700">
                  <AlertCircle className="w-5 h-5" />
                  <span>{result.failed} could not be reached{(result.sent || 0) > 0 && result.error ? ` — ${result.error}` : ''}</span>
                </div>
              )}
              <button onClick={onDone} className="w-full px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700">Done</button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-gray-500 dark:text-slate-400">Sending to {contactIds.length} owner{contactIds.length === 1 ? '' : 's'}.</p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Message</label>
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} className="w-full px-3 py-2 border rounded-lg" />
                <p className="text-xs text-gray-500 mt-1 dark:text-slate-400">
                  Filled in for each owner: <code>{'{{owner_name}}'}</code> <code>{'{{pet_name}}'}</code>{' '}
                  {vaccinationIds.length > 0 && <><code>{'{{vaccine}}'}</code> <code>{'{{due_date}}'}</code>{' '}</>}
                  <code>{'{{clinic_name}}'}</code>
                </p>
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
