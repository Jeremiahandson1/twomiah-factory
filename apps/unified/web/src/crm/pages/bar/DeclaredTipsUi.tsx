import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api';
import { useAuth, useMayWrite } from '../../../shared';
import { companyTodayKey } from '@twomiah/tenant-ui/src/time/companyClock';
import FormError, { errorText } from '../../ui/FormError';
import { BTN, ON, OFF, CARD, LABEL, INPUT, MUTED, money, centsFrom } from './registerUi';

/**
 * Declared cash tips (feature bar_declared_tips; server crm/bar/barTips.ts, barTipRoutes.ts /declared). A person says how much
 * cash they were handed outside the register when they clock out; a manager sees every night and corrects a figure. The cash
 * tips rung on the register are already on the checks, so they are shown here to keep anyone from declaring them twice.
 */
interface Night { id: string; userId: string; name?: string; day: string; amountCents: number; originalCents: number; corrected: boolean; correctedByName: string | null; note: string | null; declaredVia: string; onRegisterCents?: number }

const VIA: Record<string, string> = { phone: 'Phone', tablet: 'Counter tablet', web: 'Website', manager: 'Added by a manager' };
const TH = 'text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 py-2 pr-3';
const TD = 'py-2 pr-3 text-sm text-gray-900 dark:text-slate-100';
const shiftDay = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** My cash tips for tonight, for the person signed in: what the register already has, what I declared, and a box to say it. */
export function MyCashTips() {
  const { hasFeature } = useAuth();
  const mayDeclare = useMayWrite('bar:register');   // POST /api/tips/declared/mine asks bar:register
  const on = hasFeature('bar_declared_tips');
  const [mine, setMine] = useState<{ day: string; declared: number | null; onRegister: number } | null>(null);
  const [typed, setTyped] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await api.get('/api/tips/declared/mine');   // no range: tonight, on the bar's own clock
      setMine({ day: r.from, declared: r.nights[0]?.amountCents ?? null, onRegister: r.onRegisterByDay?.[r.from] ?? 0 }); setErr('');
    } catch (e) { setErr(errorText(e, 'Could not read your cash tips.')); }
  }, []);
  useEffect(() => { if (on && mayDeclare) load(); }, [load, on, mayDeclare]);
  if (!on || !mayDeclare) return null;
  const save = async () => {
    const cents = centsFrom(typed);
    if (cents === null) { setErr('Type the amount in dollars, like 12.50.'); return; }
    setBusy(true); setErr(''); setMsg('');
    try { await api.post('/api/tips/declared/mine', { amountCents: cents }); setMsg('Saved.'); setTyped(''); await load(); } catch (e) { setErr(errorText(e, 'That did not save.')); } finally { setBusy(false); }
  };
  return (
    <div className={CARD}>
      <p className={`${LABEL} mb-2`}>My cash tips tonight</p>
      <p className={`text-sm ${MUTED}`}>Cash a guest handed you that was not rung on the register. Cash tips you rang on the register are already counted{mine ? ` (${money(mine.onRegister)} tonight)` : ''}, so leave them out.</p>
      {mine && <p className="mt-2 text-sm text-gray-900 dark:text-slate-100">Declared so far tonight: <span className="font-mono font-semibold">{mine.declared === null ? 'nothing yet' : money(mine.declared)}</span></p>}
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div><label className={LABEL} htmlFor="my-cash-tips">Total for tonight ($)</label><input id="my-cash-tips" inputMode="decimal" className={`${INPUT} max-w-[10rem]`} value={typed} onChange={(e) => setTyped(e.target.value)} /></div>
        <button className={`${BTN} ${ON}`} disabled={busy || !typed.trim()} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
      <FormError message={err} className="mt-2" />
      {msg && <p role="status" className="mt-2 text-sm text-green-800 dark:text-green-300">{msg}</p>}
    </div>
  );
}

