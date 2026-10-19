// Moved from templates/crm-bar/frontend/src/pages/bar/GiftCardsPage.tsx.
import { useCallback, useEffect, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { api } from '../../../api'
import FormError, { errorText } from '../../ui/FormError'
import { BTN, ON, OFF, DANGER, CARD, LABEL, INPUT, MUTED, money, centsFrom, Dialog } from './registerUi';

/**
 * GIFT CARDS — every card the bar has sold, what is still on each, and the total the bar owes its guests in food
 * and drink. A card is sold on the register and spent there as a tender; here a manager looks one up, reads its
 * ledger, corrects a balance (always with a reason) or voids a lost or stolen card. bar:manage, behind the
 * gift_cards feature (routes/barGiftCards.ts). No expiry and no fees, ever.
 */

interface Card { id: string; code: string; initialCents: number; balanceCents: number; status: string; soldVia: string; soldByName: string | null; recipientName: string | null; purchaserName: string | null; createdAt: string; voidReason: string | null }
interface Entry { id: string; amountCents: number; kind: string; byName: string | null; note: string | null; at: string }

const KIND: Record<string, string> = { issue: 'Sold', redeem: 'Spent', refund: 'Put back', adjust: 'Corrected', void: 'Voided' };

export default function GiftCardsPage() {
  const [data, setData] = useState<{ cards: Card[]; outstandingCents: number } | null>(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<{ card: Card; history: Entry[] } | null>(null);

  const load = useCallback(async (query = '') => {
    try { setData(await api.get(`/api/gift-cards${query ? `?q=${encodeURIComponent(query)}` : ''}`)); setErr(''); }
    catch (e) { setErr(errorText(e, 'Could not load the gift cards.')); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const show = async (id: string) => {
    try { setOpen(await api.get(`/api/gift-cards/${id}`)); } catch (e) { setErr(errorText(e, 'Could not load that card.')); }
  };

  if (!data) return <div className="flex justify-center py-16">{err ? <FormError message={err} /> : <Loader2 className="w-6 h-6 animate-spin text-gray-500 dark:text-slate-400" />}</div>;

  return (
    <div className="space-y-3 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Gift Cards</h1>
        <p className={`text-sm ${MUTED}`}>Sold on the register, spent like cash. No expiry, no fees.</p>
      </div>
      <FormError message={err} onDismiss={() => setErr('')} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className={CARD}><p className={LABEL}>Still owed on cards</p><p className="text-2xl font-bold text-gray-900 dark:text-slate-100 mt-1">{money(data.outstandingCents)}</p></div>
        <div className={CARD}><p className={LABEL}>Cards</p><p className="text-2xl font-bold text-gray-900 dark:text-slate-100 mt-1">{data.cards.length}</p></div>
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); load(q); }}>
        <label className="sr-only" htmlFor="gc-search">Find a card</label>
        <input id="gc-search" className={INPUT} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Card number or name" />
        <button type="submit" className={`${BTN} ${OFF} inline-flex items-center gap-2`}><Search className="w-4 h-4" />Find</button>
      </form>
      <div className={CARD}>
        {data.cards.length === 0 && <p className={`text-sm ${MUTED}`}>No gift cards yet. Sell one on the register.</p>}
        <ul className="divide-y divide-gray-200 dark:divide-slate-800">
          {data.cards.map((c) => (
            <li key={c.id}>
              <button className="w-full text-left py-3 flex items-center justify-between gap-3 hover:bg-gray-50 dark:hover:bg-slate-800 rounded-lg px-2" onClick={() => show(c.id)}>
                <span className="min-w-0">
                  <span className="block font-mono font-semibold text-gray-900 dark:text-slate-100">{c.code}</span>
                  <span className={`block text-xs ${MUTED}`}>{c.soldVia === 'online' ? 'Sold online' : `Sold by ${c.soldByName || '—'}`} · {new Date(c.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}{c.recipientName ? ` · for ${c.recipientName}` : ''}</span>
                </span>
                <span className="text-right">
                  <span className="block font-mono text-gray-900 dark:text-slate-100">{c.status === 'void' ? 'Voided' : money(c.balanceCents)}</span>
                  <span className={`block text-xs ${MUTED}`}>of {money(c.initialCents)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {open && <CardDialog data={open} onClose={() => setOpen(null)} onChanged={async () => { await show(open.card.id); await load(q); }} />}
    </div>
  );
}

function CardDialog({ data, onClose, onChanged }: { data: { card: Card; history: Entry[] }; onClose: () => void; onChanged: () => Promise<void> }) {
  const [delta, setDelta] = useState('');
  const [sign, setSign] = useState<1 | -1>(1);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const c = data.card;
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr('');
    try { await fn(); setDelta(''); setReason(''); await onChanged(); } catch (e) { setErr(errorText(e, 'That did not save.')); } finally { setBusy(false); }
  };
  const cents = centsFrom(delta);
  return (
    <Dialog title={c.code} onClose={onClose} wide>
      <p className="text-2xl font-bold text-gray-900 dark:text-slate-100">{c.status === 'void' ? 'Voided' : money(c.balanceCents)}</p>
      {c.voidReason && <p className={`text-sm ${MUTED}`}>{c.voidReason}</p>}
      <p className={`${LABEL} mt-4 mb-1`}>Its ledger</p>
      <ul className="text-sm divide-y divide-gray-200 dark:divide-slate-800">
        {data.history.map((h) => (
          <li key={h.id} className="py-2 flex justify-between gap-3 text-gray-900 dark:text-slate-100">
            <span>{KIND[h.kind] || h.kind}{h.byName ? ` · ${h.byName}` : ''}{h.note ? ` · ${h.note}` : ''}<span className={`block text-xs ${MUTED}`}>{new Date(h.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span></span>
            <span className="font-mono">{h.amountCents > 0 ? '+' : ''}{money(h.amountCents)}</span>
          </li>
        ))}
      </ul>
      {c.status === 'active' && (
        <div className="mt-4 space-y-2">
          <p className={LABEL}>Correct the balance</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`${BTN} ${sign === 1 ? ON : OFF}`} aria-pressed={sign === 1} onClick={() => setSign(1)}>Add</button>
            <button type="button" className={`${BTN} ${sign === -1 ? ON : OFF}`} aria-pressed={sign === -1} onClick={() => setSign(-1)}>Take off</button>
            <label className="sr-only" htmlFor="gc-delta">Amount ($)</label>
            <input id="gc-delta" className={`${INPUT} max-w-[140px]`} inputMode="decimal" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="5.00" />
          </div>
          <label className={LABEL} htmlFor="gc-reason">Why</label>
          <input id="gc-reason" className={INPUT} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={120} placeholder="Went through the wash" />
          <FormError message={err} />
          <div className="flex flex-wrap justify-end gap-2">
            <button className={`${BTN} ${DANGER}`} disabled={busy || !reason.trim()} onClick={() => run(() => api.post(`/api/gift-cards/${c.id}/void`, { reason }))}>Void the card</button>
            <button className={`${BTN} ${ON}`} disabled={busy || !cents || !reason.trim()} onClick={() => run(() => api.post(`/api/gift-cards/${c.id}/adjust`, { deltaCents: sign * (cents || 0), reason }))}>Save the correction</button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
