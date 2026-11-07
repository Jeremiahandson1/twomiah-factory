/**
 * Checkout at the chair, on the phone (salon parity row 26; Square): the visit's sale, a gift card for part of it, the tip, and the card tapped on
 * this phone — into the salon's own Stripe account, through the same charge the card reader uses (server/crm/salon/chairCheckout.ts):
 *   · GET  /api/chair-checkout/visits/:appointmentId/sale  → the sale the finished visit raised and what is still owing;
 *   · POST /api/salon-gift-cards/redeem { code, invoiceId } → a gift card takes its part (the split);
 *   · GET  /api/chair-checkout/sales/:id/tip-info           → the salon's tip percentages, worked on the services (not retail);
 *   · POST /api/chair-checkout/phone/connection-token       → Stripe Terminal's token and Location, on the salon's account;
 *   · POST /api/chair-checkout/phone/charges { invoiceId, amountCents, tipCents, key } → the PaymentIntent's client secret (same key, same one);
 *   · GET  /api/chair-checkout/charges/:id                  → Stripe's word: recorded only once it succeeded (polled twice, written once);
 *   · POST /api/chair-checkout/phone/charges/:id/declined   → the tap failed: the card network's words, the PaymentIntent cancelled.
 * Nothing is recorded on this phone's word. Refunds are the desk's (the same refund to the card as the reader's). Behind chair_checkout and
 * tap_to_pay, for a seat that may take a card (invoices:update or cardreader:use). The SDK is a native module (src/payments/terminal).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Platform, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { get, post } from '../../src/api/client'
import { useAuth } from '../../src/auth/AuthContext'
import { useVertical } from '../../src/vertical/VerticalContext'
import { useToast } from '../../src/components/ToastProvider'
import { useHaptics } from '../../src/hooks/useHaptics'
import { Screen, Card, DText, Button, TextField, EmptyState, SkeletonRows, Chip, space, layout } from '../../src/design'
import { loadTerminal } from '../../src/payments/terminal'
import { centsOf, dollars, tipChoices, newKey, chargeWords } from '../../src/payments/chairPay'

export default function SalonPayScreen() {
  const { appointmentId } = useLocalSearchParams<{ appointmentId: string }>()
  const router = useRouter()
  const { can } = useAuth()
  const { hasFeature } = useVertical()
  const sdk = useMemo(loadTerminal, [])
  const location = useRef<string | null>(null)
  const allowed = hasFeature('chair_checkout') && hasFeature('tap_to_pay') && (can('invoices:update') || can('cardreader:use'))

  if (!allowed) return <Screen title="Take payment" onBack={() => router.back()}><EmptyState icon="card-outline" title="Tap to Pay is not switched on" body="The owner can turn it on in the web app once it is ready." /></Screen>
  if (!sdk) return <Screen title="Take payment" onBack={() => router.back()}><EmptyState icon="cloud-download-outline" title="Update the app to take taps" body="This version of the app cannot use the phone as a card reader. Install the latest version from the store." /></Screen>

  const tokenProvider = async () => {
    const r = await post('/api/chair-checkout/phone/connection-token')
    if (!r.ok) throw new Error(r.error || 'Could not reach the card service')
    location.current = r.data.locationId
    return r.data.secret as string
  }
  const Provider = sdk.StripeTerminalProvider
  return (
    <Provider tokenProvider={tokenProvider} logLevel="error">
      <PayFlow sdk={sdk} appointmentId={String(appointmentId)} location={location} onDone={() => router.back()} />
    </Provider>
  )
}

type Step = 'loading' | 'ready' | 'connecting' | 'waiting' | 'recording' | 'done'

function PayFlow({ sdk, appointmentId, location, onDone }: { sdk: any; appointmentId: string; location: React.MutableRefObject<string | null>; onDone: () => void }) {
  const toast = useToast()
  const haptics = useHaptics()
  const { company } = useAuth()
  const terminal = sdk.useStripeTerminal({})
  const [sale, setSale] = useState<{ invoiceId: string; number: string; status: string; balanceCents: number } | null>(null)
  const [amount, setAmount] = useState('')
  const [tips, setTips] = useState<Array<{ percent: number; cents: number }>>([])
  const [tipCents, setTipCents] = useState(0)
  const [gift, setGift] = useState('')
  const [step, setStep] = useState<Step>('loading')
  const [problem, setProblem] = useState('')
  // One key per charge attempt: pressing again after a dropped answer asks for the same PaymentIntent, not a second.
  const attempt = useRef(newKey())

  const loadSale = useCallback(async () => {
    const r = await get(`/api/chair-checkout/visits/${encodeURIComponent(appointmentId)}/sale`)
    if (!r.ok) { setProblem(r.error || 'This visit has no sale yet.'); return null }
    setSale(r.data)
    setAmount(dollars(r.data.balanceCents).slice(1))
    return r.data
  }, [appointmentId])

  // The tip percentages, worked on the services of what goes on the card.
  const loadTips = useCallback(async (invoiceId: string, cents: number) => {
    if (!(cents > 0)) { setTips([]); return }
    const r = await get(`/api/chair-checkout/sales/${encodeURIComponent(invoiceId)}/tip-info?amountCents=${cents}`)
    setTips(r.ok ? tipChoices(r.data) : [])
  }, [])

  useEffect(() => {
    (async () => {
      const s = await loadSale()
      if (!s) return
      await loadTips(s.invoiceId, s.balanceCents)
      const init = await terminal.initialize()
      if (init?.error) { setProblem(init.error.message || 'The card reader could not start'); return }
      if (Platform.OS === 'android' && sdk.requestNeededAndroidPermissions) {
        const perms = await sdk.requestNeededAndroidPermissions({ accessFineLocation: { title: 'Location', message: 'Card payments need your location, as Stripe requires.', buttonPositive: 'OK' } }).catch(() => ({ error: true }))
        if (perms?.error) { setProblem('Allow location access to take card payments.'); return }
      }
      setStep('ready')
    })()
  }, [appointmentId]) // eslint-disable-line react-hooks/exhaustive-deps

  const fail = (message: string) => { haptics.error(); setProblem(message); setStep('ready') }

  // A part payment changes what the tip is worked on: asked again once the typing stops.
  useEffect(() => {
    if (!sale) return
    const t = setTimeout(() => { void loadTips(sale.invoiceId, centsOf(amount)) }, 400)
    return () => clearTimeout(t)
  }, [amount, sale?.invoiceId]) // eslint-disable-line react-hooks/exhaustive-deps

  // The split: a gift card takes its part of the balance first; the card takes the rest.
  const useGift = async () => {
    if (!sale || !gift.trim()) return
    setProblem('')
    const r = await post('/api/salon-gift-cards/redeem', { code: gift.trim(), invoiceId: sale.invoiceId })
    if (!r.ok) return fail(r.error || 'That gift card could not be used.')
    setGift('')
    toast.success('Gift card applied')
    const s = await loadSale()
    if (s) { setTipCents(0); await loadTips(s.invoiceId, s.balanceCents) }
  }

  const charge = async () => {
    if (!sale) return
    setProblem('')
    const cents = centsOf(amount)
    if (!(cents >= 50) || cents > sale.balanceCents) return fail(`Enter an amount from $0.50 up to ${dollars(sale.balanceCents)}.`)
    // 1. This phone as the reader (once per screen).
    if (!terminal.connectedReader) {
      setStep('connecting')
      if (!location.current) {
        const t = await post('/api/chair-checkout/phone/connection-token')
        if (!t.ok) return fail(t.error || 'Could not reach the card service')
        location.current = t.data.locationId
      }
      const c = await terminal.easyConnect({ discoveryMethod: 'tapToPay', locationId: location.current!, merchantDisplayName: company?.name || undefined, tosAcceptancePermitted: true })
      if (c?.error) return fail(c.error.message || 'This phone could not be set up as a card reader')
    }
    // 2. The PaymentIntent, from the server, on the salon's account: the amount and the tip together.
    const r = await post('/api/chair-checkout/phone/charges', { invoiceId: sale.invoiceId, amountCents: cents, tipCents, key: attempt.current })
    if (!r.ok) return fail(r.error || 'Could not start the payment')
    const chargeId = r.data.charge.id as string
    const got = await terminal.retrievePaymentIntent(r.data.charge.clientSecret)
    if (got?.error) return fail(got.error.message || 'Could not start the payment')
    // 3. The tap: the system's Tap to Pay screen collects the card and confirms it with Stripe.
    setStep('waiting')
    const paid = await terminal.processPaymentIntent({ paymentIntent: got.paymentIntent })
    if (paid?.error) {
      attempt.current = newKey()
      const d = await post(`/api/chair-checkout/phone/charges/${encodeURIComponent(chargeId)}/declined`, { message: paid.error.message })
      // Stripe may say it went through after all (the phone lost the answer): then it was recorded.
      if (d.ok && d.data?.charge?.status === 'succeeded') { haptics.success(); toast.success(`${dollars(cents + tipCents)} taken and recorded`); setStep('done'); onDone(); return }
      return fail(chargeWords(d.ok ? d.data.charge : null, paid.error.message))
    }
    // 4. Stripe's word, read by the server: recorded once it succeeded. A moment's wait is asked again, briefly.
    setStep('recording')
    for (let i = 0; i < 5; i++) {
      const s = await get(`/api/chair-checkout/charges/${encodeURIComponent(chargeId)}`)
      if (s.ok && s.data?.charge?.status === 'succeeded') {
        haptics.success()
        toast.success(`${dollars(cents + tipCents)} taken and recorded`)
        setStep('done'); onDone(); return
      }
      if (s.ok && s.data?.charge?.status && s.data.charge.status !== 'pending') return fail(chargeWords(s.data.charge, 'The card was not taken.'))
      await new Promise((res) => setTimeout(res, 1500))
    }
    fail('The card was tapped, and Stripe has not confirmed it yet. Check the sale on the desk before taking it again.')
  }

  if (!sale && !problem) return <Screen title="Take payment"><SkeletonRows count={3} /></Screen>
  const cents = centsOf(amount)
  return (
    <Screen title="Take payment" subtitle={sale?.number} onBack={onDone}
      footer={step === 'ready' && sale && sale.balanceCents > 0 ? <Button label={`Charge ${dollars(cents + tipCents)}`} icon="card" size="lg" fullWidth onPress={charge} /> : undefined}>
      <View style={{ gap: layout.sectionGap }}>
        {sale && (
          <Card>
            <View style={{ gap: space[2] }}>
              <DText variant="caption" tone="textSecondary">Owing on {sale.number}</DText>
              <DText variant="headline">{dollars(sale.balanceCents)}</DText>
              {sale.balanceCents > 0 ? (
                <TextField label="On the card" keyboardType="decimal-pad" prefix="$" value={amount}
                  onChangeText={step === 'ready' ? (v: string) => { setAmount(v); setTipCents(0) } : undefined} />
              ) : <DText tone="textSecondary">Nothing is owing. The sale is paid.</DText>}
            </View>
          </Card>
        )}
        {sale && sale.balanceCents > 0 && tips.length > 0 && (
          <Card>
            <View style={{ gap: space[2] }}>
              <DText variant="caption" tone="textSecondary">Tip for the stylist</DText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
                <Chip label="No tip" selected={tipCents === 0} onPress={() => setTipCents(0)} />
                {tips.map((t) => <Chip key={t.percent} label={`${t.percent}% · ${dollars(t.cents)}`} selected={tipCents === t.cents} onPress={() => setTipCents(t.cents)} />)}
              </View>
            </View>
          </Card>
        )}
        {sale && sale.balanceCents > 0 && step === 'ready' && (
          <Card>
            <View style={{ gap: space[2] }}>
              <DText variant="caption" tone="textSecondary">Part on a gift card</DText>
              <TextField label="Gift card number" autoCapitalize="characters" value={gift} onChangeText={setGift} />
              <Button label="Use the gift card" variant="secondary" onPress={useGift} disabled={!gift.trim()} />
            </View>
          </Card>
        )}
        {step === 'connecting' && <DText tone="textSecondary">Setting this phone up as a card reader…</DText>}
        {step === 'waiting' && <DText tone="textSecondary">Ask the client to tap their card or phone on the back of this phone.</DText>}
        {step === 'recording' && <DText tone="textSecondary">Recording the payment…</DText>}
        {problem ? <DText tone="danger" accessibilityRole="alert">{problem}</DText> : null}
      </View>
    </Screen>
  )
}
