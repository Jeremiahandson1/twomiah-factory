// src/components/admin/ClientWeekHours.tsx — ported from CVHC ClientWeekHours.jsx
// Who was at each client, and when — one Sunday–Saturday week at a time, every scheduled visit beside
// its actual clock-in/out. Built for entering hours into an insurer's portal. Read-only: corrections
// are made in Payroll → Shift Review and shown here.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../contexts/AuthContext';
import { cancelReasonLabel } from '../../utils/cancelReasons';

// Sunday of the week containing `d` (local date), as YYYY-MM-DD.
const sundayOf = (d: Date) => { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - x.getDay()); return x.toLocaleDateString('en-CA'); };
const addDays = (ymd: string, n: number) => { const x = new Date(`${ymd}T12:00:00`); x.setDate(x.getDate() + n); return x.toLocaleDateString('en-CA'); };
const dayLabel = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
const hm = (t?: string | null) => { if (!t) return ''; const [h, m] = String(t).split(':').map(Number); return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const hrs = (m?: number | null) => m == null ? '' : (m / 60).toFixed(2);
// 15-minute units, same as the claims engine: minutes ÷ 15 to 2 decimals (8, 8.2, 8.27).
const units = (m?: number | null) => m == null ? '' : String(Math.round((m / 15) * 100) / 100);
// Payroll's correction for a shift (Payroll → Shift Review), in plain words.
const payrollText = (p: any) => {
  if (!p) return '';
  const h = p.payable_minutes != null ? `${(p.payable_minutes / 60).toFixed(2)} h / ${units(p.payable_minutes)} units` : '';
  const head = p.kind === 'manual' ? `✏️ Paid ${h} (manual entry)`
    : p.kind === 'excused' ? '🚫 Excused — not paid'
    : p.kind === 'paid_no_clock_in' ? `✅ Paid ${h}, no clock-in`
    : p.kind === 'adjusted' ? `✏️ Paid ${h}`
    : '';
  return [head, p.note].filter(Boolean).join(' — ');
};
const FLAG_LABELS: Record<string, string> = { offline_punch: 'saved offline', admin_force_clockout: 'office clock-out', excessive_duration: 'very long punch', zero_duration: 'accidental tap' };

const ClientWeekHours = () => {
  const { token } = useAuth();
  // Opens on THIS week on the agency's clock: the first load sends no weekStart and the server answers
  // with the Sunday of the agency's today (not the laptop's, not last week).
  const [weekStart, setWeekStart] = useState('');
  const adopted = useRef('');
  const [clientId, setClientId] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (weekStart && weekStart === adopted.current) return; // the week the first load just adopted
    adopted.current = '';
    setLoading(true); setError('');
    try {
      const qs = weekStart ? `?weekStart=${weekStart}` : '';
      const r = await fetch(`${API_BASE_URL}/api/reports/client-week${qs}`, { headers: { Authorization: `Bearer ${token}` } });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      setData(body);
      if (!weekStart && body.weekStart) { adopted.current = body.weekStart; setWeekStart(body.weekStart); }
    } catch (e: any) { setError(e.message); setData(null); }
    setLoading(false);
  }, [weekStart, token]);

  useEffect(() => { load(); }, [load]);

  // Clock times on the agency's clock (the server names its zone), not the viewer's laptop.
  const clock = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: data?.timezone || undefined }) : '';
  const clients: any[] = data ? data.clients : [];
  const shown = clientId ? clients.filter(c => c.client_id === clientId) : clients;

  return (
    <div className="client-week-hours">
      <style>{`@media print { .cwh-controls { display: none !important; } .cwh-client { break-inside: avoid; } }`}</style>
      <h2 style={{ marginTop: 0 }}>🗓️ Client Hours by Week</h2>
      <p className="text-muted" style={{ marginTop: 0 }}>Who was at each client and when — scheduled visits beside the actual clock-in and clock-out, Sunday to Saturday.</p>

      <div className="card cwh-controls" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-sm btn-secondary" disabled={!weekStart} onClick={() => setWeekStart(addDays(weekStart, -7))}>← Prev week</button>
        <strong>{weekStart ? `${dayLabel(weekStart)} – ${dayLabel(addDays(weekStart, 6))}` : 'This week'}</strong>
        <button type="button" className="btn btn-sm btn-secondary" disabled={!weekStart} onClick={() => setWeekStart(addDays(weekStart, 7))}>Next week →</button>
        <input type="date" value={weekStart} onChange={e => e.target.value && setWeekStart(sundayOf(new Date(`${e.target.value}T12:00:00`)))}
          title="Pick any day — the page shows that day's Sunday–Saturday week" />
        <select value={clientId} onChange={e => setClientId(e.target.value)} style={{ minWidth: 200 }}>
          <option value="">All clients ({clients.length})</option>
          {clients.map(c => <option key={c.client_id} value={c.client_id}>{c.name}</option>)}
        </select>
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => window.print()}>🖨️ Print</button>
      </div>

      {loading && <div className="card">Loading…</div>}
      {error && <div className="card" style={{ background: '#FEE2E2', color: '#991B1B', fontWeight: 600 }}>Could not load this week: {error}</div>}
      {!loading && !error && data && shown.length === 0 && <div className="card">No visits or clock-ins this week.</div>}

      {!loading && shown.map(c => (
        <div key={c.client_id} className="card cwh-client" style={{ maxWidth: 'none' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h3 style={{ margin: 0 }}>{c.name}{c.is_private_pay && <span style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 400 }}> · private pay</span>}</h3>
            <div style={{ fontSize: '0.9rem' }}>
              Scheduled <strong>{hrs(c.scheduled_minutes)} h ({units(c.scheduled_minutes)} units)</strong> · Clocked <strong>{hrs(c.clocked_minutes)} h ({units(c.clocked_minutes)} units)</strong>
              {c.missing_clock_ins > 0 && <span style={{ color: '#B45309' }}> · {c.missing_clock_ins} with no clock-in</span>}
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ fontSize: '0.86rem', marginTop: '0.5rem' }}>
              <thead><tr><th>Day</th><th>Caregiver</th><th>Scheduled</th><th>Clocked in – out</th><th style={{ textAlign: 'right' }}>Sched h</th><th style={{ textAlign: 'right' }}>Sched units</th><th style={{ textAlign: 'right' }}>Clocked h</th><th style={{ textAlign: 'right' }}>Clocked units</th><th>Note</th><th>Payroll</th></tr></thead>
              <tbody>
                {c.rows.map((r: any, i: number) => {
                  const diff = r.type === 'visit' && r.clocked_minutes != null ? r.clocked_minutes - r.sched_minutes : null;
                  const note = r.type === 'cancelled' ? `Cancelled — ${cancelReasonLabel(r.cancel_reason)}`
                    : r.type === 'unscheduled' ? 'Not on the schedule'
                    : !r.clock_in ? 'No clock-in'
                    : r.clock_in && !r.clock_out ? 'Still clocked in'
                    : '';
                  const flags = (r.flags || []).map((f: string) => FLAG_LABELS[f]).filter(Boolean);
                  return (
                    <tr key={i} style={{ background: r.type === 'cancelled' ? '#F9FAFB' : undefined, color: r.type === 'cancelled' ? '#6B7280' : undefined }}>
                      <td>{dayLabel(r.day)}</td>
                      <td>{r.caregiver_name}{r.is_training && <span style={{ color: '#6B7280' }}> (training)</span>}</td>
                      <td>{r.sched_start ? `${hm(r.sched_start)} – ${hm(r.sched_end)}` : '—'}</td>
                      <td>{r.clock_in ? `${clock(r.clock_in)} – ${r.clock_out ? clock(r.clock_out) : '…'}` : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{r.type === 'visit' ? hrs(r.sched_minutes) : ''}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{r.type === 'visit' ? units(r.sched_minutes) : ''}</td>
                      <td style={{ textAlign: 'right', color: diff == null ? undefined : diff > 7 ? '#B45309' : diff < -7 ? '#B91C1C' : undefined }}>{hrs(r.clocked_minutes)}</td>
                      <td style={{ textAlign: 'right', color: diff == null ? undefined : diff > 7 ? '#B45309' : diff < -7 ? '#B91C1C' : undefined }}>{units(r.clocked_minutes)}</td>
                      <td style={{ color: note === 'No clock-in' || note === 'Not on the schedule' ? '#B45309' : '#6B7280' }}>
                        {[note, ...flags].filter(Boolean).join(' · ')}
                      </td>
                      <td style={{ color: r.payroll && (r.payroll.kind === 'manual' || r.payroll.kind === 'adjusted') ? '#1D4ED8' : r.payroll && r.payroll.kind === 'excused' ? '#991B1B' : '#374151', fontWeight: r.payroll && r.payroll.kind !== 'paid_no_clock_in' ? 600 : 400 }}>
                        {payrollText(r.payroll)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
};

export default ClientWeekHours;
