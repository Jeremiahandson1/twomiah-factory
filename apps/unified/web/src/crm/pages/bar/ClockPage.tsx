// Moved from templates/crm-bar/frontend/src/pages/bar/ClockPage.tsx.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Delete } from 'lucide-react'
import { api } from '../../../api'
import FormError, { errorText } from '../../ui/FormError'
import { BTN, ON, OFF, CARD, LABEL, MUTED, INPUT, centsFrom, money } from './registerUi';

/**
 * THE CLOCK — on the bar tablet, whoever is signed in. Each person types their OWN till PIN and they are clocked in
 * (or out) through the CRM's own clock, into the same hours the Time page, approvals and the pay run read
 * (routes/barRegister.ts POST /register/clock). Who is on right now shows underneath.
 */

interface On { name: string; since: string; forgotten: boolean }

export default function ClockPage() {
  const [pin, setPin] = useState('');
  const [on, setOn] = useState<On[] | null>(null);
  const [tz, setTz] = useState<string | undefined>(undefined);   // the bar's clock, so every screen says the same time
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const { hasFeature } = useAuth();
  const declares = hasFeature('bar_declared_tips');
  const [tips, setTips] = useState('');

  const load = useCallback(async () => {
    try { const r = await api.get('/api/register/clock'); setOn(r.on); setTz(r.timezone); setErr(''); } catch (e) { setErr(errorText(e, 'Could not load the clock.')); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const punch = async () => {
    // Cash tips handed over the bar, said with the PIN at clock-out (blank = none to declare).
    const cents = declares && tips.trim() ? centsFrom(tips) : undefined;
    if (cents === null) { setErr('Type the cash tips in dollars, like 12.50.'); return; }
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await api.post('/api/register/clock', { pin, ...(cents !== undefined ? { declaredTipCents: cents } : {}) });
      const said = r.declaredTip?.recordedCents !== undefined ? ` ${money(r.declaredTip.recordedCents)} in cash tips declared.` : r.declaredTip?.skipped ? ` ${r.declaredTip.skipped}` : '';
      setMsg((r.action === 'in' ? `${r.name}: clocked in.` : r.action === 'out' ? `${r.name}: clocked out after ${r.hours} hours.` : r.message) + said);
      setOn(r.on); setTz(r.timezone); setPin(''); setTips('');
    } catch (e) { setErr(errorText(e, 'That did not go through.')); setPin(''); } finally { setBusy(false); }
  };
  const press = (d: string) => setPin((p) => (p.length >= 8 ? p : p + d));

  return (
    <div className="space-y-3 max-w-md mx-auto">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Clock in or out</h1>
        <Link to="/crm/register" className={`${BTN} ${OFF} inline-flex items-center`}>Register</Link>
      </div>
      <div className={CARD}>
        <label className={LABEL} htmlFor="clock-pin">Your till PIN</label>
        <input id="clock-pin" className="w-full min-h-[56px] mt-1 px-3 rounded-xl border border-gray-300 bg-white text-gray-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 text-3xl tracking-[0.5em] text-center" type="password" inputMode="numeric" autoComplete="off"
          value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} onKeyDown={(e) => { if (e.key === 'Enter' && pin.length >= 4) punch(); }} />
        {declares && (
          <div className="mt-3">
            <label className={LABEL} htmlFor="clock-tips">Cash tips handed to you this shift ($) — when you clock out</label>
            <input id="clock-tips" inputMode="decimal" className={`${INPUT} mt-1`} value={tips} onChange={(e) => setTips(e.target.value)} placeholder="Leave empty if none" />
            <p className={`text-xs mt-1 ${MUTED}`}>Only cash that was not rung on the register. Cash tips rung on the register are counted already.</p>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2 mt-3">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} className={`${BTN} ${OFF} min-h-[64px] text-2xl`} onClick={() => press(d)}>{d}</button>)}
          <button className={`${BTN} ${OFF} min-h-[64px]`} aria-label="Delete a digit" onClick={() => setPin((p) => p.slice(0, -1))}><Delete className="w-6 h-6 mx-auto" /></button>
          <button className={`${BTN} ${OFF} min-h-[64px] text-2xl`} onClick={() => press('0')}>0</button>
          <button className={`${BTN} ${ON} min-h-[64px]`} disabled={busy || pin.length < 4} onClick={punch}>Go</button>
        </div>
        {msg && <p role="status" className="mt-3 text-lg font-semibold text-gray-900 dark:text-slate-100">{msg}</p>}
        <FormError message={err} className="mt-3" />
      </div>
      <div className={CARD}>
        <p className={`${LABEL} mb-2`}>On the clock</p>
        {!on && <Loader2 className="w-5 h-5 animate-spin text-gray-500 dark:text-slate-400" />}
        {on && on.length === 0 && <p className={`text-sm ${MUTED}`}>Nobody right now.</p>}
        <ul className="space-y-1">
          {on?.map((o) => (
            <li key={o.name + o.since} className="flex justify-between gap-2 text-gray-900 dark:text-slate-100">
              <span>{o.name}</span>
              <span className={o.forgotten ? 'text-sm font-semibold text-red-800 dark:text-red-300' : `text-sm ${MUTED}`}>
                {o.forgotten ? 'Over 16 hours — forgot to clock out?' : `since ${new Date(o.since).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}`}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
