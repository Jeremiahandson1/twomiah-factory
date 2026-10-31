import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { api } from '../../../api';
import FormError, { errorText } from '../../ui/FormError';
import { useMayWrite } from '../../../shared';
import { companyTodayKey } from '@twomiah/tenant-ui/src/time/companyClock';
import { codeLabel } from '@twomiah/tenant-ui/src/labels/codes';
import { BTN, ON, OFF, DANGER, CARD, LABEL, INPUT, MUTED, money } from './registerUi';

/**
 * TIP POOLING AND TIP-OUT (feature bar_tip_pooling; server: crm/bar/barTips.ts, barTipMath.ts). Roles keep their tips or
 * put them in the pool; a tip-out hands part of one role's tips (or sales) to another; the pool is split by each role's
 * percent and then by hours. The night's tips, hours and roles are read from the register, the time clock and the
 * schedule, never typed. Closing the night on the Close-out page freezes who gets what. A manager's (bar:manage).
 */
interface Role { name: string; positions: string[]; mode: 'keeps' | 'pools'; poolPct: number }
interface TipOut { from: string; to: string; pct: number; basis: 'tips' | 'sales' }
interface Rules { roles: Role[]; tipOuts: TipOut[]; defaultRole: string; positionRoles?: Record<string, string> }
export interface Payout { userId: string; name: string; role: string; hours: number; tipsCents: number; tipOutPaidCents: number; tipOutReceivedCents: number; poolShareCents: number; totalCents: number }
interface Night { day: string; configured: boolean; payouts: Payout[]; poolCents: number; notes: string[]; totalTipsCents: number }
interface Report { people: Array<{ userId: string; name: string; hours: number; tipsCents: number; tipOutPaidCents: number; tipOutReceivedCents: number; poolShareCents: number; totalCents: number; nights: number }>; totalCents: number }

const shiftDay = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const TH = 'text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 py-2 pr-3';
const TD = 'py-2 pr-3 text-sm text-gray-900 dark:text-slate-100';

