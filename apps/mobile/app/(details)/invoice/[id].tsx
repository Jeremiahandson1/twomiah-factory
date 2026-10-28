/**
 * Invoice — what it totals, what is paid, what is owed; "Record payment" and "Send invoice".
 *
 * GET /api/invoices/:id answers total, amountPaid, amountRefunded and the server's own `balance`, `lineItems` and `payments` —
 * every figure decimal DOLLARS. "Record payment" is POST /:id/payments { amount, method } for money ALREADY received (cash, check,
 * card, bank transfer, other) — it takes nothing from anyone's card. "Send invoice" is POST /:id/send: the customer's email with the
 * invoice's own pay link. Both need invoices:update. The PDF opens in the phone's browser on a one-time link (openDownload).
 */
import React, { useState, useEffect, useCallback } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { get, post } from '../../../src/api/client'
import { openDownload } from '../../../src/api/download'
import { invoiceStatusLabel, paymentMethodLabel } from '../../../src/home/labels'
import { useAuth } from '../../../src/auth/AuthContext'
import { useToast } from '../../../src/components/ToastProvider'
import { useHaptics } from '../../../src/hooks/useHaptics'
import { useRealTimeEvent, EVENTS } from '../../../src/socket/SocketContext'
import {
  Screen, Card, Group, ListRow, SectionHeader, DText, Badge, Button, BottomSheet, TextField, Chip, ChipRow, EmptyState, SkeletonRows, space, layout,
} from '../../../src/design'

