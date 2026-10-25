// Moved from templates/crm-bar/frontend/src/pages/bar/CloseoutPage.tsx.
import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react'
import { api } from '../../../api'
import FormError, { errorText } from '../../ui/FormError'
import { BTN, ON, OFF, CARD, LABEL, INPUT, MUTED, money, centsFrom, useManagerPin } from './registerUi';

/**
 * CLOSE-OUT — the night, added up, and the drawer counted. A night is 4 AM to 4 AM on the bar's clock, so a
 * 1 AM close counts toward tonight. The figures come from the server (services/barReports.ts) from the checks
 * closed that night, at the totals frozen when they closed. Expected cash = the starting float + cash taken
 * tonight + cash tips; over/short = what was counted against that.
 *
 * Closing the night is a manager's (bar:manage); a bartender closes it with a manager's till PIN.
 */

interface Summary {
  day: string; checksPaid: number; checksVoided: number; subtotalCents: number; taxCents: number; totalCents: number; tipsCents: number; averageCheckCents: number
  byTender: Array<{ tender: string; label: string; count: number; amountCents: number; tipsCents: number }>
  byChannel: Array<{ channel: string; count: number; totalCents: number }>
  tipsByStaff: Array<{ who: string; count: number; tipsCents: number; cashTipsCents: number; cardTipsCents: number }>
  items: Array<{ name: string; qty: number; salesCents: number }>
  byHour: Array<{ hour: number; label: string; totalCents: number; checks: number }>
  voids: Array<{ kind: string; what: string; amountCents: number; reason: string; by: string | null; checkNumber: number }>
  cash: { salesCents: number; tipsCents: number; inCents: number }
  giftCardsSold: { count: number; cents: number }
  /** Given back to cards through Stripe on tonight's checks (barTerminal.ts refundPayment). */
  refunds?: { count: number; cents: number }
}
interface Closeout { id: string; businessDay: string; cashExpectedCents: number; cashCountedCents: number | null; floatCents: number; overShortCents: number | null; note: string | null; closedByName: string | null; closedAt: string; emailedAt: string | null }
interface Day { day: string; timezone: string; scope?: 'night' | 'mine'; drawerInCents?: number; summary: Summary; open: Array<{ id: string; number: number; label: string; balanceCents: number }>; closes: Closeout[] }

