/**
 * Card tabs on the phone (restaurant-bar parity row 14; bar_tab_preauth + tap_to_pay, both not ready): open a tab by holding the
 * guest's card with Tap to Pay, and close it with the tip. The register stays on the counter: this screen lists the open checks
 * only to put a card on one or take the card off it.
 *   GET  /api/food/tabs                                    the open checks and their tabs
 *   POST /api/food/terminal/tab/phone { checkId, amountCents }   the hold, made by the server on the business's own Stripe
 *   POST /api/food/terminal/tab/phone/:id/authorized       the server reads the hold back from Stripe before it counts
 *   POST /api/food/terminal/tab/:id/close { tipCents }     the capture (no reader needed)  ·  /release lets the card go
 * The card is collected by Stripe Terminal's SDK exactly as app/(details)/invoice/tap.tsx does; nothing else here touches a card.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Platform, View } from 'react-native'
import { useRouter } from 'expo-router'
import { get, post } from '../../src/api/client'
import { useAuth } from '../../src/auth/AuthContext'
import { useVertical } from '../../src/vertical/VerticalContext'
import { useToast } from '../../src/components/ToastProvider'
import { useHaptics } from '../../src/hooks/useHaptics'
import { loadTerminal } from '../../src/payments/terminal'
import { Screen, Card, Button, DText, EmptyState, TextField, SkeletonRows, space, layout } from '../../src/design'

const money = (c: number) => `$${(c / 100).toFixed(2)}`
type Check = { id: string; number: number; label: string; balanceCents: number; tab: { id: string; status: string; amountCents: number; card: { brand: string | null; last4: string | null } | null } | null }

export default function BarTabs() {
  const router = useRouter()
  const { can } = useAuth()
  const { hasFeature } = useVertical()
  const sdk = loadTerminal()
  if (!hasFeature('bar_tab_preauth') || !hasFeature('tap_to_pay') || !can('bar:register')) return <Screen title="Card tabs" onBack={() => router.back()}><EmptyState icon="lock-closed" title="Not available" body="Your business has not turned on card tabs on the phone for your seat." /></Screen>
  if (!sdk) return <Screen title="Card tabs" onBack={() => router.back()}><EmptyState icon="phone-portrait" title="Update the app" body="This build of the app cannot take cards. Install the latest version." /></Screen>
  return <sdk.StripeTerminalProvider tokenProvider={async () => { const r = await post('/api/stripe/tap-to-pay/connection-token'); if (!r.ok) throw new Error(r.error || 'No connection token'); return r.data.secret }}><Inner sdk={sdk} onBack={() => router.back()} /></sdk.StripeTerminalProvider>
}

function Inner({ sdk, onBack }: { sdk: any; onBack: () => void }) {
  const toast = useToast()
  const haptics = useHaptics()
  const { company } = useAuth()
  const terminal = sdk.useStripeTerminal()
  const [checks, setChecks] = useState<Check[] | null>(null)
  const [hold, setHold] = useState('50.00')
  const [tip, setTip] = useState('')
  const [busy, setBusy] = useState<string>('')
  const [problem, setProblem] = useState('')
  const location = useRef<string | null>(null)
  const load = useCallback(async () => { const r = await get('/api/food/tabs'); if (r.ok) setChecks(r.data.checks); else setProblem(r.error || 'Could not load the checks') }, [])
  useEffect(() => { void load(); void terminal.initialize?.() }, [load]) // eslint-disable-line react-hooks/exhaustive-deps
  const fail = (m: string) => { haptics.error(); setProblem(m); setBusy('') }

  const openTab = async (c: Check) => {
    setProblem(''); setBusy(c.id)
    const cents = Math.round(Number(hold) * 100)
    if (!(cents >= 100 && cents <= 100_000)) return fail('A hold is $1 to $1,000.')
    if (Platform.OS === 'android' && sdk.requestNeededAndroidPermissions) {
      const perms = await sdk.requestNeededAndroidPermissions({ accessFineLocation: { title: 'Location', message: 'Card payments need your location, as Stripe requires.', buttonPositive: 'OK' } }).catch(() => ({ error: true }))
      if (perms?.error) return fail('Allow location access to take cards.')
    }
    if (!terminal.connectedReader) {
      if (!location.current) { const r = await post('/api/stripe/tap-to-pay/connection-token'); if (!r.ok) return fail(r.error || 'Could not reach the card service'); location.current = r.data.locationId }
      const con = await terminal.easyConnect({ discoveryMethod: 'tapToPay', locationId: location.current!, merchantDisplayName: company?.name || undefined, tosAcceptancePermitted: true })
      if (con?.error) return fail(con.error.message || 'This phone could not be set up as a card reader')
    }
    // The hold, made by the server; the SDK collects the card against it (manual capture: nothing is taken yet).
    const r = await post('/api/food/terminal/tab/phone', { checkId: c.id, amountCents: cents })
    if (!r.ok) return fail(r.error || 'Could not start the hold')
    const got = await terminal.retrievePaymentIntent(r.data.clientSecret)
    if (got?.error) return fail(got.error.message || 'Could not start the hold')
    const held = await terminal.processPaymentIntent({ paymentIntent: got.paymentIntent })
    if (held?.error) return fail(held.error.message || 'The card was not held')
    const ok = await post(`/api/food/terminal/tab/phone/${r.data.charge.id}/authorized`)
    if (!ok.ok) return fail(ok.error || 'Stripe did not confirm the hold. Tap the card again.')
    haptics.success(); toast.success(`${money(cents)} held on the card`)
    setBusy(''); await load()
  }
  const closeTab = async (c: Check) => {
    if (!c.tab) return
    setProblem(''); setBusy(c.id)
    const tipCents = tip.trim() ? Math.round(Number(tip) * 100) : 0
    if (!(tipCents >= 0)) return fail('Check the tip.')
    const r = await post(`/api/food/terminal/tab/${c.tab.id}/close`, { tipCents })
    if (!r.ok) return fail(r.error || 'The tab did not close')
    haptics.success(); toast.success(`${money(r.data.paidCents + r.data.tipCents)} taken; the tab is closed`)
    setBusy(''); setTip(''); await load()
  }
  const release = async (c: Check) => {
    if (!c.tab) return
    setProblem(''); setBusy(c.id)
    const r = await post(`/api/food/terminal/tab/${c.tab.id}/release`)
    if (!r.ok) return fail(r.error || 'The card was not released')
    toast.success('The card is released'); setBusy(''); await load()
  }

  if (!checks && !problem) return <Screen title="Card tabs" onBack={onBack}><SkeletonRows count={4} /></Screen>
  return (
    <Screen title="Card tabs" subtitle="Hold a card with Tap to Pay; close with the tip" onBack={onBack}>
      <View style={{ gap: layout.sectionGap }}>
        {problem ? <DText tone="danger" accessibilityRole="alert">{problem}</DText> : null}
        {checks && checks.length === 0 ? <EmptyState icon="receipt" title="No open checks" body="Open a check on the register first; it shows here to put a card on." /> : null}
        {checks?.map((c) => (
          <Card key={c.id}>
            <View style={{ gap: space[2] }}>
              <DText variant="headline">#{c.number} · {c.label}</DText>
              <DText variant="caption" tone="textSecondary">{money(c.balanceCents)} on the check{c.tab ? ` · ${c.tab.card?.brand ? c.tab.card.brand.toUpperCase() : 'Card'}${c.tab.card?.last4 ? ' ····' + c.tab.card.last4 : ''} holds ${money(c.tab.amountCents)}` : ' · no card held'}</DText>
              {c.tab && c.tab.status === 'authorized' ? (
                <>
                  <TextField label="Tip (optional)" keyboardType="decimal-pad" prefix="$" value={tip} onChangeText={setTip} />
                  <View style={{ flexDirection: 'row', gap: space[2] }}>
                    <Button label={`Close for ${money(c.balanceCents + (tip.trim() ? Math.round(Number(tip) * 100) || 0 : 0))}`} icon="checkmark" loading={busy === c.id} onPress={() => closeTab(c)} />
                    <Button label="Release the card" variant="ghost" onPress={() => release(c)} />
                  </View>
                </>
              ) : (
                <>
                  <TextField label="Hold on the card" keyboardType="decimal-pad" prefix="$" value={hold} onChangeText={setHold} />
                  <Button label="Hold a card (Tap to Pay)" icon="card" loading={busy === c.id} onPress={() => openTab(c)} />
                </>
              )}
            </View>
          </Card>
        ))}
      </View>
    </Screen>
  )
}
