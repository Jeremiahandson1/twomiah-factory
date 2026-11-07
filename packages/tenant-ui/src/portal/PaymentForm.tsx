// Portal card payment for an invoice. The publishable key and client secret both come from the public
// /api/stripe/portal/payment-intent call (the owner-side /api/stripe/config needs a login the customer does not have).
import React, { useState, useEffect } from 'react'
import { loadStripe, type Stripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { CreditCard, Lock, Loader2, Check, AlertCircle } from 'lucide-react'
import { API_URL } from './PortalContext'
import { money } from '../money'

// One Stripe.js instance per publishable key + connected account. A business that took payments through
// "Connect Stripe" charges on its own connected account, and Stripe.js must be told which one or it
// rejects that account's client secrets; a business on its own keys passes no account.
const stripeByKey = new Map<string, Promise<Stripe | null>>()
export const getStripe = (publishableKey: string, stripeAccount?: string | null) => {
  const cacheKey = `${publishableKey}|${stripeAccount || ''}`
  let p = stripeByKey.get(cacheKey)
  if (!p) { p = loadStripe(publishableKey, stripeAccount ? { stripeAccount } : undefined); stripeByKey.set(cacheKey, p) }
  return p
}

// portalToken: paying from the customer's portal. linkToken: paying from the invoice's own link (/d/<token>), which every
// invoice email carries (2026-10-22). One of the two.
interface PaymentFormProps { invoiceId: string; amount: number; portalToken?: string; linkToken?: string; onSuccess?: () => void; onCancel?: () => void; primaryColor?: string; /** A tip on top (contractor parity row 12, invoice_tips), in dollars. */ tip?: number }

export function PortalPaymentForm({ invoiceId, amount, portalToken, linkToken, onSuccess, onCancel, primaryColor, tip }: PaymentFormProps) {
  const tipPart = tip && tip > 0 ? { tip } : {}
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [stripe, setStripe] = useState<Stripe | null>(null)
  // Row 18: a business that surcharges credit cards — the card is entered first, the surcharge shown, then the payment made.
  const [deferred, setDeferred] = useState<{ pct: number; amount: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${API_URL}/api/stripe/portal/payment-intent`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoiceId, amount, ...(linkToken ? { linkToken } : { portalToken }), ...tipPart }) })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error || 'Could not start the payment')
        if (!body.publishableKey) throw new Error('Card payments are not set up yet. Please contact us to pay another way.')
        const s = await getStripe(body.publishableKey, body.stripeAccount)
        if (cancelled) return
        setStripe(s)
        if (body.deferred) { setDeferred({ pct: Number(body.surchargePct), amount: Number(body.amount) }); setError(null); return }
        setClientSecret(body.clientSecret)
        setError(null)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to initialize payment')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [invoiceId, amount, portalToken, linkToken, tip])

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /><span className="ml-2 text-gray-500 dark:text-slate-400">Preparing payment...</span></div>
  if (error) return <div role="alert" className="bg-red-50 text-red-700 p-4 rounded-lg flex items-center gap-3 dark:bg-red-950/40 dark:text-red-300"><AlertCircle className="w-5 h-5 shrink-0" /><span>{error}</span></div>
  if (deferred && stripe) {
    const who = { ...(linkToken ? { linkToken } : { portalToken }), ...(tip && tip > 0 ? { tip: String(tip) } : {}) }
    return (
      <Elements stripe={stripe} options={{ mode: 'payment', amount: Math.round(deferred.amount * 100), currency: 'usd', paymentMethodCreation: 'manual', appearance: { theme: 'stripe', variables: { colorPrimary: primaryColor || '#f97316', fontFamily: 'Inter, system-ui, sans-serif', borderRadius: '8px' } } } as any}>
        <SurchargeCheckout invoiceId={invoiceId} amount={deferred.amount} pct={deferred.pct} who={who} onSuccess={onSuccess} onCancel={onCancel} />
      </Elements>
    )
  }
  if (!clientSecret || !stripe) return null

  return (
    <Elements stripe={stripe} options={{ clientSecret, appearance: { theme: 'stripe', variables: { colorPrimary: primaryColor || '#f97316', colorBackground: '#ffffff', colorText: '#1f2937', colorDanger: '#dc2626', fontFamily: 'Inter, system-ui, sans-serif', borderRadius: '8px' } } }}>
      <CheckoutForm amount={Math.round((amount + (tip || 0)) * 100) / 100} onSuccess={onSuccess} onCancel={onCancel} />
    </Elements>
  )
}

/**
 * Roofing parity row 18 (Roofr): the business adds a surcharge to CREDIT card payments. The card is entered first; the server reads the
 * card (credit, debit, prepaid) on the business's account and answers the surcharge, shown here before paying as its own line; then
 * it charges, working the surcharge out again itself. A debit or prepaid card pays no surcharge.
 */
function SurchargeCheckout({ invoiceId, amount, pct, who, onSuccess, onCancel }: { invoiceId: string; amount: number; pct: number; who: Record<string, string | undefined>; onSuccess?: () => void; onCancel?: () => void }) {
  const stripe = useStripe()
  const elements = useElements()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [quote, setQuote] = useState<{ paymentMethodId: string; surcharge: number; total: number } | null>(null)
  const [success, setSuccess] = useState(false)
  const post = async (path: string, body: Record<string, unknown>) => {
    const res = await fetch(`${API_URL}/api/stripe/portal/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoiceId, amount, ...who, ...body }) })
    const out = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(out.error || 'The payment could not go through.')
    return out
  }
  const priceCard = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!stripe || !elements) return
    setBusy(true); setError(null)
    try {
      const { error: submitError } = await elements.submit()
      if (submitError) throw new Error(submitError.message || 'Check the card details.')
      const { error: pmError, paymentMethod } = await (stripe as any).createPaymentMethod({ elements })
      if (pmError || !paymentMethod) throw new Error(pmError?.message || 'Check the card details.')
      const q = await post('surcharge-quote', { paymentMethodId: paymentMethod.id })
      setQuote({ paymentMethodId: paymentMethod.id, surcharge: Number(q.surcharge), total: Number(q.total) })
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  const pay = async () => {
    if (!stripe || !quote) return
    setBusy(true); setError(null)
    try {
      const r = await post('surcharge-pay', { paymentMethodId: quote.paymentMethodId })
      if (r.status === 'requires_action' && r.clientSecret) {
        const { error: actionError, paymentIntent } = await (stripe as any).handleNextAction({ clientSecret: r.clientSecret })
        if (actionError) throw new Error(actionError.message || 'The card was not confirmed.')
        if (paymentIntent?.status !== 'succeeded' && paymentIntent?.status !== 'processing') throw new Error('The card was not charged.')
      } else if (r.status !== 'succeeded' && r.status !== 'processing') throw new Error('The card was not charged.')
      setSuccess(true); setTimeout(() => onSuccess?.(), 2000)
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  if (success) {
    return (
      <div className="text-center py-8">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 dark:bg-green-950/40"><Check className="w-8 h-8 text-green-700 dark:text-green-300" /></div>
        <h3 className="text-xl font-bold text-gray-900 mb-2 dark:text-slate-100">Payment Successful!</h3>
        <p className="text-gray-500 dark:text-slate-400">Thank you for your payment.</p>
      </div>
    )
  }
  return (
    <form onSubmit={priceCard} className="space-y-5">
      <div className="bg-gray-50 rounded-lg p-4 text-center dark:bg-slate-800">
        <p className="text-sm text-gray-500 dark:text-slate-400">Payment Amount</p>
        <p className="text-3xl font-bold text-gray-900 dark:text-slate-100">{money(amount)}</p>
      </div>
      <p className="text-sm text-gray-700 dark:text-slate-300" data-testid="surcharge-notice">A {pct}% surcharge is added to payments by credit card. Debit and prepaid cards pay no surcharge.</p>
      <div className={`bg-white dark:bg-slate-900 rounded-lg border p-4 ${quote ? 'opacity-60 pointer-events-none' : ''}`}><PaymentElement options={{ layout: 'tabs' }} /></div>
      {quote && (
        <div className="rounded-lg border border-gray-200 p-3 text-sm dark:border-slate-700" data-testid="surcharge-summary">
          <div className="flex justify-between"><span>Payment</span><span>{money(amount)}</span></div>
          <div className="flex justify-between"><span>Card surcharge{quote.surcharge > 0 ? ` (${pct}%)` : ''}</span><span>{quote.surcharge > 0 ? money(quote.surcharge) : 'None — not a credit card'}</span></div>
          <div className="flex justify-between font-semibold border-t mt-2 pt-2 dark:border-slate-700"><span>Total charged</span><span>{money(quote.total)}</span></div>
        </div>
      )}
      {error && <div role="alert" className="bg-red-50 text-red-700 p-3 rounded-lg flex items-center gap-2 text-sm dark:bg-red-950/40 dark:text-red-300"><AlertCircle className="w-4 h-4 shrink-0" />{error}</div>}
      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-slate-400"><Lock className="w-3 h-3" /><span>Your payment info is encrypted and secure</span></div>
      <div className="flex gap-3">
        {onCancel && <button type="button" onClick={quote ? () => setQuote(null) : onCancel} disabled={busy} className="flex-1 px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 text-gray-900 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800">{quote ? 'Change card' : 'Cancel'}</button>}
        {quote
          ? <button type="button" onClick={pay} disabled={busy} className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50">{busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</> : <><CreditCard className="w-4 h-4" /> Pay {money(quote.total)}</>}</button>
          : <button type="submit" disabled={!stripe || busy} className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50">{busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Checking the card...</> : 'Continue'}</button>}
      </div>
    </form>
  )
}

function CheckoutForm({ amount, onSuccess, onCancel }: { amount: number; onSuccess?: () => void; onCancel?: () => void }) {
  const stripe = useStripe()
  const elements = useElements()
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!stripe || !elements) return
    setProcessing(true)
    setError(null)
    const { error: submitError } = await elements.submit()
    if (submitError) { setError(submitError.message || 'Submission error'); setProcessing(false); return }
    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({ elements, confirmParams: { return_url: window.location.href }, redirect: 'if_required' })
    if (confirmError) { setError(confirmError.message || 'Payment confirmation error'); setProcessing(false); return }
    if (paymentIntent?.status === 'succeeded') { setSuccess(true); setTimeout(() => onSuccess?.(), 2000) }
    setProcessing(false)
  }

  if (success) {
    return (
      <div className="text-center py-8">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 dark:bg-green-950/40"><Check className="w-8 h-8 text-green-700 dark:text-green-300" /></div>
        <h3 className="text-xl font-bold text-gray-900 mb-2 dark:text-slate-100">Payment Successful!</h3>
        <p className="text-gray-500 dark:text-slate-400">Thank you for your payment.</p>
      </div>
    )
  }
  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-gray-50 rounded-lg p-4 text-center dark:bg-slate-800">
        <p className="text-sm text-gray-500 dark:text-slate-400">Payment Amount</p>
        <p className="text-3xl font-bold text-gray-900 dark:text-slate-100">{money(Number(amount))}</p>
      </div>
      <div className="bg-white dark:bg-slate-900 rounded-lg border p-4"><PaymentElement options={{ layout: 'tabs' }} /></div>
      {error && <div role="alert" className="bg-red-50 text-red-700 p-3 rounded-lg flex items-center gap-2 text-sm dark:bg-red-950/40 dark:text-red-300"><AlertCircle className="w-4 h-4 shrink-0" />{error}</div>}
      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-slate-400"><Lock className="w-3 h-3" /><span>Your payment info is encrypted and secure</span></div>
      <div className="flex gap-3">
        {onCancel && <button type="button" onClick={onCancel} disabled={processing} className="flex-1 px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 text-gray-900 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800">Cancel</button>}
        <button type="submit" disabled={!stripe || processing} className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50">
          {processing ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</> : <><CreditCard className="w-4 h-4" /> Pay {money(Number(amount))}</>}
        </button>
      </div>
    </form>
  )
}

