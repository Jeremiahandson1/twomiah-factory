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
}

function fmtDate(s?: string): string {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
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

  const toggle = (ownerId?: string) => {
    if (!ownerId) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ownerId)) next.delete(ownerId);
      else next.add(ownerId);
      return next;
    });
  };

  const rows = tab === 'due' ? dueRows : lapsedRows;
  const allOwnerIds = Array.from(new Set(rows.map((r) => r.ownerId).filter(Boolean))) as string[];
  const allSelected = allOwnerIds.length > 0 && allOwnerIds.every((id) => selected.has(id));

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(allOwnerIds));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <BellRing className="w-6 h-6 text-teal-600" /> Reminders
        </h1>
        <p className="text-gray-500">Bring patients back in for the care they're due</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        <button
          onClick={() => setTab('due')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            tab === 'due' ? 'border-teal-600 text-teal-700' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Syringe className="w-4 h-4" /> Vaccines Due
        </button>
        <button
          onClick={() => setTab('lapsed')}
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
              <label className="text-sm text-gray-500">Window</label>
              <select value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))} className="px-3 py-2 border rounded-lg">
                <option value={30}>30 days</option>
                <option value={60}>60 days</option>
                <option value={90}>90 days</option>
              </select>
              <span className="text-sm text-gray-500">
                {dueCount} due · <span className="text-red-600 font-medium">{overdueCount} overdue</span>
              </span>
            </>
          ) : (
            <>
              <label className="text-sm text-gray-500">No visit in</label>
              <select value={months} onChange={(e) => setMonths(Number(e.target.value))} className="px-3 py-2 border rounded-lg">
                <option value={6}>6 months</option>
                <option value={12}>12 months</option>
                <option value={18}>18 months</option>
                <option value={24}>24 months</option>
              </select>
              <span className="text-sm text-gray-500">{lapsedRows.length} lapsed</span>
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
        <div className="text-center py-12 text-gray-500 bg-white rounded-xl border">
          {tab === 'due' ? 'No vaccines due in this window' : 'No lapsed clients'}
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-left">
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
                  </>
                ) : (
                  <th className="px-4 py-3 font-medium">Last Visit</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y">
              {tab === 'due'
                ? dueRows.map((r) => (
                    <tr key={r.vaccinationId} className={r.overdue ? 'bg-red-50' : ''}>
                      <td className="px-4 py-3">
                        <input type="checkbox" checked={!!r.ownerId && selected.has(r.ownerId)} onChange={() => toggle(r.ownerId)} disabled={!r.ownerId} className="w-4 h-4" />
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {r.patientName || '—'} <span className="text-xs text-gray-400 capitalize">{r.species}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{r.ownerName || '—'}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {[r.ownerMobile || r.ownerPhone, r.ownerEmail].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{r.vaccine || '—'}</td>
                      <td className={`px-4 py-3 ${r.overdue ? 'text-red-700 font-medium' : 'text-gray-600'}`}>
                        {fmtDate(r.dueDate)}{r.overdue ? ' (overdue)' : ''}
                      </td>
                    </tr>
                  ))
                : lapsedRows.map((r, i) => (
                    <tr key={`${r.patientId || r.ownerId || i}`}>
                      <td className="px-4 py-3">
                        <input type="checkbox" checked={!!r.ownerId && selected.has(r.ownerId)} onChange={() => toggle(r.ownerId)} disabled={!r.ownerId} className="w-4 h-4" />
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {r.patientName || '—'} <span className="text-xs text-gray-400 capitalize">{r.species}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{r.ownerName || '—'}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {[r.ownerMobile || r.ownerPhone, r.ownerEmail].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{fmtDate(r.lastVisit)}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}

      {showSend && (
        <SendReminderModal
          contactIds={Array.from(selected)}
          onDone={() => { setShowSend(false); setSelected(new Set()); }}
          onClose={() => setShowSend(false)}
        />
      )}
    </div>
  );
}

/* ---------------- Send Reminder Modal ---------------- */

function SendReminderModal({ contactIds, onDone, onClose }: { contactIds: string[]; onDone: () => void; onClose: () => void }) {
  const [message, setMessage] = useState<string>(
    'Hi! This is a friendly reminder from your veterinary team — your pet is due for care. Please call us to schedule a visit.'
  );
  const [sending, setSending] = useState<boolean>(false);
  const [result, setResult] = useState<{ sent?: number; failed?: number } | null>(null);

  const send = async () => {
    if (!message.trim()) { alert('Message is required'); return; }
    setSending(true);
    try {
      const res = await api.post('/api/reminders/send', { contactIds, message: message.trim() });
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
        <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold flex items-center gap-2"><Send className="w-5 h-5 text-teal-600" /> Send Reminder</h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>

          {result ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-green-700">
                <CheckCircle2 className="w-5 h-5" />
                <span className="font-medium">{result.sent} reminder{result.sent === 1 ? '' : 's'} sent</span>
              </div>
              {(result.failed || 0) > 0 && (
                <div className="flex items-center gap-2 text-amber-700">
                  <AlertCircle className="w-5 h-5" />
                  <span>{result.failed} failed to send</span>
                </div>
              )}
              <button onClick={onDone} className="w-full px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700">Done</button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">Sending to {contactIds.length} owner{contactIds.length === 1 ? '' : 's'}.</p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
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