/** Who gets what of a night's tips: used here and on the Close-out. */
export function PayoutTable({ payouts }: { payouts: Payout[] }) {
  if (!payouts.length) return <p className={`text-sm ${MUTED}`}>No tips or hours for this night yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem]">
        <thead><tr><th className={TH}>Who</th><th className={TH}>Role</th><th className={TH}>Hours</th><th className={TH}>Tips</th><th className={TH}>Tipped out</th><th className={TH}>Got tip-out</th><th className={TH}>Pool share</th><th className={TH}>Takes home</th></tr></thead>
        <tbody>
          {payouts.map((p) => (
            <tr key={p.userId} className="border-t border-gray-100 dark:border-slate-800">
              <td className={TD}>{p.name}</td><td className={TD}>{codeLabel(p.role)}</td><td className={TD}>{p.hours}</td><td className={`${TD} font-mono`}>{money(p.tipsCents)}</td>
              <td className={`${TD} font-mono`}>{p.tipOutPaidCents ? `−${money(p.tipOutPaidCents)}` : '—'}</td><td className={`${TD} font-mono`}>{p.tipOutReceivedCents ? money(p.tipOutReceivedCents) : '—'}</td>
              <td className={`${TD} font-mono`}>{p.poolShareCents ? money(p.poolShareCents) : '—'}</td><td className={`${TD} font-mono font-bold`}>{money(p.totalCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function TipsPage() {
  const may = useMayWrite('bar:manage');
  const [tab, setTab] = useState<'night' | 'rules' | 'report'>('night');
  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Tips</h1>
        <Link to="/crm/closeout" className={`${BTN} ${OFF} inline-flex items-center`}>Close-out</Link>
      </div>
      <div className="flex gap-2" role="tablist">
        {([['night', 'A night'], ['report', 'Report'], ['rules', 'Rules']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`${BTN} ${tab === k ? ON : OFF}`} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'night' && <NightView />}
      {tab === 'report' && <ReportView />}
      {tab === 'rules' && <RulesView may={may} />}
    </div>
  );
}

function NightView() {
  const [day, setDay] = useState(companyTodayKey());
  const [n, setN] = useState<Night | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { setN(null); api.get(`/api/tips/night?day=${day}`).then((r) => { setN(r); setErr(''); }).catch((e) => setErr(errorText(e, 'Could not read the night.'))); }, [day]);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button className={`${BTN} ${OFF} px-3`} aria-label="The night before" onClick={() => setDay(shiftDay(day, -1))}>‹</button>
        <input aria-label="Night" type="date" className={`${INPUT} max-w-[11rem]`} value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
        <button className={`${BTN} ${OFF} px-3`} aria-label="The night after" onClick={() => setDay(shiftDay(day, 1))}>›</button>
      </div>
      <FormError message={err} />
      {!n ? (err ? null : <Loader2 className="w-5 h-5 animate-spin text-gray-500" />) : !n.configured ? (
        <div className={CARD}><p className={MUTED}>Set the rules first (Rules tab): which roles keep their tips, which pool them, and who tips out to whom.</p></div>
      ) : (
        <div className={CARD}>
          <p className={`${LABEL} mb-2`}>{money(n.totalTipsCents)} in tips · as it would settle now</p>
          <PayoutTable payouts={n.payouts} />
          {n.notes.map((x) => <p key={x} className={`text-sm mt-2 ${MUTED}`}>{x}</p>)}
          <p className={`text-xs mt-3 ${MUTED}`}>This is frozen when the night is closed on the Close-out page.</p>
        </div>
      )}
    </div>
  );
}

function ReportView() {
  const [from, setFrom] = useState(shiftDay(companyTodayKey(), -13));
  const [to, setTo] = useState(companyTodayKey());
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => { api.get(`/api/tips/report?from=${from}&to=${to}`).then((x) => { setR(x); setErr(''); }).catch((e) => setErr(errorText(e, 'Could not read the report.'))); }, [from, to]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="From" type="date" className={`${INPUT} max-w-[11rem]`} value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        <span className={MUTED}>to</span>
        <input aria-label="To" type="date" className={`${INPUT} max-w-[11rem]`} value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
      </div>
      <FormError message={err} />
      {r && (
        <div className={CARD}>
          <p className={`${LABEL} mb-2`}>{money(r.totalCents)} paid out in tips on the nights closed</p>
          {r.people.length === 0 ? <p className={`text-sm ${MUTED}`}>No nights closed in this range.</p> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[30rem]">
              <thead><tr><th className={TH}>Who</th><th className={TH}>Nights</th><th className={TH}>Hours</th><th className={TH}>Tips</th><th className={TH}>Tip-outs</th><th className={TH}>Pool</th><th className={TH}>Total</th></tr></thead>
              <tbody>{r.people.map((p) => <tr key={p.userId} className="border-t border-gray-100 dark:border-slate-800"><td className={TD}>{p.name}</td><td className={TD}>{p.nights}</td><td className={TD}>{p.hours}</td><td className={`${TD} font-mono`}>{money(p.tipsCents)}</td><td className={`${TD} font-mono`}>{money(p.tipOutReceivedCents - p.tipOutPaidCents)}</td><td className={`${TD} font-mono`}>{money(p.poolShareCents)}</td><td className={`${TD} font-mono font-bold`}>{money(p.totalCents)}</td></tr>)}</tbody>
            </table></div>
          )}
        </div>
      )}
    </div>
  );
}

function RulesView({ may }: { may: boolean }) {
  const [rules, setRules] = useState<Rules | null>(null);
  const [positions, setPositions] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/api/tips/rules').then((r) => { setRules(r.rules); setPositions(r.positions || []); }).catch((e) => setErr(errorText(e, 'Could not read the rules.'))); }, []);
  if (!rules) return err ? <FormError message={err} /> : <Loader2 className="w-5 h-5 animate-spin text-gray-500" />;
  const setRole = (i: number, patch: Partial<Role>) => setRules({ ...rules, roles: rules.roles.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const setOut = (i: number, patch: Partial<TipOut>) => setRules({ ...rules, tipOuts: rules.tipOuts.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const shares = rules.roles.reduce((s, r) => s + (Number(r.poolPct) || 0), 0);
  const save = async () => {
    setBusy(true); setErr(''); setSaved(false);
    try { const r = await api.put('/api/tips/rules', rules); setRules(r.rules); setSaved(true); } catch (e) { setErr(errorText(e, 'The rules did not save.')); } finally { setBusy(false); }
  };
  const roleNames = rules.roles.map((r) => r.name).filter(Boolean);
  // The map the owner sets; until they save one, the older per-role position lists show what each position already counts as.
  const roleOfPosition = (pos: string) => {
    if (rules.positionRoles) { const k = Object.keys(rules.positionRoles).find((x) => x.toLowerCase() === pos.toLowerCase()); return k ? rules.positionRoles[k] : ''; }
    return rules.roles.find((r) => r.positions.some((p) => p.toLowerCase() === pos.toLowerCase()) || r.name.toLowerCase() === pos.toLowerCase())?.name || '';
  };
  const positionList = [...new Set([...positions, ...Object.keys(rules.positionRoles || {}), ...rules.roles.flatMap((r) => r.positions)])].sort((a, b) => a.localeCompare(b));
  const setPosition = (pos: string, role: string) => {
    const current = Object.fromEntries(positionList.map((p) => [p, roleOfPosition(p)]));
    setRules({ ...rules, positionRoles: { ...current, [pos]: role } });
  };
  return (
    <div className="space-y-4">
      <div className={`${CARD} space-y-3`}>
        <p className={LABEL}>Roles</p>
        <p className={`text-sm ${MUTED}`}>Which role each position on the Schedule counts as is set in the next box. Anyone with no scheduled position counts as the role below.</p>
        {rules.roles.map((r, i) => (
          <div key={i} className="grid grid-cols-1 md:grid-cols-[1.6fr_1fr_6rem_auto] gap-2 items-end">
            <div><label className={LABEL} htmlFor={`rn${i}`}>Role</label><input id={`rn${i}`} className={INPUT} value={r.name} onChange={(e) => setRole(i, { name: e.target.value })} /></div>
            <div><label className={LABEL} htmlFor={`rm${i}`}>Their tips</label><select id={`rm${i}`} className={INPUT} value={r.mode} onChange={(e) => setRole(i, { mode: e.target.value as Role['mode'] })}><option value="keeps">Keep their own</option><option value="pools">Go in the pool</option></select></div>
            <div><label className={LABEL} htmlFor={`rs${i}`}>Pool %</label><input id={`rs${i}`} inputMode="decimal" className={INPUT} value={r.poolPct} onChange={(e) => setRole(i, { poolPct: Number(e.target.value) || 0 })} /></div>
            <button type="button" className={`${BTN} ${DANGER} px-3`} aria-label={`Remove ${r.name || 'role'}`} onClick={() => setRules({ ...rules, roles: rules.roles.filter((_, j) => j !== i) })}><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        <button type="button" className={`${BTN} ${OFF} inline-flex items-center gap-2`} onClick={() => setRules({ ...rules, roles: [...rules.roles, { name: '', positions: [], mode: 'keeps', poolPct: 0 }] })}><Plus className="w-4 h-4" />Add a role</button>
        <p className={`text-sm ${shares === 0 || Math.round(shares * 100) === 10000 ? MUTED : 'text-red-700 dark:text-red-300'}`}>Shares of the pool add up to {Math.round(shares * 100) / 100}% {shares > 0 ? '(they need to be 100)' : ''}</p>
        <div><label className={LABEL} htmlFor="defrole">Role for anyone with no scheduled position</label><select id="defrole" className={`${INPUT} max-w-xs`} value={rules.defaultRole} onChange={(e) => setRules({ ...rules, defaultRole: e.target.value })}><option value="">The first role</option>{roleNames.map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
      </div>
      <div className={`${CARD} space-y-3`}>
        <p className={LABEL}>What each position counts as</p>
        <p className={`text-sm ${MUTED}`}>These are the positions you give shifts on the Schedule. Pick the role each one counts as for tips. A position set to &ldquo;No role&rdquo; takes no tip-out, gives none and has no share of the pool: that person keeps what they made.</p>
        {positionList.length === 0 && <p className={`text-sm ${MUTED}`}>No positions on the Schedule yet.</p>}
        {positionList.map((pos, i) => (
          <div key={pos} className="flex flex-wrap items-end gap-2">
            <div className="min-w-[8rem]"><p className={LABEL}>Position</p><p className="py-2 text-sm text-gray-900 dark:text-slate-100">{pos}</p></div>
            <div><label className={LABEL} htmlFor={`pr${i}`}>Counts as</label><select id={`pr${i}`} className={INPUT} disabled={!may} value={roleOfPosition(pos)} onChange={(e) => setPosition(pos, e.target.value)}><option value="">No role</option>{roleNames.map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
          </div>
        ))}
      </div>
      <div className={`${CARD} space-y-3`}>
        <p className={LABEL}>Tip-outs</p>
        <p className={`text-sm ${MUTED}`}>Taken from what the person made, never more. Shared among the receiving role by hours.</p>
        {rules.tipOuts.map((t, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <div><label className={LABEL} htmlFor={`tf${i}`}>From</label><select id={`tf${i}`} className={INPUT} value={t.from} onChange={(e) => setOut(i, { from: e.target.value })}><option value="">Pick</option>{roleNames.map((n) => <option key={n}>{n}</option>)}</select></div>
            <div><label className={LABEL} htmlFor={`tp${i}`}>Percent</label><input id={`tp${i}`} inputMode="decimal" className={`${INPUT} w-24`} value={t.pct} onChange={(e) => setOut(i, { pct: Number(e.target.value) || 0 })} /></div>
            <div><label className={LABEL} htmlFor={`tb${i}`}>Of their</label><select id={`tb${i}`} className={INPUT} value={t.basis} onChange={(e) => setOut(i, { basis: e.target.value as TipOut['basis'] })}><option value="tips">tips</option><option value="sales">sales</option></select></div>
            <div><label className={LABEL} htmlFor={`tt${i}`}>To</label><select id={`tt${i}`} className={INPUT} value={t.to} onChange={(e) => setOut(i, { to: e.target.value })}><option value="">Pick</option>{roleNames.map((n) => <option key={n}>{n}</option>)}</select></div>
            <button type="button" className={`${BTN} ${DANGER} px-3`} aria-label="Remove this tip-out" onClick={() => setRules({ ...rules, tipOuts: rules.tipOuts.filter((_, j) => j !== i) })}><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        <button type="button" className={`${BTN} ${OFF} inline-flex items-center gap-2`} onClick={() => setRules({ ...rules, tipOuts: [...rules.tipOuts, { from: '', to: '', pct: 10, basis: 'tips' }] })}><Plus className="w-4 h-4" />Add a tip-out</button>
      </div>
      <FormError message={err} />
      {saved && <p role="status" className="text-sm text-green-800 dark:text-green-300">Saved. It applies to the next night you close.</p>}
      {may && <button type="button" className={`${BTN} ${ON}`} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save the rules'}</button>}
    </div>
  );
}
