// Moved from templates/crm-bar/frontend/src/pages/bar/RegisterPage.tsx.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Loader2, Flame, LayoutGrid, Clock, Send, CreditCard, Banknote, Scissors, Ban, KeyRound, Plus, Minus, ClipboardCheck, Pencil, Users, Gift, Star, UserPlus } from 'lucide-react'
import { api } from '../../../api'
import FormError, { errorText } from '../../ui/FormError'
import { BTN, ON, OFF, DANGER, CARD, LABEL, INPUT, MUTED, money, centsFrom, Dialog, useLive, useManagerPin, TillPinDialog } from './registerUi';

/**
 * THE REGISTER — the bar tablet. Open a tab ("Mike"), a table ("Booth 2") or ring a walk-up; ring items (sizes,
 * an open price, a pour from the tap list); Send fires the food to the grill screen as one ticket; take cash or
 * card (run on the card reader, then recorded here); split by item or by seat; void with a reason.
 *
 * The server decides everything (routes/barRegister.ts): totals, tax, what needs a manager. This screen shows what
 * it says and asks for a manager's till PIN only when the server answers that one is needed.
 */

interface Size { id: string; name: string; priceCents: number | null }
interface MenuItem { id: string; name: string; is86ed: boolean; sizes: Size[] }
interface Section { id: string; name: string; kind: string; items: MenuItem[] }
interface OpenRow { id: string; number: number; kind: string; label: string; spot: string | null; totalCents: number; balanceCents: number; itemCount: number; heldCount: number; foodUpAt: string | null; onGrill: number }
interface Recent { id: string; number: number; label: string; status: string; totalCents: number | null; closedAt: string }
interface Line { id: string; name: string; size: string | null; qty: number; unitPriceCents: number; note: string | null; seat: number | null; toKitchen: boolean; kind: string; state: string; ticketId: string | null; voidReason: string | null; voidedByName: string | null }
interface Payment { id: string; tender: string; amountCents: number; tipCents: number; changeCents: number | null; takenByName: string | null; voidedAt: string | null; voidReason: string | null }
interface Check {
  id: string; number: number; kind: string; label: string; spot: string | null; note: string | null; status: string
  contactId: string | null; guestName: string | null; guestPoints: number | null
  items: Line[]; payments: Payment[]; heldFood: number; quickCash: number[]
  totals: { subtotalCents: number; taxCents: number; totalCents: number; paidCents: number; tipCents: number; balanceCents: number }
}
interface Reward { id: string; name: string; pointsCost: number; type: string }
interface State { businessDay: string; open: OpenRow[]; recent: Recent[]; menu: Section[]; taxRateBps: number; giftCards: boolean; regulars: { rewards: Reward[] } | null; me: { name: string; mayManage: boolean; hasPin: boolean } }

const TENDER_LABEL: Record<string, string> = { cash: 'Cash', card_external: 'Card', card_online: 'Card (website)', giftcard: 'Gift card' };

