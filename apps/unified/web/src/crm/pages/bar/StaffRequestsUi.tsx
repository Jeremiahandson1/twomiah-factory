import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api';
import { useAuth, useMayWrite } from '../../../shared';
import { companyTodayKey } from '@twomiah/tenant-ui/src/time/companyClock';
import FormError, { errorText } from '../../ui/FormError';
import { BTN, ON, OFF, DANGER, CARD, LABEL, INPUT, MUTED, Dialog } from './registerUi';

/**
 * Availability and shift swaps on the Schedule (features bar_availability and bar_shift_swaps; server:
 * crm/bar/barStaffRequests.ts, barScheduleRoutes.ts). Staff say when they can work, give a shift away or swap it; a
 * manager approves before anything moves. Everything here asks the server; the server decides.
 */
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayLabel = (d: string) => { const x = new Date(d + 'T12:00:00Z'); return `${DOW[x.getUTCDay()]} ${x.getUTCMonth() + 1}/${x.getUTCDate()}`; };
const clock12 = (t: string) => { const [h, m] = t.split(':').map(Number); const hr = h % 12 === 0 ? 12 : h % 12; return `${hr}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`; };
const span = (s: { day: string; start: string; end: string; position?: string | null } | null) => (s ? `${dayLabel(s.day)} ${clock12(s.start)}–${clock12(s.end)}${s.position ? ` · ${s.position}` : ''}` : 'a shift that is gone');

export interface Window { dow: number; start: string; end: string }
type Mode = 'free' | 'off' | 'between';
interface Row { mode: Mode; start: string; end: string }

const toRows = (ws: Window[]): Row[] => Array.from({ length: 7 }, (_, d) => {
  if (!ws.length) return { mode: 'free', start: '09:00', end: '17:00' };
  const mine = ws.filter((w) => w.dow === d);
  if (!mine.length) return { mode: 'off', start: '09:00', end: '17:00' };
  if (mine.length === 1 && mine[0].start === '00:00' && mine[0].end === '23:59') return { mode: 'free', start: '09:00', end: '17:00' };
  return { mode: 'between', start: mine[0].start, end: mine[0].end };
});
/** Every day free means no limits at all; otherwise a free day is a full-day window, an off day has none. */
const toWindows = (rows: Row[]): Window[] => {
  if (rows.every((r) => r.mode === 'free')) return [];
  return rows.flatMap((r, dow) => (r.mode === 'off' ? [] : r.mode === 'free' ? [{ dow, start: '00:00', end: '23:59' }] : [{ dow, start: r.start, end: r.end }]));
};

/** One person's week of "can work / cannot". */
export function AvailabilityEditor({ initial, onSave, saveLabel = 'Send for approval' }: { initial: Window[]; onSave: (w: Window[]) => Promise<void>; saveLabel?: string }) {
  const [rows, setRows] = useState<Row[]>(toRows(initial));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setRows(toRows(initial)); }, [initial]);
  const set = (i: number, p: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <form className="space-y-2" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(''); try { await onSave(toWindows(rows)); } catch (ex) { setErr(errorText(ex, 'That did not save.')); } finally { setBusy(false); } }}>
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <span className="w-24 text-sm text-gray-900 dark:text-slate-100">{FULL[i]}</span>
          <select aria-label={`${FULL[i]} availability`} className={`${INPUT} max-w-[11rem]`} value={r.mode} onChange={(e) => set(i, { mode: e.target.value as Mode })}>
            <option value="free">Can work any time</option><option value="between">Only between</option><option value="off">Cannot work</option>
          </select>
          {r.mode === 'between' && (<>
            <input aria-label={`${FULL[i]} from`} type="time" className={`${INPUT} max-w-[9rem]`} value={r.start} onChange={(e) => set(i, { start: e.target.value })} />
            <span className={MUTED}>to</span>
            <input aria-label={`${FULL[i]} until`} type="time" className={`${INPUT} max-w-[9rem]`} value={r.end} onChange={(e) => set(i, { end: e.target.value })} />
          </>)}
        </div>
      ))}
      <p className={`text-xs ${MUTED}`}>For a late night, say until 11:59 PM and add the small hours (12:00 AM to 2:00 AM) to the next day.</p>
      <FormError message={err} />
      <button type="submit" className={`${BTN} ${ON}`} disabled={busy}>{busy ? 'Saving…' : saveLabel}</button>
    </form>
  );
}

