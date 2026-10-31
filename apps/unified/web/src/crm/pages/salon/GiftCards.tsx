// Gift cards (server crm/salon/giftCards.ts, /api/salon-gift-cards; hidden feature `salon_gift_cards`):
//   · the Gift cards page — what the salon owes on cards, sell one, look one up, correct or void it;
//   · the "Pay with a gift card" panel beside a sale (invoiceAside.tsx).
// A card is sold as a paid sale at the desk and spent as a payment on any sale. Every change is on the card's own history.
import { useCallback, useEffect, useState } from 'react'
import { Gift, Loader2, Plus, Search, Settings as Cog } from 'lucide-react'
import { api, useAuth, useToast, usePermissions, useConfirm, usePrompt, money } from '../../../shared'
import { Button, Field, Modal, inputCls } from '@twomiah/tenant-ui/src/invoicing/ui'
import { momentDate } from '@twomiah/tenant-ui/src/time/companyClock'
import ClientPicker from './ClientPicker'
import { ChairCheckoutPanel } from './ChairCheckout'

const box = 'rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900'
const cents = (c: number) => money(c / 100)
const last4 = (code: string) => code.replace(/[^A-Z0-9]/g, '').slice(-4)

interface Card { id: string; code: string; initialCents: number; balanceCents: number; status: 'active' | 'void' | 'pending'; invoiceId: string | null; purchaserName: string | null; recipientName: string | null; recipientEmail: string | null; message: string | null; soldByName: string | null; createdAt: string; voidReason: string | null
  spendableCents: number; paidCents: number; bonusCents: number; bonusGrantedCents: number; bonusExpiresOn: string | null; bonusExpired: boolean; deliverOn: string | null; deliveredAt: string | null; source: string }
interface Offer { id: string; buyCents: number; bonusCents: number; validDays: number | null }
interface Entry { id: string; kind: string; amountCents: number; byName: string | null; note: string | null; at: string }
const KIND_WORDS: Record<string, string> = { issue: 'Sold', redeem: 'Spent on a sale', refund: 'Put back by a refund', adjust: 'Corrected', void: 'Voided', bonus: 'Free bonus added', bonus_expired: 'Free bonus ended', reload: 'Reloaded', extend: 'Bonus last day extended' }
const METHODS = [{ value: 'cash', label: 'Cash' }, { value: 'card', label: 'Card (taken on the machine at the desk)' }, { value: 'check', label: 'Cheque' }, { value: 'other', label: 'Other' }]

export default function GiftCardsPage() {
  const { can, known } = usePermissions()
  // The front desk sells and takes cards with its own right (giftcards:sell); the server asks the same.
  const maySell = known && (can('giftcards:sell') || (can('invoices:create') && can('invoices:update')))
  const [cards, setCards] = useState<Card[] | null>(null)
  const [owed, setOwed] = useState(0)
  const [q, setQ] = useState('')
  const [loadError, setLoadError] = useState('')
  const [selling, setSelling] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [readerSale, setReaderSale] = useState(false)
  const [setup, setSetup] = useState(false)
  const mayConfigure = known && can('company:update')

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
          <p className="mt-1 text-gray-600 dark:text-slate-300">Your own gift cards. Sold at the desk, on the card reader or on your website, spent like cash on any sale. The money paid for a card never expires; a free bonus ("buy $100, get $20") can have a last day.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {mayConfigure && <Button variant="secondary" onClick={() => setSetup(true)}><Cog className="mr-2 inline h-4 w-4" aria-hidden="true" />Offers and online sales</Button>}
          {maySell && <Button variant="secondary" onClick={() => setReaderSale(true)}>Sell on the card reader</Button>}
          {maySell && <Button onClick={() => setSelling(true)}><Plus className="mr-2 inline h-4 w-4" aria-hidden="true" />Sell a gift card</Button>}
        </div>
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
                  <td className="px-4 py-2"><button className="font-medium text-teal-800 underline dark:text-teal-200" onClick={() => setOpen(c.id)}>Card ending {last4(c.code)}</button>{c.status === 'pending' && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">Waiting for payment</span>}{c.status === 'void' && <span className="ml-2 rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-800 dark:bg-slate-700 dark:text-slate-100">Voided</span>}</td>
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
      {setup && <SettingsModal onClose={() => setSetup(false)} />}
      {readerSale && <ReaderSaleModal onClose={() => setReaderSale(false)} onChanged={() => load(q)} />}
      {selling && <SellModal onClose={() => setSelling(false)} onSold={() => { load(q) }} />}
      {open && <CardModal id={open} onClose={() => setOpen(null)} onChanged={() => load(q)} />}
    </div>
  )
}

