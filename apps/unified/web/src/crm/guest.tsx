// What a private-event client opens from their email, with no sign-in (restaurant-bar-depth #1 and #2):
//   /event-proposal/<token>  the proposal: the room, date and menu, the price, their choices, the terms, and a drawn signature
//   /event-pay/<token>       one payment: the amount still owed, paid by card on the venue's own Stripe account, and the option
//                            to leave a card for the rest of the event
// Loaded on its own (App.tsx) so Stripe.js and the signature pad stay out of the admin's bundle. The card number goes to
// Stripe from the browser; this page and our server never see it.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2, Check, FileSignature, CreditCard, AlertCircle, Download } from 'lucide-react'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { SignaturePad } from '@twomiah/tenant-ui/src/portal/SignaturePad'
import { getStripe } from '@twomiah/tenant-ui/src/portal/PaymentForm'
import { money } from '@twomiah/tenant-ui/src/money'
import { momentDate } from '@twomiah/tenant-ui/src/time/companyClock'

async function call(path: string, method = 'GET', body?: unknown) {
  const res = await fetch(path, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(json.error || 'Something went wrong. Please try again.'), { code: json.code as string | undefined })
  return json
}

function Page({ brand, title, children }: { brand?: { name?: string; color?: string | null; logo?: string | null; phone?: string } | null; title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-gray-200 bg-white dark:bg-slate-900 dark:border-slate-800" style={brand?.color ? { borderTop: `4px solid ${brand.color}` } : undefined}>
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          {brand?.logo && <img src={brand.logo} alt="" className="h-10 w-auto" />}
          <div><p className="font-semibold">{brand?.name || 'Your venue'}</p>{brand?.phone && <p className="text-sm text-gray-600 dark:text-slate-400">{brand.phone}</p>}</div>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">
        <h1 className="text-2xl font-bold">{title}</h1>
        {children}
      </main>
    </div>
  )
}
const box = 'bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5'
const Err = ({ children }: { children: ReactNode }) => <p role="alert" className="flex items-start gap-2 text-red-700 dark:text-red-300"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{children}</p>

// ── The proposal ─────────────────────────────────────────────────────────────────────────────────────────────────────
interface View {
  status: string; expiresAt: string | null; message: string | null; terms: string | null; acceptedAt: string | null; signedBy: string | null
  event: { name: string; type: string; dateWords: string; startTime: string | null; endTime: string | null; guestCount: number | null }
  space: { name: string } | null
  lines: Array<{ description: string; quantity: number; unitPrice: number; total: number }>
  minimum: { required: number; spend: number; shortfall: number } | null
  schedule: Array<{ label: string; amount: number; dueDate: string | null }>
  brand: { name?: string; phone?: string; color?: string | null; logo?: string | null }
  taxRate: number
  options: Array<{ id: string; title: string; kind: 'single' | 'multi'; required: boolean; choices: Array<{ id: string; label: string; price: number; perPerson: boolean }> }>
  selections: Record<string, string[]>
  chosen: Array<{ name: string; quantity: number; unitPrice: number; total: number }>
  subtotal: number; tax: number; total: number
  contract: { name: string; text: string } | null
  signers: Array<{ position: number; role: string; roleLabel: string; name: string; status: 'waiting' | 'sent' | 'signed'; signedAt: string | null }>
  you: { position: number; role: string; roleLabel: string; status: 'waiting' | 'sent' | 'signed'; name: string | null } | null
  pay?: PayOffer | null
}
const CLOSED: Record<string, string> = { expired: 'This proposal has expired. Please ask us for a new one.', declined: 'This proposal was declined.', superseded: 'We have sent you a newer proposal — please use the newest link in your email.' }

