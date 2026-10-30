// Gift cards (server crm/salon/giftCards.ts, /api/salon-gift-cards; hidden feature `salon_gift_cards`):
//   · the Gift cards page — what the salon owes on cards, sell one, look one up, correct or void it;
//   · the "Pay with a gift card" panel beside a sale (invoiceAside.tsx).
// A card is sold as a paid sale at the desk and spent as a payment on any sale. Every change is on the card's own history.
import { useCallback, useEffect, useState } from 'react'
import { Gift, Loader2, Plus, Search } from 'lucide-react'
import { api, useAuth, useToast, usePermissions, useConfirm, usePrompt, money } from '../../../shared'
import { Button, Field, Modal, inputCls } from '@twomiah/tenant-ui/src/invoicing/ui'
import { momentDate } from '@twomiah/tenant-ui/src/time/companyClock'
import ClientPicker from './ClientPicker'

const box = 'rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900'
const cents = (c: number) => money(c / 100)
const last4 = (code: string) => code.replace(/[^A-Z0-9]/g, '').slice(-4)

interface Card { id: string; code: string; initialCents: number; balanceCents: number; status: 'active' | 'void'; invoiceId: string | null; purchaserName: string | null; recipientName: string | null; recipientEmail: string | null; message: string | null; soldByName: string | null; createdAt: string; voidReason: string | null }
interface Entry { id: string; kind: string; amountCents: number; byName: string | null; note: string | null; at: string }
const KIND_WORDS: Record<string, string> = { issue: 'Sold', redeem: 'Spent on a sale', refund: 'Put back by a refund', adjust: 'Corrected', void: 'Voided' }
const METHODS = [{ value: 'cash', label: 'Cash' }, { value: 'card', label: 'Card (taken on the machine at the desk)' }, { value: 'check', label: 'Cheque' }, { value: 'other', label: 'Other' }]

