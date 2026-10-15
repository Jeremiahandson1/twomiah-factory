// src/components/admin/PortalClaimDays.tsx
// Insurer-portal claim days — ported from CVHC EvvClaimWeek.jsx (the MIDAS claim days page).
// Per client of one payer, per day of a Sun–Sat week: the EVV-code units (from visits that went
// through EVV, capped at the client's weekly EVV allowance) and the other-code units (everything
// else). 1 unit = 15 min, rounded per day. The portal and both codes are the PAYER's settings —
// My Choice Wisconsin / MIDAS (S5125 / S5130) is one preset, offered to Wisconsin agencies.
import React, { useState, useEffect } from 'react';
import { apiCall } from '../../config';
import { toast } from '../Toast';
import { useAuth } from '../../contexts/AuthContext';

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const lastFullWeekSunday = () => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - d.getDay() - 7); return ymd(d); };
const shiftWeek = (ws, n) => { const d = new Date(ws + 'T12:00:00'); d.setDate(d.getDate() + 7 * n); return ymd(d); };
const dayLabel = (s) => new Date(s + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
const hrs = (u) => `${(u * 0.25).toFixed(2).replace(/\.?0+$/, '')}h`;
const EMPTY_CFG = { name: '', evvCode: '', evvLabel: '', otherCode: '', otherLabel: '' };

export default function PortalClaimDays() {
  const { token } = useAuth();
  const [payers, setPayers] = useState([]);
  const [presets, setPresets] = useState([]);
  const [payerId, setPayerId] = useState('');
  const [weekStart, setWeekStart] = useState(lastFullWeekSunday());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [cfg, setCfg] = useState(EMPTY_CFG);

  const loadPayers = async () => {
    try {
      const r = await apiCall('/api/billing/claim-portals', { method: 'GET' }, token);
      setPayers(r?.payers || []);
      setPresets(r?.presets || []);
      const firstSet = (r?.payers || []).find((p) => p.claim_portal);
      if (!payerId && firstSet) setPayerId(firstSet.id);
    } catch (e) { setError(e.message); }
  };
  useEffect(() => { loadPayers(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const payer = payers.find((p) => p.id === payerId) || null;
  const portal = payer?.claim_portal || null;

  const load = async () => {
    if (!payerId || !portal) { setData(null); return; }
    setLoading(true); setError('');
    try {
      const j = await apiCall(`/api/billing/portal-claim-days?payerId=${encodeURIComponent(payerId)}&weekStart=${weekStart}`, { method: 'GET' }, token);
      setData(j);
    } catch (e) { setError(e.message); setData(null); }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [weekStart, payerId, portal?.name]);

  const saveCfg = async (value) => {
    try {
      await apiCall(`/api/billing/claim-portals/${payerId}`, { method: 'PUT', body: JSON.stringify({ claimPortal: value }) }, token);
      toast(value ? 'Portal export saved' : 'Portal export removed', 'success');
      setEditing(false);
      await loadPayers();
    } catch (e) { toast(e.message, 'error'); }
  };

  const downloadCsv = () => {
    if (!data || !portal) return;
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Client', 'Medicaid ID', 'MCO Member ID', 'Date', 'Procedure', 'Description', 'Units', 'Hours']];
    for (const c of data.clients) {
      for (const d of c.days) {
        if (d.evvUnits > 0) rows.push([c.client_name, c.medicaid_id, c.mco_member_id, d.date, portal.evvCode, portal.evvLabel, d.evvUnits, d.evvUnits * 0.25]);
        if (d.homemakerUnits > 0) rows.push([c.client_name, c.medicaid_id, c.mco_member_id, d.date, portal.otherCode, portal.otherLabel, d.homemakerUnits, d.homemakerUnits * 0.25]);
      }
    }
    const blob = new Blob([rows.map((r) => r.map(q).join(',')).join('\r\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${portal.name.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}-claim-days_${data.week_start}_to_${data.week_end}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const totals = data ? data.clients.reduce((t, c) => ({ evv: t.evv + c.totals.evvUnits, other: t.other + c.totals.homemakerUnits, pending: t.pending + c.pending_approval }), { evv: 0, other: 0, pending: 0 }) : null;
  const th = 'border-b border-gray-200 px-2.5 py-1.5 text-left text-xs text-gray-700 dark:border-slate-700 dark:text-slate-300';
  const td = 'border-b border-gray-100 px-2.5 py-1.5 text-sm text-gray-900 dark:border-slate-800 dark:text-slate-100';

  return (
    <div className="max-w-5xl p-4">
      <h2 className="mb-1">Insurer Portal Claim Days</h2>
      <p className="mt-0 text-sm text-gray-600 dark:text-slate-400">
        Per client, per day: the payer's EVV procedure units (from visits that went through EVV, capped at the client's weekly
        EVV units) and its other procedure units (everything else). 1 unit = 15 min, rounded per day — what the office keys
        into the insurer's portal, with the visit times as backup.
      </p>

      <div className="my-4 flex flex-wrap items-end gap-3">
        <div className="form-group" style={{ margin: 0 }}>
          <label htmlFor="pcd-payer">Payer</label>
          <select id="pcd-payer" value={payerId} onChange={(e) => { setPayerId(e.target.value); setEditing(false); }}>
            <option value="">Choose a payer…</option>
            {payers.map((p) => <option key={p.id} value={p.id}>{p.name}{p.claim_portal ? ` — ${p.claim_portal.name}` : ''}</option>)}
          </select>
        </div>
        {payer && (
          <button type="button" className="btn btn-secondary" onClick={() => { setCfg(portal || EMPTY_CFG); setEditing(!editing); }}>
            {portal ? '⚙️ Portal settings' : '➕ Set up a portal export'}
          </button>
        )}
      </div>

      {payer && editing && (
        <div className="card">
          <h3 className="mt-0">Portal export for {payer.name}</h3>
          {presets.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-sm text-gray-700 dark:text-slate-300">Use a preset:</span>
              {presets.map((p) => <button key={p.id} type="button" className="btn btn-sm btn-secondary" onClick={() => setCfg(p.config)}>{p.label}</button>)}
            </div>
          )}
          <div className="form-grid">
            {[
              ['name', 'Portal name', 'e.g. MIDAS'],
              ['evvCode', 'EVV procedure code', 'e.g. S5125'],
              ['evvLabel', 'EVV description', 'e.g. Attendant care (EVV)'],
              ['otherCode', 'Other procedure code', 'e.g. S5130'],
              ['otherLabel', 'Other description', 'e.g. Homemaker'],
            ].map(([k, label, ph]) => (
              <div className="form-group" key={k}>
                <label htmlFor={`pcd-${k}`}>{label}</label>
                <input id={`pcd-${k}`} type="text" value={cfg[k] || ''} placeholder={ph} onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })} />
              </div>
            ))}
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-primary" onClick={() => saveCfg(cfg)}>Save</button>
            {portal && <button type="button" className="btn btn-danger" onClick={() => saveCfg(null)}>Remove portal export</button>}
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}

      {payer && !portal && !editing && (
        <p className="text-sm text-gray-600 dark:text-slate-400">{payer.name} has no portal export yet — set one up to see its claim days.</p>
      )}

      {portal && (
        <div className="my-4 flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => setWeekStart(shiftWeek(weekStart, -1))}>← Prev week</button>
          <strong className="text-gray-900 dark:text-slate-100">{data ? `${dayLabel(data.week_start)} – ${dayLabel(data.week_end)}` : weekStart}</strong>
          <button type="button" className="btn btn-secondary" onClick={() => setWeekStart(shiftWeek(weekStart, 1))}>Next week →</button>
          <span className="flex-1" />
          <button type="button" className="btn btn-secondary" onClick={() => window.print()} disabled={!data}>🖨 Print</button>
          <button type="button" className="btn btn-primary" onClick={downloadCsv} disabled={!data || !data.clients.length}>⬇ CSV for {portal.name}</button>
        </div>
      )}

      {loading && <p>Loading…</p>}
      {error && <div className="rounded-lg bg-red-50 p-3 text-red-800 dark:bg-red-950/40 dark:text-red-200">{error}</div>}

      {portal && data && !loading && (
        <>
          <div className="mb-4 flex flex-wrap gap-4">
            <div className="rounded-lg bg-blue-50 px-4 py-2.5 text-blue-900 dark:bg-blue-950/40 dark:text-blue-200">{portal.evvCode} {portal.evvLabel}: <strong>{totals.evv} units</strong> ({hrs(totals.evv)})</div>
            <div className="rounded-lg bg-green-50 px-4 py-2.5 text-green-900 dark:bg-green-950/40 dark:text-green-200">{portal.otherCode} {portal.otherLabel}: <strong>{totals.other} units</strong> ({hrs(totals.other)})</div>
            {totals.pending > 0 && <div className="rounded-lg bg-amber-50 px-4 py-2.5 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">⚠ {totals.pending} visit{totals.pending === 1 ? '' : 's'} still awaiting approval — review before claiming</div>}
          </div>

          {data.clients.length === 0 && <p>No {payer?.name} visits this week.</p>}

          {data.clients.map((c) => (
            <div key={c.client_id} className="mb-4 overflow-hidden rounded-xl border border-gray-200 dark:border-slate-700" style={{ breakInside: 'avoid' }}>
              <div className="flex flex-wrap items-baseline gap-3 bg-gray-50 px-3.5 py-2.5 dark:bg-slate-800">
                <strong className="text-base text-gray-900 dark:text-slate-100">{c.client_name}</strong>
                {c.medicaid_id && <span className="text-xs text-gray-600 dark:text-slate-400">MA {c.medicaid_id}</span>}
                <span className="flex-1" />
                <span className="text-sm text-gray-900 dark:text-slate-100">
                  EVV <strong>{c.totals.evvUnits}</strong>{c.totals.evvAuthorizedUnits != null ? ` of ${c.totals.evvAuthorizedUnits}` : ''} u · {portal.otherLabel} <strong>{c.totals.homemakerUnits}</strong> u
                </span>
                {!c.in_evv && <span className="text-xs text-gray-600 dark:text-slate-400">(no Medicaid ID — not an EVV client)</span>}
                {c.in_evv && c.totals.evvAuthorizedUnits == null && <span className="text-xs text-amber-800 dark:text-amber-300">⚠ no weekly EVV units entered — all EVV time counted as EVV</span>}
                {c.in_evv && c.totals.evvAuthorizedUnits != null && c.totals.evvUnits < c.totals.evvAuthorizedUnits && <span className="text-xs text-amber-800 dark:text-amber-300">⚠ under authorized EVV units</span>}
              </div>
              <table className="w-full border-collapse">
                <thead><tr><th className={th}>Day</th><th className={th}>{portal.evvCode} units</th><th className={th}>{portal.otherCode} units</th><th className={th}>Visits</th></tr></thead>
                <tbody>
                  {c.days.map((d) => (
                    <tr key={d.date}>
                      <td className={td}>{dayLabel(d.date)}</td>
                      <td className={td}>{d.evvUnits || '—'}</td>
                      <td className={td}>{d.homemakerUnits || '—'}</td>
                      <td className={`${td} text-xs`}>
                        {d.visits.map((v) => (
                          <div key={v.id}>
                            {v.clock_in}–{v.clock_out} · {v.caregiver} · {v.minutes} min
                            {v.sentToSandata ? ' · EVV' : ''}
                            {v.needs_approval && <span className="text-amber-800 dark:text-amber-300"> · ⚠ needs approval</span>}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