/** My availability, for me. */
export function MyAvailability() {
  const { hasFeature } = useAuth();
  const mayAsk = useMayWrite('bar:read');   // PUT /api/schedule/availability/mine asks bar:read
  const [data, setData] = useState<{ approved: Window[]; pending: Window[] | null } | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => { try { setData(await api.get('/api/schedule/availability/mine')); } catch (e) { setErr(errorText(e, 'Could not load your availability.')); } }, []);
  useEffect(() => { if (hasFeature('bar_availability')) load(); }, [load, hasFeature]);
  if (!hasFeature('bar_availability') || !mayAsk) return null;
  return (
    <div className={CARD}>
      <p className={`${LABEL} mb-2`}>When I can work</p>
      <FormError message={err} />
      {data && (<>
        {data.pending && <p className={`text-sm mb-2 ${MUTED}`} role="status">A change is waiting for a manager. Until it is approved the schedule uses what was approved before.</p>}
        <AvailabilityEditor initial={data.pending ?? data.approved} onSave={async (windows) => { await api.put('/api/schedule/availability/mine', { windows }); await load(); }} />
      </>)}
    </div>
  );
}

interface Req { id: string; kind: 'give' | 'swap'; status: string; note: string | null; fromName: string; toName: string | null; fromUserId: string; shift: { id: string; day: string; start: string; end: string; position: string | null } | null; withShift: { day: string; start: string; end: string; position: string | null } | null }
const STATUS: Record<string, string> = { open: 'Waiting for someone to take it', offered: 'Waiting for their answer', pending: 'Waiting for a manager', approved: 'Approved', denied: 'Denied', declined: 'Declined', cancelled: 'Taken back' };

