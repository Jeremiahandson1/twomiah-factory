// The card reader on the register's Pay screen, a refund back to the card, and a check's receipt — what the register,
// the kiosk and the Orders screen share (server: crm/bar/barTerminal.ts, barReceipts.ts, barFoodRoutes.ts).
//
// "Card" on a reader: the amount goes to the reader, this waits, and the payment is on the check only once Stripe has
// confirmed it — the server records it, never this screen. Cancel, a decline and a timeout each say what happened.
import { useEffect, useRef, useState } from 'react'
import { Loader2, Printer, Send } from 'lucide-react'
import { api } from '../../../api'
import { useMayWrite } from '../../../shared'
import FormError, { errorText } from '../../ui/FormError'
import { BTN, ON, OFF, DANGER, LABEL, INPUT, MUTED, money, centsFrom, Dialog } from './registerUi'

export interface Charge { id: string; status: 'pending' | 'succeeded' | 'failed' | 'canceled' | 'timed_out'; failure: string | null; amountCents: number; tipCents: number; readerId: string; readerLabel: string | null; checkId: string | null; orderId: string | null }
export interface ReaderChoice { id: string; label: string; simulated: boolean }

const ENDED: Record<string, string> = { failed: 'Not paid', canceled: 'Cancelled', timed_out: 'Timed out' }

/**
 * Wait on a payment sent to a reader: ask the server every two seconds (it asks Stripe), and hand back the final
 * answer. The guest can cancel on the reader; the bartender can cancel here.
 */
export function useCharge(onDone: (c: Charge) => void) {
  const [charge, setCharge] = useState<Charge | null>(null)
  const [err, setErr] = useState('')
  const done = useRef(onDone); done.current = onDone
  useEffect(() => {
    if (!charge || charge.status !== 'pending') return
    let stop = false
    const t = setTimeout(async () => {
      try {
        const r = await api.get(`/api/food/terminal/charge/${charge.id}`)
        if (stop) return
        setCharge(r.charge)
        if (r.charge.status !== 'pending') done.current(r.charge)
      } catch (e) { if (!stop) setErr(errorText(e, 'Lost touch with the reader. Still waiting…')) }
    }, 2000)
    return () => { stop = true; clearTimeout(t) }
  }, [charge])
  const cancel = async () => {
    if (!charge) return
    try { const r = await api.post(`/api/food/terminal/charge/${charge.id}/cancel`, {}); setCharge(r.charge); if (r.charge.status !== 'pending') done.current(r.charge) }
    catch (e) { setErr(errorText(e, 'Could not cancel. Try again.')) }
  }
  const simulate = async (outcome: 'approve' | 'decline', tipCents = 0) => {
    if (!charge) return
    try { const r = await api.post(`/api/food/terminal/charge/${charge.id}/simulate`, { outcome, tipCents }); setCharge(r.charge); if (r.charge.status !== 'pending') done.current(r.charge) }
    catch (e) { setErr(errorText(e, 'The test card did not go through.')) }
  }
  return { charge, setCharge, err, setErr, cancel, simulate }
}

/** The waiting panel: "Tap, insert or swipe on the reader", Cancel, and — on a simulated reader — the test cards. */
export function ChargeWaiting({ charge, simulated, onCancel, onSimulate, err }: { charge: Charge; simulated: boolean; onCancel: () => void; onSimulate: (o: 'approve' | 'decline', tip?: number) => void; err: string }) {
  // Taking (and stopping) a card payment is the register's: bar:register (barFoodRoutes.ts).
  const mayRing = useMayWrite('bar:register')
  if (charge.status !== 'pending') {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-4" role="status">
        <p className="text-lg font-bold text-gray-900 dark:text-slate-100">{charge.status === 'succeeded' ? `Paid ${money(charge.amountCents + charge.tipCents)}` : ENDED[charge.status] || charge.status}</p>
        {charge.status === 'succeeded' && charge.tipCents > 0 && <p className={`text-sm ${MUTED}`}>Including a {money(charge.tipCents)} tip on the reader.</p>}
        {charge.failure && <p className="text-sm mt-1 text-red-700 dark:text-red-300">{charge.failure}</p>}
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-orange-300 bg-orange-50 text-gray-900 dark:border-orange-700 dark:bg-orange-950/40 dark:text-slate-100 p-4" role="status" aria-live="polite">
      <p className="flex items-center gap-2 text-lg font-bold"><Loader2 className="w-5 h-5 animate-spin" />{money(charge.amountCents)} on {charge.readerLabel || 'the reader'}</p>
      <p className="text-sm mt-1">Tap, insert or swipe the card on the reader. It is recorded here when Stripe confirms it.</p>
      <FormError message={err} className="mt-2" />
      {mayRing && <div className="flex flex-wrap gap-2 mt-3">
        <button type="button" className={`${BTN} ${DANGER}`} onClick={onCancel}>Cancel the payment</button>
        {simulated && (
          <>
            <button type="button" className={`${BTN} ${OFF}`} onClick={() => onSimulate('approve')}>Test card: approve</button>
            <button type="button" className={`${BTN} ${OFF}`} onClick={() => onSimulate('approve', 200)}>Test card + $2 tip</button>
            <button type="button" className={`${BTN} ${OFF}`} onClick={() => onSimulate('decline')}>Test card: decline</button>
          </>
        )}
      </div>}
    </div>
  )
}

