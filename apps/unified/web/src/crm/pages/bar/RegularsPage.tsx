// Moved from templates/crm-bar/frontend/src/pages/bar/RegularsPage.tsx.
import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { api } from '../../../api'
import { useMayWrite } from '../../../shared'
import FormError, { errorText } from '../../ui/FormError'
import { BTN, ON, OFF, DANGER, CARD, LABEL, INPUT, MUTED, money, centsFrom, Dialog } from './registerUi';

/**
 * THE REGULARS — the bar's loyalty programme. Points on what a regular spends on food and drink (never tax, tips
 * or gift cards), and the rewards they spend them on at the register. The arithmetic is the shared loyalty engine's
 * (the salon and the store run the same); this page sets the bar's numbers (routes/barLoyalty.ts).
 *
 * Reading it is loyalty:read; changing the programme or the rewards is loyalty:configure (owner and admin); a hand
 * correction to someone's points is loyalty:adjust (managers and up). The list of regulars is GET /api/loyalty/members.
 */

interface Config { loyaltyEnabled: boolean; loyaltyPointsPerDollar: number; loyaltyWelcomePoints: number }
interface Reward { id: string; name: string; description: string | null; pointsCost: number; type: 'fixed' | 'percent' | 'free_item'; valueCents: number; menuItemId: string | null; active: boolean; usageCount: number }
interface MenuItem { id: string; name: string }
interface Member { contactId: string; name: string; phone: string | null; pointsBalance: number; lifetimePoints: number; joinedAt: string | null; lastActivityAt: string | null }
interface Txn { id: string; type: string; points: number; balanceAfter: number; description: string | null; createdBy: string | null; createdAt: string }

const TYPE_LABEL: Record<Reward['type'], string> = { fixed: 'Money off', percent: 'Percent off', free_item: 'A free item' };