export default function RegisterPage() {
  const [params] = useSearchParams();
  const [state, setState] = useState<State | null>(null);
  // Opened from the floor ("/crm/register?check=…"): that table's check is the one on screen.
  const [checkId, setCheckId] = useState<string>(params.get('check') || '');
  const [check, setCheck] = useState<Check | null>(null);
  const [section, setSection] = useState<string>('');
  const [seat, setSeat] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [dialog, setDialog] = useState<null | { kind: 'open'; as: 'tab' | 'table' } | { kind: 'size'; item: MenuItem } | { kind: 'price'; item: MenuItem; size: Size | null } | { kind: 'pay' } | { kind: 'split' } | { kind: 'void'; what: 'item' | 'payment' | 'check'; id: string; label: string } | { kind: 'rename' } | { kind: 'pin' } | { kind: 'sellCard' } | { kind: 'guest' }>(null);
  const [showRecent, setShowRecent] = useState(false);
  const [paid, setPaid] = useState<{ changeCents: number | null; giftCard: { code: string; balanceCents: number } | null } | null>(null);
  const { guarded, dialog: managerDialog } = useManagerPin();

  const loadState = useCallback(async () => {
    try {
      const s: State = await api.get('/api/register/state');
      setState(s);
      setSection((cur) => cur && s.menu.some((m) => m.id === cur) ? cur : (s.menu[0]?.id || ''));
    } catch (e) { setErr(errorText(e, 'Could not load the register. Try again.')); }
  }, []);
  const loadCheck = useCallback(async (id: string) => {
    if (!id) { setCheck(null); return; }
    try { const r = await api.get(`/api/register/check/${id}`); setCheck(r.check); } catch (e) { setErr(errorText(e, 'Could not load that check.')); }
  }, []);
  useEffect(() => { loadState(); }, [loadState]);
  useEffect(() => { loadCheck(checkId); setSeat(null); }, [checkId, loadCheck]);
  useLive('bar:register', () => { loadState(); if (checkId) loadCheck(checkId); });

  /** One action: the request, then the screen re-reads. A refusal stays on the page. */
  const act = async (key: string, fn: () => Promise<any>) => {
    setBusy(key); setErr('');
    try {
      const r = await fn();
      if (r?.check) setCheck(r.check);
      await loadState();
      return r;
    } catch (e) { setErr(errorText(e, 'That did not save. Try again.')); return null; } finally { setBusy(''); }
  };

  const openCheck = async (body: Record<string, unknown>) => {
    const r = await act('open', () => api.post('/api/register/check', body));
    if (r?.check) { setCheckId(r.check.id); setDialog(null); }
    return r?.check as Check | undefined;
  };

  const ring = async (item: MenuItem, size: Size | null, priceCents?: number) => {
    let id = checkId;
    if (!id || check?.status !== 'open') {
      // Ringing with no check open is a walk-up: one tap, no naming.
      const c = await openCheck({ kind: 'walkup' });
      if (!c) return;
      id = c.id;
    }
    await act('ring', () => api.post(`/api/register/check/${id}/items`, { menuItemId: item.id, sizeId: size?.id ?? null, seat, priceCents }));
  };
  const pick = (item: MenuItem) => {
    if (item.is86ed) return;
    if (item.sizes.length > 1) { setDialog({ kind: 'size', item }); return; }
    const size = item.sizes[0] || null;
    if (!size || size.priceCents === null) { setDialog({ kind: 'price', item, size }); return; }
    ring(item, size);
  };

  const menuItems = useMemo(() => state?.menu.find((s) => s.id === section)?.items || [], [state, section]);
  const live = check && check.status === 'open';
  const lines = check?.items || [];
  const held = lines.filter((l) => l.state === 'held');
  const isTable = check?.kind === 'table';

  if (!state) {
    return <div className="flex justify-center py-16">{err ? <FormError message={err} /> : <Loader2 className="w-6 h-6 animate-spin text-gray-500 dark:text-slate-400" />}</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Register</h1>
          <p className={`text-sm ${MUTED}`}>{state.me.name} · the night of {state.businessDay}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/crm/floor" className={`${BTN} ${OFF} inline-flex items-center gap-2`}><LayoutGrid className="w-4 h-4" />Floor</Link>
          <Link to="/crm/grill" className={`${BTN} ${OFF} inline-flex items-center gap-2`}><Flame className="w-4 h-4" />Grill screen</Link>
          <Link to="/crm/clock" className={`${BTN} ${OFF} inline-flex items-center gap-2`}><Clock className="w-4 h-4" />Clock in</Link>
          <Link to="/crm/closeout" className={`${BTN} ${OFF} inline-flex items-center gap-2`}><ClipboardCheck className="w-4 h-4" />Close-out</Link>
          <button className={`${BTN} ${OFF} inline-flex items-center gap-2`} onClick={() => setDialog({ kind: 'pin' })}><KeyRound className="w-4 h-4" />{state.me.hasPin ? 'My till PIN' : 'Set my till PIN'}</button>
        </div>
      </div>

      <FormError message={err} onDismiss={() => setErr('')} />

      <div className="grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)_380px] gap-3 items-start">
        {/* ── the checks ── */}
        <section className={CARD} aria-label="Open checks">
          <div className="grid grid-cols-3 lg:grid-cols-1 gap-2 mb-3">
            <button className={`${BTN} ${OFF}`} onClick={() => setDialog({ kind: 'open', as: 'tab' })}>New tab</button>
            <button className={`${BTN} ${OFF}`} onClick={() => setDialog({ kind: 'open', as: 'table' })}>New table</button>
            <button className={`${BTN} ${OFF}`} disabled={!!busy} onClick={() => openCheck({ kind: 'walkup' })}>Walk-up</button>
          </div>
          <p className={`${LABEL} mb-2`}>Open ({state.open.length})</p>
          {state.open.length === 0 && <p className={`text-sm ${MUTED}`}>No open checks.</p>}
          <ul className="space-y-2">
            {state.open.map((o) => (
              <li key={o.id}>
                <button onClick={() => setCheckId(o.id)} aria-pressed={o.id === checkId}
                  className={`w-full text-left rounded-xl border px-3 py-2 min-h-[48px] ${o.id === checkId ? 'border-orange-500 bg-orange-50 text-gray-900 dark:bg-orange-950/40 dark:text-slate-100 dark:border-orange-500' : 'border-gray-200 bg-white text-gray-900 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800'}`}>
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-semibold truncate">#{o.number} {o.label}</span>
                    <span className="font-mono text-sm">{money(o.balanceCents)}</span>
                  </span>
                  <span className="flex flex-wrap gap-1 mt-1">
                    {o.heldCount > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">{o.heldCount} not sent</span>}
                    {o.onGrill > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-800 dark:bg-slate-800 dark:text-slate-200">On the grill</span>}
                    {o.foodUpAt && <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100">Food's up</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button className={`mt-3 text-sm underline ${MUTED}`} onClick={() => setShowRecent((v) => !v)}>{showRecent ? 'Hide' : 'Show'} tonight's closed ({state.recent.length})</button>
          {showRecent && (
            <ul className="mt-2 space-y-1">
              {state.recent.map((r) => (
                <li key={r.id}>
                  <button className={`w-full text-left text-sm px-2 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-800 dark:text-slate-200`} onClick={() => setCheckId(r.id)}>
                    #{r.number} {r.label} · {r.status === 'void' ? 'voided' : money(r.totalCents)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── the menu ── */}
        <section className={CARD} aria-label="Menu">
          <div className="flex flex-wrap gap-2 mb-3" role="tablist">
            {state.menu.map((s) => (
              <button key={s.id} role="tab" aria-selected={s.id === section} className={`${BTN} ${s.id === section ? ON : OFF}`} onClick={() => setSection(s.id)}>{s.name}</button>
            ))}
          </div>
          {isTable && live && (
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className={LABEL}>Seat</span>
              {[null, 1, 2, 3, 4, 5, 6].map((n) => (
                <button key={String(n)} className={`${BTN} ${seat === n ? ON : OFF} min-w-[48px]`} aria-pressed={seat === n} onClick={() => setSeat(n)}>{n === null ? 'Any' : n}</button>
              ))}
            </div>
          )}
          {state.menu.length === 0 && <p className={`text-sm ${MUTED}`}>Nothing on the menu yet. Add it under Menu.</p>}
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
            {menuItems.map((i) => {
              const price = i.sizes.length === 1 && i.sizes[0].priceCents !== null ? money(i.sizes[0].priceCents) : i.sizes.length > 1 ? `${i.sizes.length} sizes` : 'Enter price';
              return (
                <button key={i.id} disabled={i.is86ed || !!busy} onClick={() => pick(i)}
                  className={`rounded-xl border min-h-[72px] px-3 py-2 text-left ${i.is86ed ? 'border-gray-200 bg-gray-100 text-gray-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-500 line-through' : 'border-gray-300 bg-white text-gray-900 hover:bg-orange-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800'}`}>
                  <span className="block font-semibold leading-tight">{i.name}</span>
                  <span className={`block text-sm mt-1 ${i.is86ed ? '' : MUTED}`}>{i.is86ed ? "86'd" : price}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* ── the check ── */}
        <section className={CARD} aria-label="The check">
          {!check && <p className={`text-sm ${MUTED}`}>Pick a check, open one, or just ring an item for a walk-up.</p>}
          {check && (
            <>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <p className="text-lg font-bold text-gray-900 dark:text-slate-100 truncate">#{check.number} {check.label}</p>
                  {check.spot && check.spot !== check.label && <p className={`text-sm ${MUTED}`}>{check.spot}</p>}
                  {check.status !== 'open' && <p className="text-sm font-semibold text-gray-800 dark:text-slate-200">{check.status === 'paid' ? 'Paid' : 'Voided'}</p>}
                </div>
                {live && <button className={`${BTN} ${OFF} px-3`} aria-label="Rename or move" onClick={() => setDialog({ kind: 'rename' })}><Pencil className="w-4 h-4" /></button>}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 mb-2 rounded-xl border border-gray-200 dark:border-slate-800 px-3 py-2">
                <span className="text-sm text-gray-900 dark:text-slate-100">
                  {check.guestName ? <><Star className="w-4 h-4 inline -mt-0.5 mr-1" />{check.guestName}{check.guestPoints !== null ? ` · ${check.guestPoints} points` : ''}</> : <span className={MUTED}>No guest on this check</span>}
                </span>
                {live && <button className={`${BTN} ${OFF} min-h-[40px] px-3`} onClick={() => setDialog({ kind: 'guest' })}>{check.guestName ? 'Change' : 'Add a guest'}</button>}
              </div>
              {live && check.contactId && state.regulars && state.regulars.rewards.length > 0 && !lines.some((l) => l.kind === 'reward') && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {state.regulars.rewards.map((r) => {
                    const short = (check.guestPoints ?? 0) < r.pointsCost;
                    return (
                      <button key={r.id} className={`${BTN} ${OFF} min-h-[40px] text-xs`} disabled={short || !!busy} title={short ? `Needs ${r.pointsCost} points` : undefined}
                        onClick={() => act('reward', () => api.post(`/api/register/check/${check.id}/reward`, { rewardId: r.id }))}>
                        {r.name} · {r.pointsCost} pts
                      </button>
                    );
                  })}
                </div>
              )}
              <ul className="divide-y divide-gray-200 dark:divide-slate-800 mb-3">
                {lines.length === 0 && <li className={`py-3 text-sm ${MUTED}`}>Nothing on it yet.</li>}
                {lines.map((l) => (
                  <li key={l.id} className={`py-2 ${l.state === 'void' ? 'opacity-70' : ''}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className={`font-medium text-gray-900 dark:text-slate-100 ${l.state === 'void' ? 'line-through' : ''}`}>
                          {l.qty > 1 ? `${l.qty} × ` : ''}{l.name}{l.size ? ` (${l.size})` : ''}
                        </p>
                        <p className={`text-xs ${MUTED}`}>
                          {[l.seat ? `Seat ${l.seat}` : null, l.note, l.state === 'held' ? 'Not sent' : l.state === 'sent' ? (l.toKitchen ? 'Sent to the grill' : 'Sent') : `Voided: ${l.voidReason || ''}${l.voidedByName ? ' (' + l.voidedByName + ')' : ''}`].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <span className="font-mono text-sm text-gray-900 dark:text-slate-100">{money(l.qty * l.unitPriceCents)}</span>
                    </div>
                    {live && l.state === 'held' && (
                      <div className="flex gap-2 mt-1">
                        <button className={`${BTN} ${OFF} min-h-[40px] px-3`} aria-label={`One fewer ${l.name}`} onClick={() => act('qty', () => api.patch(`/api/register/item/${l.id}`, { qty: l.qty - 1 }))}><Minus className="w-4 h-4" /></button>
                        <button className={`${BTN} ${OFF} min-h-[40px] px-3`} aria-label={`One more ${l.name}`} onClick={() => act('qty', () => api.patch(`/api/register/item/${l.id}`, { qty: l.qty + 1 }))}><Plus className="w-4 h-4" /></button>
                        {held.length > 1 && <button className={`${BTN} ${OFF} min-h-[40px] px-3 text-xs`} title="Send just this now; the rest waits" onClick={() => act('fire', () => api.post(`/api/register/check/${check.id}/send`, { itemIds: [l.id] }))}>Fire just this</button>}
                      </div>
                    )}
                    {live && l.state === 'sent' && l.kind === 'reward' && (
                      <button className={`mt-1 text-sm underline text-gray-800 dark:text-slate-200`} onClick={() => act('unreward', () => api.post(`/api/register/item/${l.id}/void`, {}))}>Take the reward off</button>
                    )}
                    {live && l.state === 'sent' && l.kind !== 'reward' && (
                      <button className={`mt-1 text-sm underline text-red-700 dark:text-red-300`} onClick={() => setDialog({ kind: 'void', what: 'item', id: l.id, label: l.name })}>Void</button>
                    )}
                  </li>
                ))}
              </ul>

              <dl className="text-sm space-y-1 mb-3">
                <div className="flex justify-between"><dt className={MUTED}>Food &amp; drink</dt><dd className="font-mono text-gray-900 dark:text-slate-100">{money(check.totals.subtotalCents)}</dd></div>
                <div className="flex justify-between"><dt className={MUTED}>Tax ({(state.taxRateBps / 100).toFixed(2).replace(/\.?0+$/, '')}%)</dt><dd className="font-mono text-gray-900 dark:text-slate-100">{money(check.totals.taxCents)}</dd></div>
                <div className="flex justify-between text-base font-bold"><dt className="text-gray-900 dark:text-slate-100">Total</dt><dd className="font-mono text-gray-900 dark:text-slate-100">{money(check.totals.totalCents)}</dd></div>
                {check.payments.map((p) => (
                  <div key={p.id} className="flex justify-between items-center gap-2">
                    <dt className={`${MUTED} ${p.voidedAt ? 'line-through' : ''}`}>
                      {TENDER_LABEL[p.tender] || p.tender}{p.tipCents ? ` + ${money(p.tipCents)} tip` : ''}{p.takenByName ? ` · ${p.takenByName}` : ''}
                      {live && !p.voidedAt && <button className="ml-2 underline text-red-700 dark:text-red-300" onClick={() => setDialog({ kind: 'void', what: 'payment', id: p.id, label: `${TENDER_LABEL[p.tender] || p.tender} ${money(p.amountCents)}` })}>Void</button>}
                    </dt>
                    <dd className={`font-mono text-gray-900 dark:text-slate-100 ${p.voidedAt ? 'line-through' : ''}`}>−{money(p.amountCents)}</dd>
                  </div>
                ))}
                <div className="flex justify-between text-lg font-bold pt-1 border-t border-gray-200 dark:border-slate-800"><dt className="text-gray-900 dark:text-slate-100">Balance</dt><dd className="font-mono text-gray-900 dark:text-slate-100">{money(check.totals.balanceCents)}</dd></div>
              </dl>

              {live && (
                <div className="grid grid-cols-2 gap-2">
                  <button className={`${BTN} ${held.length ? ON : OFF} inline-flex items-center justify-center gap-2 col-span-2`} disabled={!held.length || !!busy}
                    onClick={() => act('send', () => api.post(`/api/register/check/${check.id}/send`, {}))}>
                    <Send className="w-4 h-4" />Send{held.length ? ` (${held.length})` : ''}
                  </button>
                  <button className={`${BTN} ${ON} inline-flex items-center justify-center gap-2 col-span-2`} disabled={check.totals.balanceCents <= 0 || !!busy} onClick={() => { setPaid(null); setDialog({ kind: 'pay' }); }}>
                    <CreditCard className="w-4 h-4" />Pay {money(check.totals.balanceCents)}
                  </button>
                  <button className={`${BTN} ${OFF} inline-flex items-center justify-center gap-2`} disabled={lines.filter((l) => l.state !== 'void').length < 2} onClick={() => setDialog({ kind: 'split' })}><Scissors className="w-4 h-4" />Split</button>
                  {isTable
                    ? <button className={`${BTN} ${OFF} inline-flex items-center justify-center gap-2`} onClick={() => act('seats', () => api.post(`/api/register/check/${check.id}/split-seats`, {}))}><Users className="w-4 h-4" />By seat</button>
                    : <span />}
                  {state.giftCards && <button className={`${BTN} ${OFF} inline-flex items-center justify-center gap-2 col-span-2`} onClick={() => setDialog({ kind: 'sellCard' })}><Gift className="w-4 h-4" />Sell a gift card</button>}
                  <button className={`${BTN} ${DANGER} inline-flex items-center justify-center gap-2 col-span-2`} onClick={() => setDialog({ kind: 'void', what: 'check', id: check.id, label: `check #${check.number}` })}><Ban className="w-4 h-4" />Void the check</button>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* ── dialogs ── */}
      {dialog?.kind === 'open' && <OpenDialog as={dialog.as} onClose={() => setDialog(null)} onOpen={(b) => openCheck(b)} />}
      {dialog?.kind === 'size' && (
        <Dialog title={dialog.item.name} onClose={() => setDialog(null)}>
          <div className="grid grid-cols-2 gap-2">
            {dialog.item.sizes.map((s) => (
              <button key={s.id} className={`${BTN} ${OFF} min-h-[64px]`} onClick={() => {
                const item = dialog.item; setDialog(null);
                if (s.priceCents === null) setDialog({ kind: 'price', item, size: s }); else ring(item, s);
              }}>
                <span className="block">{s.name}</span><span className={`block text-sm ${MUTED}`}>{s.priceCents === null ? 'Enter price' : money(s.priceCents)}</span>
              </button>
            ))}
          </div>
        </Dialog>
      )}
      {dialog?.kind === 'price' && <PriceDialog item={dialog.item} onClose={() => setDialog(null)} onRing={(cents) => { const d = dialog; setDialog(null); ring(d.item, d.size, cents); }} />}
      {dialog?.kind === 'pay' && check && (
        <PayDialog check={check} result={paid} onClose={() => { setDialog(null); setPaid(null); }}
          onPay={async (body) => { const r = await act('pay', () => api.post(`/api/register/check/${check.id}/pay`, body)); if (r) setPaid({ changeCents: r.changeCents ?? null, giftCard: r.giftCard ?? null }); return !!r; }} giftCards={state.giftCards} />
      )}
      {dialog?.kind === 'split' && check && (
        <SplitDialog check={check} onClose={() => setDialog(null)}
          onSplit={async (itemIds, label) => { const r = await act('split', () => api.post(`/api/register/check/${check.id}/split`, { itemIds, label })); if (r?.to) { setDialog(null); setCheckId(r.to.id); } }} />
      )}
      {dialog?.kind === 'guest' && check && (
        <GuestDialog regulars={!!state.regulars} current={check.contactId} onClose={() => setDialog(null)}
          onPick={async (contactId) => { const r = await act('guest', () => api.post(`/api/register/check/${check.id}/guest`, { contactId })); if (r) setDialog(null); }} />
      )}
      {dialog?.kind === 'sellCard' && check && (
        <SellCardDialog onClose={() => setDialog(null)}
          onSell={async (amountCents, code) => { const r = await act('sell', () => api.post(`/api/register/check/${check.id}/giftcard`, { amountCents, code })); if (r) setDialog(null); }} />
      )}
      {dialog?.kind === 'rename' && check && (
        <RenameDialog check={check} onClose={() => setDialog(null)}
          onSave={async (b) => { const r = await act('rename', () => api.patch(`/api/register/check/${check.id}`, b)); if (r) setDialog(null); }} />
      )}
      {dialog?.kind === 'void' && (
        <VoidDialog what={dialog.what} label={dialog.label} onClose={() => setDialog(null)}
          onVoid={async (reason) => {
            const d = dialog;
            const path = d.what === 'item' ? `/api/register/item/${d.id}/void` : d.what === 'payment' ? `/api/register/payment/${d.id}/void` : `/api/register/check/${d.id}/void`;
            setErr('');
            try {
              await guarded(async (managerPin) => {
                const r = await api.post(path, { reason, managerPin });
                if (r?.check) setCheck(r.check);
                setDialog(null);
                await loadState();
              }, (e) => { setErr(errorText(e, 'That did not save. Try again.')); setDialog(null); });
            } catch (e) { setErr(errorText(e, 'That did not save. Try again.')); setDialog(null); }
          }} />
      )}
      {dialog?.kind === 'pin' && (
        <TillPinDialog hasPin={state.me.hasPin} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); loadState(); }}
          save={(pin) => api.put('/api/register/pin', { pin })} clear={() => api.delete('/api/register/pin')} />
      )}
      {managerDialog}
    </div>
  );
}

function OpenDialog({ as, onClose, onOpen }: { as: 'tab' | 'table'; onClose: () => void; onOpen: (b: Record<string, unknown>) => Promise<unknown> }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={as === 'tab' ? 'New tab' : 'New table'} onClose={onClose}>
      <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); await onOpen(as === 'tab' ? { kind: 'tab', label: name } : { kind: 'table', spot: name }); setBusy(false); }}>
        <label className={LABEL} htmlFor="open-name">{as === 'tab' ? 'Whose tab?' : 'Which table?'}</label>
        <input id="open-name" className={`${INPUT} mt-1`} autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={as === 'tab' ? 'Mike' : 'Booth 2'} />
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className={`${BTN} ${OFF}`} onClick={onClose}>Cancel</button>
          <button type="submit" className={`${BTN} ${ON}`} disabled={busy || !name.trim()}>Open</button>
        </div>
      </form>
    </Dialog>
  );
}

function PriceDialog({ item, onClose, onRing }: { item: MenuItem; onClose: () => void; onRing: (cents: number) => void }) {
  const [typed, setTyped] = useState('');
  const cents = centsFrom(typed);
  return (
    <Dialog title={item.name} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (cents !== null) onRing(cents); }}>
        <p className={`text-sm mb-2 ${MUTED}`}>No price on file. Enter tonight's price.</p>
        <label className={LABEL} htmlFor="open-price">Price ($)</label>
        <input id="open-price" className={`${INPUT} mt-1`} inputMode="decimal" autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="12.50" />
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className={`${BTN} ${OFF}`} onClick={onClose}>Cancel</button>
          <button type="submit" className={`${BTN} ${ON}`} disabled={cents === null}>Ring {cents !== null ? money(cents) : ''}</button>
        </div>
      </form>
    </Dialog>
  );
}

function PayDialog({ check, result, onClose, onPay, giftCards }: { check: Check; result: { changeCents: number | null; giftCard: { code: string; balanceCents: number } | null } | null; onClose: () => void; onPay: (b: Record<string, unknown>) => Promise<boolean>; giftCards: boolean }) {
  const [tender, setTender] = useState<'cash' | 'card_external' | 'giftcard'>('card_external');
  const [cardCode, setCardCode] = useState('');
  const [cardBalance, setCardBalance] = useState<{ text: string; cents: number | null } | null>(null);
  const [amount, setAmount] = useState((check.totals.balanceCents / 100).toFixed(2));
  const [tip, setTip] = useState('');
  const [tendered, setTendered] = useState('');
  const [busy, setBusy] = useState(false);
  const amt = centsFrom(amount), tipC = centsFrom(tip) ?? 0, tend = centsFrom(tendered);
  const ways = [2, 3, 4];
  if (result) {
    return (
      <Dialog title="Paid" onClose={onClose}>
        {result.changeCents !== null && <p className="text-3xl font-bold text-gray-900 dark:text-slate-100 mb-2">Change {money(result.changeCents)}</p>}
        {result.giftCard && <p className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-2">{result.giftCard.code}: {money(result.giftCard.balanceCents)} left on the card</p>}
        <p className={`text-sm ${MUTED}`}>{check.status === 'paid' ? 'The check is paid and closed.' : `Still owed: ${money(check.totals.balanceCents)}`}</p>
        <div className="flex justify-end mt-4"><button className={`${BTN} ${ON}`} onClick={onClose}>Done</button></div>
      </Dialog>
    );
  }
  return (
    <Dialog title={`Pay #${check.number} ${check.label}`} onClose={onClose}>
      <form onSubmit={async (e) => {
        e.preventDefault(); if (amt === null) return; setBusy(true);
        await onPay(tender === 'giftcard'
          ? { tender, amountCents: amt, giftCardCode: cardCode }
          : { tender, amountCents: amt, tipCents: tipC, cashTenderedCents: tender === 'cash' && tend !== null ? tend : null });
        setBusy(false);
      }}>
        <div className={`grid ${giftCards ? 'grid-cols-3' : 'grid-cols-2'} gap-2 mb-3`}>
          <button type="button" className={`${BTN} ${tender === 'card_external' ? ON : OFF} inline-flex items-center justify-center gap-2`} aria-pressed={tender === 'card_external'} onClick={() => setTender('card_external')}><CreditCard className="w-4 h-4" />Card</button>
          <button type="button" className={`${BTN} ${tender === 'cash' ? ON : OFF} inline-flex items-center justify-center gap-2`} aria-pressed={tender === 'cash'} onClick={() => setTender('cash')}><Banknote className="w-4 h-4" />Cash</button>
          {giftCards && <button type="button" className={`${BTN} ${tender === 'giftcard' ? ON : OFF} inline-flex items-center justify-center gap-2`} aria-pressed={tender === 'giftcard'} onClick={() => setTender('giftcard')}><Gift className="w-4 h-4" />Gift card</button>}
        </div>
        {tender === 'card_external' && <p className={`text-sm mb-3 ${MUTED}`}>Run the card on the card reader first, then record it here.</p>}
        {tender === 'giftcard' && (
          <div className="mb-3">
            <label className={LABEL} htmlFor="pay-card">Gift card number</label>
            <div className="flex gap-2 mt-1">
              <input id="pay-card" className={INPUT} autoComplete="off" value={cardCode} onChange={(e) => { setCardCode(e.target.value); setCardBalance(null); }} placeholder="ABCD-7K2Q-9XMP" />
              <button type="button" className={`${BTN} ${OFF}`} disabled={!cardCode.trim()} onClick={async () => {
                try { const r = await api.get(`/api/gift-cards/lookup?code=${encodeURIComponent(cardCode)}`); setCardBalance({ text: r.status === 'active' ? `${money(r.balanceCents)} on ${r.code}` : `${r.code} was voided`, cents: r.status === 'active' ? r.balanceCents : null }); }
                catch (e) { setCardBalance({ text: errorText(e, 'Could not look that up.'), cents: null }); }
              }}>Balance</button>
            </div>
            {cardBalance && <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-slate-100">{cardBalance.text}</p>}
            <p className={`text-xs mt-1 ${MUTED}`}>Takes up to what is on the card; anything left is paid another way. No tip off a gift card.</p>
          </div>
        )}
        <label className={LABEL} htmlFor="pay-amount">Amount ($) — balance {money(check.totals.balanceCents)}</label>
        <input id="pay-amount" className={`${INPUT} mt-1`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <div className="flex flex-wrap gap-2 mt-2">
          <span className={`${LABEL} self-center`}>Split evenly</span>
          {ways.map((n) => {
            // The parts as they will really be paid: the odd cents go on the first ones ($24.79 two ways is
            // $12.40 + $12.39). The label used to show the rounded-up part alone, which never added up (Bar Run 1).
            const bal = check.totals.balanceCents, lo = Math.floor(bal / n), extra = bal - lo * n, hi = lo + (extra ? 1 : 0);
            const each = (cents: number, k: number) => `${k > 1 ? `${k} × ` : ''}${money(cents)}`;
            const label = extra ? `${each(hi, extra)} + ${each(lo, n - extra)}` : `${n} × ${money(lo)}`;
            return <button key={n} type="button" className={`${BTN} ${OFF} min-h-[40px]`} onClick={() => setAmount((hi / 100).toFixed(2))}>{n} ways · {label}</button>;
          })}
        </div>
        {tender !== 'giftcard' && (
          <>
            <label className={`${LABEL} block mt-3`} htmlFor="pay-tip">Tip ($)</label>
            <input id="pay-tip" className={`${INPUT} mt-1`} inputMode="decimal" value={tip} onChange={(e) => setTip(e.target.value)} placeholder="0.00" />
          </>
        )}
        {tender === 'cash' && (
          <>
            <label className={`${LABEL} block mt-3`} htmlFor="pay-tendered">Cash handed over ($)</label>
            <input id="pay-tendered" className={`${INPUT} mt-1`} inputMode="decimal" value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder="Leave blank if exact" />
            <div className="flex flex-wrap gap-2 mt-2">
              {check.quickCash.map((q) => <button key={q} type="button" className={`${BTN} ${OFF} min-h-[40px]`} onClick={() => setTendered((q / 100).toFixed(2))}>{money(q)}</button>)}
            </div>
            {amt !== null && tend !== null && <p className="mt-2 text-lg font-semibold text-gray-900 dark:text-slate-100">{tend >= amt + tipC ? `Change ${money(tend - amt - tipC)}` : 'Not enough cash'}</p>}
          </>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className={`${BTN} ${OFF}`} onClick={onClose}>Cancel</button>
          <button type="submit" className={`${BTN} ${ON}`} disabled={busy || amt === null || amt <= 0 || (tender === 'giftcard' && !cardCode.trim())}>Take {amt !== null ? money(tender === 'giftcard' ? amt : amt + tipC) : ''}</button>
        </div>
      </form>
    </Dialog>
  );
}

interface GuestHit { id: string; name: string; phone: string | null; email: string | null; isRegular: boolean; pointsBalance: number | null }

function GuestDialog({ regulars, current, onClose, onPick }: { regulars: boolean; current: string | null; onClose: () => void; onPick: (contactId: string | null) => Promise<void> }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<GuestHit[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); return; }
    const t = setTimeout(async () => {
      try { const r = await api.get(`/api/register/guests?q=${encodeURIComponent(term)}`); setHits(r.guests || []); setErr(''); }
      catch (e) { setErr(errorText(e, 'Could not search.')); }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <Dialog title="Guest on this check" onClose={onClose}>
      {!adding && (
        <>
          <label className={LABEL} htmlFor="guest-q">Phone number or name</label>
          <input id="guest-q" className={`${INPUT} mt-1`} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="715-555-0142" />
          <ul className="mt-2 space-y-1">
            {hits.map((g) => (
              <li key={g.id}>
                <button className={`w-full text-left rounded-xl border px-3 py-2 min-h-[48px] border-gray-200 bg-white text-gray-900 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800`} disabled={busy}
                  onClick={async () => { setBusy(true); await onPick(g.id); setBusy(false); }}>
                  <span className="font-semibold">{g.name}</span>
                  <span className={`block text-xs ${MUTED}`}>{[g.phone, g.isRegular ? (g.pointsBalance !== null ? `${g.pointsBalance} points` : 'Regular') : null].filter(Boolean).join(' · ')}</span>
                </button>
              </li>
            ))}
            {q.trim().length >= 2 && hits.length === 0 && <li className={`text-sm ${MUTED}`}>Nobody by that number or name.</li>}
          </ul>
          <FormError message={err} className="mt-2" />
          <div className="flex flex-wrap justify-end gap-2 mt-4">
            {current && <button className={`${BTN} ${OFF}`} disabled={busy} onClick={async () => { setBusy(true); await onPick(null); setBusy(false); }}>Take the guest off</button>}
            {regulars && <button className={`${BTN} ${ON} inline-flex items-center gap-2`} onClick={() => { setAdding(true); setPhone(/\d{3}/.test(q) ? q : ''); setName(/\d{3}/.test(q) ? '' : q); }}><UserPlus className="w-4 h-4" />Add a regular</button>}
          </div>
        </>
      )}
      {adding && (
        <form onSubmit={async (e) => {
          e.preventDefault(); setBusy(true); setErr('');
          try { const r = await api.post('/api/register/guests', { name, phone }); await onPick(r.guest.id); }
          catch (ex) { setErr(errorText(ex, 'That did not save.')); } finally { setBusy(false); }
        }}>
          <p className={`text-sm mb-2 ${MUTED}`}>A name and a phone number. If that number is already a guest, it is them — nothing about them is changed.</p>
          <label className={LABEL} htmlFor="reg-name">Name</label>
          <input id="reg-name" className={`${INPUT} mt-1`} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus />
          <label className={`${LABEL} block mt-3`} htmlFor="reg-phone">Phone</label>
          <input id="reg-phone" className={`${INPUT} mt-1`} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} aria-describedby="reg-phone-hint" />
          {/* The button waits for 10 digits (the server's rule, services/barLoyalty.ts addRegular); say so, or a 7-digit number just leaves it grey (Bar Run 1). */}
          <p id="reg-phone-hint" className={`text-xs mt-1 ${MUTED}`}>{(() => { const n = phone.replace(/\D/g, '').length; return n > 0 && n < 10 ? `With the area code: 10 digits (${n} so far).` : 'With the area code, e.g. 715-555-0142.'; })()}</p>
          <FormError message={err} className="mt-2" />
          <div className="flex justify-end gap-2 mt-4">
            <button type="button" className={`${BTN} ${OFF}`} onClick={() => setAdding(false)}>Back</button>
            <button type="submit" className={`${BTN} ${ON}`} disabled={busy || !name.trim() || phone.replace(/\D/g, '').length < 10}>Add and put on the check</button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function SellCardDialog({ onClose, onSell }: { onClose: () => void; onSell: (amountCents: number, code: string | null) => Promise<void> }) {
  const [typed, setTyped] = useState('25');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const cents = centsFrom(typed);
  return (
    <Dialog title="Sell a gift card" onClose={onClose}>
      <form onSubmit={async (e) => { e.preventDefault(); if (cents === null) return; setBusy(true); await onSell(cents, code.trim() || null); setBusy(false); }}>
        <div className="flex flex-wrap gap-2 mb-3">
          {[25, 50, 100].map((d) => <button key={d} type="button" className={`${BTN} ${typed === String(d) ? ON : OFF}`} onClick={() => setTyped(String(d))}>${d}</button>)}
        </div>
        <label className={LABEL} htmlFor="gc-amount">Amount ($5 to $500)</label>
        <input id="gc-amount" className={`${INPUT} mt-1`} inputMode="decimal" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <label className={`${LABEL} block mt-3`} htmlFor="gc-code">Card number (only for a pre-printed card)</label>
        <input id="gc-code" className={`${INPUT} mt-1`} autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Leave blank to make one" />
        <p className={`text-xs mt-2 ${MUTED}`}>It goes on this check and becomes a card when the check is paid. No expiry, no fees. It is not taxed — the food is, when the card is spent.</p>
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className={`${BTN} ${OFF}`} onClick={onClose}>Cancel</button>
          <button type="submit" className={`${BTN} ${ON}`} disabled={busy || cents === null}>Add {cents !== null ? money(cents) : ''}</button>
        </div>
      </form>
    </Dialog>
  );
}

function SplitDialog({ check, onClose, onSplit }: { check: Check; onClose: () => void; onSplit: (itemIds: string[], label: string) => Promise<void> }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [label, setLabel] = useState('');
  const movable = check.items.filter((l) => l.state !== 'void' && l.kind !== 'reward');
  return (
    <Dialog title="Split onto a new check" onClose={onClose}>
      <ul className="space-y-1 mb-3">
        {movable.map((l) => (
          <li key={l.id}>
            <label className="flex items-center gap-3 min-h-[44px] text-gray-900 dark:text-slate-100">
              <input type="checkbox" className="w-5 h-5" checked={picked.has(l.id)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(l.id); else n.delete(l.id); return n; })} />
              <span>{l.qty > 1 ? `${l.qty} × ` : ''}{l.name}{l.size ? ` (${l.size})` : ''} · {money(l.qty * l.unitPriceCents)}</span>
            </label>
          </li>
        ))}
      </ul>
      <label className={LABEL} htmlFor="split-label">Name for the new check</label>
      <input id="split-label" className={`${INPUT} mt-1`} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={`${check.label} (split)`} maxLength={40} />
      <div className="flex justify-end gap-2 mt-4">
        <button className={`${BTN} ${OFF}`} onClick={onClose}>Cancel</button>
        <button className={`${BTN} ${ON}`} disabled={!picked.size} onClick={() => onSplit([...picked], label)}>Move {picked.size || ''}</button>
      </div>
    </Dialog>
  );
}

function RenameDialog({ check, onClose, onSave }: { check: Check; onClose: () => void; onSave: (b: Record<string, unknown>) => Promise<void> }) {
  const [label, setLabel] = useState(check.label);
  const [spot, setSpot] = useState(check.spot || '');
  const [note, setNote] = useState(check.note || '');
  return (
    <Dialog title={`Check #${check.number}`} onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSave({ label, spot, note }); }}>
        <div><label className={LABEL} htmlFor="rn-label">Name</label><input id="rn-label" className={`${INPUT} mt-1`} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} /></div>
        <div><label className={LABEL} htmlFor="rn-spot">Where (bar seat, booth, table)</label><input id="rn-spot" className={`${INPUT} mt-1`} value={spot} onChange={(e) => setSpot(e.target.value)} maxLength={40} /></div>
        <div><label className={LABEL} htmlFor="rn-note">Note for the grill</label><input id="rn-note" className={`${INPUT} mt-1`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></div>
        <div className="flex justify-end gap-2">
          <button type="button" className={`${BTN} ${OFF}`} onClick={onClose}>Cancel</button>
          <button type="submit" className={`${BTN} ${ON}`} disabled={!label.trim()}>Save</button>
        </div>
      </form>
    </Dialog>
  );
}

function VoidDialog({ what, label, onClose, onVoid }: { what: 'item' | 'payment' | 'check'; label: string; onClose: () => void; onVoid: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const reasons = what === 'payment' ? ['Wrong check', 'Wrong amount', 'Card declined'] : ['Rang in wrong', 'Sent back', 'Walked out', 'Comp'];
  return (
    <Dialog title={`Void ${label}`} onClose={onClose}>
      <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); await onVoid(reason); setBusy(false); }}>
        <p className={`text-sm mb-2 ${MUTED}`}>It stays on the record with the reason and your name.</p>
        <div className="flex flex-wrap gap-2 mb-2">
          {reasons.map((r) => <button key={r} type="button" className={`${BTN} ${reason === r ? ON : OFF} min-h-[40px]`} onClick={() => setReason(r)}>{r}</button>)}
        </div>
        <label className={LABEL} htmlFor="void-reason">Reason</label>
        <input id="void-reason" className={`${INPUT} mt-1`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={80} />
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className={`${BTN} ${OFF}`} onClick={onClose}>Cancel</button>
          <button type="submit" className={`${BTN} ${DANGER}`} disabled={busy}>Void</button>
        </div>
      </form>
    </Dialog>
  );
}