/**
 * How much to pay (roofing parity row 16, JobNimbus: the customer enters an amount): the whole balance, or another amount from $1 up to
 * it. Shown only where the business offers part payment (the invoice's partPayment); the server checks the same bounds.
 */
function AmountStep({ balance, onPick, onCancel, next }: { balance: number; onPick: (amount: number) => void; onCancel: () => void; /** A payment plan's next installment (row 12): offered first. */ next?: { dueDate: string; owed: number } | null }) {
  const [mode, setMode] = useState<'all' | 'part' | 'next'>(next && next.owed < balance - 0.005 ? 'next' : 'all')
  const [typed, setTyped] = useState('')
  const n = Number(typed)
  const bad = mode === 'part' && !(Number.isFinite(n) && n >= 1 && n <= balance + 0.005)
  return (
    <div className="space-y-3">
      {next && next.owed < balance - 0.005 && <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200"><input type="radio" name="pay-amount" checked={mode === 'next'} onChange={() => setMode('next')} /> This installment, {money(next.owed)} (due {next.dueDate})</label>}
      <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200"><input type="radio" name="pay-amount" checked={mode === 'all'} onChange={() => setMode('all')} /> The whole balance, {money(balance)}</label>
      <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200"><input type="radio" name="pay-amount" checked={mode === 'part'} onChange={() => setMode('part')} /> Another amount</label>
      {mode === 'part' && (
        <div>
          <input className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" type="number" min={1} max={balance} step="0.01" inputMode="decimal" aria-label="Amount to pay" placeholder="Amount" value={typed} onChange={(e) => setTyped(e.target.value)} />
          {typed !== '' && bad && <p className="mt-1 text-sm text-red-700 dark:text-red-300" role="alert">Enter an amount from $1.00 to {money(balance)}.</p>}
        </div>
      )}
      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onCancel} className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-gray-800 dark:border-slate-600 dark:text-slate-200">Cancel</button>
        <button type="button" disabled={bad || (mode === 'part' && typed === '')} onClick={() => onPick(mode === 'all' ? balance : mode === 'next' && next ? next.owed : Math.round(n * 100) / 100)} className="flex-1 rounded-lg bg-green-700 px-4 py-2 font-medium text-white disabled:opacity-50">Continue</button>
      </div>
    </div>
  )
}