/** Give a shift away, swap it, answer a swap, take a shift on offer — for me. `published` is the schedule staff see. */
export function MySwaps({ published, meId }: { published: any[]; meId: string | null }) {
  const { hasFeature } = useAuth();
  const mayAsk = useMayWrite('bar:read');   // POST /api/schedule/swaps and its answers ask bar:read
  const [data, setData] = useState<{ mine: Req[]; forMe: Req[]; onOffer: Req[] } | null>(null);
  const [swapFor, setSwapFor] = useState<any | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => { try { setData(await api.get('/api/schedule/swaps/mine')); setErr(''); } catch (e) { setErr(errorText(e, 'Could not load your requests.')); } }, []);
  useEffect(() => { if (hasFeature('bar_shift_swaps')) load(); }, [load, hasFeature]);
  if (!hasFeature('bar_shift_swaps') || !mayAsk) return null;
  const act = async (fn: () => Promise<unknown>, fallback: string) => { setErr(''); try { await fn(); await load(); } catch (e) { setErr(errorText(e, fallback)); } };
  const today = companyTodayKey();
  const mineShifts = published.filter((s) => s.userId === meId && s.id && s.day >= today);
  const others = published.filter((s) => s.userId !== meId && s.id && s.day >= today);
  const busyIds = new Set((data?.mine || []).filter((r) => ['open', 'offered', 'pending'].includes(r.status)).map((r) => r.shift?.id));
  return (
    <div className={CARD}>
      <p className={`${LABEL} mb-2`}>Shift swaps</p>
      <FormError message={err} />
      {data && (<div className="space-y-4">
        {data.forMe.length > 0 && (
          <section aria-label="Swaps offered to me"><p className="text-sm font-semibold text-gray-900 dark:text-slate-100">Offered to you</p>
            <ul className="space-y-2 mt-1">{data.forMe.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-900 dark:text-slate-100">
                <span>{r.fromName} offers {span(r.shift)} for your {span(r.withShift)}{r.note ? ` · ${r.note}` : ''}</span>
                <span className="flex gap-2"><button className={`${BTN} ${ON} min-h-[40px]`} onClick={() => act(() => api.post(`/api/schedule/swaps/${r.id}/accept`, {}), 'That did not go through.')}>Accept</button><button className={`${BTN} ${OFF} min-h-[40px]`} onClick={() => act(() => api.post(`/api/schedule/swaps/${r.id}/decline`, {}), 'That did not go through.')}>Decline</button></span>
              </li>))}</ul></section>
        )}
        {data.onOffer.length > 0 && (
          <section aria-label="Shifts on offer"><p className="text-sm font-semibold text-gray-900 dark:text-slate-100">Shifts you could take</p>
            <ul className="space-y-2 mt-1">{data.onOffer.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-900 dark:text-slate-100">
                <span>{r.fromName}: {span(r.shift)}{r.note ? ` · ${r.note}` : ''}</span>
                <button className={`${BTN} ${ON} min-h-[40px]`} onClick={() => act(() => api.post(`/api/schedule/swaps/${r.id}/claim`, {}), 'Someone may have just taken it.')}>I&rsquo;ll take it</button>
              </li>))}</ul>
            <p className={`text-xs mt-1 ${MUTED}`}>A manager approves before it is yours.</p></section>
        )}
        <section aria-label="My shifts"><p className="text-sm font-semibold text-gray-900 dark:text-slate-100">My coming shifts</p>
          {mineShifts.length === 0 ? <p className={`text-sm ${MUTED}`}>Nothing coming up on the published schedule.</p> : (
            <ul className="space-y-2 mt-1">{mineShifts.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-900 dark:text-slate-100">
                <span>{span(s)}</span>
                {busyIds.has(s.id) ? <span className={MUTED}>Requested</span> : (
                  <span className="flex gap-2">
                    <button className={`${BTN} ${OFF} min-h-[40px]`} onClick={() => act(() => api.post('/api/schedule/swaps', { kind: 'give', shiftId: s.id }), 'That did not go through.')}>Give away</button>
                    <button className={`${BTN} ${OFF} min-h-[40px]`} onClick={() => setSwapFor(s)}>Swap</button>
                  </span>)}
              </li>))}</ul>)}
        </section>
        {data.mine.length > 0 && (
          <section aria-label="My requests"><p className="text-sm font-semibold text-gray-900 dark:text-slate-100">My requests</p>
            <ul className="space-y-1 mt-1">{data.mine.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-900 dark:text-slate-100">
                <span>{r.kind === 'give' ? 'Give away' : `Swap with ${r.toName}`} · {span(r.shift)} · {STATUS[r.status] || r.status}</span>
                {['open', 'offered', 'pending'].includes(r.status) && <button className={`${BTN} ${OFF} min-h-[40px]`} onClick={() => act(() => api.post(`/api/schedule/swaps/${r.id}/cancel`, {}), 'That did not go through.')}>Take it back</button>}
              </li>))}</ul></section>
        )}
      </div>)}
      {swapFor && (
        <Dialog title="Swap this shift" onClose={() => setSwapFor(null)}>
          <p className={`text-sm mb-2 ${MUTED}`}>Your {span(swapFor)}. Pick the shift you would take instead; they have to say yes, then a manager approves.</p>
          {others.length === 0 ? <p className={MUTED}>Nobody else has a coming shift on the published schedule.</p> : (
            <ul className="space-y-2 max-h-80 overflow-auto">{others.map((o) => (
              <li key={o.id}><button className={`${BTN} ${OFF} w-full text-left`} onClick={async () => { await act(() => api.post('/api/schedule/swaps', { kind: 'swap', shiftId: swapFor.id, withShiftId: o.id }), 'That did not go through.'); setSwapFor(null); }}>{o.name}: {span(o)}</button></li>))}</ul>)}
          <div className="flex justify-end mt-3"><button className={`${BTN} ${OFF}`} onClick={() => setSwapFor(null)}>Never mind</button></div>
        </Dialog>
      )}
    </div>
  );
}

