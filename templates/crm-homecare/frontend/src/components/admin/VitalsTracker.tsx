// VitalsTracker — record and read a client's vitals. Quick entry at the top, history below with
// a trend arrow per measure (latest against the one before). The plausible ranges are the
// server's; a value outside them is refused with the range named.
import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../contexts/AuthContext';

const FIELDS = [
  { key: 'systolicBp', label: 'Systolic', unit: 'mmHg', dbKey: 'systolic_bp', decimal: false, range: [50, 260] },
  { key: 'diastolicBp', label: 'Diastolic', unit: 'mmHg', dbKey: 'diastolic_bp', decimal: false, range: [25, 160] },
  { key: 'pulse', label: 'Pulse', unit: 'bpm', dbKey: 'pulse', decimal: false, range: [25, 220] },
  { key: 'respirations', label: 'Resp', unit: '/min', dbKey: 'respirations', decimal: false, range: [4, 70] },
  { key: 'oxygenSaturation', label: 'O₂ Sat', unit: '%', dbKey: 'oxygen_saturation', decimal: false, range: [50, 100] },
  { key: 'temperatureF', label: 'Temp', unit: '°F', dbKey: 'temperature_f', decimal: true, range: [85, 112] },
  { key: 'bloodGlucose', label: 'Glucose', unit: 'mg/dL', dbKey: 'blood_glucose', decimal: false, range: [20, 800] },
  { key: 'weightLbs', label: 'Weight', unit: 'lbs', dbKey: 'weight_lbs', decimal: true, range: [30, 800] },
  { key: 'painScale', label: 'Pain', unit: '0-10', dbKey: 'pain_scale', decimal: false, range: [0, 10] },
];

const inp = 'w-full px-2 py-1.5 rounded-md border text-sm border-gray-300 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';
const card = 'rounded-xl p-4 shadow-sm bg-white text-gray-900 dark:bg-slate-800 dark:text-slate-100';

export default function VitalsTracker({ clientId, timeEntryId }: { clientId: string; timeEntryId?: string }) {
  const { token } = useAuth();
  const [form, setForm] = useState<Record<string, string>>({});
  const [painLocation, setPainLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [history, setHistory] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!clientId) return;
    try {
      const r = await fetch(`${API_BASE_URL}/api/medications/vitals/client/${clientId}?limit=30`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) setHistory(await r.json());
    } catch { /* ignore */ }
  }, [clientId, token]);

  useEffect(() => { load(); }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    // Checked on submit, never clamped while typing.
    const bad = FIELDS.filter(f => {
      const v = (form[f.key] ?? '').trim();
      if (!v) return false;
      const n = Number(v);
      return !Number.isFinite(n) || (!f.decimal && !/^\d+$/.test(v)) || n < f.range[0] || n > f.range[1];
    })
    if (bad.length) { setMsg({ kind: 'err', text: `Check: ${bad.map(f => `${f.label} (${f.range[0]}–${f.range[1]}${f.decimal ? '' : ', whole number'})`).join(', ')}` }); return; }
    setBusy(true);
    try {
      const body: Record<string, unknown> = { clientId, timeEntryId, painLocation: painLocation || null, notes: notes || null };
      FIELDS.forEach(f => { if ((form[f.key] ?? '').trim() !== '') body[f.key] = form[f.key].trim(); });
      const r = await fetch(`${API_BASE_URL}/api/medications/vitals`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
      setMsg({ kind: 'ok', text: 'Vitals recorded' });
      setForm({}); setPainLocation(''); setNotes('');
      load();
    } catch (err: any) {
      setMsg({ kind: 'err', text: err.message });
    } finally { setBusy(false); }
  };

  const trendFor = (dbKey: string) => {
    const values = history.map(h => h[dbKey]).filter(v => v != null && v !== '');
    if (values.length < 2) return null;
    const a = parseFloat(values[0]); const b = parseFloat(values[1]);
    if (isNaN(a) || isNaN(b)) return null;
    if (a === b) return { arrow: '→', cls: 'text-gray-400 dark:text-slate-500' };
    return a > b ? { arrow: '▲', cls: 'text-red-600 dark:text-red-400' } : { arrow: '▼', cls: 'text-cyan-700 dark:text-cyan-300' };
  };

  return (
    <div className="grid gap-4">
      <div className={card}>
        <h3 className="mt-0 mb-2 text-base font-semibold">📋 Record Vitals</h3>
        {msg && (
          <div className={`px-3 py-2 rounded-md mb-2 text-sm ${msg.kind === 'ok' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200'}`}>{msg.text}</div>
        )}
        <form onSubmit={submit}>
          <div className="grid gap-3 mb-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            {FIELDS.map(f => (
              <div key={f.key}>
                <label htmlFor={`vital-${f.key}`} className="block mb-0.5 text-xs font-bold text-gray-500 dark:text-slate-400">
                  {f.label} <span className="font-normal">({f.unit})</span>
                </label>
                <input id={`vital-${f.key}`} inputMode={f.decimal ? 'decimal' : 'numeric'} value={form[f.key] ?? ''}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} className={inp} />
              </div>
            ))}
            <div>
              <label htmlFor="vital-pain-location" className="block mb-0.5 text-xs font-bold text-gray-500 dark:text-slate-400">Pain Location</label>
              <input id="vital-pain-location" type="text" value={painLocation} onChange={(e) => setPainLocation(e.target.value)} placeholder="lower back, knee, etc." className={inp} />
            </div>
          </div>
          <div className="mb-2">
            <label htmlFor="vital-notes" className="block mb-0.5 text-xs font-bold text-gray-500 dark:text-slate-400">Notes</label>
            <textarea id="vital-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Anything notable — symptoms, refusal, position, etc." className={inp} />
          </div>
          <button type="submit" disabled={busy} className="px-5 py-2 rounded-md text-sm font-bold bg-teal-600 text-white disabled:opacity-60 dark:bg-teal-600 dark:text-white">
            {busy ? 'Saving…' : '💾 Record Vitals'}
          </button>
        </form>
      </div>

      <div className={card}>
        <h3 className="mt-0 mb-2 text-base font-semibold">📊 Recent Vitals ({history.length})</h3>
        {history.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-slate-500">No vitals recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-700 dark:bg-slate-900 dark:text-slate-200">
                  <th className="px-2 py-2 text-left font-bold">When</th>
                  {FIELDS.map(f => {
                    const trend = trendFor(f.dbKey);
                    return (
                      <th key={f.key} className="px-2 py-2 text-right font-bold">
                        {f.label}{trend && <span className={`ml-1 ${trend.cls}`}>{trend.arrow}</span>}
                      </th>
                    );
                  })}
                  <th className="px-2 py-2 text-left">By</th>
                </tr>
              </thead>
              <tbody>
                {history.map(h => (
                  <tr key={h.id} className="border-t border-gray-100 dark:border-slate-700">
                    <td className="px-2 py-1.5 whitespace-nowrap">{new Date(h.recorded_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                    {FIELDS.map(f => <td key={f.key} className="px-2 py-1.5 text-right">{h[f.dbKey] != null && h[f.dbKey] !== '' ? h[f.dbKey] : '—'}</td>)}
                    <td className="px-2 py-1.5">{h.caregiver_first ? `${h.caregiver_first} ${h.caregiver_last?.[0] || ''}.` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
