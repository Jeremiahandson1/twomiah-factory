// src/components/admin/BillingEngine.tsx
// Claims & EVV Engine — ported from CVHC BillingEngine.jsx: claims (generate drafts from EVV,
// 837P / insurer-portal / IRIS exports, status updates), authorizations burn-down, the denial
// queue with resubmission, and payer payments (check scan + reconciliation).
import React, { useState, useEffect } from 'react';
import { API_BASE_URL, apiCall } from '../../config';
import { toast } from '../Toast';
import { useAuth } from '../../contexts/AuthContext';
import { formatDate } from '../../utils/date';

const money = (n) => `$${(parseFloat(n || 0) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATUSES = ['draft', 'pending', 'ready', 'submitted', 'accepted', 'paid', 'denied', 'voided'];
// Self-contained chips: ground + ink set together, readable in both themes.
const STATUS_CHIP = {
  draft: 'bg-gray-200 text-gray-800 dark:bg-slate-700 dark:text-slate-200',
  pending: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
  ready: 'bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-200',
  submitted: 'bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-200',
  accepted: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200',
  paid: 'bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-200',
  denied: 'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200',
  voided: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400',
};
const chip = (status) => <span className={`rounded px-2 py-0.5 text-xs font-bold ${STATUS_CHIP[status] || STATUS_CHIP.draft}`}>{(status || '').toUpperCase()}</span>;
const Stat = ({ label, value, tone = '', sub = null }) => (
  <div className="stat-card"><small>{label}</small><div className={`value ${tone}`}>{value}</div>{sub && <small>{sub}</small>}</div>
);

const download = async (token, path, claimIds, fallbackName) => {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ claimIds }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Export failed'); }
  const blob = await res.blob();
  const name = /filename=([^;]+)/.exec(res.headers.get('content-disposition') || '')?.[1] || fallbackName;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
};

const BillingEngine = () => {
  const { token } = useAuth();
  const [activeTab, setActiveTab] = useState('claims');
  const tabs = [
    { id: 'claims', label: '📑 Claims' },
    { id: 'authorizations', label: '📋 Authorizations' },
    { id: 'denials', label: '❌ Denials' },
    { id: 'payments', label: '💰 Payments' },
  ];
  return (
    <div>
      <div className="page-header"><h2>Claims & EVV Engine</h2></div>
      <div className="mb-4 flex flex-wrap gap-1 border-b-2 border-gray-200 dark:border-slate-700" role="tablist">
        {tabs.map(tab => (
          <button key={tab.id} role="tab" aria-selected={activeTab === tab.id} onClick={() => setActiveTab(tab.id)}
            className={`rounded-t-md border-b-[3px] px-5 py-2.5 text-sm ${activeTab === tab.id
              ? 'border-blue-600 bg-blue-50 font-bold text-blue-700 dark:border-blue-400 dark:bg-blue-950/40 dark:text-blue-300'
              : 'border-transparent font-medium text-gray-600 dark:text-slate-400'}`}>
            {tab.label}
          </button>
        ))}
      </div>
      {activeTab === 'claims' && <ClaimsTab token={token} />}
      {activeTab === 'authorizations' && <AuthorizationsTab token={token} />}
      {activeTab === 'denials' && <DenialsTab token={token} />}
      {activeTab === 'payments' && <PaymentsTab token={token} />}
    </div>
  );
};

// ═════════════════════════════════════════ CLAIMS ═════════════════════════════════════════
const ClaimsTab = ({ token }) => {
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: '', payerId: '' });
  const [payers, setPayers] = useState([]);
  const [selected, setSelected] = useState([]);
  const [summary, setSummary] = useState(null);
  const [showBatch, setShowBatch] = useState(false);
  const [batchDates, setBatchDates] = useState({ startDate: '', endDate: '' });
  const [current, setCurrent] = useState(null);

  const loadClaims = async () => {
    try {
      const p = new URLSearchParams();
      if (filter.status) p.append('status', filter.status);
      if (filter.payerId) p.append('payerId', filter.payerId);
      const data = await apiCall(`/api/claims?${p}`, { method: 'GET' }, token);
      setClaims(Array.isArray(data) ? data : []);
    } catch (e) { toast(e.message, 'error'); } finally { setLoading(false); }
  };
  const loadSummary = async () => { try { setSummary(await apiCall('/api/claims/reports/summary', { method: 'GET' }, token)); } catch {} };
  useEffect(() => { loadClaims(); loadSummary(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);
  useEffect(() => {
    apiCall('/api/referral-sources', { method: 'GET' }, token).then(d => setPayers(Array.isArray(d) ? d : (d?.data || []))).catch(() => {});
  }, [token]);

  const batchGenerate = async () => {
    if (!batchDates.startDate || !batchDates.endDate) { toast('Select a date range', 'error'); return; }
    try {
      const data = await apiCall('/api/claims/batch-generate', { method: 'POST', body: JSON.stringify(batchDates) }, token);
      toast(`Generated ${data.generated} draft claims. ${data.skipped} skipped.`, 'success');
      setShowBatch(false); loadClaims(); loadSummary();
    } catch (e) { toast(e.message, 'error'); }
  };
  const runExport = async (path, name, label) => {
    if (!selected.length) { toast('Select claims to export'); return; }
    try {
      await download(token, path, selected, name);
      toast(`${label} exported — the selected claims are now submitted`, 'success');
      setSelected([]); loadClaims(); loadSummary();
    } catch (e) { toast(e.message, 'error'); }
  };
  const updateStatus = async (form) => {
    try {
      await apiCall('/api/claims/update-status', { method: 'POST', body: JSON.stringify(form) }, token);
      toast('Status updated', 'success');
      setCurrent(null); loadClaims(); loadSummary();
    } catch (e) { toast(e.message, 'error'); }
  };
  const toggle = (id) => setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const selectAllOpen = () => setSelected(claims.filter(c => ['pending', 'draft', 'ready'].includes(c.status)).map(c => c.id));
  const day = new Date().toISOString().slice(0, 10);

  return (
    <div>
      {summary && (
        <div className="mb-4 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <Stat label="Total AR" value={money(summary.totalAR)} tone="text-red-700 dark:text-red-300" />
          <Stat label="Paid This Month" value={money(summary.paidThisMonth?.amount)} tone="text-emerald-700 dark:text-emerald-300" sub={`${summary.paidThisMonth?.count || 0} claims`} />
          <Stat label="Denied" value={summary.deniedClaims?.count || 0} tone="text-red-700 dark:text-red-300" sub={money(summary.deniedClaims?.total)} />
          <Stat label="30-60 Day AR" value={money(summary.aging?.days_30_60)} tone="text-amber-700 dark:text-amber-300" />
        </div>
      )}
      <div className="mb-4 flex flex-wrap gap-2">
        <button className="btn btn-primary" onClick={() => setShowBatch(true)}>Generate Claims from EVV</button>
        <button className="btn btn-secondary" onClick={() => runExport('/api/claims/export/837p', `claims-837p-${day}.edi`, 'EDI 837P')} disabled={!selected.length}>EDI 837P ({selected.length})</button>
        <button className="btn btn-secondary" onClick={() => runExport('/api/claims/export/portal', `Insurer-Portal-Upload-Packet-${day}.csv`, 'Portal upload packet')} disabled={!selected.length}>Insurer Portal Export</button>
        <button className="btn btn-secondary" onClick={() => runExport('/api/claims/export/iris', `IRIS-FEA-Export-${day}.csv`, 'IRIS FEA export')} disabled={!selected.length}>IRIS FEA Export</button>
        <button className="btn btn-secondary" onClick={selectAllOpen}>Select All Open</button>
      </div>

      {showBatch && (
        <div className="modal active" onClick={() => setShowBatch(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px' }}>
            <div className="modal-header">
              <h3>Generate Claims from EVV Visits</h3>
              <button className="modal-close" aria-label="Close" onClick={() => setShowBatch(false)}>×</button>
            </div>
            <p className="mb-4 mt-0 text-sm text-gray-600 dark:text-slate-400">
              Creates a DRAFT claim for every completed visit with billable time whose client bills a claim payer (not
              private pay) and that has no claim yet. Units come from the visit's billable minutes.
            </p>
            <div className="form-group"><label htmlFor="be-start">Start Date</label><input id="be-start" type="date" value={batchDates.startDate} onChange={e => setBatchDates(p => ({ ...p, startDate: e.target.value }))} /></div>
            <div className="form-group"><label htmlFor="be-end">End Date</label><input id="be-end" type="date" value={batchDates.endDate} onChange={e => setBatchDates(p => ({ ...p, endDate: e.target.value }))} /></div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowBatch(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={batchGenerate}>Generate</button>
            </div>
          </div>
        </div>
      )}

      <div className="card mb-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="form-group" style={{ margin: 0 }}>
            <label htmlFor="be-status">Status</label>
            <select id="be-status" value={filter.status} onChange={e => setFilter(p => ({ ...p, status: e.target.value }))}>
              <option value="">All</option>
              {STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label htmlFor="be-payer">Payer</label>
            <select id="be-payer" value={filter.payerId} onChange={e => setFilter(p => ({ ...p, payerId: e.target.value }))}>
              <option value="">All Payers</option>
              {payers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        {loading ? <div className="loading"><div className="spinner"></div></div> : claims.length === 0 ? (
          <p className="p-8 text-center text-gray-600 dark:text-slate-400">No claims found. Generate claims from EVV visits to get started.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}><input type="checkbox" aria-label="Select all open claims" onChange={e => e.target.checked ? selectAllOpen() : setSelected([])} checked={selected.length > 0} /></th>
                  <th>Claim #</th><th>Client</th><th>Payer</th><th>Service Date</th><th>Units</th><th>Amount</th><th>Status</th><th>Age</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {claims.map(c => (
                  <tr key={c.id}>
                    <td><input type="checkbox" aria-label={`Select claim ${c.claim_number}`} checked={selected.includes(c.id)} onChange={() => toggle(c.id)} disabled={c.status === 'paid' || c.status === 'voided'} /></td>
                    <td><strong className="text-xs">{c.claim_number}</strong></td>
                    <td>{c.client_first_name} {c.client_last_name}</td>
                    <td className="text-xs">{c.payer_name || '-'}</td>
                    <td>{c.service_date ? formatDate(c.service_date) : c.service_date_from ? formatDate(c.service_date_from) : '-'}</td>
                    <td>{c.units_billed || '-'}</td>
                    <td><strong>{money(c.charge_amount)}</strong></td>
                    <td>{chip(c.status)}</td>
                    <td className={`text-xs ${c.days_since_submission > 60 ? 'text-red-700 dark:text-red-300' : c.days_since_submission > 30 ? 'text-amber-700 dark:text-amber-300' : 'text-gray-600 dark:text-slate-400'}`}>
                      {c.days_since_submission != null ? `${Math.floor(c.days_since_submission)}d` : '-'}
                    </td>
                    <td><button className="btn btn-sm btn-secondary" onClick={() => setCurrent(c)}>Update</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {current && (
        <div className="modal active" onClick={() => setCurrent(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Update Claim Status</h3>
              <button className="modal-close" aria-label="Close" onClick={() => setCurrent(null)}>×</button>
            </div>
            <StatusUpdateForm claim={current} onSubmit={updateStatus} onCancel={() => setCurrent(null)} />
          </div>
        </div>
      )}
    </div>
  );
};

const StatusUpdateForm = ({ claim, onSubmit, onCancel }) => {
  const [form, setForm] = useState({ claimId: claim.id, status: claim.status, paidAmount: '', denialCode: '', denialReason: '', eobNotes: '' });
  const submit = (e) => {
    e.preventDefault();
    // Typed as text, checked here on submit.
    if (form.status === 'paid' && form.paidAmount !== '' && !/^\d+(\.\d{1,2})?$/.test(String(form.paidAmount).trim())) {
      toast('Paid amount must be a dollar amount, e.g. 132.00', 'error'); return;
    }
    onSubmit(form);
  };
  return (
    <form onSubmit={submit}>
      <p><strong>Claim:</strong> {claim.claim_number} | <strong>Amount:</strong> {money(claim.charge_amount)}</p>
      <div className="form-group">
        <label htmlFor="su-status">New Status</label>
        <select id="su-status" value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
          {STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
      </div>
      {form.status === 'submitted' && <p className="text-xs text-gray-600 dark:text-slate-400">Submitting takes this claim's units off its authorization — once, however many times it is submitted.</p>}
      {form.status === 'paid' && (
        <div className="form-group"><label htmlFor="su-paid">Paid Amount</label>
          <input id="su-paid" type="text" inputMode="decimal" value={form.paidAmount} onChange={e => setForm(p => ({ ...p, paidAmount: e.target.value }))} placeholder="Enter amount received" /></div>
      )}
      {form.status === 'denied' && (
        <>
          <div className="form-group"><label htmlFor="su-code">Denial Code</label><input id="su-code" value={form.denialCode} onChange={e => setForm(p => ({ ...p, denialCode: e.target.value }))} placeholder="e.g. CO-197" /></div>
          <div className="form-group"><label htmlFor="su-reason">Denial Reason</label><textarea id="su-reason" value={form.denialReason} onChange={e => setForm(p => ({ ...p, denialReason: e.target.value }))} /></div>
        </>
      )}
      <div className="form-group"><label htmlFor="su-eob">EOB Notes</label><textarea id="su-eob" value={form.eobNotes} onChange={e => setForm(p => ({ ...p, eobNotes: e.target.value }))} placeholder="Optional notes from EOB" /></div>
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">Update Status</button>
      </div>
    </form>
  );
};

// ═════════════════════════════════════ AUTHORIZATIONS ═════════════════════════════════════
const AuthorizationsTab = ({ token }) => {
  const [auths, setAuths] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    apiCall('/api/authorizations?status=active', { method: 'GET' }, token).then(d => setAuths(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false));
    apiCall('/api/authorizations/summary', { method: 'GET' }, token).then(setSummary).catch(() => {});
  }, [token]);

  const health = (a) => {
    const total = parseFloat(a.authorized_units || 0), used = parseFloat(a.used_units || 0);
    const daysLeft = a.end_date ? Math.ceil((new Date(String(a.end_date).slice(0, 10) + 'T23:59:59').getTime() - Date.now()) / 86400000) : null;
    if (daysLeft !== null && daysLeft <= 0) return 'expired';
    if (total - used <= parseFloat(a.low_units_alert_threshold || 20)) return 'low';
    if (daysLeft !== null && daysLeft <= 30) return 'expiring_soon';
    return 'ok';
  };
  const HEALTH = {
    ok: 'border-emerald-600 dark:border-emerald-400', expiring_soon: 'border-amber-500 dark:border-amber-400',
    low: 'border-red-600 dark:border-red-400', expired: 'border-gray-500 dark:border-slate-500',
  };
  const HEALTH_CHIP = {
    ok: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200', expiring_soon: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
    low: 'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200', expired: 'bg-gray-200 text-gray-800 dark:bg-slate-700 dark:text-slate-200',
  };

  if (loading) return <div className="loading"><div className="spinner"></div></div>;
  return (
    <div>
      {summary && (
        <div className="mb-4 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
          <Stat label="Active" value={summary.active || 0} tone="text-emerald-700 dark:text-emerald-300" />
          <Stat label="Expiring Soon" value={summary.expiring_soon || 0} tone="text-amber-700 dark:text-amber-300" />
          <Stat label="Low Units" value={summary.low_units || 0} tone="text-red-700 dark:text-red-300" />
          <Stat label="Exhausted" value={summary.exhausted || 0} />
          <Stat label="Expired" value={summary.expired || 0} />
        </div>
      )}
      <div className="grid gap-3">
        {auths.length === 0 ? <p className="p-8 text-center text-gray-600 dark:text-slate-400">No active authorizations.</p> : auths.map(a => {
          const total = parseFloat(a.authorized_units || 0), used = parseFloat(a.used_units || 0);
          const remaining = Math.max(0, total - used);
          const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
          const h = health(a);
          const name = a.client ? `${a.client.firstName || a.client.first_name || ''} ${a.client.lastName || a.client.last_name || ''}`.trim() : '';
          return (
            <div key={a.id} className={`card border-l-4 ${HEALTH[h]}`} style={{ padding: '1rem' }}>
              <div className="mb-2 flex items-start justify-between">
                <div>
                  <strong>{name || 'Client'}</strong>
                  <span className="ml-3 text-xs text-gray-600 dark:text-slate-400">Auth #{a.auth_number || 'N/A'} | {a.payer?.name || 'Unknown Payer'}</span>
                </div>
                <span className={`rounded px-2 py-0.5 text-[0.72rem] font-bold ${HEALTH_CHIP[h]}`}>{h.replace('_', ' ').toUpperCase()}</span>
              </div>
              <div className="mb-2">
                <div className="mb-1 flex justify-between text-xs text-gray-600 dark:text-slate-400">
                  <span>{used.toFixed(1)} / {total.toFixed(1)} units used</span>
                  <span className={`font-semibold ${remaining < total * 0.1 ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>{remaining.toFixed(1)} remaining</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-gray-200 dark:bg-slate-700" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Units used">
                  <div className={`h-full rounded-full ${pct > 90 ? 'bg-red-500' : pct > 75 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
              <div className="flex gap-4 text-xs text-gray-600 dark:text-slate-400">
                <span>Code: {a.procedure_code || 'T1019'}</span>
                <span>Expires: {a.end_date ? formatDate(a.end_date) : 'N/A'}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════ DENIALS ═════════════════════════════════════════
const DenialsTab = ({ token }) => {
  const [denials, setDenials] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = () => apiCall('/api/claims/denial-queue', { method: 'GET' }, token).then(d => setDenials(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const resubmit = async (id) => {
    try { await apiCall(`/api/claims/${id}/resubmit`, { method: 'POST', body: '{}' }, token); toast('Claim resubmitted — a new pending claim replaces the denied one', 'success'); load(); }
    catch (e) { toast(e.message, 'error'); }
  };
  if (loading) return <div className="loading"><div className="spinner"></div></div>;
  return denials.length === 0 ? (
    <div className="card p-8 text-center text-emerald-700 dark:text-emerald-300">No denied claims. All clear!</div>
  ) : (
    <div className="grid gap-3">
      {denials.map(d => (
        <div key={d.id} className="card border-l-4 border-red-600 dark:border-red-400" style={{ padding: '1rem' }}>
          <div className="mb-2 flex items-start justify-between">
            <div><strong>{d.claim_number}</strong><span className="ml-3 text-sm text-gray-600 dark:text-slate-400">{d.client_first_name} {d.client_last_name}</span></div>
            <strong className="text-red-700 dark:text-red-300">{money(d.charge_amount)}</strong>
          </div>
          <div className="mb-2 rounded-md bg-red-50 p-3 dark:bg-red-950/40">
            <div className="mb-1 text-sm font-semibold text-red-900 dark:text-red-200">{d.denial_code || 'No Code'}: {d.denial_description || d.denial_reason || 'No reason provided'}</div>
            {d.common_fix && <div className="text-xs text-gray-700 dark:text-slate-300">Suggested fix: {d.common_fix}</div>}
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-600 dark:text-slate-400">
            <span>Payer: {d.payer_name || '-'}</span>
            <span>Date: {d.service_date ? formatDate(d.service_date) : '-'}</span>
            <span>Auth: {d.auth_number || '-'}</span>
            <div className="flex-1" />
            <button className="btn btn-sm btn-primary" onClick={() => resubmit(d.id)}>Resubmit</button>
          </div>
        </div>
      ))}
    </div>
  );
};

// ═══════════════════════════════════════ PAYMENTS ════════════════════════════════════════
const PaymentsTab = ({ token }) => {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showScanner, setShowScanner] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [reconc, setReconc] = useState(null);

  const loadPayments = () => apiCall('/api/payments', { method: 'GET' }, token).then(d => setPayments(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false));
  const loadReconc = () => apiCall('/api/payments/reports/reconciliation', { method: 'GET' }, token).then(setReconc).catch(() => {});
  useEffect(() => { loadPayments(); loadReconc(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const scanCheck = async (file) => {
    setScanning(true);
    try {
      const fd = new FormData();
      fd.append('check', file);
      const res = await fetch(`${API_BASE_URL}/api/payments/scan-check`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Scan failed');
      setScanResult(data);
      toast('Check scanned', 'success');
    } catch (e) { toast(e.message, 'error'); } finally { setScanning(false); }
  };
  const recordPayment = async (p) => {
    if (!/^\d+(\.\d{1,2})?$/.test(String(p.checkAmount || '').trim())) { toast('Amount must be a dollar amount, e.g. 1250.00', 'error'); return; }
    try {
      const data = await apiCall('/api/payments', { method: 'POST', body: JSON.stringify(p) }, token);
      toast(`Payment recorded. ${data.claimsUpdated} claims matched.`, 'success');
      setShowScanner(false); setShowManual(false); setScanResult(null);
      loadPayments(); loadReconc();
    } catch (e) { toast(e.message, 'error'); }
  };

  const RECON_CHIP = (s) => s === 'reconciled' ? 'bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-200'
    : s === 'partial' ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200'
    : 'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200';

  return (
    <div>
      {reconc?.summary && (
        <div className="mb-4 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <Stat label="Total Received" value={money(reconc.summary.total_received)} tone="text-emerald-700 dark:text-emerald-300" />
          <Stat label="Matched" value={money(reconc.summary.total_matched)} />
          <Stat label="Underpayments" value={money(reconc.summary.total_underpayments)} tone="text-amber-700 dark:text-amber-300" />
          <Stat label="Reconciled" value={reconc.summary.reconciled_count || 0} />
        </div>
      )}
      <div className="mb-4 flex gap-2">
        <button className="btn btn-primary" onClick={() => setShowScanner(true)}>Scan Check</button>
        <button className="btn btn-secondary" onClick={() => setShowManual(true)}>Manual Payment</button>
      </div>

      {showScanner && (
        <div className="modal active" onClick={() => { setShowScanner(false); setScanResult(null); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <div className="modal-header"><h3>Check Scanner</h3><button className="modal-close" aria-label="Close" onClick={() => { setShowScanner(false); setScanResult(null); }}>×</button></div>
            {!scanResult ? (
              <div>
                <p className="mb-4 text-sm text-gray-600 dark:text-slate-400">Upload a photo of the check front. The payer, amount and check number are read from it and matched to open claims.</p>
                <div className="rounded-lg border-2 border-dashed border-gray-300 p-8 text-center dark:border-slate-600">
                  <input type="file" accept="image/*" onChange={e => e.target.files?.[0] && scanCheck(e.target.files[0])} className="hidden" id="check-upload" />
                  <label htmlFor="check-upload" className="cursor-pointer font-semibold text-blue-700 dark:text-blue-300">{scanning ? 'Scanning...' : 'Click to upload check image'}</label>
                </div>
              </div>
            ) : (
              <ScanResultForm scanResult={scanResult} onSubmit={recordPayment} onCancel={() => { setShowScanner(false); setScanResult(null); }} />
            )}
          </div>
        </div>
      )}

      {showManual && (
        <div className="modal active" onClick={() => setShowManual(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <div className="modal-header"><h3>Record Payment</h3><button className="modal-close" aria-label="Close" onClick={() => setShowManual(false)}>×</button></div>
            <ManualPaymentForm token={token} onSubmit={recordPayment} onCancel={() => setShowManual(false)} />
          </div>
        </div>
      )}

      <div className="card">
        {loading ? <div className="loading"><div className="spinner"></div></div> : payments.length === 0 ? (
          <p className="p-8 text-center text-gray-600 dark:text-slate-400">No payments recorded yet.</p>
        ) : (
          <table className="table">
            <thead><tr><th>Date</th><th>Payer</th><th>Check #</th><th>Amount</th><th>Matched</th><th>Status</th><th>Claims</th></tr></thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id}>
                  <td>{p.payment_date ? formatDate(p.payment_date) : '-'}</td>
                  <td>{p.payer_display_name || p.payer_name}</td>
                  <td>{p.check_number || '-'}</td>
                  <td><strong>{money(p.check_amount)}</strong></td>
                  <td>{money(p.total_matched)}</td>
                  <td><span className={`rounded px-1.5 py-0.5 text-[0.72rem] font-bold ${RECON_CHIP(p.reconciliation_status)}`}>{(p.reconciliation_status || '').toUpperCase()}</span></td>
                  <td>{p.match_count || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

const ScanResultForm = ({ scanResult, onSubmit, onCancel }) => {
  const ex = scanResult.extracted || {};
  const [form, setForm] = useState({
    payerId: scanResult.suggestedPayer?.id || '', payerName: ex.payerName || scanResult.suggestedPayer?.name || '',
    checkNumber: ex.checkNumber || '', checkDate: ex.checkDate || '', checkAmount: ex.amount != null ? String(ex.amount) : '', paymentMethod: 'check',
    claimMatches: (scanResult.suggestedMatches || []).map(m => ({ claimId: m.claimId, amount: m.chargeAmount, claimNumber: m.claimNumber, matchType: 'auto' })),
  });
  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit(form); }}>
      <div className="mb-4 rounded-md bg-green-50 p-3 text-sm text-green-900 dark:bg-green-950/40 dark:text-green-200">
        <strong>Read from the check:</strong> {ex.payerName || 'Unknown'} | ${ex.amount || '?'} | Check #{ex.checkNumber || '?'} | {ex.checkDate || '?'}
        {ex.confidence && <span className="ml-2 opacity-80">({ex.confidence} confidence)</span>}
      </div>
      <div className="form-group"><label htmlFor="sr-payer">Payer Name</label><input id="sr-payer" value={form.payerName} onChange={e => setForm(p => ({ ...p, payerName: e.target.value }))} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div className="form-group"><label htmlFor="sr-check">Check #</label><input id="sr-check" value={form.checkNumber} onChange={e => setForm(p => ({ ...p, checkNumber: e.target.value }))} /></div>
        <div className="form-group"><label htmlFor="sr-date">Check Date</label><input id="sr-date" type="date" value={form.checkDate} onChange={e => setForm(p => ({ ...p, checkDate: e.target.value }))} /></div>
      </div>
      <div className="form-group"><label htmlFor="sr-amt">Amount</label><input id="sr-amt" type="text" inputMode="decimal" value={form.checkAmount} onChange={e => setForm(p => ({ ...p, checkAmount: e.target.value }))} /></div>
      {form.claimMatches.length > 0 && (
        <div className="mb-4">
          <div className="text-sm font-semibold">Matched Claims:</div>
          {form.claimMatches.map((m, i) => (
            <div key={i} className="flex justify-between border-b border-gray-200 py-1.5 text-sm dark:border-slate-700"><span>{m.claimNumber}</span><strong>{money(m.amount)}</strong></div>
          ))}
          {scanResult.unmatchedAmount > 0.01 && <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">{money(scanResult.unmatchedAmount)} unmatched</div>}
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">Record Payment</button>
      </div>
    </form>
  );
};

const ManualPaymentForm = ({ token, onSubmit, onCancel }) => {
  const [form, setForm] = useState({ payerName: '', checkNumber: '', checkDate: '', checkAmount: '', paymentMethod: 'check', notes: '', claimMatches: [] });
  const [openClaims, setOpenClaims] = useState([]);
  useEffect(() => {
    apiCall('/api/claims?status=submitted', { method: 'GET' }, token).then(d => setOpenClaims(Array.isArray(d) ? d : [])).catch(() => {});
  }, [token]);
  const toggleMatch = (claim) => setForm(prev => {
    const exists = prev.claimMatches.find(m => m.claimId === claim.id);
    return { ...prev, claimMatches: exists ? prev.claimMatches.filter(m => m.claimId !== claim.id)
      : [...prev.claimMatches, { claimId: claim.id, amount: claim.charge_amount, claimNumber: claim.claim_number, matchType: 'manual' }] };
  });
  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit(form); }}>
      <div className="form-group"><label htmlFor="mp-payer">Payer Name</label><input id="mp-payer" value={form.payerName} onChange={e => setForm(p => ({ ...p, payerName: e.target.value }))} required /></div>
      <div className="grid grid-cols-2 gap-3">
        <div className="form-group"><label htmlFor="mp-check">Check #</label><input id="mp-check" value={form.checkNumber} onChange={e => setForm(p => ({ ...p, checkNumber: e.target.value }))} /></div>
        <div className="form-group"><label htmlFor="mp-amt">Amount</label><input id="mp-amt" type="text" inputMode="decimal" value={form.checkAmount} onChange={e => setForm(p => ({ ...p, checkAmount: e.target.value }))} required /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="form-group"><label htmlFor="mp-date">Check Date</label><input id="mp-date" type="date" value={form.checkDate} onChange={e => setForm(p => ({ ...p, checkDate: e.target.value }))} /></div>
        <div className="form-group"><label htmlFor="mp-method">Method</label>
          <select id="mp-method" value={form.paymentMethod} onChange={e => setForm(p => ({ ...p, paymentMethod: e.target.value }))}>
            <option value="check">Check</option><option value="eft">EFT</option><option value="ach">ACH</option><option value="other">Other</option>
          </select></div>
      </div>
      {openClaims.length > 0 && (
        <div className="mb-4">
          <div className="text-sm font-semibold">Match to Submitted Claims:</div>
          <div className="mt-1 max-h-52 overflow-y-auto rounded-md border border-gray-200 dark:border-slate-700">
            {openClaims.slice(0, 50).map(c => {
              const on = form.claimMatches.some(m => m.claimId === c.id);
              return (
                <label key={c.id} className={`flex cursor-pointer justify-between border-b border-gray-100 px-3 py-2 text-xs dark:border-slate-800 ${on ? 'bg-blue-50 dark:bg-blue-950/40' : ''}`}>
                  <span><input type="checkbox" checked={on} onChange={() => toggleMatch(c)} className="mr-2" />{c.claim_number} - {c.client_first_name} {c.client_last_name}</span>
                  <strong>{money(c.charge_amount)}</strong>
                </label>
              );
            })}
          </div>
        </div>
      )}
      <div className="form-group"><label htmlFor="mp-notes">Notes</label><textarea id="mp-notes" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional" /></div>
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">Record Payment</button>
      </div>
    </form>
  );
};

export default BillingEngine;