export default function GiftCardsPage() {
  const { can, known } = usePermissions()
  const maySell = known && can('invoices:create') && can('invoices:update')
  const [cards, setCards] = useState<Card[] | null>(null)
  const [owed, setOwed] = useState(0)
  const [q, setQ] = useState('')
  const [loadError, setLoadError] = useState('')
  const [selling, setSelling] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback((search = '') => {
    api.get(`/api/salon-gift-cards${search ? `?q=${encodeURIComponent(search)}` : ''}`)
      .then((r: { cards: Card[]; outstandingCents: number }) => { setCards(r.cards); setOwed(r.outstandingCents); setLoadError('') })
      .catch((e: Error) => setLoadError(e.message || 'The gift cards could not be loaded.'))
  }, [])
  useEffect(() => { const h = setTimeout(() => load(q), q ? 250 : 0); return () => clearTimeout(h) }, [q, load])

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white"><Gift className="h-6 w-6 text-teal-700 dark:text-teal-300" aria-hidden="true" /> Gift cards</h1>
          <p className="mt-1 text-gray-600 dark:text-slate-300">Your own gift cards. Sold at the desk, spent like cash on any sale, no expiry and no fees.</p>
        </div>
        {maySell && <Button onClick={() => setSelling(true)}><Plus className="mr-2 inline h-4 w-4" aria-hidden="true" />Sell a gift card</Button>}
      </div>

      <section className={box} aria-label="What is owed on gift cards">
        <p className="text-sm text-gray-600 dark:text-slate-300">Still to be spent on active cards</p>
        <p className="text-3xl font-bold text-gray-900 dark:text-white" data-testid="gift-owed">{cents(owed)}</p>
      </section>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-500 dark:text-slate-300" aria-hidden="true" />
        <input aria-label="Find a gift card" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find by card number or name" className={inputCls + ' pl-9'} />
      </div>

      {loadError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{loadError}</div>}
      {!cards && !loadError && <div className="flex h-32 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-gray-500 dark:text-slate-300" /></div>}
      {cards && cards.length === 0 && <p className="text-gray-600 dark:text-slate-300">{q ? 'No gift card matches that.' : 'No gift cards sold yet.'}</p>}
      {cards && cards.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-700 dark:bg-slate-800 dark:text-slate-200">
              <tr><th className="px-4 py-2">Card</th><th className="px-4 py-2">For</th><th className="px-4 py-2">Sold</th><th className="px-4 py-2 text-right">Value</th><th className="px-4 py-2 text-right">Left</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
              {cards.map((c) => (
                <tr key={c.id} className="text-gray-900 dark:text-slate-100">
                  <td className="px-4 py-2"><button className="font-medium text-teal-800 underline dark:text-teal-200" onClick={() => setOpen(c.id)}>Card ending {last4(c.code)}</button>{c.status === 'void' && <span className="ml-2 rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-800 dark:bg-slate-700 dark:text-slate-100">Voided</span>}</td>
                  <td className="px-4 py-2">{c.recipientName || c.purchaserName || '—'}</td>
                  <td className="px-4 py-2">{momentDate(c.createdAt)}</td>
                  <td className="px-4 py-2 text-right">{cents(c.initialCents)}</td>
                  <td className="px-4 py-2 text-right font-medium">{cents(c.balanceCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selling && <SellModal onClose={() => setSelling(false)} onSold={() => { load(q) }} />}
      {open && <CardModal id={open} onClose={() => setOpen(null)} onChanged={() => load(q)} />}
    </div>
  )
}

function SellModal({ onClose, onSold }: { onClose: () => void; onSold: () => void }) {
  const toast = useToast()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('cash')
  const [contactId, setContactId] = useState('')
  const [f, setF] = useState({ purchaserName: '', purchaserEmail: '', recipientName: '', recipientEmail: '', message: '' })
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState('')
  const [done, setDone] = useState<{ code: string; emailed: boolean; amountCents: number } | null>(null)
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }))

  const submit = async () => {
    const dollars = Number(amount)
    if (!Number.isFinite(dollars) || dollars <= 0) { setErrors({ amount: 'Enter the amount of the gift card.' }); return }
    setBusy(true); setErrors({}); setProblem('')
    try {
      const r = await api.post('/api/salon-gift-cards/sell', { amountCents: Math.round(dollars * 100), method, contactId: contactId || undefined, ...f })
      setDone({ code: r.card.code, emailed: !!r.emailed, amountCents: r.card.initialCents })
      onSold()
    } catch (e: any) {
      setErrors(e?.data?.fields || {}); setProblem(e?.message || 'The gift card could not be sold.')
    } finally { setBusy(false) }
  }

  if (done) {
    return (
      <Modal isOpen onClose={onClose} title="Gift card sold" size="md">
        <div className="space-y-3 text-gray-900 dark:text-slate-100">
          <p>A {cents(done.amountCents)} gift card was sold and paid for.</p>
          <p className="text-sm text-gray-600 dark:text-slate-300">Gift card number — give or read this to the person who will spend it:</p>
          <p className="rounded-lg bg-gray-100 p-3 text-center text-2xl font-bold tracking-wider dark:bg-slate-800" data-testid="gift-code">{done.code}</p>
          <p className="text-sm text-gray-700 dark:text-slate-300">{done.emailed ? 'It was also emailed to the recipient.' : 'Nothing was emailed. Write it on the card or message it yourself.'}</p>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => { void navigator.clipboard?.writeText(done.code).then(() => toast.success('Copied'), () => toast.error('Could not copy')) }}>Copy number</Button><Button onClick={onClose}>Done</Button></div>
        </div>
      </Modal>
    )
  }
  return (
    <Modal isOpen onClose={onClose} title="Sell a gift card" size="md" dirty={!!(amount || f.purchaserName || f.recipientName || f.message)}>
      <div className="space-y-3">
        {problem && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{problem}</div>}
        <Field label="Amount ($)">
          <div className="flex flex-wrap items-center gap-2">
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls + ' max-w-[9rem]'} aria-invalid={!!errors.amount} aria-label="Amount" />
            {[25, 50, 100].map((n) => <button key={n} type="button" className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800" onClick={() => setAmount(String(n))}>${n}</button>)}
          </div>
          {errors.amount && <span role="alert" className="text-xs text-red-700 dark:text-red-300">{errors.amount}</span>}
        </Field>
        <Field label="How was it paid?"><select value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls}>{METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></Field>
        <Field label="Bought by (a client, if they are one)"><ClientPicker value={contactId} onChange={(id, c) => { setContactId(id); if (c && !f.purchaserName) set('purchaserName', c.name || [c.firstName, c.lastName].filter(Boolean).join(' ')) }} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Buyer's name"><input value={f.purchaserName} onChange={(e) => set('purchaserName', e.target.value)} className={inputCls} /></Field>
          <Field label="Recipient's name"><input value={f.recipientName} onChange={(e) => set('recipientName', e.target.value)} className={inputCls} /></Field>
        </div>
        <Field label="Recipient's email (optional)" hint="If you add one, the gift card number is emailed to them.">
          <input type="email" value={f.recipientEmail} onChange={(e) => set('recipientEmail', e.target.value)} className={inputCls} aria-invalid={!!errors.recipientEmail} />
        </Field>
        <Field label="Message (optional)"><textarea rows={2} maxLength={400} value={f.message} onChange={(e) => set('message', e.target.value)} className={inputCls} /></Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={busy}>{busy ? 'Selling…' : 'Sell gift card'}</Button></div>
      </div>
    </Modal>
  )
}

function CardModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const prompt = usePrompt()
  const { can, known } = usePermissions()
  const mayFix = known && can('payments:delete')
  const [d, setD] = useState<{ card: Card; history: Entry[] } | null>(null)
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => { api.get(`/api/salon-gift-cards/${id}`).then(setD).catch((e: Error) => setProblem(e.message || 'That card could not be loaded.')) }, [id])
  useEffect(load, [load])

  const adjust = async () => {
    const amt = await prompt('How many dollars to add (or take off, with a minus sign)?', { title: 'Correct the balance', confirmText: 'Next' })
    if (amt == null) return
    const dollars = Number(amt)
    if (!Number.isFinite(dollars) || dollars === 0) { toast.error('Enter an amount such as 5 or -5.'); return }
    const why = await prompt('Why is the balance being corrected?', { title: 'Reason', confirmText: 'Correct balance' })
    if (!why) return
    setBusy(true)
    try { await api.post(`/api/salon-gift-cards/${id}/adjust`, { deltaCents: Math.round(dollars * 100), reason: why }); toast.success('Balance corrected'); load(); onChanged() }
    catch (e: any) { toast.error(e?.message || 'That did not save.') } finally { setBusy(false) }
  }
  const voidIt = async () => {
    const why = await prompt('Why is this card being voided? Its remaining balance goes to nothing.', { title: 'Void this gift card', confirmText: 'Void card' })
    if (!why) return
    if (!(await confirm('Void this gift card? This cannot be undone.', { title: 'Void gift card', confirmText: 'Void card' }))) return
    setBusy(true)
    try { await api.post(`/api/salon-gift-cards/${id}/void`, { reason: why }); toast.success('Gift card voided'); load(); onChanged() }
    catch (e: any) { toast.error(e?.message || 'That did not save.') } finally { setBusy(false) }
  }

  return (
    <Modal isOpen onClose={onClose} title={d ? `Gift card ending ${last4(d.card.code)}` : 'Gift card'} size="lg">
      {problem && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{problem}</div>}
      {!d && !problem && <div className="flex h-24 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-gray-500 dark:text-slate-300" /></div>}
      {d && (
        <div className="space-y-4 text-gray-900 dark:text-slate-100">
          <div>
            <p className="text-sm text-gray-600 dark:text-slate-300">Card number</p>
            <p className="text-lg font-semibold tracking-wider">{d.card.code}</p>
            <p className="mt-2 text-sm text-gray-600 dark:text-slate-300">Left on it</p>
            <p className="text-3xl font-bold">{cents(d.card.balanceCents)} <span className="text-base font-normal text-gray-600 dark:text-slate-300">of {cents(d.card.initialCents)}{d.card.status === 'void' ? ' · voided' : ''}</span></p>
            {d.card.voidReason && <p className="text-sm text-gray-700 dark:text-slate-300">{d.card.voidReason}</p>}
            <p className="mt-2 text-sm text-gray-700 dark:text-slate-300">{[d.card.purchaserName && `Bought by ${d.card.purchaserName}`, d.card.recipientName && `for ${d.card.recipientName}`, d.card.soldByName && `sold by ${d.card.soldByName}`].filter(Boolean).join(' · ')}</p>
            {d.card.message && <p className="mt-1 text-sm italic text-gray-700 dark:text-slate-300">“{d.card.message}”</p>}
          </div>
          <div>
            <h3 className="text-sm font-semibold">History</h3>
            <ul className="mt-1 divide-y divide-gray-100 text-sm dark:divide-slate-800">
              {d.history.map((h) => (
                <li key={h.id} className="flex justify-between gap-3 py-1.5">
                  <span>{KIND_WORDS[h.kind] || h.kind}{h.byName ? ` — ${h.byName}` : ''}{h.note ? ` (${h.note})` : ''}<span className="block text-xs text-gray-600 dark:text-slate-400">{momentDate(h.at)}</span></span>
                  <span className={h.amountCents < 0 ? 'text-gray-900 dark:text-slate-100' : 'text-green-800 dark:text-green-300'}>{h.amountCents < 0 ? '−' : '+'}{cents(Math.abs(h.amountCents))}</span>
                </li>
              ))}
            </ul>
          </div>
          {mayFix && d.card.status === 'active' && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={adjust} disabled={busy}>Correct the balance</Button>
              <Button variant="secondary" onClick={voidIt} disabled={busy}>Void this card</Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

/**
 * Beside a sale that is still owing: type the card's number, see what is on it, apply it. The server takes it off the card inside
 * the payment, so a stale balance on this screen can never overspend a card.
 */
export function GiftCardPayPanel({ invoiceId, status, balance, reload }: { invoiceId: string; status: string; balance?: number | null; reload?: () => void }) {
  const toast = useToast()
  const { hasFeature } = useAuth()
  const { can, known } = usePermissions()
  const [code, setCode] = useState('')
  const [card, setCard] = useState<{ balanceCents: number; status: string; code: string } | null>(null)
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const owing = balance == null ? status !== 'paid' : Number(balance) > 0.005
  if (!hasFeature('salon_gift_cards') || !(known && can('invoices:update')) || status === 'void' || status === 'draft' || !owing) return null

  const look = async () => {
    setProblem(''); setCard(null); setBusy(true)
    try { setCard(await api.get(`/api/salon-gift-cards/lookup?code=${encodeURIComponent(code)}`)) } catch (e: any) { setProblem(e?.message || 'No gift card with that number.') } finally { setBusy(false) }
  }
  const apply = async () => {
    setBusy(true); setProblem('')
    try {
      const r = await api.post('/api/salon-gift-cards/redeem', { code, invoiceId })
      toast.success(`${cents(r.appliedCents)} taken off the gift card — ${cents(r.balanceCents)} left on it`)
      setCode(''); setCard(null); reload?.()
    } catch (e: any) { setProblem(e?.message || 'The gift card could not be applied.') } finally { setBusy(false) }
  }
  return (
    <section aria-label="Pay with a gift card" className="rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900" data-testid="gift-pay-panel">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-slate-100"><Gift className="h-4 w-4 text-teal-700 dark:text-teal-300" aria-hidden="true" />Pay with a gift card</h2>
      <div className="mt-2 flex gap-2">
        <input aria-label="Gift card number" value={code} onChange={(e) => { setCode(e.target.value); setCard(null) }} onKeyDown={(e) => { if (e.key === 'Enter' && code.trim()) void look() }} placeholder="Card number" className={inputCls} />
        <Button variant="secondary" onClick={look} disabled={busy || !code.trim()}>Check</Button>
      </div>
      {problem && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{problem}</p>}
      {card && (
        <div className="mt-2 text-sm text-gray-900 dark:text-slate-100">
          {card.status !== 'active' ? <p>That card was voided.</p> : card.balanceCents <= 0 ? <p>That card has nothing left on it.</p> : (
            <>
              <p>{cents(card.balanceCents)} on the card. It pays as much of this sale as it can.</p>
              <Button className="mt-2" onClick={apply} disabled={busy}>{busy ? 'Applying…' : 'Apply gift card'}</Button>
            </>
          )}
        </div>
      )}
    </section>
  )
}