export default function RegularsPage() {
  const mayConfigure = useMayWrite('loyalty:configure');
  const [cfg, setCfg] = useState<Config | null>(null);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ rate: string; welcome: string }>({ rate: '1', welcome: '0' });
  const [editing, setEditing] = useState<Partial<Reward> & { value?: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, r, m] = await Promise.all([api.get('/api/loyalty/config'), api.get('/api/loyalty/rewards'), api.get('/api/bar/menu').catch(() => ({ sections: [] }))]);
      setCfg(c); setRewards(r.data || []);
      setItems((m.sections || []).flatMap((s: any) => (s.items || []).map((i: any) => ({ id: i.id, name: i.name }))));
      setForm({ rate: String(c.loyaltyPointsPerDollar), welcome: String(c.loyaltyWelcomePoints) });
      setErr('');
    } catch (e) { setErr(errorText(e, 'Could not load the Regulars.')); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (patch: Record<string, unknown>) => {
    setBusy(true); setErr('');
    try { setCfg(await api.put('/api/loyalty/config', patch)); } catch (e) { setErr(errorText(e, 'That did not save.')); } finally { setBusy(false); }
  };

  if (!cfg) return <div className="flex justify-center py-16">{err ? <FormError message={err} /> : <Loader2 className="w-6 h-6 animate-spin text-gray-500 dark:text-slate-400" />}</div>;

  return (
    <div className="space-y-3 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">The Regulars</h1>
        <p className={`text-sm ${MUTED}`}>Points on food and drink, spent on rewards at the register. Tax, tips and gift cards never earn.</p>
      </div>
      <FormError message={err} onDismiss={() => setErr('')} />

      <div className={CARD}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <p className={LABEL}>The programme</p>
          {mayConfigure && (
            <div className="flex gap-2">
              <button className={`${BTN} ${cfg.loyaltyEnabled ? ON : OFF}`} aria-pressed={cfg.loyaltyEnabled} disabled={busy} onClick={() => save({ loyaltyEnabled: true })}>On</button>
              <button className={`${BTN} ${!cfg.loyaltyEnabled ? ON : OFF}`} aria-pressed={!cfg.loyaltyEnabled} disabled={busy} onClick={() => save({ loyaltyEnabled: false })}>Off</button>
            </div>
          )}
        </div>
        {!mayConfigure && <p className="text-sm text-gray-900 dark:text-slate-100 mb-2">{cfg.loyaltyEnabled ? 'On' : 'Off'} · {cfg.loyaltyPointsPerDollar} point{cfg.loyaltyPointsPerDollar === 1 ? '' : 's'} per dollar · {cfg.loyaltyWelcomePoints} welcome points</p>}
        {mayConfigure && (
          <form className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end" onSubmit={(e) => { e.preventDefault(); save({ loyaltyPointsPerDollar: Number(form.rate), loyaltyWelcomePoints: Number(form.welcome) }); }}>
            <div><label className={LABEL} htmlFor="loy-rate">Points per dollar</label><input id="loy-rate" className={`${INPUT} mt-1`} inputMode="decimal" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} /></div>
            <div><label className={LABEL} htmlFor="loy-welcome">Welcome points</label><input id="loy-welcome" className={`${INPUT} mt-1`} inputMode="numeric" value={form.welcome} onChange={(e) => setForm({ ...form, welcome: e.target.value })} /></div>
            <button type="submit" className={`${BTN} ${ON}`} disabled={busy}>Save</button>
          </form>
        )}
      </div>

      <div className={CARD}>
        <div className="flex items-center justify-between gap-2 mb-3">
          <p className={LABEL}>Rewards</p>
          {mayConfigure && <button className={`${BTN} ${OFF} inline-flex items-center gap-2`} onClick={() => setEditing({ type: 'fixed', active: true, value: '5', pointsCost: 100 })}><Plus className="w-4 h-4" />Reward</button>}
        </div>
        {rewards.length === 0 && <p className={`text-sm ${MUTED}`}>No rewards yet. A regular has nothing to spend points on until there is one.</p>}
        <ul className="divide-y divide-gray-200 dark:divide-slate-800">
          {rewards.map((r) => (
            <li key={r.id} className="py-2 flex items-center justify-between gap-3">
              <span className="min-w-0 text-gray-900 dark:text-slate-100">
                <span className="font-semibold">{r.name}</span>{!r.active && <span className={`ml-2 text-xs ${MUTED}`}>(off)</span>}
                <span className={`block text-xs ${MUTED}`}>{r.pointsCost} points · {r.type === 'fixed' ? `${money(r.valueCents)} off` : r.type === 'percent' ? `${r.valueCents}% off` : `free ${items.find((i) => i.id === r.menuItemId)?.name || 'item'}`} · used {r.usageCount}×</span>
              </span>
              {mayConfigure && <button className={`${BTN} ${OFF} min-h-[40px]`} onClick={() => setEditing({ ...r, value: r.type === 'fixed' ? (r.valueCents / 100).toFixed(2) : String(r.valueCents) })}>Edit</button>}
            </li>
          ))}
        </ul>
      </div>

      <MemberList />

      {editing && <RewardDialog reward={editing} items={items} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

/** Everyone on the programme and their points; tap one for their ledger (and, for a manager, a correction). */
function MemberList() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Member[] | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<Member | null>(null);
  const load = useCallback(async (term: string) => {
    try { const r = await api.get(`/api/loyalty/members${term.trim() ? `?q=${encodeURIComponent(term.trim())}` : ''}`); setRows(r.data || []); setErr(''); }
    catch (e) { setErr(errorText(e, 'Could not load the regulars.')); }
  }, []);
  useEffect(() => { const t = setTimeout(() => load(q), 250); return () => clearTimeout(t); }, [q, load]);
  return (
    <div className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className={LABEL}>The regulars{rows ? ` (${rows.length}${rows.length === 200 ? '+' : ''})` : ''}</p>
        <input aria-label="Find a regular by name or phone" className={`${INPUT} sm:max-w-xs`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or phone" />
      </div>
      <FormError message={err} onDismiss={() => setErr('')} />
      {rows === null && !err && <Loader2 className="w-5 h-5 animate-spin text-gray-500 dark:text-slate-400" />}
      {rows?.length === 0 && <p className={`text-sm ${MUTED}`}>{q.trim() ? 'Nobody on the programme matches that.' : 'No regulars yet. Add one at the register with "Add a regular": a name and a phone number.'}</p>}
      <ul className="divide-y divide-gray-200 dark:divide-slate-800">
        {rows?.map((m) => (
          <li key={m.contactId}>
            <button className="w-full text-left py-2 flex items-center justify-between gap-3 min-h-[48px] text-gray-900 dark:text-slate-100" onClick={() => setOpen(m)}>
              <span className="min-w-0">
                <span className="font-semibold block truncate">{m.name}</span>
                <span className={`block text-xs ${MUTED}`}>{[m.phone, m.lastActivityAt ? `last in ${new Date(m.lastActivityAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : null].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="font-mono text-right shrink-0">{m.pointsBalance} pts<span className={`block text-xs ${MUTED}`}>{m.lifetimePoints} all time</span></span>
            </button>
          </li>
        ))}
      </ul>
      {open && <MemberDialog member={open} onClose={() => setOpen(null)} onChanged={() => load(q)} />}
    </div>
  );
}

function MemberDialog({ member, onClose, onChanged }: { member: Member; onClose: () => void; onChanged: () => void }) {
  const mayAdjust = useMayWrite('loyalty:adjust');
  const [history, setHistory] = useState<Txn[] | null>(null);
  const [balance, setBalance] = useState(member.pointsBalance);
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const r = await api.get(`/api/loyalty/members/${member.contactId}`); setHistory(r.history || []); if (r.member) setBalance(r.member.pointsBalance); }
    catch (e) { setErr(errorText(e, 'Could not load their points.')); }
  }, [member.contactId]);
  useEffect(() => { load(); }, [load]);
  return (
    <Dialog title={member.name} onClose={onClose}>
      <p className="text-sm text-gray-900 dark:text-slate-100 mb-3"><span className="font-mono font-semibold">{balance}</span> points to spend{member.phone ? ` · ${member.phone}` : ''}</p>
      <FormError message={err} className="mb-2" />
      {history === null && !err && <Loader2 className="w-5 h-5 animate-spin text-gray-500 dark:text-slate-400" />}
      {history?.length === 0 && <p className={`text-sm ${MUTED}`}>Nothing earned or spent yet.</p>}
      <ul className="text-sm divide-y divide-gray-200 dark:divide-slate-800 max-h-64 overflow-y-auto">
        {history?.map((t) => (
          <li key={t.id} className="py-1.5 flex justify-between gap-3 text-gray-900 dark:text-slate-100">
            <span className="min-w-0">{t.description || t.type}<span className={`block text-xs ${MUTED}`}>{new Date(t.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}{t.createdBy ? ` · ${t.createdBy}` : ''}</span></span>
            <span className="font-mono shrink-0">{t.points > 0 ? '+' : ''}{t.points}</span>
          </li>
        ))}
      </ul>
      {mayAdjust && (
        <form className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2 items-end" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true); setErr('');
          try { const r = await api.post(`/api/loyalty/members/${member.contactId}/adjust`, { points: Number(points), reason }); setBalance(r.pointsBalance); setPoints(''); setReason(''); await load(); onChanged(); }
          catch (ex) { setErr(errorText(ex, 'That did not save.')); } finally { setBusy(false); }
        }}>
          <div><label className={LABEL} htmlFor="adj-pts">Points (+ or −)</label><input id="adj-pts" className={`${INPUT} mt-1`} inputMode="numeric" value={points} onChange={(e) => setPoints(e.target.value.replace(/[^0-9-]/g, ''))} placeholder="-20" /></div>
          <div><label className={LABEL} htmlFor="adj-why">Why</label><input id="adj-why" className={`${INPUT} mt-1`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} /></div>
          <button type="submit" className={`${BTN} ${OFF}`} disabled={busy || !points || points === '-' || !reason.trim()}>Correct it</button>
        </form>
      )}
    </Dialog>
  );
}

function RewardDialog({ reward, items, onClose, onSaved }: { reward: Partial<Reward> & { value?: string }; items: MenuItem[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(reward);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setErr('');
    const valueCents = f.type === 'fixed' ? centsFrom(f.value || '') : f.type === 'percent' ? Math.round(Number(f.value)) : 0;
    const body = { name: f.name, description: f.description ?? null, pointsCost: Number(f.pointsCost), type: f.type, valueCents, menuItemId: f.type === 'free_item' ? f.menuItemId : null, active: f.active !== false };
    try {
      if (f.id) await api.put(`/api/loyalty/rewards/${f.id}`, body); else await api.post('/api/loyalty/rewards', body);
      onSaved();
    } catch (e) { setErr(errorText(e, 'The reward did not save.')); } finally { setBusy(false); }
  };
  return (
    <Dialog title={f.id ? 'Edit the reward' : 'New reward'} onClose={onClose}>
      <div className="space-y-3">
        <div><label className={LABEL} htmlFor="rw-name">Name</label><input id="rw-name" className={`${INPUT} mt-1`} value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} placeholder="$5 off" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={LABEL} htmlFor="rw-cost">Points</label><input id="rw-cost" className={`${INPUT} mt-1`} inputMode="numeric" value={String(f.pointsCost ?? '')} onChange={(e) => setF({ ...f, pointsCost: Number(e.target.value.replace(/\D/g, '')) })} /></div>
          <div><label className={LABEL} htmlFor="rw-type">What they get</label>
            <select id="rw-type" className={`${INPUT} mt-1`} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as Reward['type'] })}>
              {(Object.keys(TYPE_LABEL) as Reward['type'][]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
          </div>
        </div>
        {f.type === 'fixed' && <div><label className={LABEL} htmlFor="rw-value">Amount off ($)</label><input id="rw-value" className={`${INPUT} mt-1`} inputMode="decimal" value={f.value || ''} onChange={(e) => setF({ ...f, value: e.target.value })} /></div>}
        {f.type === 'percent' && <div><label className={LABEL} htmlFor="rw-pct">Percent off</label><input id="rw-pct" className={`${INPUT} mt-1`} inputMode="numeric" value={f.value || ''} onChange={(e) => setF({ ...f, value: e.target.value })} /></div>}
        {f.type === 'free_item' && (
          <div><label className={LABEL} htmlFor="rw-item">Which item (one of it)</label>
            <select id="rw-item" className={`${INPUT} mt-1`} value={f.menuItemId || ''} onChange={(e) => setF({ ...f, menuItemId: e.target.value || null })}>
              <option value="">Pick an item</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm text-gray-900 dark:text-slate-100"><input type="checkbox" className="w-5 h-5" checked={f.active !== false} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Offered on the register</label>
        <FormError message={err} />
        <div className="flex flex-wrap justify-end gap-2">
          {f.id && <button className={`${BTN} ${DANGER} inline-flex items-center gap-2`} disabled={busy} onClick={async () => { setBusy(true); try { await api.delete(`/api/loyalty/rewards/${f.id}`); onSaved(); } catch (e) { setErr(errorText(e, 'Could not delete it.')); } finally { setBusy(false); } }}><Trash2 className="w-4 h-4" />Delete</button>}
          <button className={`${BTN} ${OFF}`} onClick={onClose}>Cancel</button>
          <button className={`${BTN} ${ON}`} disabled={busy || !f.name?.trim()} onClick={submit}>Save</button>
        </div>
      </div>
    </Dialog>
  );
}