function shift(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function CloseoutPage() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<Day | null>(null);
  const [err, setErr] = useState('');
  const [floatIn, setFloatIn] = useState('');
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [askForce, setAskForce] = useState(false);
  const { guarded, dialog } = useManagerPin();
  const day = params.get('day') || '';

  const load = useCallback(async () => {
    try { setData(await api.get(`/api/register/day${day ? `?day=${encodeURIComponent(day)}` : ''}`)); setErr(''); }
    catch (e) { setErr(errorText(e, 'Could not load the night. Try again.')); }
  }, [day]);
  useEffect(() => { load(); }, [load]);

  // One handler for a refused close, whether it came straight back or after a manager's PIN (useManagerPin hands
  // it here then): a night with an open check is a 409 that switches on "Close the night anyway".
  const refused = (e: any) => {
    if (e?.status === 409 && /still open/.test(e?.data?.error || '')) setAskForce(true);
    setErr(errorText(e, 'That did not save. Try again.'));
  };
  const close = async (force: boolean) => {
    if (!data) return;
    setBusy(true); setErr('');
    try {
      await guarded(async (managerPin) => {
        await api.post('/api/register/closeout', { day: data.day, floatCents: centsFrom(floatIn) ?? 0, countedCents: counted.trim() ? centsFrom(counted) : null, note, force, managerPin });
        setAskForce(false); setCounted(''); setNote('');
        await load();
      }, refused);
    } catch (e: any) {
      refused(e);
    } finally { setBusy(false); }
  };

  if (!data) return <div className="flex justify-center py-16">{err ? <FormError message={err} /> : <Loader2 className="w-6 h-6 animate-spin text-gray-500 dark:text-slate-400" />}</div>;
  const s = data.summary;
  // The drawer is the bar's: the whole night's cash, even on a bartender's own checkout (drawerInCents).
  const drawerIn = data.drawerInCents ?? s.cash.inCents;
  const expected = (centsFrom(floatIn) ?? 0) + drawerIn;
  const mine = data.scope === 'mine';
  const countedC = counted.trim() ? centsFrom(counted) : null;

  return (
    <div className="space-y-3 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button className={`${BTN} ${OFF} px-3`} aria-label="The night before" onClick={() => setParams({ day: shift(data.day, -1) })}><ChevronLeft className="w-4 h-4" /></button>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{mine ? 'My checkout' : 'Close-out'} · {data.day}</h1>
          <button className={`${BTN} ${OFF} px-3`} aria-label="The night after" onClick={() => setParams({ day: shift(data.day, 1) })}><ChevronRight className="w-4 h-4" /></button>
        </div>
        <Link to="/crm/register" className={`${BTN} ${OFF} inline-flex items-center`}>Register</Link>
      </div>
      <FormError message={err} onDismiss={() => setErr('')} />
      {/* A bartender checks out their own night, as a server does on Toast; the whole night is a manager's. */}
      {mine && <p className={`text-sm ${MUTED}`}>Your checks, your tips and the cash you took tonight. The whole night&rsquo;s figures are a manager&rsquo;s; closing the night needs a manager&rsquo;s till PIN.</p>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[['Total', money(s.totalCents)], ['Checks', String(s.checksPaid)], ['Average check', money(s.averageCheckCents)], ['Tips', money(s.tipsCents)]].map(([k, v]) => (
          <div key={k} className={CARD}><p className={LABEL}>{k}</p><p className="text-2xl font-bold text-gray-900 dark:text-slate-100 mt-1">{v}</p></div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className={CARD}>
          <p className={`${LABEL} mb-2`}>Sales</p>
          <dl className="text-sm space-y-1">
            <div className="flex justify-between"><dt className={MUTED}>Food &amp; drink</dt><dd className="font-mono text-gray-900 dark:text-slate-100">{money(s.subtotalCents)}</dd></div>
            <div className="flex justify-between"><dt className={MUTED}>Sales tax</dt><dd className="font-mono text-gray-900 dark:text-slate-100">{money(s.taxCents)}</dd></div>
            {s.giftCardsSold.count > 0 && <div className="flex justify-between"><dt className={MUTED}>Gift cards sold ({s.giftCardsSold.count})</dt><dd className="font-mono text-gray-900 dark:text-slate-100">{money(s.giftCardsSold.cents)}</dd></div>}
            {(s.refunds?.cents || 0) > 0 && <div className="flex justify-between"><dt className={MUTED}>Refunds to cards ({s.refunds!.count})</dt><dd className="font-mono text-gray-900 dark:text-slate-100">−{money(s.refunds!.cents)}</dd></div>}
            {s.byTender.map((t) => <div key={t.tender} className="flex justify-between"><dt className={MUTED}>{t.label} ({t.count})</dt><dd className="font-mono text-gray-900 dark:text-slate-100">{money(t.amountCents)}{t.tipsCents ? ` + ${money(t.tipsCents)}` : ''}</dd></div>)}
          </dl>
        </div>
        <div className={CARD}>
          <p className={`${LABEL} mb-2`}>Tips by person</p>
          {s.tipsByStaff.length === 0 && <p className={`text-sm ${MUTED}`}>No tips yet.</p>}
          <dl className="text-sm space-y-1">
            {s.tipsByStaff.map((t) => <div key={t.who} className="flex justify-between"><dt className={MUTED}>{t.who}</dt><dd className="font-mono text-gray-900 dark:text-slate-100">{money(t.tipsCents)}{t.cashTipsCents ? ` (${money(t.cashTipsCents)} cash)` : ''}</dd></div>)}
          </dl>
        </div>
      </div>

      {data.open.length > 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100 p-4">
          <p className="font-semibold">{data.open.length} check{data.open.length === 1 ? ' is' : 's are'} still open</p>
          <p className="text-sm mt-1">{data.open.map((o) => `#${o.number} ${o.label} (${money(o.balanceCents)})`).join(' · ')}</p>
        </div>
      )}

      <div className={CARD}>
        <p className={`${LABEL} mb-3`}>The drawer</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div><label className={LABEL} htmlFor="co-float">Starting float ($)</label><input id="co-float" className={`${INPUT} mt-1`} inputMode="decimal" value={floatIn} onChange={(e) => setFloatIn(e.target.value)} placeholder="150.00" /></div>
          <div><label className={LABEL} htmlFor="co-counted">Counted ($)</label><input id="co-counted" className={`${INPUT} mt-1`} inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder="What is in the drawer" /></div>
          <div><label className={LABEL} htmlFor="co-note">Note</label><input id="co-note" className={`${INPUT} mt-1`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></div>
        </div>
        <dl className="text-sm space-y-1 mt-3">
          {mine && <div className="flex justify-between"><dt className={MUTED}>Cash you took + your cash tips</dt><dd className="font-mono text-gray-900 dark:text-slate-100">{money(s.cash.inCents)}</dd></div>}
          <div className="flex justify-between"><dt className={MUTED}>Cash taken tonight + cash tips{mine ? ' (everyone)' : ''}</dt><dd className="font-mono text-gray-900 dark:text-slate-100">{money(drawerIn)}</dd></div>
          <div className="flex justify-between"><dt className={MUTED}>Should be in the drawer</dt><dd className="font-mono text-gray-900 dark:text-slate-100">{money(expected)}</dd></div>
          {countedC !== null && <div className="flex justify-between font-semibold"><dt className="text-gray-900 dark:text-slate-100">Over / short</dt><dd className="font-mono text-gray-900 dark:text-slate-100">{countedC === expected ? 'Even' : countedC > expected ? `Over ${money(countedC - expected)}` : `Short ${money(expected - countedC)}`}</dd></div>}
        </dl>
        <div className="flex flex-wrap justify-end gap-2 mt-4">
          {askForce && <button className={`${BTN} ${OFF}`} disabled={busy} onClick={() => close(true)}>Close the night anyway</button>}
          <button className={`${BTN} ${ON}`} disabled={busy} onClick={() => close(false)}>Close the night</button>
        </div>
      </div>

      {data.closes.length > 0 && (
        <div className={CARD}>
          <p className={`${LABEL} mb-2`}>Closed</p>
          <ul className="text-sm space-y-1">
            {data.closes.map((c) => (
              <li key={c.id} className="text-gray-900 dark:text-slate-100">
                {new Date(c.closedAt).toLocaleString('en-US', { timeZone: data.timezone, hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric', timeZoneName: 'short' })} by {c.closedByName || '—'} · expected {money(c.cashExpectedCents)}
                {c.cashCountedCents !== null && <> · counted {money(c.cashCountedCents)} · {c.overShortCents === 0 ? 'even' : (c.overShortCents! > 0 ? 'over ' : 'short ') + money(Math.abs(c.overShortCents!))}</>}
                {c.emailedAt ? ' · emailed' : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {s.voids.length > 0 && (
        <div className={CARD}>
          <p className={`${LABEL} mb-2`}>Voids ({s.voids.length})</p>
          <ul className="text-sm space-y-1">{s.voids.map((v, n) => <li key={n} className="text-gray-900 dark:text-slate-100">#{v.checkNumber} {v.what} — {v.reason}{v.by ? ` (${v.by})` : ''}{v.amountCents ? ` · ${money(v.amountCents)}` : ''}</li>)}</ul>
        </div>
      )}

      {s.items.length > 0 && (
        <div className={CARD}>
          <p className={`${LABEL} mb-2`}>What sold</p>
          <ul className="text-sm grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">{s.items.map((i) => <li key={i.name} className="flex justify-between text-gray-900 dark:text-slate-100"><span>{i.qty} × {i.name}</span><span className="font-mono">{money(i.salesCents)}</span></li>)}</ul>
        </div>
      )}
      {dialog}
    </div>
  );
}
