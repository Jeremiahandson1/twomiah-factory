/**
 * Tap to Pay — the customer taps their card on this phone; the money goes to the business's own Stripe account and the
 * payment is recorded on the invoice (tap_to_pay, not ready; the owner's decision 10/30).
 *
 * The server (packages/tenant-backend payments/stripe.ts, /api/stripe/tap-to-pay/…):
 *   · POST connection-token              → { secret, locationId } for Stripe Terminal's SDK, on the business's account;
 *   · POST invoices/:id/intent { amount, key } → { clientSecret, paymentIntentId, amount }: an in-person PaymentIntent for
 *     what is owed (or less) — `key` makes a second press the same PaymentIntent;
 *   · POST payments/:paymentIntentId/record → { recorded, status }: the server reads the PaymentIntent from Stripe and
 *     records it once it succeeded. Nothing is recorded on this phone's word.
 * The SDK is a native module: an app built before it was added has none, so it is loaded here, on this screen only, and
 * a phone without it is told to update the app instead of crashing. Tap to Pay on iPhone also needs Apple's entitlement in
 * the build (app.config.ts TAP_TO_PAY_IOS).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Platform, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { get, post } from '../../../src/api/client'
import { useOfflineApi } from '../../../src/offline/useOfflineApi'
import { useAuth } from '../../../src/auth/AuthContext'
import { useVertical } from '../../../src/vertical/VerticalContext'
import { useToast } from '../../../src/components/ToastProvider'
import { useHaptics } from '../../../src/hooks/useHaptics'
import { Screen, Card, DText, Button, TextField, EmptyState, SkeletonRows, space, layout } from '../../../src/design'
import { loadTerminal } from '../../../src/payments/terminal'

const num = (v: unknown) => Number(v) || 0
const money = (v: unknown) => `$${num(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function TapToPayScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { can } = useAuth()
  const { hasFeature } = useVertical()
  const sdk = useMemo(loadTerminal, [])
  const location = useRef<string | null>(null)
  const allowed = hasFeature('tap_to_pay') && can('invoices:update')

  if (!allowed) return <Screen title="Tap to Pay" onBack={() => router.back()}><EmptyState icon="card-outline" title="Tap to Pay is not switched on" body="The owner can turn it on in the web app once it is ready." /></Screen>
  if (!sdk) return <Screen title="Tap to Pay" onBack={() => router.back()}><EmptyState icon="cloud-download-outline" title="Update the app to take taps" body="This version of the app cannot use the phone as a card reader. Install the latest version from the store." /></Screen>

  // The SDK asks for a connection token whenever it needs one; the location comes with it.
  const tokenProvider = async () => {
    const r = await post('/api/stripe/tap-to-pay/connection-token')
    if (!r.ok) throw new Error(r.error || 'Could not reach the card service')
    location.current = r.data.locationId
    return r.data.secret as string
  }
  const Provider = sdk.StripeTerminalProvider
  return (
    <Provider tokenProvider={tokenProvider} logLevel="error">
      <TapFlow sdk={sdk} invoiceId={String(id)} location={location} onDone={() => router.back()} />
    </Provider>
  )
}

type Step = 'loading' | 'ready' | 'connecting' | 'waiting' | 'recording' | 'done'

function TapFlow({ sdk, invoiceId, location, onDone }: { sdk: any; invoiceId: string; location: React.MutableRefObject<string | null>; onDone: () => void }) {
  const toast = useToast()
  const haptics = useHaptics()
  const { company } = useAuth()
  // Offline mode (parity row 14): what the SDK says about forwarding, shown in plain words.
  const [offlineNote, setOfflineNote] = useState('')
  const terminal = sdk.useStripeTerminal({
    onDidChangeOfflineStatus: (status: any) => { const n = Number(status?.sdk?.offlinePaymentsCount ?? status?.offlinePaymentsCount ?? 0); setOfflineNote(n > 0 ? `${n} payment${n === 1 ? '' : 's'} taken offline, waiting to be sent to Stripe.` : '') },
    onDidForwardPaymentIntent: () => setOfflineNote('An offline payment reached Stripe.'),
    onDidReportForwardingError: (e: any) => setOfflineNote(`An offline payment could not be sent: ${e?.message || 'Stripe refused it'}. It stays on this phone to try again.`),
  })
  const queued = useOfflineApi()
  const [invoice, setInvoice] = useState<any>(null)
  const [amount, setAmount] = useState('')
  const [step, setStep] = useState<Step>('loading')
  const [problem, setProblem] = useState('')
  // One key per charge attempt: pressing again after a dropped answer asks for the same PaymentIntent, not a second.
  const attempt = useRef<string>(`t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`)

  useEffect(() => {
    (async () => {
      const r = await get(`/api/invoices/${invoiceId}`)
      if (!r.ok) { setProblem(r.error || 'Invoice not found'); return }
      setInvoice(r.data)
      setAmount(num(r.data.balance).toFixed(2))
      const init = await terminal.initialize()
      if (init?.error) { setProblem(init.error.message || 'The card reader could not start'); return }
      if (Platform.OS === 'android' && sdk.requestNeededAndroidPermissions) {
        const perms = await sdk.requestNeededAndroidPermissions({ accessFineLocation: { title: 'Location', message: 'Card payments need your location, as Stripe requires.', buttonPositive: 'OK' } }).catch(() => ({ error: true }))
        if (perms?.error) { setProblem('Allow location access to take card payments.'); return }
      }
      setStep('ready')
    })()
  }, [invoiceId]) // eslint-disable-line react-hooks/exhaustive-deps

  const fail = (message: string) => { haptics.error(); setProblem(message); setStep('ready') }

  const charge = async () => {
    setProblem('')
    const want = Number(amount)
    if (!(want > 0) || want > num(invoice.balance) + 0.005) return fail(`Enter an amount up to ${money(invoice.balance)}.`)
    // 1. Connect this phone as the reader (once per screen).
    if (!terminal.connectedReader) {
      setStep('connecting')
      if (!location.current) { try { await post('/api/stripe/tap-to-pay/connection-token').then((r) => { if (r.ok) location.current = r.data.locationId; else throw new Error(r.error) }) } catch (e: any) { return fail(e?.message || 'Could not reach the card service') } }
      const c = await terminal.easyConnect({ discoveryMethod: 'tapToPay', locationId: location.current!, merchantDisplayName: company?.name || undefined, tosAcceptancePermitted: true })
      if (c?.error) return fail(c.error.message || 'This phone could not be set up as a card reader')
    }
    // 2. The PaymentIntent, from the server, on the business's account. With no signal (restaurant-bar parity row 14,
    //    Stripe Terminal OFFLINE MODE): the SDK makes it on the phone instead, with the same metadata the server's record
    //    checks, takes the card, and forwards it to Stripe when the phone is back online - within the limits Stripe sets for
    //    the account (offline mode and its per-payment and stored totals are switched on in the Stripe Dashboard).
    let paymentIntentId = '', offline = false
    let got: any
    const r = await post(`/api/stripe/tap-to-pay/invoices/${invoiceId}/intent`, { amount: want, key: attempt.current })
    if (r.ok) {
      paymentIntentId = r.data.paymentIntentId
      got = await terminal.retrievePaymentIntent(r.data.clientSecret)
      if (got?.error) return fail(got.error.message || 'Could not start the payment')
    } else if (r.status === 0 && terminal.createPaymentIntent) {
      offline = true
      got = await terminal.createPaymentIntent({ amount: Math.round(want * 100), currency: 'usd', captureMethod: 'automatic', offlineBehavior: 'force_offline',
        metadata: { kind: 'tap_to_pay', company_id: String((company as any)?.id || ''), invoice_id: String(invoiceId), invoice_number: String(invoice?.number || ''), offline: '1' } })
      if (got?.error) return fail(got.error.message || 'No signal, and this phone cannot take the card offline (offline mode is switched on in Stripe).')
      paymentIntentId = String(got.paymentIntent?.id || '')
    } else return fail(r.error || 'Could not start the payment')
    // 3. The tap: the SDK shows the system's Tap to Pay screen, collects the card and confirms it with Stripe (or keeps it, offline).
    setStep('waiting')
    const paid = await terminal.processPaymentIntent({ paymentIntent: got.paymentIntent })
    if (paid?.error) { attempt.current = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`; return fail(paid.error.message || 'The card was not taken') }
    if (offline || paid?.paymentIntent?.offlineDetails?.requiresUpload) {
      // Kept on the phone: the SDK forwards it; the record goes through the offline queue and is answered once Stripe has it.
      const q = await queued.post(`/api/stripe/tap-to-pay/payments/${encodeURIComponent(paymentIntentId || paid?.paymentIntent?.id || '')}/record`, { offline: true }, { recordKey: `tap:${invoiceId}`, label: `${invoice?.number || 'Invoice'} · ${money(want)} taken offline` })
      haptics.success()
      toast.success(q.queued ? `${money(want)} taken offline. It is recorded when the phone is back online.` : `${money(want)} taken and recorded`)
      setStep('done'); onDone(); return
    }
    // 4. The server reads it from Stripe and records it.
    setStep('recording')
    const rec = await post(`/api/stripe/tap-to-pay/payments/${encodeURIComponent(paymentIntentId)}/record`)
    if (!rec.ok) return fail(rec.error || 'The card was taken but the payment could not be recorded. Record it by hand.')
    if (!rec.data?.recorded) return fail(`Stripe says the payment is ${String(rec.data?.status || 'not finished').replace(/_/g, ' ')}. Nothing was recorded.`)
    haptics.success()
    toast.success(`${money(rec.data.amount)} taken and recorded`)
    setStep('done')
    onDone()
  }

  if (!invoice && !problem) return <Screen title="Tap to Pay"><SkeletonRows count={3} /></Screen>
  return (
    <Screen title="Tap to Pay" subtitle={invoice?.number} onBack={onDone}
      footer={step === 'ready' ? <Button label={`Charge ${money(amount)}`} icon="card" size="lg" fullWidth onPress={charge} /> : undefined}>
      <View style={{ gap: layout.sectionGap }}>
        {invoice && (
          <Card>
            <View style={{ gap: space[2] }}>
              <DText variant="caption" tone="textSecondary">Owed on {invoice.number}</DText>
              <DText variant="headline">{money(invoice.balance)}</DText>
              <TextField label="Amount to take" keyboardType="decimal-pad" prefix="$" value={amount} onChangeText={step === 'ready' ? setAmount : undefined} />
            </View>
          </Card>
        )}
        {step === 'connecting' && <DText tone="textSecondary">Setting this phone up as a card reader…</DText>}
        {step === 'waiting' && <DText tone="textSecondary">Ask the customer to tap their card or phone on the back of this phone.</DText>}
        {step === 'recording' && <DText tone="textSecondary">Recording the payment…</DText>}
        {offlineNote ? <DText tone="textSecondary">{offlineNote}</DText> : null}
        {problem ? <DText tone="danger" accessibilityRole="alert">{problem}</DText> : null}
      </View>
    </Screen>
  )
}