/** For a manager: swaps waiting for a decision, and availability waiting for a decision. */
export function ManagerRequests() {
  const { hasFeature } = useAuth();
  const mayDecide = useMayWrite('bar:update');   // PUT /api/schedule/swaps/:id and the availability decisions ask bar:update
  const swapsOn = hasFeature('bar_shift_swaps'), availOn = hasFeature('bar_availability');
  const [swaps, setSwaps] = useState<{ pending: Req[]; open: Req[] } | null>(null);
  const [people, setPeople] = useState<Array<{ userId: string; name: string; windows: Window[]; pending: Window[] | null }>>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const load = useCallback(async () => {
    try {
      if (swapsOn) setSwaps(await api.get('/api/schedule/swaps'));
      if (availOn) setPeople((await api.get('/api/schedule/availability')).people);
    } catch (e) { setErr(errorText(e, 'Could not load the requests.')); }
  }, [swapsOn, availOn]);
  useEffect(() => { load(); }, [load]);
  if ((!swapsOn && !availOn) || !mayDecide) return null;
  const decide = async (fn: () => Promise<any>) => { setErr(''); setNote(''); try { const r = await fn(); if (r?.warnings?.length) setNote(r.warnings.join(' ')); await load(); } catch (e) { setErr(errorText(e, 'That did not go through.')); } };
  const waiting = people.filter((p) => p.pending);
  const describe = (ws: Window[] | null) => (!ws ? '' : ws.length === 0 ? 'any time' : ws.map((w) => `${DOW[w.dow]} ${clock12(w.start)}–${clock12(w.end)}`).join(', '));
  return (
    <div className="space-y-3">
      <FormError message={err} />
      {note && <p role="status" className="text-sm text-amber-900 dark:text-amber-200">{note}</p>}
      {swapsOn && swaps && (swaps.pending.length > 0 || swaps.open.length > 0) && (
        <div className={CARD}>
          <p className={`${LABEL} mb-2`}>Shift swaps</p>
          <ul className="space-y-2">
            {swaps.pending.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-900 dark:text-slate-100">
                <span>{r.kind === 'give' ? `${r.fromName} gives ${span(r.shift)} to ${r.toName}` : `${r.fromName} ${span(r.shift)} ⇄ ${r.toName} ${span(r.withShift)}`}{r.note ? ` · ${r.note}` : ''}</span>
                <span className="flex gap-2"><button className={`${BTN} ${ON} min-h-[40px]`} onClick={() => decide(() => api.put(`/api/schedule/swaps/${r.id}`, { status: 'approved' }))}>Approve</button><button className={`${BTN} ${OFF} min-h-[40px]`} onClick={() => decide(() => api.put(`/api/schedule/swaps/${r.id}`, { status: 'denied' }))}>Deny</button></span>
              </li>))}
            {swaps.open.map((r) => <li key={r.id} className={`text-sm ${MUTED}`}>{r.fromName}: {span(r.shift)} · {STATUS[r.status]}</li>)}
          </ul>
        </div>
      )}
      {availOn && (
        <div className={CARD}>
          <p className={`${LABEL} mb-2`}>Availability</p>
          <ul className="space-y-2">
            {waiting.map((p) => (
              <li key={p.userId} className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-900 dark:text-slate-100">
                <span>{p.name} asks for: {describe(p.pending)}</span>
                <span className="flex gap-2"><button className={`${BTN} ${ON} min-h-[40px]`} onClick={() => decide(() => api.post(`/api/schedule/availability/${p.userId}/decision`, { status: 'approved' }))}>Approve</button><button className={`${BTN} ${OFF} min-h-[40px]`} onClick={() => decide(() => api.post(`/api/schedule/availability/${p.userId}/decision`, { status: 'denied' }))}>Deny</button></span>
              </li>))}
            {people.map((p) => (
              <li key={`all-${p.userId}`} className="text-sm text-gray-900 dark:text-slate-100">
                <div className="flex flex-wrap items-center justify-between gap-2"><span>{p.name}: {describe(p.windows)}</span><button className={`${BTN} ${OFF} min-h-[40px]`} onClick={() => setEditing(editing === p.userId ? null : p.userId)}>{editing === p.userId ? 'Close' : 'Change'}</button></div>
                {editing === p.userId && <div className="mt-2"><AvailabilityEditor initial={p.windows} saveLabel="Save" onSave={async (windows) => { await api.put(`/api/schedule/availability/${p.userId}`, { windows }); setEditing(null); await load(); }} /></div>}
              </li>))}
          </ul>
        </div>
      )}
    </div>
  );
}
