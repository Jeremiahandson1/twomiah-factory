// Office side of the Sandata alternate-EVV integration (Integrations → EVV), ported from the CVHC
// CRM's IntegrationsHub EVV tab and extended with the screens its routes had no caller for:
//   · the agency's Sandata account (credentials are agency data, not server env)
//   · certification readiness: what would make Sandata reject a visit
//   · visits needing attention: correct times (with a reason code) or acknowledge an exception
//   · the submission queue: failures, retry, and "check Sandata for results"
import React, { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '../../config';
import { toast } from '../Toast';
import { EVV_REASONS, EVV_REASONS_NEEDING_MEMO } from '../../utils/sandata';

const fmtDT = (d) => (d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
// datetime-local wants local wall time without a zone.
const toLocalInput = (d) => {
  if (!d) return '';
  const x = new Date(d);
  if (isNaN(x.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
};

const card = 'rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800';
const h4 = 'mb-2 text-base font-extrabold text-gray-900 dark:text-slate-100';
const label = 'mb-1 block text-xs font-semibold text-gray-600 dark:text-slate-300';
const input = 'w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';
const btn = 'rounded-md bg-blue-700 px-3 py-1.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50 dark:bg-blue-600 dark:text-white dark:hover:bg-blue-500';
const btnGhost = 'rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-700';

export default function SandataPanel({ token, visits = [], onChanged }: { token: string | null; visits?: any[]; onChanged?: () => void }) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState({ username: '', password: '', accountId: '', providerId: '', agencyId: '', timezone: '', apiUrl: '' });
  const [readiness, setReadiness] = useState(null);
  const [queue, setQueue] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState('');
  const [editing, setEditing] = useState(null); // { visit, mode: 'ack' | 'fix', reasonCode, memo, start, end }

  const get = useCallback(async (url) => {
    try { const r = await fetch(`${API_BASE_URL}${url}`, { headers: { Authorization: `Bearer ${token}` } }); return r.ok ? r.json() : null; } catch { return null; }
  }, [token]);

  const load = useCallback(async () => {
    const [s, rd, q] = await Promise.all([get('/api/sandata/settings'), get('/api/sandata/readiness'), get('/api/sandata/queue')]);
    if (s) {
      setSettings(s);
      setForm({ username: s.username || '', password: '', accountId: s.accountId || '', providerId: s.providerId || '', agencyId: s.agencyId || '', timezone: s.timezone || '', apiUrl: s.apiUrl || '' });
    }
    setReadiness(rd);
    setQueue(q);
  }, [get]);
  useEffect(() => { load(); }, [load]);

  const saveSettings = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body: any = { username: form.username, accountId: form.accountId, providerId: form.providerId, agencyId: form.agencyId, timezone: form.timezone, apiUrl: form.apiUrl };
      if (form.password.trim()) body.password = form.password;
      const r = await fetch(`${API_BASE_URL}/api/sandata/settings`, { method: 'PUT', headers, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Save failed');
      toast(d.isConfigured ? 'Sandata account saved — submission is on' : 'Saved. Submission starts once username, password, account id and provider id are all set.', 'success');
      await load();
      onChanged && onChanged();
    } catch (err) { toast(err.message, 'error'); } finally { setSaving(false); }
  };

  const post = async (url, body, okMsg) => {
    setBusy(url);
    try {
      const r = await fetch(`${API_BASE_URL}${url}`, { method: 'POST', headers, body: JSON.stringify(body || {}) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Request failed');
      toast(typeof okMsg === 'function' ? okMsg(d) : okMsg, 'success');
      await load();
      onChanged && onChanged();
      return d;
    } catch (err) { toast(err.message, 'error'); return null; } finally { setBusy(''); }
  };

  // Validate on submit: a reason code is required, 5 and 8 need a memo, the end must follow the start.
  const submitEdit = async () => {
    const e = editing;
    if (!e) return;
    if (EVV_REASONS_NEEDING_MEMO.includes(e.reasonCode) && !e.memo.trim()) { toast(`Reason code ${e.reasonCode} needs a memo explaining the change.`, 'error'); return; }
    if (e.mode === 'ack') {
      const d = await post(`/api/sandata/visit/${e.visit.id}/acknowledge`, { reasonCode: e.reasonCode, memo: e.memo }, 'Exception acknowledged — the visit will be resubmitted');
      if (d) setEditing(null);
      return;
    }
    const body: any = { reasonCode: e.reasonCode, reasonMemo: e.memo };
    if (e.start && e.start !== toLocalInput(e.visit.actual_start)) body.actualStart = new Date(e.start).toISOString();
    if (e.end && e.end !== toLocalInput(e.visit.actual_end)) body.actualEnd = new Date(e.end).toISOString();
    if (!body.actualStart && !body.actualEnd) { toast('Change the start or end time first.', 'error'); return; }
    if (e.start && e.end && new Date(e.end) <= new Date(e.start)) { toast('The visit must end after it starts.', 'error'); return; }
    setBusy('fix');
    try {
      const r = await fetch(`${API_BASE_URL}/api/sandata/visit/${e.visit.id}`, { method: 'PUT', headers, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Save failed');
      toast('Visit times corrected — recorded as a Sandata visit change', 'success');
      setEditing(null);
      await load();
      onChanged && onChanged();
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(''); }
  };

  const attention = visits.filter((v) => ['exception', 'needs_manual'].includes(v.sandata_status));
  const configured = !!settings?.isConfigured;

  return (
    <div className="grid gap-4">
      {/* Account */}
      <form className={card} onSubmit={saveSettings}>
        <div className={h4}>🔑 Sandata account</div>
        <p className="mb-3 text-sm text-gray-600 dark:text-slate-400">
          {configured
            ? 'Visits that pass verification are submitted to Sandata automatically after clock-out.'
            : 'Certification with Sandata issues these. Until all four of username, password, account id and provider id are set, EVV records are still created at clock-out but nothing is sent.'}
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div><label className={label}>API username</label><input className={input} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="off" /></div>
          <div>
            <label className={label}>API password {settings?.hasPassword ? '(saved — leave blank to keep)' : ''}</label>
            <input className={input} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
          </div>
          <div><label className={label}>Account id</label><input className={input} value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })} /></div>
          <div><label className={label}>Agency Medicaid provider id</label><input className={input} value={form.providerId} onChange={(e) => setForm({ ...form, providerId: e.target.value })} /></div>
          <div>
            <label className={label}>Sandata agency id (caregivers pick it in Sandata Mobile Connect)</label>
            <input className={input} value={form.agencyId} onChange={(e) => setForm({ ...form, agencyId: e.target.value })} />
          </div>
          <div>
            <label className={label}>Agency time zone — EVV weeks, reports and reminders all use it {settings ? `(now ${settings.effectiveTimezone})` : ''}</label>
            <input className={input} value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} placeholder="e.g. America/Chicago — blank = your state's" />
          </div>
          <div className="md:col-span-2">
            <label className={label}>Sandata endpoint</label>
            <select className={input} value={form.apiUrl || ''} onChange={(e) => setForm({ ...form, apiUrl: e.target.value })}>
              <option value="">UAT (testing) — {settings?.uatUrl || 'uat-api.sandata.com'}</option>
              {settings?.productionUrl && <option value={settings.productionUrl}>Production — {settings.productionUrl}</option>}
              {form.apiUrl && form.apiUrl !== settings?.productionUrl && <option value={form.apiUrl}>{form.apiUrl}</option>}
            </select>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button type="submit" className={btn} disabled={saving}>{saving ? 'Saving…' : 'Save account'}</button>
          {settings?.hasPassword && (
            <button type="button" className={btnGhost} onClick={async () => {
              const r = await fetch(`${API_BASE_URL}/api/sandata/settings`, { method: 'PUT', headers, body: JSON.stringify({ clearPassword: true }) });
              if (r.ok) { toast('Password removed', 'success'); load(); }
            }}>Remove password</button>
          )}
          <span className={configured ? 'text-sm font-semibold text-emerald-700 dark:text-emerald-300' : 'text-sm font-semibold text-amber-700 dark:text-amber-300'}>
            {configured ? '✓ Submission on' : 'Submission off'}
          </span>
        </div>
      </form>

      {/* Readiness */}
      {readiness && (
        <div className={card}>
          <div className={h4}>🧭 Certification readiness</div>
          <div className="mb-2 text-xs text-gray-600 dark:text-slate-400">{readiness.clientsInScope} EVV-scope clients · {readiness.activeCaregivers} active caregivers</div>
          {readiness.careTypesMissingServiceCode?.length > 0 && (
            <div className="mb-2 text-sm text-amber-700 dark:text-amber-300">
              <strong>Care types missing a service code:</strong> {readiness.careTypesMissingServiceCode.map((ct) => `${ct.name} (${ct.active_clients} clients)`).join(', ')}
            </div>
          )}
          <div className="mb-2 text-sm">
            <strong className={readiness.caregiversWithIssues?.length ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}>
              Caregivers missing an EVV worker ID: {readiness.caregiversWithIssues?.length || 0}
            </strong>
            {readiness.caregiversWithIssues?.length > 0 && (
              <span className="text-gray-600 dark:text-slate-400"> — {readiness.caregiversWithIssues.slice(0, 8).map((u) => `${u.first_name} ${u.last_name}`).join(', ')}{readiness.caregiversWithIssues.length > 8 ? ` +${readiness.caregiversWithIssues.length - 8} more` : ''}</span>
            )}
          </div>
          <div className="mb-2 text-sm">
            <strong className={readiness.clientsWithIssues?.length ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}>
              Clients with EVV data issues: {readiness.clientsWithIssues?.length || 0}
            </strong>
          </div>
          {readiness.clientsWithIssues?.length > 0 && (
            <div className="max-h-48 overflow-auto rounded-lg border border-gray-100 text-xs dark:border-slate-700">
              <table className="w-full border-collapse">
                <tbody>
                  {readiness.clientsWithIssues.map((c) => (
                    <tr key={c.id} className="border-b border-gray-50 dark:border-slate-700">
                      <td className="whitespace-nowrap px-2 py-1 font-semibold text-gray-900 dark:text-slate-100">{c.first_name} {c.last_name}</td>
                      <td className="px-2 py-1 text-amber-700 dark:text-amber-300">{c.issues.join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Needs attention */}
      <div className={card}>
        <div className="flex items-center justify-between">
          <div className={h4}>⚠️ Visits needing attention ({attention.length})</div>
          <button type="button" className={btnGhost} disabled={!configured || busy === '/api/sandata/poll-status'}
            onClick={() => post('/api/sandata/poll-status', {}, (d) => `Checked ${d.checked || 0} submitted visit(s) — ${d.resolved || 0} answered`)}>
            Check Sandata for results
          </button>
        </div>
        {attention.length === 0 && <div className="text-sm text-gray-500 dark:text-slate-400">Nothing rejected or waiting for a manual fix in this period.</div>}
        {attention.map((v) => (
          <div key={v.id} className="mb-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm dark:border-red-800 dark:bg-red-950">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-gray-900 dark:text-slate-100">
                <strong>{v.client_first} {v.client_last}</strong> · {v.cg_first} {v.cg_last} · {fmtDT(v.actual_start)} – {fmtDT(v.actual_end)}
              </div>
              <div className="flex gap-2">
                <button type="button" className={btnGhost} onClick={() => setEditing({ visit: v, mode: 'fix', reasonCode: '1', memo: '', start: toLocalInput(v.actual_start), end: toLocalInput(v.actual_end) })}>Correct times</button>
                <button type="button" className={btnGhost} onClick={() => setEditing({ visit: v, mode: 'ack', reasonCode: '1', memo: '', start: '', end: '' })}>Acknowledge</button>
              </div>
            </div>
            <div className="mt-1 text-red-800 dark:text-red-200">{v.sandata_exception_code ? `${v.sandata_exception_code}: ` : ''}{v.sandata_exception_desc || v.sandata_status}</div>
          </div>
        ))}
        {editing && (
          <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-slate-900">
            <div className="mb-2 font-bold text-blue-900 dark:text-blue-200">
              {editing.mode === 'ack' ? 'Acknowledge the exception' : 'Correct the visit times'} — {editing.visit.client_first} {editing.visit.client_last}
            </div>
            {editing.mode === 'fix' && (
              <div className="mb-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                <div><label className={label}>Start</label><input className={input} type="datetime-local" value={editing.start} onChange={(e) => setEditing({ ...editing, start: e.target.value })} /></div>
                <div><label className={label}>End</label><input className={input} type="datetime-local" value={editing.end} onChange={(e) => setEditing({ ...editing, end: e.target.value })} /></div>
              </div>
            )}
            <label className={label}>EVV change reason (reported to Sandata)</label>
            <select className={input} value={editing.reasonCode} onChange={(e) => setEditing({ ...editing, reasonCode: e.target.value })}>
              {EVV_REASONS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
            <label className={`${label} mt-2`}>Memo {EVV_REASONS_NEEDING_MEMO.includes(editing.reasonCode) ? '(required for this code)' : '(optional)'}</label>
            <input className={input} value={editing.memo} maxLength={256} onChange={(e) => setEditing({ ...editing, memo: e.target.value })} />
            <div className="mt-2 flex gap-2">
              <button type="button" className={btn} disabled={!!busy} onClick={submitEdit}>{editing.mode === 'ack' ? 'Acknowledge & resubmit' : 'Save correction'}</button>
              <button type="button" className={btnGhost} onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Queue */}
      {queue && (
        <div className={card}>
          <div className={h4}>📤 Submission queue (last 7 days)</div>
          <div className="mb-2 flex flex-wrap gap-3 text-sm text-gray-700 dark:text-slate-300">
            {(queue.queueStatus || []).length === 0 && <span>No submissions yet.</span>}
            {(queue.queueStatus || []).map((s) => <span key={s.status}><strong>{s.count}</strong> {s.status}</span>)}
          </div>
          {(queue.recentFailures || []).map((f) => (
            <div key={f.id} className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm dark:border-amber-800 dark:bg-amber-950">
              <div className="text-gray-900 dark:text-slate-100">
                <strong>{f.client_first} {f.client_last}</strong> · {String(f.service_date || '').slice(0, 10)} · {f.retry_count} attempt(s)
                <div className="text-xs text-amber-800 dark:text-amber-200">{f.last_error}</div>
              </div>
              <button type="button" className={btnGhost} disabled={busy === `/api/sandata/queue/retry/${f.id}`}
                onClick={() => post(`/api/sandata/queue/retry/${f.id}`, {}, 'Submission re-queued')}>Retry</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