function useOffers() {
  const [offers, setOffers] = useState<Offer[]>([])
  useEffect(() => { api.get('/api/salon-gift-cards/settings').then((r: { offers: Offer[] }) => setOffers(r.offers || [])).catch(() => setOffers([])) }, [])
  return offers
}
const offerWords = (o: Offer) => `Pay ${cents(o.buyCents)}, get ${cents(o.bonusCents)} free${o.validDays ? ` (bonus lasts ${o.validDays} days)` : ''}`

function SellModal({ onClose, onSold }: { onClose: () => void; onSold: () => void }) {
  const toast = useToast()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('cash')
  const [contactId, setContactId] = useState('')
  const [f, setF] = useState({ purchaserName: '', purchaserEmail: '', recipientName: '', recipientEmail: '', message: '' })
  const offers = useOffers()
  const [offerId, setOfferId] = useState('')
  const [deliverOn, setDeliverOn] = useState('')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState('')
  const [done, setDone] = useState<{ code: string; emailed: boolean; scheduled: string | null; amountCents: number; bonusCents: number } | null>(null)
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }))

  const submit = async () => {
    const dollars = Number(amount)
    if (!Number.isFinite(dollars) || dollars <= 0) { setErrors({ amount: 'Enter the amount of the gift card.' }); return }
    setBusy(true); setErrors({}); setProblem('')
    try {
      const r = await api.post('/api/salon-gift-cards/sell', { amountCents: Math.round(dollars * 100), method, contactId: contactId || undefined, offerId: offerId || undefined, deliverOn: deliverOn || undefined, ...f })
      setDone({ code: r.card.code, emailed: !!r.emailed, scheduled: r.scheduled || null, amountCents: r.card.initialCents, bonusCents: r.card.bonusCents })
      onSold()
    } catch (e: any) {
      setErrors(e?.data?.fields || {}); setProblem(e?.message || 'The gift card could not be sold.')
    } finally { setBusy(false) }
  }

  if (done) {
    return (
      <Modal isOpen onClose={onClose} title="Gift card sold" size="md">
        <div className="space-y-3 text-gray-900 dark:text-slate-100">
          <p>A {cents(done.amountCents)} gift card was sold and paid for{done.bonusCents > 0 ? `, with a free ${cents(done.bonusCents)} bonus on top` : ''}.</p>
          <p className="text-sm text-gray-600 dark:text-slate-300">Gift card number — give or read this to the person who will spend it:</p>
          <p className="rounded-lg bg-gray-100 p-3 text-center text-2xl font-bold tracking-wider dark:bg-slate-800" data-testid="gift-code">{done.code}</p>
          <p className="text-sm text-gray-700 dark:text-slate-300">{done.emailed ? 'It was also emailed to the recipient.' : done.scheduled ? `It will be emailed to the recipient on ${momentDate(done.scheduled)}.` : 'Nothing was emailed. Write it on the card or message it yourself.'}</p>
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
        {offers.length > 0 && (
          <Field label="Offer" hint="The free bonus is added to the card; only the amount paid is the sale.">
            <select value={offerId} onChange={(e) => { setOfferId(e.target.value); const o = offers.find((x) => x.id === e.target.value); if (o) setAmount(String(o.buyCents / 100)) }} className={inputCls} aria-label="Offer">
              <option value="">No offer</option>
              {offers.map((o) => <option key={o.id} value={o.id}>{offerWords(o)}</option>)}
            </select>
          </Field>
        )}
        <Field label="How was it paid?"><select value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls}>{METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></Field>
        <Field label="Bought by (a client, if they are one)"><ClientPicker value={contactId} onChange={(id, c) => { setContactId(id); if (c && !f.purchaserName) set('purchaserName', c.name || [c.firstName, c.lastName].filter(Boolean).join(' ')) }} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Buyer's name"><input value={f.purchaserName} onChange={(e) => set('purchaserName', e.target.value)} className={inputCls} /></Field>
          <Field label="Recipient's name"><input value={f.recipientName} onChange={(e) => set('recipientName', e.target.value)} className={inputCls} /></Field>
        </div>
        <Field label="Recipient's email (optional)" hint="If you add one, the gift card number is emailed to them.">
          <input type="email" value={f.recipientEmail} onChange={(e) => set('recipientEmail', e.target.value)} className={inputCls} aria-invalid={!!errors.recipientEmail} />
        </Field>
        <Field label="Send it on (optional)" hint="Leave empty to email it now. Needs the recipient's email.">
          <input type="date" value={deliverOn} onChange={(e) => setDeliverOn(e.target.value)} className={inputCls} aria-label="Send on" aria-invalid={!!errors.deliverOn} />
          {errors.deliverOn && <span role="alert" className="text-xs text-red-700 dark:text-red-300">{errors.deliverOn}</span>}
        </Field>
        <Field label="Message (optional)"><textarea rows={2} maxLength={400} value={f.message} onChange={(e) => set('message', e.target.value)} className={inputCls} /></Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={busy}>{busy ? 'Selling…' : 'Sell gift card'}</Button></div>
      </div>
    </Modal>
  )
}

function ReaderSaleModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const offers = useOffers()
  const [amount, setAmount] = useState('')
  const [offerId, setOfferId] = useState('')
  const [email, setEmail] = useState('')
  const [made, setMade] = useState<{ invoiceId: string; cents: number } | null>(null)
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const start = async () => {
    const dollars = Number(amount)
    if (!Number.isFinite(dollars) || dollars <= 0) { setProblem('Enter the amount of the gift card.'); return }
    setBusy(true); setProblem('')
    try {
      const r = await api.post('/api/salon-gift-cards/reader-sale', { amountCents: Math.round(dollars * 100), offerId: offerId || undefined, recipientEmail: email || undefined })
      setMade({ invoiceId: r.invoiceId, cents: r.card.initialCents }); onChanged()
    } catch (e: any) { setProblem(e?.message || 'The gift card could not be started.') } finally { setBusy(false) }
  }
  return (
    <Modal isOpen onClose={onClose} title="Sell a gift card on the card reader" size="md">
      <div className="space-y-3 text-gray-900 dark:text-slate-100">
        {!made ? (
          <>
            {problem && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{problem}</div>}
            {offers.length > 0 && (
              <Field label="Offer"><select value={offerId} onChange={(e) => { setOfferId(e.target.value); const o = offers.find((x) => x.id === e.target.value); if (o) setAmount(String(o.buyCents / 100)) }} className={inputCls} aria-label="Offer"><option value="">No offer</option>{offers.map((o) => <option key={o.id} value={o.id}>{offerWords(o)}</option>)}</select></Field>
            )}
            <Field label="Amount ($)"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls + ' max-w-[9rem]'} aria-label="Amount" /></Field>
            <Field label="Recipient's email (optional)" hint="The card number is emailed here once the reader has taken the payment."><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} /></Field>
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={start} disabled={busy}>{busy ? 'Starting…' : 'Continue to the reader'}</Button></div>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-700 dark:text-slate-300">The card is live as soon as the reader takes the payment. Until then it holds nothing and cannot be spent.</p>
            <ChairCheckoutPanel invoiceId={made.invoiceId} status="open" balance={made.cents / 100} reload={onChanged} />
            <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Close</Button></div>
          </>
        )}
      </div>
    </Modal>
  )
}

