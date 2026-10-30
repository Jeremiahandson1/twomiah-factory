// Checkout at the chair (server crm/salon/chairCheckout.ts + retail.ts; hidden features `chair_checkout`, `salon_retail`):
//   · ChairCheckoutPanel — beside a sale that is owing: pick the reader, the amount (the whole balance, or part of a split bill) and the tip, send it
//     to the reader, watch it, cancel it; refund a reader payment back to the card. On a SIMULATED reader the owner can tap a test card.
//   · RetailSellPanel — beside an open sale: put a product from the shelf on it (stock is taken by the server), take one off.
//   · CardReadersSettingsPage — Settings › Card readers: pair a reader by its code, remove one.
// The phone app never takes a card: the card is tapped on the reader. Every right is also checked by the server.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CreditCard, Loader2, ShoppingBag, Trash2 } from 'lucide-react'
import { api, useAuth, useToast, usePermissions, useConfirm, usePrompt, money } from '../../../shared'
import { Button, inputCls } from '@twomiah/tenant-ui/src/invoicing/ui'

const box = 'rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900'
const cents = (c: number) => money(c / 100)
const toCents = (v: string) => Math.round(Number(v) * 100)
const CLOSED = new Set(['paid', 'void', 'refunded', 'draft'])

interface Reader { id: string; label: string; deviceType: string | null; simulated: boolean; status?: string | null }
interface Charge { id: string; status: string; failure: string | null; amountCents: number; tipCents: number; readerLabel: string | null; paymentId: string | null }
interface ReaderPayment { chargeId: string; paymentId: string; amountCents: number; tipCents: number; refundedCents: number; tipRefundedCents?: number }

const STATUS_WORDS: Record<string, string> = {
  pending: 'Waiting for the card on the reader…', succeeded: 'Paid.', failed: 'The card did not go through.', canceled: 'Cancelled — nothing was taken.',
  timed_out: 'The reader waited too long — nothing was taken.', needs_review: 'The card was charged but the sale could not take it.',
}

