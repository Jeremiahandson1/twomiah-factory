import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import api from '../../services/api';
import FormError, { errorText } from '../../components/ui/FormError';
import { BTN, ON, OFF, CARD, LABEL, INPUT, MUTED, money } from './registerUi';

/**
 * THE BAR'S SALES — the top of the Reports page. Bar Run 1: Reports was the contractor's ("Jobs completed",
 * "Quote conversion") with no bar sales, tips or voids. This is the close-out's arithmetic over a run of nights
 * (GET /api/register/report, services/barReports.ts loadRange), so a week here is the sum of that week's
 * close-outs. Each night links to its close-out. reports:read — owners, admins, managers.
 */

interface Report {
  from: string; to: string; timezone: string
  nights: Array<{ day: string; checksPaid: number; subtotalCents: number; taxCents: number; totalCents: number; tipsCents: number }>
  checksPaid: number; checksVoided: number; subtotalCents: number; taxCents: number; totalCents: number; tipsCents: number; averageCheckCents: number
  byTender: Array<{ tender: string; label: string; count: number; amountCents: number; tipsCents: number }>
  tipsByStaff: Array<{ who: string; count: number; tipsCents: number; cashTipsCents: number; cardTipsCents: number }>
  items: Array<{ name: string; qty: number; salesCents: number }>
  voids: { count: number; amountCents: number }
  giftCardsSold: { count: number; cents: number }
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const back = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
function presets(): Array<{ id: string; label: string; from: string; to: string }> {
  const now = new Date();
  const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const lastMon = new Date(monday); lastMon.setDate(monday.getDate() - 7);
  const lastSun = new Date(monday); lastSun.setDate(monday.getDate() - 1);
  return [
    { id: 'week', label: 'This week', from: iso(monday), to: iso(now) },
    { id: 'lastweek', label: 'Last week', from: iso(lastMon), to: iso(lastSun) },
    { id: 'month', label: 'This month', from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) },
    { id: '30', label: 'Last 30 nights', from: back(29), to: iso(now) },
  ];
}
const nightLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

export default function SalesReport() {
  const [range, setRange] = useState(() => { const p = presets()[0]; return { id: p.id, from: p.from, to: p.to }; });
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (from: string, to: string) => {
    setBusy(true);
    try { const res = await api.get(`/api/register/report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`); setR(res.report); setErr(''); }
    catch (e) { setErr(errorText(e, 'Could not load the sales.')); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { load(range.from, range.to); }, [load, range.from, range.to]);

  const best = r ? Math.max(1, ...r.nights.map((n) => n.totalCents)) : 1;
  return (
    <section className="space-y-3 mb-8" aria-label="Sales">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">Sales</h2>
        <div className="flex flex-wrap items-end gap-2">
          {presets().map((p) => (
            <button key={p.id} className={`${BTN} ${range.id === p.id ? ON : OFF} min-h-[40px]`} aria-pressed={range.id === p.id} onClick={() => setRange({ id: p.id, from: p.from, to: p.to })}>{p.label}</button>
          ))}
          <label className="sr-only" htmlFor="rep-from">From</label>
          <span className="inline-block w-40"><input id="rep-from" type="date" className={INPUT} value={range.from} max={range.to} onChange={(e) => e.target.value && setRange((x) => ({ id: 'custom', from: e.target.value, to: x.to }))} /></span>
          <label className="sr-only" htmlFor="rep-to">To</label>
          <span className="inline-block w-40"><input id="rep-to" type="date" className={INPUT} value={range.to} min={range.from} onChange={(e) => e.target.value && setRange((x) => ({ id: 'custom', from: x.from, to: e.target.value }))} /></span>
        </div>
      </div>
      <FormError message={err} onDismiss={() => setErr('')} />
      {!r && !err && <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-gray-500 dark:text-slate-400" /></div>}
      {r && (
        <div className={`space-y-3 ${busy ? 'opacity-60' : ''}`}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[['Total', money(r.totalCents)], ['Food & drink', money(r.subtotalCents)], ['Checks', String(r.checksPaid)], ['Average check', money(r.averageCheckCents)],
              ['Tips', money(r.tipsCents)], ['Sales tax', money(r.taxCents)], ['Gift cards sold', `${money(r.giftCardsSold.cents)}${r.giftCardsSold.count ? ` (${r.giftCardsSold.count})` : ''}`], ['Voids', `${r.voids.count}${r.voids.amountCents ? ` · ${money(r.voids.amountCents)}` : ''}`]].map(([k, v]) => (
              <div key={k} className={CARD}><p className={LABEL}>{k}</p><p className="text-xl font-bold text-gray-900 dark:text-slate-100 mt-1">{v}</p></div>
            ))}
          </div>

          <div className={CARD}>
            <p className={`${LABEL} mb-2`}>Night by night</p>
            {r.checksPaid === 0 && <p className={`text-sm ${MUTED}`}>No checks closed in these nights.</p>}
            <ul className="text-sm space-y-1">
              {r.nights.filter((n) => n.checksPaid > 0).map((n) => (
                <li key={n.day} className="grid grid-cols-[7rem_1fr_auto] items-center gap-2 text-gray-900 dark:text-slate-100">
                  <Link className="underline" to={`/crm/closeout?day=${n.day}`}>{nightLabel(n.day)}</Link>
                  <span className="h-2 rounded bg-gray-100 dark:bg-slate-800" aria-hidden="true"><span className="block h-2 rounded bg-orange-600 dark:bg-orange-400" style={{ width: `${Math.round((n.totalCents / best) * 100)}%` }} /></span>
                  <span className="font-mono">{money(n.totalCents)} · {n.checksPaid} check{n.checksPaid === 1 ? '' : 's'}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className={CARD}>
              <p className={`${LABEL} mb-2`}>How they paid</p>
              {r.byTender.length === 0 && <p className={`text-sm ${MUTED}`}>Nothing paid yet.</p>}
              <dl className="text-sm space-y-1">
                {r.byTender.map((t) => <div key={t.tender} className="flex justify-between gap-2"><dt className={MUTED}>{t.label} ({t.count})</dt><dd className="font-mono text-gray-900 dark:text-slate-100">{money(t.amountCents)}{t.tipsCents ? ` + ${money(t.tipsCents)} tips` : ''}</dd></div>)}
              </dl>
            </div>
            <div className={CARD}>
              <p className={`${LABEL} mb-2`}>Tips by person</p>
              {r.tipsByStaff.length === 0 && <p className={`text-sm ${MUTED}`}>No tips yet.</p>}
              <dl className="text-sm space-y-1">
                {r.tipsByStaff.map((t) => <div key={t.who} className="flex justify-between gap-2"><dt className={MUTED}>{t.who}</dt><dd className="font-mono text-gray-900 dark:text-slate-100">{money(t.tipsCents)}{t.cashTipsCents ? ` (${money(t.cashTipsCents)} cash)` : ''}</dd></div>)}
              </dl>
            </div>
          </div>

          {r.items.length > 0 && (
            <div className={CARD}>
              <p className={`${LABEL} mb-2`}>What sold most</p>
              <ul className="text-sm grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">{r.items.slice(0, 20).map((i) => <li key={i.name} className="flex justify-between gap-2 text-gray-900 dark:text-slate-100"><span>{i.qty} × {i.name}</span><span className="font-mono">{money(i.salesCents)}</span></li>)}</ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