function SettingsModal({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const [online, setOnline] = useState(false)
  const [rows, setRows] = useState<Array<{ buy: string; bonus: string; days: string }>>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  useEffect(() => {
    api.get('/api/salon-gift-cards/settings').then((r: { online: boolean; offers: Offer[] }) => {
      setOnline(!!r.online); setRows(r.offers.map((o) => ({ buy: String(o.buyCents / 100), bonus: String(o.bonusCents / 100), days: o.validDays ? String(o.validDays) : '' }))); setLoaded(true)
    }).catch((e: Error) => setProblem(e.message || 'The settings could not be loaded.'))
  }, [])
  const upd = (i: number, k: 'buy' | 'bonus' | 'days', v: string) => setRows((p) => p.map((r, j) => j === i ? { ...r, [k]: v } : r))
  const save = async () => {
    setBusy(true); setProblem('')
    try {
      const offers = rows.map((r) => ({ buyCents: Math.round(Number(r.buy) * 100), bonusCents: Math.round(Number(r.bonus) * 100), validDays: r.days ? Number(r.days) : null }))
      await api.put('/api/salon-gift-cards/settings', { online, offers })
      toast.success('Gift card settings saved'); onClose()
    } catch (e: any) { setProblem(e?.data?.fields?.offers || e?.message || 'That did not save.') } finally { setBusy(false) }
  }
  return (
    <Modal isOpen onClose={onClose} title="Offers and online sales" size="lg">
      <div className="space-y-4 text-gray-900 dark:text-slate-100">
        {problem && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{problem}</div>}
        {!loaded && !problem && <Loader2 className="h-6 w-6 animate-spin text-gray-500 dark:text-slate-300" />}
        {loaded && (
          <>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={online} onChange={(e) => setOnline(e.target.checked)} /><span><strong>Sell gift cards on my website.</strong> Buyers pay on Stripe's page into your own account; the card is emailed once it is paid. Your page is at <code>/api/gift-shop</code> and the balance check at <code>/api/gift-balance</code> on your booking address.</span></label>
            <div>
              <h3 className="text-sm font-semibold">"Buy this much, get this much free"</h3>
              <p className="text-xs text-gray-600 dark:text-slate-300">The money a buyer pays never expires. Only the free bonus can have a last day; leave the days empty for none.</p>
              {rows.map((r, i) => (
                <div key={i} className="mt-2 flex flex-wrap items-end gap-2">
                  <label className="text-xs">Buyer pays ($)<input inputMode="decimal" value={r.buy} onChange={(e) => upd(i, 'buy', e.target.value)} className={inputCls + ' w-24'} aria-label={`Offer ${i + 1} buyer pays`} /></label>
                  <label className="text-xs">Free bonus ($)<input inputMode="decimal" value={r.bonus} onChange={(e) => upd(i, 'bonus', e.target.value)} className={inputCls + ' w-24'} aria-label={`Offer ${i + 1} free bonus`} /></label>
                  <label className="text-xs">Bonus lasts (days)<input inputMode="numeric" value={r.days} onChange={(e) => upd(i, 'days', e.target.value)} className={inputCls + ' w-24'} aria-label={`Offer ${i + 1} days`} /></label>
                  <Button variant="secondary" onClick={() => setRows((p) => p.filter((_, j) => j !== i))}>Remove</Button>
                </div>
              ))}
              <Button className="mt-2" variant="secondary" onClick={() => setRows((p) => [...p, { buy: '', bonus: '', days: '' }])}>Add an offer</Button>
            </div>
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button></div>
          </>
        )}
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
  const maySell = known && (can('giftcards:sell') || (can('invoices:create') && can('invoices:update')))
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
  const reload = async () => {
    const amt = await prompt('How many dollars are being added to the card?', { title: 'Reload this gift card', confirmText: 'Next' })
    if (amt == null) return
    const dollars = Number(amt)
    if (!Number.isFinite(dollars) || dollars <= 0) { toast.error('Enter an amount such as 25.'); return }
    const how = await prompt('How was it paid? Type cash, card, check or other.', { title: 'Payment', confirmText: 'Reload card', initialValue: 'cash' })
    if (!how) return
    setBusy(true)
    try { await api.post(`/api/salon-gift-cards/${id}/reload`, { amountCents: Math.round(dollars * 100), method: how.trim().toLowerCase() }); toast.success('Card reloaded'); load(); onChanged() }
    catch (e: any) { toast.error(e?.message || 'That did not save.') } finally { setBusy(false) }
  }
  const extend = async () => {
    const day = await prompt('The new last day for the free bonus (YYYY-MM-DD, later than today\'s last day).', { title: 'Extend the bonus', confirmText: 'Next', initialValue: d?.card.bonusExpiresOn || '', inputType: 'date' })
    if (!day) return
    const why = await prompt('Why is it being extended?', { title: 'Reason', confirmText: 'Extend bonus' })
    if (!why) return
    setBusy(true)
    try { await api.post(`/api/salon-gift-cards/${id}/extend-bonus`, { bonusExpiresOn: day.trim(), reason: why }); toast.success('Bonus extended'); load(); onChanged() }
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
            <p className="mt-2 text-sm text-gray-600 dark:text-slate-300">Can be spent today</p>
            <p className="text-3xl font-bold">{cents(d.card.spendableCents)} <span className="text-base font-normal text-gray-600 dark:text-slate-300">{d.card.status === 'void' ? 'voided' : d.card.status === 'pending' ? 'waiting for payment' : `of ${cents(d.card.initialCents)} paid for`}</span></p>
            {d.card.bonusGrantedCents > 0 && (
              <p className="mt-1 text-sm text-gray-700 dark:text-slate-300" data-testid="gift-bonus-line">
                {d.card.bonusExpired ? `The free ${cents(d.card.bonusGrantedCents)} bonus ended${d.card.bonusExpiresOn ? ` on ${momentDate(d.card.bonusExpiresOn)}` : ''}; the money paid is still here.`
                  : `Includes a free ${cents(d.card.bonusCents)} bonus${d.card.bonusExpiresOn ? ` to spend by ${momentDate(d.card.bonusExpiresOn)}` : ' with no last day'}. The ${cents(d.card.paidCents)} paid never expires.`}
              </p>
            )}
            {d.card.deliverOn && !d.card.deliveredAt && <p className="mt-1 text-sm text-gray-700 dark:text-slate-300">To be emailed on {momentDate(d.card.deliverOn)}.</p>}
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
          {d.card.status === 'active' && (maySell || (mayFix && d.card.bonusCents > 0 && !d.card.bonusExpired && d.card.bonusExpiresOn)) && (
            <div className="flex flex-wrap justify-end gap-2">
              {maySell && <Button variant="secondary" onClick={reload} disabled={busy}>Reload</Button>}
              {mayFix && d.card.bonusCents > 0 && !d.card.bonusExpired && d.card.bonusExpiresOn && <Button variant="secondary" onClick={extend} disabled={busy}>Extend the bonus</Button>}
            </div>
          )}
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
  const [card, setCard] = useState<{ balanceCents: number; spendableCents: number; status: string; code: string } | null>(null)
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const owing = balance == null ? status !== 'paid' : Number(balance) > 0.005
  if (!hasFeature('salon_gift_cards') || !(known && (can('invoices:update') || can('giftcards:sell'))) || status === 'void' || status === 'draft' || !owing) return null

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
          {card.status !== 'active' ? <p>That card was voided.</p> : card.spendableCents <= 0 ? <p>That card has nothing left to spend.</p> : (
            <>
              <p>{cents(card.spendableCents)} can be spent from the card. It pays as much of this sale as it can.</p>
              <Button className="mt-2" onClick={apply} disabled={busy}>{busy ? 'Applying…' : 'Apply gift card'}</Button>
            </>
          )}
        </div>
      )}
    </section>
  )
}