/** For a manager (bar:manage): every declared night in a range, each correctable; a night someone forgot can be added. */
export function DeclaredTipsView() {
  const may = useMayWrite('bar:manage');
  const [from, setFrom] = useState(shiftDay(companyTodayKey(), -13));
  const [to, setTo] = useState(companyTodayKey());
  const [rows, setRows] = useState<Night[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);
  const [people, setPeople] = useState<Array<{ userId: string; name: string }>>([]);
  const [who, setWho] = useState('');
  const [addDay, setAddDay] = useState(companyTodayKey());
  const [err, setErr] = useState('');
  const load = useCallback(async () => { try { setRows((await api.get(`/api/tips/declared?from=${from}&to=${to}`)).nights); setErr(''); } catch (e) { setErr(errorText(e, 'Could not read the cash tips.')); } }, [from, to]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (adding && !people.length) api.get('/api/schedule/week').then((w) => setPeople((w.people || []).filter((p: any) => p.isActive).map((p: any) => ({ userId: p.userId, name: p.name })))).catch(() => setPeople([])); }, [adding, people.length]);
  const save = async (fn: () => Promise<unknown>) => {
    const cents = centsFrom(amount);
    if (cents === null) { setErr('Type the amount in dollars, like 12.50.'); return; }
    setErr(''); try { await fn(); setEditing(null); setAdding(false); setAmount(''); setNote(''); await load(); } catch (e) { setErr(errorText(e, 'That did not save.')); }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="From" type="date" className={`${INPUT} max-w-[11rem]`} value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        <span className={MUTED}>to</span>
        <input aria-label="To" type="date" className={`${INPUT} max-w-[11rem]`} value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
        {may && <button className={`${BTN} ${OFF}`} onClick={() => { setAdding(!adding); setEditing(null); setAmount(''); }}>{adding ? 'Never mind' : 'Add a night'}</button>}
      </div>
      <FormError message={err} />
      {adding && may && (
        <div className={`${CARD} flex flex-wrap items-end gap-2`}>
          <div><label className={LABEL} htmlFor="dt-who">Who</label><select id="dt-who" className={`${INPUT} max-w-[12rem]`} value={who} onChange={(e) => setWho(e.target.value)}><option value="">Pick a person</option>{people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}</select></div>
          <div><label className={LABEL} htmlFor="dt-day">Night</label><input id="dt-day" type="date" className={`${INPUT} max-w-[11rem]`} value={addDay} onChange={(e) => setAddDay(e.target.value)} /></div>
          <div><label className={LABEL} htmlFor="dt-amt">Cash tips ($)</label><input id="dt-amt" inputMode="decimal" className={`${INPUT} max-w-[9rem]`} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <button className={`${BTN} ${ON}`} disabled={!who || !addDay} onClick={() => save(() => api.post('/api/tips/declared', { userId: who, day: addDay, amountCents: centsFrom(amount), note: note.trim() || undefined }))}>Add</button>
        </div>
      )}
      <div className={CARD}>
        <p className={`${LABEL} mb-2`}>Cash tips declared at clock-out</p>
        {!rows ? null : rows.length === 0 ? <p className={`text-sm ${MUTED}`}>Nobody has declared cash tips in this range.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[34rem]">
            <thead><tr><th className={TH}>Who</th><th className={TH}>Night</th><th className={TH}>Declared</th><th className={TH}>Said first</th><th className={TH}>How</th><th className={TH}>Note</th>{may && <th className={TH}><span className="sr-only">Correct</span></th>}</tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-100 dark:border-slate-800 align-top">
                <td className={TD}>{r.name}</td><td className={TD}>{r.day}</td>
                <td className={`${TD} font-mono font-semibold`}>{editing === r.id ? <input aria-label={`Corrected cash tips for ${r.name}`} inputMode="decimal" className={`${INPUT} max-w-[7rem]`} value={amount} onChange={(e) => setAmount(e.target.value)} /> : money(r.amountCents)}</td>
                <td className={`${TD} font-mono`}>{r.corrected ? `${money(r.originalCents)} (corrected by ${r.correctedByName})` : '—'}</td>
                <td className={TD}>{VIA[r.declaredVia] || r.declaredVia}</td>
                <td className={TD}>{editing === r.id ? <input aria-label="Why" className={INPUT} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /> : r.note || ''}</td>
                {may && <td className={TD}>{editing === r.id
                  ? <span className="flex gap-2"><button className={`${BTN} ${ON} min-h-[40px]`} onClick={() => save(() => api.put(`/api/tips/declared/${r.id}`, { amountCents: centsFrom(amount), note: note.trim() || undefined }))}>Save</button><button className={`${BTN} ${OFF} min-h-[40px]`} onClick={() => setEditing(null)}>Cancel</button></span>
                  : <button className={`${BTN} ${OFF} min-h-[40px]`} onClick={() => { setEditing(r.id); setAmount((r.amountCents / 100).toFixed(2)); setNote(r.note || ''); }}>Correct</button>}</td>}
              </tr>))}</tbody>
          </table></div>
        )}
        <p className={`text-xs mt-3 ${MUTED}`}>These count as the person&rsquo;s tips in the pool and the tip-out, and go to the payroll export. A night already closed is worked out again when a figure changes.</p>
      </div>
    </div>
  );
}