// What the server accepts for a payment recorded by hand (invoices.ts PAYMENT_METHODS, less stripe and account_balance).
const METHODS: { id: string; label: string }[] = [
  { id: 'cash', label: 'Cash' }, { id: 'check', label: 'Check' }, { id: 'card', label: 'Card' }, { id: 'bank_transfer', label: 'Bank transfer' }, { id: 'other', label: 'Other' },
]
const num = (v: unknown) => Number(v) || 0
const money = (v: unknown) => `$${num(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
/** What was typed, as dollars to the cent — or null when it is not an amount. */
export const paymentDollars = (typed: string): number | null => {
  const n = Number(String(typed).replace(/[$,\s]/g, ''))
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n * 100) / 100
}
const STATUS_TONE: Record<string, any> = { paid: 'success', draft: 'neutral', void: 'neutral', refunded: 'neutral', overdue: 'danger', partial: 'warning' }

export default function InvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const toast = useToast()
  const haptics = useHaptics()
  const { can } = useAuth()
  const canUpdate = can('invoices:update')
  const [invoice, setInvoice] = useState<any>(null)
  const [refused, setRefused] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [sheet, setSheet] = useState<'pay' | 'send' | null>(null)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('cash')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await get(`/api/invoices/${id}`)
    if (res.ok) setInvoice(res.data)
    setRefused(res.status === 403)
    setLoading(false)
  }, [id])
  useEffect(() => { load() }, [load])
  useRealTimeEvent(EVENTS.INVOICE_UPDATED, load, [load])
  useRealTimeEvent(EVENTS.INVOICE_PAID, load, [load])
  useRealTimeEvent(EVENTS.PAYMENT_RECEIVED, load, [load])

  const total = num(invoice?.total)
  const paid = num(invoice?.amountPaid) - num(invoice?.amountRefunded)
  const balance = invoice?.balance !== undefined ? num(invoice.balance) : total - paid
  const canPay = canUpdate && balance > 0 && !['void', 'draft', 'refunded'].includes(invoice?.status)
  const canSend = canUpdate && !['void', 'refunded', 'paid'].includes(invoice?.status)

  const openPay = () => { setAmount(balance > 0 ? balance.toFixed(2) : ''); setMethod('cash'); setSheet('pay') }
  const recordPayment = async () => {
    const dollars = paymentDollars(amount)
    if (dollars === null) { toast.error('Enter an amount greater than zero'); return }
    setBusy(true)
    const res = await post(`/api/invoices/${id}/payments`, { amount: dollars, method })
    setBusy(false)
    if (res.ok) { haptics.success(); toast.success('Payment recorded'); setSheet(null); load() }
    else { haptics.error(); toast.error(res.error || 'Could not record the payment') }
  }
  const sendInvoice = async () => {
    setBusy(true)
    const res = await post(`/api/invoices/${id}/send`)
    setBusy(false)
    if (res.ok) { haptics.success(); toast.success('Invoice sent'); setSheet(null); load() }
    else { haptics.error(); toast.error(res.error || 'Could not send the invoice') }
  }

  if (loading) return <Screen title="Invoice" onBack={() => router.back()}><SkeletonRows count={4} /></Screen>
  if (!invoice) return <Screen title="Invoice" onBack={() => router.back()}><EmptyState icon="receipt" title={refused ? 'Not part of your role' : 'Invoice not found'} body={refused ? 'Your role does not include invoices.' : undefined} /></Screen>

  const items: any[] = Array.isArray(invoice.lineItems) ? invoice.lineItems : []
  const payments: any[] = Array.isArray(invoice.payments) ? invoice.payments : []

  return (
    <Screen title={invoice.number || 'Invoice'} subtitle={invoice.contact?.name} onBack={() => router.back()} refreshing={refreshing}
      onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false) }}
      footer={(canPay || canSend) ? (
        <View style={{ flexDirection: 'row', gap: space[2] }}>
          {canPay ? <View style={{ flex: 1 }}><Button label="Record payment" icon="cash" size="lg" fullWidth onPress={openPay} /></View> : null}
          {canSend ? <View style={{ flex: 1 }}><Button label={invoice.status === 'draft' ? 'Send invoice' : 'Send again'} icon="paper-plane" size="lg" fullWidth variant={canPay ? 'secondary' : 'primary'} onPress={() => setSheet('send')} /></View> : null}
        </View>
      ) : undefined}>
      <View style={{ gap: layout.sectionGap }}>
        <Card>
          <View style={{ gap: space[3] }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <DText variant="callout" tone="textSecondary">{invoice.createdAt ? `Created ${new Date(invoice.createdAt).toLocaleDateString()}` : 'Invoice'}</DText>
              <Badge label={invoiceStatusLabel(invoice.status)} tone={STATUS_TONE[invoice.status] || 'info'} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <View><DText variant="caption" tone="textSecondary">Total</DText><DText variant="headline">{money(total)}</DText></View>
              <View><DText variant="caption" tone="textSecondary">Paid</DText><DText variant="headline">{money(paid)}</DText></View>
              <View><DText variant="caption" tone="textSecondary">Owed</DText><DText variant="headline" tone={balance > 0 ? 'danger' : 'success'}>{money(balance)}</DText></View>
            </View>
          </View>
        </Card>

        {invoice.contact ? (
          <Group><ListRow icon="person" title={invoice.contact.name} subtitle="Customer" divider={false} onPress={() => router.push(`/(details)/contact/${invoice.contact.id || invoice.contactId}` as any)} /></Group>
        ) : null}

        {items.length > 0 ? (
          <View>
            <SectionHeader title="Line items" />
            <Group>{items.map((it, i) => <ListRow key={it.id || i} title={it.description} subtitle={`${num(it.quantity)} × ${money(it.unitPrice)}`} meta={money(it.total)} divider={i < items.length - 1} />)}</Group>
          </View>
        ) : null}

        {payments.length > 0 ? (
          <View>
            <SectionHeader title="Payments" />
            <Group>{payments.map((p, i) => (
              <ListRow key={p.id || i} title={money(p.amount)} subtitle={paymentMethodLabel(p.method)} meta={new Date(p.paidAt || p.createdAt).toLocaleDateString()} divider={i < payments.length - 1} />
            ))}</Group>
          </View>
        ) : null}

        <Button label="View PDF" icon="document" variant="secondary" onPress={async () => { const err = await openDownload(`/api/invoices/${id}/pdf`); if (err) { haptics.error(); toast.error(err) } }} />
      </View>

      <BottomSheet visible={sheet === 'pay'} title="Record payment" onClose={() => setSheet(null)}>
        <View style={{ gap: space[3] }}>
          <DText variant="callout" tone="textSecondary">Record a payment you already received.</DText>
          <TextField label="Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" prefix="$" />
          <DText variant="captionStrong" tone="textSecondary">How was it paid?</DText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>{METHODS.map((m) => <Chip key={m.id} label={m.label} selected={method === m.id} onPress={() => setMethod(m.id)} />)}</View>
          <Button label="Record payment" size="lg" fullWidth loading={busy} onPress={recordPayment} />
        </View>
      </BottomSheet>

      <BottomSheet visible={sheet === 'send'} title={invoice.status === 'draft' ? 'Send invoice' : 'Send again'} onClose={() => setSheet(null)}>
        <View style={{ gap: space[3] }}>
          <DText variant="body">{`Email ${invoice.number} to ${invoice.contact?.name || 'the customer'}, with a link where they can view it and pay.`}</DText>
          <Button label="Send invoice" icon="paper-plane" size="lg" fullWidth loading={busy} onPress={sendInvoice} />
        </View>
      </BottomSheet>
    </Screen>
  )
}