export function ProposalPage() {
  const { token = '' } = useParams()
  const base = `/api/proposal-links/${token}`
  const [v, setV] = useState<View | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [signing, setSigning] = useState(false)
  const [name, setName] = useState('')
  const [consent, setConsent] = useState(false)
  const [reason, setReason] = useState('')
  const [declining, setDeclining] = useState(false)
  useEffect(() => { call(base).then(setV).catch((e) => setErr(e.message)) }, [base])
  useEffect(() => { document.title = v?.brand?.name ? `${v.brand.name} — Your event proposal` : 'Your event proposal' }, [v?.brand?.name])
  const open = v && ['sent', 'viewed', 'partly_signed'].includes(v.status)
  // The first signer makes the choices; whoever signs after them reads what was chosen. Your turn: the signature box shows.
  const choosing = !!v && !!open && (v.you?.position ?? 1) === 1 && !v.signers.some((s) => s.status === 'signed')
  const myTurn = !!v && !!open && (!v.you || v.you.status === 'sent')
  const choose = async (optId: string, choiceId: string, kind: 'single' | 'multi') => {
    if (!v || !choosing) return
    const cur = v.selections[optId] || []
    const next = kind === 'single' ? (cur[0] === choiceId ? [] : [choiceId]) : cur.includes(choiceId) ? cur.filter((x) => x !== choiceId) : [...cur, choiceId]
    setErr('')
    try { setV(await call(`${base}/choices`, 'PUT', { selections: { ...v.selections, [optId]: next } })) } catch (e) { setErr((e as Error).message) }
  }
  const missing = useMemo(() => v?.options.find((o) => o.required && !(v.selections[o.id]?.length)) || null, [v])
  const sign = async (signature: string) => {
    if (!v) return
    setBusy(true); setErr('')
    try { setV(await call(`${base}/accept`, 'POST', { signature, signedBy: name.trim(), consent, selections: v.selections })); setSigning(false) } catch (e) { setErr((e as Error).message); setSigning(false) } finally { setBusy(false) }
  }
  const decline = async () => { setBusy(true); try { setV(await call(`${base}/decline`, 'POST', { reason })); setDeclining(false) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }
  if (!v) return <Page title="Your event proposal" brand={null}>{err ? <Err>{err}</Err> : <Loader2 className="w-5 h-5 animate-spin text-gray-400" />}</Page>
  const hours = v.event.startTime ? `${v.event.startTime}${v.event.endTime ? ' – ' + v.event.endTime : ''}` : null
  return (
    <Page title={v.event.name} brand={v.brand}>
      <section className={box}>
        <p className="font-medium">{v.event.dateWords}{hours ? `, ${hours}` : ''}</p>
        <p className="text-gray-600 dark:text-slate-400">{[v.space?.name, v.event.guestCount ? `${v.event.guestCount} guests` : '', v.event.type].filter(Boolean).join(' · ')}</p>
        {v.message && <p className="mt-3 whitespace-pre-line">{v.message}</p>}
      </section>
      {v.status === 'accepted' && <p className="flex items-center gap-2 text-green-800 dark:text-green-300 font-medium"><Check className="w-5 h-5" />{v.signers.length > 1 ? 'Everyone has signed' : `Signed by ${v.signedBy}`}{v.acceptedAt ? ` on ${momentDate(v.acceptedAt)}` : ''}. Your date is booked — thank you!</p>}
      {v.status === 'partly_signed' && v.you?.status === 'signed' && <p role="status" className="flex items-center gap-2 text-green-800 dark:text-green-300 font-medium"><Check className="w-5 h-5" />Thank you — your signature is kept. The date is booked once everyone below has signed; we will email you.</p>}
      {open && v.you?.status === 'waiting' && <p role="status" className="text-amber-800 dark:text-amber-300">It is not your turn to sign yet. You will be emailed a message when the people before you have signed. You can read everything below.</p>}
      {CLOSED[v.status] && <Err>{CLOSED[v.status]}</Err>}

      {v.options.map((o) => (
        <section key={o.id} className={box}>
          <h2 className="font-semibold mb-1">{o.title}{o.required ? ' *' : ''}</h2>
          <p className="text-sm text-gray-600 dark:text-slate-400 mb-2">{o.kind === 'single' ? 'Choose one' : 'Choose any'}</p>
          <ul className="space-y-2">
            {o.choices.map((c) => {
              const on = (v.selections[o.id] || []).includes(c.id)
              return (
                <li key={c.id}>
                  <button type="button" disabled={!choosing} aria-pressed={on} onClick={() => choose(o.id, c.id, o.kind)} className={`w-full text-left flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${on ? 'border-orange-600 bg-orange-50 dark:bg-orange-950/30' : 'border-gray-300 dark:border-slate-700'} disabled:opacity-70`}>
                    <span className="flex items-center gap-2">{on && <Check className="w-4 h-4" />}{c.label}</span>
                    <span className="text-sm">{c.price > 0 ? `${money(c.price)}${c.perPerson ? ' per guest' : ''}` : 'Included'}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      <section className={box}>
        <h2 className="font-semibold mb-2">Your price</h2>
        <table className="w-full text-sm"><tbody>
          {v.lines.map((l, i) => <tr key={i}><td className="py-1">{l.description}<span className="text-gray-600 dark:text-slate-400"> ({l.quantity} × {money(l.unitPrice)})</span></td><td className="text-right">{money(l.total)}</td></tr>)}
          {v.chosen.map((l, i) => <tr key={'c' + i}><td className="py-1">{l.name}<span className="text-gray-600 dark:text-slate-400"> ({l.quantity} × {money(l.unitPrice)})</span></td><td className="text-right">{money(l.total)}</td></tr>)}
          <tr className="border-t"><td className="py-1">Subtotal</td><td className="text-right">{money(v.subtotal)}</td></tr>
          {v.tax > 0 && <tr><td className="py-1">Tax ({v.taxRate}%)</td><td className="text-right">{money(v.tax)}</td></tr>}
          <tr className="font-semibold border-t"><td className="py-1">Total</td><td className="text-right">{money(v.total)}</td></tr>
        </tbody></table>
        {v.minimum && v.minimum.shortfall > 0 && <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">This room has a food and drink minimum of {money(v.minimum.required)}. Choosing more brings the total toward it; any amount short is added to the bill.</p>}
        {v.schedule.length > 0 && <div className="mt-3 text-sm"><p className="font-medium">When you pay</p><ul>{v.schedule.map((s, i) => <li key={i}>{s.label}: {money(s.amount)}{s.dueDate ? `, due ${s.dueDate}` : ''}</li>)}</ul></div>}
      </section>

      {v.contract && <section className={box} data-testid="contract"><h2 className="font-semibold mb-2">{v.contract.name}</h2><p className="whitespace-pre-line text-sm">{v.contract.text}</p></section>}
      {v.terms && <section className={box}><h2 className="font-semibold mb-1">Terms</h2><p className="whitespace-pre-line text-sm">{v.terms}</p></section>}
      {err && <Err>{err}</Err>}

      {v.signers.length > 1 && (
        <section className={box} data-testid="signers">
          <h2 className="font-semibold mb-2">Who signs, in order</h2>
          <ol className="space-y-1 text-sm">{v.signers.map((s) => <li key={s.position} className="flex items-center gap-2">{s.status === 'signed' ? <Check className="w-4 h-4 text-green-700 dark:text-green-300" /> : <span className="w-4" />}<span><strong>{s.roleLabel}</strong> — {s.name}{s.status === 'signed' && s.signedAt ? `, signed ${momentDate(s.signedAt)}` : s.status === 'sent' ? ', waiting to sign' : s.status === 'waiting' ? ', next in line' : ''}</span></li>)}</ol>
        </section>
      )}

      {myTurn && (
        <section className={`${box} space-y-3`}>
          <h2 className="font-semibold flex items-center gap-2"><FileSignature className="w-4 h-4" />{(v.you?.position ?? 1) === 1 && v.signers.length <= 1 ? 'Sign to book your date' : `Sign as ${v.you?.roleLabel.toLowerCase() || 'the client'}`}</h2>
          <div><label className="block text-sm font-medium mb-1" htmlFor="signer">Your full name</label><input id="signer" className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-slate-800 dark:border-slate-700" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />I agree that my electronic signature is the legal equivalent of my handwritten signature.</label>
          {choosing && missing && <p className="text-sm text-amber-800 dark:text-amber-300">Please choose for “{missing.title}” first.</p>}
          {!signing
            ? <button type="button" disabled={!name.trim() || !consent || (choosing && !!missing) || busy} onClick={() => setSigning(true)} className="px-4 py-2 rounded-lg bg-orange-600 text-white disabled:opacity-50">Draw my signature</button>
            : <div className="space-y-2">{busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <SignaturePad onSave={sign} onCancel={() => setSigning(false)} width={500} height={180} />}</div>}
          <div className="pt-2 border-t border-gray-100 dark:border-slate-800">
            {!declining ? <button type="button" className="text-sm underline text-gray-600 dark:text-slate-400" onClick={() => setDeclining(true)}>This isn’t for me</button> : (
              <div className="space-y-2"><label className="block text-sm" htmlFor="why">Anything you would like us to know? (optional)</label><textarea id="why" className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-slate-800 dark:border-slate-700" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                <button type="button" className="px-3 py-1.5 rounded-lg border" onClick={decline} disabled={busy}>Decline this proposal</button></div>
            )}
          </div>
        </section>
      )}
      {v.pay && (
        <section className={`${box} space-y-3`} data-testid="pay-at-signing">
          <h2 className="font-semibold flex items-center gap-2"><CreditCard className="w-4 h-4" />{v.pay.owed > 0.005 ? `Pay your ${v.pay.label.toLowerCase()} now` : `Your ${v.pay.label.toLowerCase()} is paid`}</h2>
          {v.pay.owed > 0.005
            ? <><p className="text-3xl font-bold">{money(v.pay.owed)}<span className="text-base font-normal text-gray-600 dark:text-slate-400">{v.pay.dueDate ? ` due ${v.pay.dueDate}` : ''}</span></p>
              <p className="text-sm text-gray-600 dark:text-slate-400">Your date is booked. You can pay this now, here, or later from the link in your email. You can also keep your card for the rest of your payments, so each is paid on its due date.</p></>
            : <p className="flex items-center gap-2 text-green-800 dark:text-green-300 font-medium"><Check className="w-5 h-5" />Thank you — it has been received.</p>}
          {!v.pay.canPayByCard && <p>This venue takes card payments in person or by arrangement{v.brand.phone ? ` — please call ${v.brand.phone}` : ''}.</p>}
        </section>
      )}
      {v.pay && <PayPanel base={`${base}/pay`} offer={v.pay} onChanged={() => { call(base).then(setV).catch((e) => setErr(e.message)) }} />}
      {(v.status === 'accepted' || v.signers.some((x) => x.status === 'signed')) && <a className="inline-flex items-center gap-2 underline" href={`${base}/pdf`}><Download className="w-4 h-4" />{v.status === 'accepted' ? 'Download your signed copy (PDF)' : 'Download the copy so far (PDF)'}</a>}
    </Page>
  )
}

// ── Paying one instalment ────────────────────────────────────────────────────────────────────────────────────────────
interface PayView {
  brand: { name?: string; phone?: string; color?: string | null; logo?: string | null }
  event: { name: string; dateWords: string }; label: string; dueDate: string | null; amount: number; owed: number; state: string
  canPayByCard: boolean; autopay: { brand: string | null; last4: string | null } | null; autopayConsent: string
}
interface Started { clientSecret: string; stripeAccount: string; publishableKey: string; paymentIntentId?: string; setupIntentId?: string }

function CardForm({ kind, onDone, label }: { kind: 'pay' | 'setup'; onDone: () => void; label: string }) {
  const stripe = useStripe(), elements = useElements()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!stripe || !elements) return
    setBusy(true); setErr('')
    const sub = await elements.submit()
    if (sub.error) { setErr(sub.error.message || 'Check your card details.'); setBusy(false); return }
    const r = kind === 'pay'
      ? await stripe.confirmPayment({ elements, confirmParams: { return_url: window.location.href }, redirect: 'if_required' })
      : await stripe.confirmSetup({ elements, confirmParams: { return_url: window.location.href }, redirect: 'if_required' })
    if (r.error) { setErr(r.error.message || 'The card did not go through.'); setBusy(false); return }
    onDone()
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <PaymentElement />
      {err && <Err>{err}</Err>}
      <button type="submit" disabled={!stripe || busy} className="px-4 py-2 rounded-lg bg-orange-600 text-white disabled:opacity-50 inline-flex items-center gap-2">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}{label}</button>
    </form>
  )
}

/** What the panel needs to take one payment: the amount owed and how it can be paid (the pay page's own fields, and the proposal's `pay`). */
export interface PayOffer { label: string; dueDate: string | null; owed: number; canPayByCard: boolean; autopay: { brand: string | null; last4: string | null } | null; autopayConsent: string }

/**
 * Taking one payment on a page: pay by card with the option to keep the card for the rest of the event, or leave a card without
 * paying now. `base` is the API prefix (/api/event-pay/<token> or, after the signature, /api/proposal-links/<token>/pay), so the
 * pay link and the proposal page take money the same way. `onChanged` reloads the page's own view after a payment or a stop.
 */
export function PayPanel({ base, offer, onChanged }: { base: string; offer: PayOffer; onChanged: () => void }) {
  const [err, setErr] = useState('')
  const [started, setStarted] = useState<(Started & { kind: 'pay' | 'setup'; save: boolean }) | null>(null)
  const [save, setSave] = useState(false)
  const [done, setDone] = useState('')
  const [stripePromise, setStripePromise] = useState<ReturnType<typeof getStripe> | null>(null)
  useEffect(() => { setStripePromise(started ? getStripe(started.publishableKey, started.stripeAccount) : null) }, [started])
  const startPay = async () => {
    setErr('')
    try { const r = await call(`${base}/intent`, 'POST', save ? { saveCard: true, consent: true } : {}); setStarted({ ...r, kind: 'pay', save }) } catch (e) { setErr((e as Error).message) }
  }
  const startSetup = async () => {
    setErr('')
    try { const r = await call(`${base}/autopay`, 'POST', { consent: true }); setStarted({ ...r, kind: 'setup', save: true }) } catch (e) { setErr((e as Error).message) }
  }
  const finish = async () => {
    if (!started) return
    try {
      if (started.kind === 'pay') await call(`${base}/confirm`, 'POST', { paymentIntentId: started.paymentIntentId, ...(started.save ? { saveCard: true, consent: true } : {}) })
      else await call(`${base}/autopay/confirm`, 'POST', { setupIntentId: started.setupIntentId })
      setDone(started.kind === 'pay' ? 'Thank you — your payment has been received.' : 'Your card is saved. We will charge it on each due date.')
      setStarted(null); onChanged()
    } catch (e) { setErr((e as Error).message) }
  }
  const stop = async () => { try { await call(`${base}/autopay/stop`, 'POST', {}); setDone('Your card was removed.'); onChanged() } catch (e) { setErr((e as Error).message) } }
  return (
    <>
      {done && <p role="status" className="flex items-center gap-2 text-green-800 dark:text-green-300"><Check className="w-4 h-4" />{done}</p>}
      {err && <Err>{err}</Err>}
      {offer.canPayByCard && !started && (
        <section className={`${box} space-y-3`}>
          {offer.owed > 0.005 && (
            <>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={save} onChange={(e) => setSave(e.target.checked)} />Keep this card for the rest of my event’s payments. <span className="text-gray-600 dark:text-slate-400">{offer.autopayConsent}</span></label>
              <button type="button" onClick={startPay} className="px-4 py-2 rounded-lg bg-orange-600 text-white inline-flex items-center gap-2"><CreditCard className="w-4 h-4" />Pay {money(offer.owed)} by card</button>
            </>
          )}
          {offer.autopay
            ? <p className="text-sm">A {offer.autopay.brand || 'card'} ending {offer.autopay.last4} is saved for this event. <button type="button" className="underline" onClick={stop}>Remove it</button></p>
            : offer.owed > 0.005 && <p className="text-sm"><button type="button" className="underline" onClick={startSetup}>Leave a card on file without paying now</button> <span className="text-gray-600 dark:text-slate-400">— {offer.autopayConsent}</span></p>}
        </section>
      )}
      {started && stripePromise && (
        <section className={box}>
          <Elements stripe={stripePromise} options={{ clientSecret: started.clientSecret }}>
            <CardForm kind={started.kind} onDone={finish} label={started.kind === 'pay' ? `Pay ${money(offer.owed)}` : 'Save this card'} />
          </Elements>
        </section>
      )}
    </>
  )
}

export function PayPage() {
  const { token = '' } = useParams()
  const base = `/api/event-pay/${token}`
  const [v, setV] = useState<PayView | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => call(base).then(setV).catch((e) => setErr(e.message)), [base])
  useEffect(() => { load() }, [load])
  useEffect(() => { document.title = v?.brand?.name ? `${v.brand.name} — Pay for your event` : 'Pay for your event' }, [v?.brand?.name])
  if (!v) return <Page title="Pay for your event" brand={null}>{err ? <Err>{err}</Err> : <Loader2 className="w-5 h-5 animate-spin text-gray-400" />}</Page>
  return (
    <Page title={`${v.label} — ${v.event.name}`} brand={v.brand}>
      <section className={box}>
        <p className="text-gray-600 dark:text-slate-400">{v.event.dateWords}</p>
        {v.owed > 0.005
          ? <p className="text-3xl font-bold mt-1">{money(v.owed)}<span className="text-base font-normal text-gray-600 dark:text-slate-400">{v.dueDate ? ` due ${v.dueDate}` : ''}</span></p>
          : <p className="flex items-center gap-2 text-green-800 dark:text-green-300 font-medium mt-1"><Check className="w-5 h-5" />This payment has been made. Thank you!</p>}
      </section>
      {v.owed > 0.005 && !v.canPayByCard && <section className={box}><p>This venue takes card payments in person or by arrangement{v.brand.phone ? ` — please call ${v.brand.phone}` : ''}.</p></section>}
      <PayPanel base={base} offer={v} onChanged={load} />
    </Page>
  )
}

export default function GuestApp({ which }: { which: 'proposal' | 'pay' }) {
  return which === 'proposal' ? <ProposalPage /> : <PayPage />
}