export function ChairCheckoutPanel({ invoiceId, status, balance, reload }: { invoiceId: string; status: string; balance?: number | null; reload?: () => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const prompt = usePrompt()
  const { hasFeature } = useAuth()
  const { can, known } = usePermissions()
  const [readers, setReaders] = useState<Reader[] | null>(null)
  const [readerId, setReaderId] = useState('')
  const [amount, setAmount] = useState('')
  const [tip, setTip] = useState('')
  const [onReaderTip, setOnReaderTip] = useState(false)
  const [charge, setCharge] = useState<Charge | null>(null)
  const [paid, setPaid] = useState<ReaderPayment[]>([])
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const on = hasFeature('chair_checkout') && known && can('invoices:update')
  const owing = balance == null ? status !== 'paid' : Number(balance) > 0.005
  const dueCents = balance == null ? 0 : Math.round(Number(balance) * 100)
  const pending = charge?.status === 'pending'

  const poll = useCallback((id: string) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try {
        const r = await api.get(`/api/chair-checkout/charges/${id}`)
        setCharge(r.charge)
        if (r.charge.status === 'pending') poll(id)
        else if (r.charge.status === 'succeeded') { toast.success('Card payment taken'); reload?.() }
      } catch { poll(id) }
    }, 2000)
  }, [reload, toast])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const loadPaid = useCallback(() => { api.get(`/api/chair-checkout/sales/${invoiceId}/payments`).then((r: { payments: ReaderPayment[] }) => setPaid(r.payments)).catch(() => setPaid([])) }, [invoiceId])
  useEffect(() => {
    if (!on) return
    api.get('/api/chair-checkout/readers').then((r: { readers: Reader[] }) => { setReaders(r.readers); if (r.readers[0]) setReaderId((cur) => cur || r.readers[0].id) }).catch(() => setReaders([]))
    api.get(`/api/chair-checkout/sales/${invoiceId}/charge`).then((r: { charge: Charge | null }) => { if (r.charge) { setCharge(r.charge); if (r.charge.status === 'pending') poll(r.charge.id) } }).catch(() => {})
    loadPaid()
  }, [on, invoiceId, poll, loadPaid])
  if (!on || status === 'void' || status === 'draft') return null
  if (!owing && !paid.length) return null

  const sale = amount ? toCents(amount) : dueCents
  const chip = (pct: number) => setTip(((sale * pct) / 100 / 100).toFixed(2))
  const send = async () => {
    setBusy(true); setProblem('')
    try {
      const r = await api.post('/api/chair-checkout/charges', { invoiceId, readerId, ...(amount ? { amountCents: toCents(amount) } : {}), ...(onReaderTip ? { tipOnReader: true } : tip ? { tipCents: toCents(tip) } : {}) })
      setCharge(r.charge); poll(r.charge.id)
    } catch (e: any) { setProblem(e?.message || 'The reader could not be reached.') } finally { setBusy(false) }
  }
  const cancel = async () => {
    if (!charge) return
    setBusy(true)
    try { const r = await api.post(`/api/chair-checkout/charges/${charge.id}/cancel`, {}); setCharge(r.charge); if (r.charge.status === 'succeeded') { toast.success('Card payment taken'); reload?.() } }
    catch (e: any) { setProblem(e?.message || 'That could not be cancelled.') } finally { setBusy(false) }
  }
  const tap = async (outcome: 'approve' | 'decline') => {
    if (!charge) return
    setBusy(true)
    try { const r = await api.post(`/api/chair-checkout/charges/${charge.id}/simulate`, { outcome }); setCharge(r.charge); if (r.charge.status === 'succeeded') { toast.success('Card payment taken'); reload?.() } }
    catch (e: any) { setProblem(e?.message || 'The test card was not taken.') } finally { setBusy(false) }
  }
  /**
   * Refund to the card. The rest of the payment (`part` false) always takes the tip with it; a part of it asks whether the tip goes back too
   * (the server decides the same way, whatever this screen sends).
   */
  const refund = async (p: ReaderPayment, part = false) => {
    const left = p.amountCents - p.refundedCents
    const tipLeft = Math.max(0, p.tipCents - (p.tipRefundedCents || 0))
    let amount = left
    if (part) {
      const typed = await prompt(`How much of the ${cents(left)} still on this payment goes back to the card? (dollars)`, { title: 'Refund part of it', confirmText: 'Next' })
      if (!typed) return
      amount = toCents(typed)
      if (!Number.isFinite(amount) || amount <= 0 || amount > left) { toast.error(`Enter an amount up to ${cents(left)}.`); return }
    }
    const everything = amount === left
    const why = await prompt(`Why is ${cents(amount)} going back to the card?`, { title: 'Refund to the card', confirmText: 'Next' })
    if (!why) return
    let includeTip = everything && tipLeft > 0
    // Part of it: the person chooses whether the stylist's tip goes back too. "No" keeps the tip.
    if (!everything && tipLeft > 0) includeTip = await confirm(`Give the ${cents(tipLeft)} tip back as well? Choose "No" to leave the tip with the stylist.`, { title: 'The tip', confirmText: 'Yes, give the tip back', danger: false })
    const total = amount + (includeTip ? tipLeft : 0)
    const tipNote = includeTip ? ` (${cents(amount)} of the sale and the ${cents(tipLeft)} tip)` : tipLeft > 0 ? ' (the tip stays)' : ''
    if (!(await confirm(`Refund ${cents(total)} to the client's card${tipNote}? This sends the money back through your Stripe account.`, { title: 'Refund to the card', confirmText: 'Refund' }))) return
    setBusy(true)
    try { await api.post(`/api/chair-checkout/payments/${p.paymentId}/refund`, { reason: why, ...(everything ? {} : { amountCents: amount, includeTip }) }); toast.success('Refunded to the card'); loadPaid(); reload?.() }
    catch (e: any) { toast.error(e?.message || 'The refund did not go through.') } finally { setBusy(false) }
  }

  const simulated = !!readers?.find((r) => r.id === readerId)?.simulated
  return (
    <section aria-label="Take a card at the chair" className={box} data-testid="chair-panel">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-slate-100"><CreditCard className="h-4 w-4 text-teal-700 dark:text-teal-300" aria-hidden="true" />Card reader</h2>
      {readers === null && <Loader2 className="mt-2 h-5 w-5 animate-spin text-gray-500" />}
      {readers && readers.length === 0 && owing && (
        <p className="mt-2 text-sm text-gray-700 dark:text-slate-300">No card reader is set up. {known && can('company:update') ? <Link to="/crm/settings/card-readers" className="font-medium text-teal-800 underline dark:text-teal-200">Add one in Settings</Link> : 'Ask the owner to add one in Settings.'}</p>
      )}
      {readers && readers.length > 0 && owing && (!charge || charge.status !== 'pending') && (
        <div className="mt-2 space-y-2 text-sm text-gray-900 dark:text-slate-100">
          {charge && charge.status !== 'succeeded' && <p role="alert" className="text-red-700 dark:text-red-300">{STATUS_WORDS[charge.status] || charge.status}{charge.failure ? ` ${charge.failure}` : ''}</p>}
          <div className="grid grid-cols-2 gap-2">
            <label>Amount ($)<input inputMode="decimal" aria-label="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={(dueCents / 100).toFixed(2)} className={inputCls + ' mt-1'} /></label>
            <label className={onReaderTip ? 'opacity-50' : ''}>Tip ($)<input inputMode="decimal" aria-label="Tip" value={tip} disabled={onReaderTip} onChange={(e) => setTip(e.target.value)} placeholder="0.00" className={inputCls + ' mt-1'} /></label>
          </div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={onReaderTip} onChange={(e) => { setOnReaderTip(e.target.checked); if (e.target.checked) setTip('') }} />Let the client choose the tip on the reader</label>
          <div className={'flex flex-wrap gap-2' + (onReaderTip ? ' hidden' : '')} role="group" aria-label="Tip shortcuts">
            {[15, 18, 20].map((n) => <button key={n} type="button" onClick={() => chip(n)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-slate-600 dark:hover:bg-slate-800">{n}%</button>)}
            <button type="button" onClick={() => setTip('')} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-slate-600 dark:hover:bg-slate-800">No tip</button>
          </div>
          {readers.length > 1 && <label className="block">Reader<select value={readerId} onChange={(e) => setReaderId(e.target.value)} className={inputCls + ' mt-1'}>{readers.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>}
          {problem && <p role="alert" className="text-red-700 dark:text-red-300">{problem}</p>}
          <Button onClick={send} disabled={busy || !readerId}>{busy ? 'Sending…' : onReaderTip ? `Send ${cents(sale)} to the reader` : `Send ${cents(sale + (tip ? toCents(tip) : 0))} to the reader`}</Button>
          <p className="text-xs text-gray-600 dark:text-slate-400">The card is charged the amount and the tip together; the tip is recorded for the stylist. Part of the balance can go on the reader and the rest in cash or on a gift card.</p>
        </div>
      )}
      {pending && charge && (
        <div className="mt-2 space-y-2 text-sm text-gray-900 dark:text-slate-100" role="status">
          <p className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{STATUS_WORDS.pending} {cents(charge.amountCents + charge.tipCents)}{charge.tipCents ? ` (includes ${cents(charge.tipCents)} tip)` : ''}</p>
          {problem && <p role="alert" className="text-red-700 dark:text-red-300">{problem}</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={cancel} disabled={busy}>Cancel on the reader</Button>
            {simulated && known && can('company:update') && (<><Button variant="secondary" onClick={() => tap('approve')} disabled={busy}>Tap test card (approve)</Button><Button variant="secondary" onClick={() => tap('decline')} disabled={busy}>Tap test card (decline)</Button></>)}
          </div>
        </div>
      )}
      {charge?.status === 'needs_review' && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{charge.failure}</p>}
      {paid.length > 0 && (
        <ul className="mt-3 divide-y divide-gray-100 text-sm text-gray-900 dark:divide-slate-800 dark:text-slate-100" aria-label="Card reader payments on this sale">
          {paid.map((p) => (
            <li key={p.chargeId} className="flex items-center justify-between gap-2 py-1.5">
              <span>Card {cents(p.amountCents)}{p.tipCents ? ` + ${cents(p.tipCents)} tip` : ''}{p.refundedCents ? ` · ${cents(p.refundedCents + (p.tipRefundedCents || 0))} refunded` : ''}</span>
              {known && can('payments:delete') && p.amountCents - p.refundedCents > 0 && (
                <span className="flex gap-2">
                  {p.amountCents - p.refundedCents > 1 && <Button variant="secondary" onClick={() => refund(p, true)} disabled={busy}>Refund part</Button>}
                  <Button variant="secondary" onClick={() => refund(p)} disabled={busy}>Refund to card</Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

interface Product { id: string; name: string; brand: string | null; priceCents: number; onHand: number }

/** Put a product from the shelf on this sale (an unpaid one), or take one off. The server takes and returns the stock. */
export function RetailSellPanel({ invoiceId, status, lines, reload }: { invoiceId: string; status: string; lines?: Array<{ id: string; type?: string | null; description: string; quantity: number | string }>; reload?: () => void }) {
  const toast = useToast()
  const { hasFeature } = useAuth()
  const { can, known } = usePermissions()
  const [products, setProducts] = useState<Product[] | null>(null)
  const [productId, setProductId] = useState('')
  const [qty, setQty] = useState('1')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const on = hasFeature('salon_retail') && known && can('invoices:update') && !CLOSED.has(status)
  const load = useCallback(() => { api.get('/api/salon-retail').then((r: { products: Product[] }) => setProducts(r.products)).catch(() => setProducts([])) }, [])
  useEffect(() => { if (on) load() }, [on, load])
  if (!on) return null

  const retailLines = (lines || []).filter((l) => l.type === 'retail')
  const add = async () => {
    setBusy(true); setProblem('')
    try { await api.post('/api/salon-retail/sell', { invoiceId, items: [{ productId, quantity: Number(qty) || 1 }] }); toast.success('Added to the sale'); setQty('1'); load(); reload?.() }
    catch (e: any) { setProblem(e?.message || 'That could not be added.') } finally { setBusy(false) }
  }
  const remove = async (lineId: string) => {
    setBusy(true); setProblem('')
    try { await api.delete(`/api/salon-retail/lines/${lineId}`); toast.success('Taken off the sale'); load(); reload?.() }
    catch (e: any) { setProblem(e?.message || 'That could not be taken off.') } finally { setBusy(false) }
  }
  const inStock = (products || []).filter((p) => p.onHand > 0)
  return (
    <section aria-label="Sell retail" className={box} data-testid="retail-panel">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-slate-100"><ShoppingBag className="h-4 w-4 text-teal-700 dark:text-teal-300" aria-hidden="true" />Sell retail</h2>
      {products === null ? <Loader2 className="mt-2 h-5 w-5 animate-spin text-gray-500" /> : inStock.length === 0 ? <p className="mt-2 text-sm text-gray-700 dark:text-slate-300">{products.length ? 'Everything is out of stock.' : 'No retail products yet.'}</p> : (
        <div className="mt-2 flex flex-wrap items-end gap-2 text-sm text-gray-900 dark:text-slate-100">
          <label className="min-w-0 flex-1">Product<select value={productId} onChange={(e) => setProductId(e.target.value)} className={inputCls + ' mt-1'}><option value="">Choose…</option>{inStock.map((p) => <option key={p.id} value={p.id}>{[p.brand, p.name].filter(Boolean).join(' ')} — {cents(p.priceCents)} ({p.onHand} left)</option>)}</select></label>
          <label className="w-20">Qty<input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} className={inputCls + ' mt-1'} aria-label="Quantity" /></label>
          <Button variant="secondary" onClick={add} disabled={busy || !productId}>Add</Button>
        </div>
      )}
      {problem && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{problem}</p>}
      {retailLines.length > 0 && (
        <ul className="mt-2 divide-y divide-gray-100 text-sm text-gray-900 dark:divide-slate-800 dark:text-slate-100">
          {retailLines.map((l) => <li key={l.id} className="flex items-center justify-between gap-2 py-1.5"><span>{l.quantity} × {l.description}</span><button type="button" aria-label={`Take ${l.description} off the sale`} onClick={() => remove(l.id)} disabled={busy} className="rounded p-1 text-gray-600 hover:text-red-700 dark:text-slate-300"><Trash2 className="h-4 w-4" aria-hidden="true" /></button></li>)}
        </ul>
      )}
    </section>
  )
}

/** Settings › Card readers. */
export default function CardReadersSettingsPage() {
  const toast = useToast()
  const confirm = useConfirm()
  const { can, known } = usePermissions()
  const mayEdit = known && can('company:update')
  const [readers, setReaders] = useState<Reader[] | null>(null)
  const [code, setCode] = useState('')
  const [label, setLabel] = useState('')
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => { api.get('/api/chair-checkout/readers?live=1').then((r: { readers: Reader[] }) => setReaders(r.readers)).catch((e: Error) => { setReaders([]); setProblem(e.message) }) }, [])
  useEffect(load, [load])

  const add = async () => {
    setBusy(true); setProblem('')
    try { await api.post('/api/chair-checkout/readers', { code, label }); toast.success('Reader added'); setCode(''); setLabel(''); load() }
    catch (e: any) { setProblem(e?.message || 'The reader could not be added.') } finally { setBusy(false) }
  }
  const remove = async (r: Reader) => {
    if (!(await confirm(`Remove ${r.label}? It can be added again with a new code.`, { title: 'Remove reader', confirmText: 'Remove' }))) return
    try { await api.delete(`/api/chair-checkout/readers/${r.id}`); toast.success('Reader removed'); load() } catch (e: any) { toast.error(e?.message || 'That reader could not be removed.') }
  }
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white"><CreditCard className="h-6 w-6 text-teal-700 dark:text-teal-300" aria-hidden="true" /> Card readers</h1>
        <p className="mt-1 text-gray-600 dark:text-slate-300">A card reader lets a client pay at the chair. The money goes to your own Stripe account — Twomiah never holds it. Connect Stripe first in Settings › Integrations.</p>
      </div>
      {problem && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{problem}</div>}
      <section className={box} aria-label="Your readers">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Your readers</h2>
        {readers === null ? <Loader2 className="mt-2 h-5 w-5 animate-spin text-gray-500" /> : readers.length === 0 ? <p className="mt-1 text-sm text-gray-600 dark:text-slate-300">None yet.</p> : (
          <ul className="mt-2 divide-y divide-gray-100 text-sm text-gray-900 dark:divide-slate-800 dark:text-slate-100">
            {readers.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                <span>{r.label}{r.simulated && <span className="ml-2 rounded-full bg-gray-200 px-2 py-0.5 text-xs dark:bg-slate-700">Test reader</span>}<span className="block text-xs text-gray-600 dark:text-slate-400">{r.status ? (r.status === 'online' ? 'Online' : 'Offline') : 'Status unknown'}</span></span>
                {mayEdit && <Button variant="secondary" onClick={() => remove(r)}>Remove</Button>}
              </li>
            ))}
          </ul>
        )}
      </section>
      {mayEdit && (
        <section className={box} aria-label="Add a reader">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Add a reader</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-slate-300">On the reader, open Settings and choose “Generate pairing code”, then type the code here. To try everything without a reader, type <strong>simulated-wpe</strong>: it makes a test reader on a Stripe test account and shows buttons to tap a test card.</p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm text-gray-900 dark:text-slate-100">
            <label>Pairing code<input value={code} onChange={(e) => setCode(e.target.value)} className={inputCls + ' mt-1'} autoComplete="off" /></label>
            <label>Name (for example Front desk)<input value={label} onChange={(e) => setLabel(e.target.value)} className={inputCls + ' mt-1'} maxLength={60} /></label>
          </div>
          <div className="mt-3 flex justify-end"><Button onClick={add} disabled={busy || !code.trim()}>{busy ? 'Adding…' : 'Add reader'}</Button></div>
        </section>
      )}
    </div>
  )
}