/** Give money back to the card, through Stripe (a manager's: bar:manage — the server asks). */
export function RefundDialog({ payment, checkOpen, onClose, onDone }: { payment: { id: string; amountCents: number; tipCents: number; refundedCents?: number }; checkOpen: boolean; onClose: () => void; onDone: (r: any) => void }) {
  // A refund is a manager's: bar:manage (barFoodRoutes.ts /payment/:id/refund).
  const mayRefund = useMayWrite('bar:manage')
  const left = payment.amountCents + payment.tipCents - (payment.refundedCents || 0)
  const [amount, setAmount] = useState((left / 100).toFixed(2))
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const cents = checkOpen ? left : centsFrom(amount)
  return (
    <Dialog title="Refund to the card" onClose={onClose}>
      <form onSubmit={async (e) => {
        e.preventDefault(); if (cents === null) return; setBusy(true); setErr('')
        try { onDone(await api.post(`/api/food/payment/${payment.id}/refund`, { amountCents: cents, reason })) }
        catch (ex) { setErr(errorText(ex, 'The refund did not go through.')) } finally { setBusy(false) }
      }}>
        <p className={`text-sm mb-3 ${MUTED}`}>{checkOpen ? `The whole ${money(left)} goes back to the card and comes off this check, so the balance is owed again.` : `Up to ${money(left)} can go back to the card. The check stays closed; the night's report shows the refund.`}</p>
        {!checkOpen && (
          <>
            <label className={LABEL} htmlFor="refund-amount">Amount ($)</label>
            <input id="refund-amount" className={`${INPUT} mt-1`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </>
        )}
        <label className={`${LABEL} block mt-3`} htmlFor="refund-reason">Reason</label>
        <input id="refund-reason" className={`${INPUT} mt-1`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Charged twice" required />
        <FormError message={err} className="mt-3" />
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className={`${BTN} ${OFF}`} onClick={onClose}>Cancel</button>
          {mayRefund && <button type="submit" className={`${BTN} ${ON}`} disabled={busy || cents === null || cents <= 0 || cents > left || !reason.trim()}>Refund {cents !== null ? money(cents) : ''}</button>}
        </div>
      </form>
    </Dialog>
  )
}

/**
 * The receipt: email it, text it, or open the printable page (80 mm) in a new tab. The link is fetched when this opens
 * and is a plain link, so the browser never blocks it as a pop-up and the app never calls print itself.
 */
export function ReceiptPanel({ checkId, guestEmail, guestPhone }: { checkId: string; guestEmail?: string | null; guestPhone?: string | null }) {
  // Sending a receipt is the register's: bar:register (barFoodRoutes.ts /check/:id/receipt).
  const mayRing = useMayWrite('bar:register')
  const [url, setUrl] = useState('')
  const [email, setEmail] = useState(guestEmail || '')
  const [phone, setPhone] = useState(guestPhone || '')
  const [msg, setMsg] = useState<{ email?: string; text?: string } | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    api.get(`/api/food/check/${checkId}/receipt`).then((r) => { if (live) setUrl(`${api.baseUrl || ''}${r.url}`) }).catch(() => {})
    return () => { live = false }
  }, [checkId])
  const said = (k: 'email' | 'text', v?: string) => (v ? (v === 'sent' ? (k === 'email' ? 'Receipt emailed.' : 'Receipt texted.') : v) : '')
  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-3 mt-3">
      <p className={`${LABEL} mb-2`}>Receipt</p>
      <form className="space-y-2" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr(''); setMsg(null)
        try { const r = await api.post(`/api/food/check/${checkId}/receipt`, { email: email.trim() || undefined, phone: phone.trim() || undefined }); setMsg(r.sent) }
        catch (ex) { setErr(errorText(ex, 'The receipt did not send.')) } finally { setBusy(false) }
      }}>
        <label className="sr-only" htmlFor={`rc-email-${checkId}`}>Email</label>
        <input id={`rc-email-${checkId}`} className={INPUT} type="email" inputMode="email" placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="sr-only" htmlFor={`rc-phone-${checkId}`}>Mobile number</label>
        <input id={`rc-phone-${checkId}`} className={INPUT} type="tel" inputMode="tel" placeholder="Mobile for a text (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <p className={`text-xs ${MUTED}`}>A text goes only to a number that has not opted out of your texts.</p>
        <div className="flex flex-wrap gap-2">
          {mayRing && <button type="submit" className={`${BTN} ${ON} inline-flex items-center gap-2`} disabled={busy || (!email.trim() && !phone.trim())}><Send className="w-4 h-4" />Send receipt</button>}
          {url && <a href={url} target="_blank" rel="noopener noreferrer" className={`${BTN} ${OFF} inline-flex items-center gap-2`}><Printer className="w-4 h-4" />Print receipt</a>}
        </div>
      </form>
      <FormError message={err} className="mt-2" />
      {msg && <p className="text-sm mt-2 text-gray-900 dark:text-slate-100" role="status">{[said('email', msg.email), said('text', msg.text)].filter(Boolean).join(' ')}</p>}
    </div>
  )
}