/** A tip on top of the payment (contractor parity row 12, Jobber's tips): none, a share of the payment, or an amount typed. */
function TipStep({ amount, onPick, onCancel }: { amount: number; onPick: (tip: number) => void; onCancel: () => void }) {
  const [typed, setTyped] = useState('')
  const share = (p: number) => Math.round(amount * p) / 100
  const n = Number(typed)
  const bad = typed !== '' && !(Number.isFinite(n) && n >= 0 && n <= amount)
  return (
    <div className="space-y-3" data-testid="tip-step">
      <p className="text-sm text-gray-800 dark:text-slate-200">Add a tip for the crew? It goes on top of the {money(amount)} payment.</p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => onPick(0)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:text-slate-200">No tip</button>
        {[10, 15, 20].map((p) => <button key={p} type="button" onClick={() => onPick(share(p))} className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:text-slate-200">{p}% · {money(share(p))}</button>)}
      </div>
      <div className="flex gap-2">
        <input aria-label="Tip amount" type="number" min={0} step="0.01" inputMode="decimal" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Another amount" className="flex-1 rounded-lg border border-gray-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        <button type="button" disabled={typed === '' || bad} onClick={() => onPick(Math.round(n * 100) / 100)} className="rounded-lg bg-green-700 px-4 py-2 text-white disabled:opacity-50">Add</button>
      </div>
      {bad && <p role="alert" className="text-sm text-red-700 dark:text-red-300">A tip is from $0 to {money(amount)}.</p>}
      <button type="button" onClick={onCancel} className="w-full rounded-lg border border-gray-300 px-4 py-2 text-gray-800 dark:border-slate-600 dark:text-slate-200">Cancel</button>
    </div>
  )
}

export function PortalPaymentModal({ isOpen, onClose, invoiceId, amount, portalToken, linkToken, onSuccess, primaryColor, allowPart, tips, next }: { isOpen: boolean; onClose: () => void; invoiceId: string; amount: number; portalToken?: string; linkToken?: string; onSuccess?: () => void; primaryColor?: string; allowPart?: boolean; tips?: boolean; next?: { dueDate: string; owed: number } | null }) {
  const [chosen, setChosen] = useState<number | null>(null)
  const [tip, setTip] = useState<number | null>(null)
  useEffect(() => { if (!isOpen) { setChosen(null); setTip(null) } }, [isOpen])
  if (!isOpen) return null
  const pay = allowPart ? chosen : amount
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div role="dialog" aria-modal="true" aria-label="Make Payment" className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6 dark:bg-slate-900">
          <h2 className="text-xl font-bold text-gray-900 mb-6 dark:text-slate-100">Make Payment</h2>
          {pay === null
            ? <AmountStep balance={amount} onPick={setChosen} onCancel={onClose} next={next} />
            : tips && tip === null
            ? <TipStep amount={pay} onPick={setTip} onCancel={onClose} />
            : <PortalPaymentForm invoiceId={invoiceId} amount={pay} tip={tip || 0} portalToken={portalToken} linkToken={linkToken} primaryColor={primaryColor} onSuccess={() => { onSuccess?.(); setTimeout(onClose, 2000) }} onCancel={onClose} />}
        </div>
      </div>
    </div>
  )
}
