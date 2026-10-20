/**
 * Invoice Detail — line items, payment history, record payment, send.
 *
 * GET /api/invoices/:id (packages/tenant-backend invoicing/invoices.ts) answers total, amountPaid, amountRefunded and the
 * server's own `balance`, `lineItems` [{ description, quantity, unitPrice, total }] and `payments` [{ amount, method,
 * paidAt }] — every figure decimal DOLLARS. POST /:id/payments takes { amount, method } in DOLLARS too: $12.34 is 12.34
 * (sending cents recorded a payment 100 times too big). Sending and recording a payment need invoices:update. The PDF
 * needs the session, which a browser opened from the phone does not carry, so the phone does not offer it.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, TextInput,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter, Stack } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet'
import { useTheme } from '../../../src/theme/ThemeContext'
import { get, post } from '../../../src/api/client'
import { useAuth } from '../../../src/auth/AuthContext'
import { StatusBadge } from '../../../src/components/StatusBadge'
import { SkeletonList } from '../../../src/components/SkeletonLoader'
import { AnimatedCard } from '../../../src/components/AnimatedCard'
import { ConfirmSheet } from '../../../src/components/ConfirmSheet'
import { useToast } from '../../../src/components/ToastProvider'
import { useHaptics } from '../../../src/hooks/useHaptics'
import { useRealTimeEvent, EVENTS } from '../../../src/socket/SocketContext'

// Methods the server accepts for a payment recorded by hand (invoices.ts PAYMENT_METHODS, less stripe and account_balance).
const PAYMENT_METHODS = ['cash', 'check', 'card', 'bank_transfer', 'other']
const num = (v: unknown) => Number(v) || 0
const money = (v: unknown) => `$${num(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
/** What was typed, as dollars to the cent — or null when it is not an amount. */
const paymentDollars = (typed: string): number | null => {
  const n = Number(String(typed).replace(/[$,\s]/g, ''))
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n * 100) / 100
}

export default function InvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const t = useTheme()
  const toast = useToast()
  const haptics = useHaptics()
  const { can } = useAuth()
  const canUpdate = can('invoices:update')
  const [invoice, setInvoice] = useState<any>(null)
  const [refused, setRefused] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showSendConfirm, setShowSendConfirm] = useState(false)
  // Payment sheet
  const [showPayment, setShowPayment] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('cash')
  const [paySubmitting, setPaySubmitting] = useState(false)
  const paymentSheetRef = React.useRef<BottomSheet>(null)

  const load = useCallback(async () => {
    const res = await get(`/api/invoices/${id}`)
    if (res.ok) setInvoice(res.data)
    setRefused(res.status === 403)
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false) }
  useRealTimeEvent(EVENTS.INVOICE_UPDATED, load, [load])
  useRealTimeEvent(EVENTS.INVOICE_PAID, load, [load])
  useRealTimeEvent(EVENTS.PAYMENT_RECEIVED, load, [load])

  const handleSend = async () => {
    const res = await post(`/api/invoices/${id}/send`)
    if (res.ok) { haptics.success(); toast.success('Invoice sent'); load() }
    else { haptics.error(); toast.error(res.error || 'Send failed') }
  }

  const handleRecordPayment = async () => {
    const amount = paymentDollars(payAmount)
    if (amount === null) { toast.error('Enter a valid amount'); return }
    setPaySubmitting(true)
    const res = await post(`/api/invoices/${id}/payments`, { amount, method: payMethod })
    if (res.ok) {
      haptics.success()
      toast.success('Payment recorded')
      setShowPayment(false)
      setPayAmount('')
      paymentSheetRef.current?.close()
      load()
    } else {
      haptics.error()
      toast.error(res.error || 'Failed to record payment')
    }
    setPaySubmitting(false)
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
        <Stack.Screen options={{ title: 'Invoice' }} />
        <SkeletonList count={4} />
      </SafeAreaView>
    )
  }

  if (!invoice) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
        <Stack.Screen options={{ title: 'Invoice' }} />
        <View style={styles.centered}><Text style={{ color: t.textMuted }}>{refused ? 'Invoices are not part of your role.' : 'Invoice not found'}</Text></View>
      </SafeAreaView>
    )
  }

  const items: any[] = Array.isArray(invoice.lineItems) ? invoice.lineItems : []
  const payments: any[] = Array.isArray(invoice.payments) ? invoice.payments : []
  const total = num(invoice.total)
  // Paid net of refunds; the balance is the server's (invoiceBalance), never re-derived here.
  const paid = num(invoice.amountPaid) - num(invoice.amountRefunded)
  const balance = invoice.balance !== undefined ? num(invoice.balance) : total - paid
  const canPay = canUpdate && balance > 0 && !['void', 'draft'].includes(invoice.status)

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      <Stack.Screen options={{ title: invoice.number || 'Invoice' }} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
      >
        {/* Header */}
        <AnimatedCard index={0}>
          <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
            <View style={styles.headerRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: t.text }]}>{invoice.number}</Text>
                {invoice.createdAt && <Text style={[styles.sub, { color: t.textSecondary }]}>Created {new Date(invoice.createdAt).toLocaleDateString()}</Text>}
              </View>
              <StatusBadge status={invoice.status} />
            </View>
            <View style={styles.amountRow}>
              <View>
                <Text style={[styles.amountLabel, { color: t.textMuted }]}>Total</Text>
                <Text style={[styles.amount, { color: t.text }]}>{money(total)}</Text>
              </View>
              <View>
                <Text style={[styles.amountLabel, { color: t.textMuted }]}>Paid</Text>
                <Text style={[styles.amount, { color: '#22c55e' }]}>{money(paid)}</Text>
              </View>
              <View>
                <Text style={[styles.amountLabel, { color: t.textMuted }]}>Balance</Text>
                <Text style={[styles.amount, { color: balance > 0 ? '#ef4444' : '#22c55e' }]}>{money(balance)}</Text>
              </View>
            </View>
          </View>
        </AnimatedCard>

        {/* Contact */}
        {invoice.contact && (
          <AnimatedCard index={1}>
            <TouchableOpacity
              style={[styles.card, { backgroundColor: t.surface, borderColor: t.border, flexDirection: 'row', alignItems: 'center', gap: 10 }]}
              onPress={() => router.push(`/(details)/contact/${invoice.contact.id || invoice.contactId}`)}
            >
              <Ionicons name="person-circle-outline" size={24} color={t.primary} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: t.text }}>
                  {invoice.contact.name}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={t.textMuted} />
            </TouchableOpacity>
          </AnimatedCard>
        )}

        {/* Line Items */}
        <AnimatedCard index={2}>
          <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Text style={[styles.sectionTitle, { color: t.text }]}>Line Items</Text>
            {items.map((item: any, i: number) => (
              <View key={item.id || i} style={[styles.lineItem, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '500', color: t.text }}>{item.description}</Text>
                  <Text style={{ fontSize: 12, color: t.textMuted, marginTop: 2 }}>{num(item.quantity)} x {money(item.unitPrice)}</Text>
                </View>
                <Text style={{ fontSize: 14, fontWeight: '600', color: t.text }}>{money(item.total)}</Text>
              </View>
            ))}
          </View>
        </AnimatedCard>

        {/* Payment History */}
        {payments.length > 0 && (
          <AnimatedCard index={3}>
            <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
              <Text style={[styles.sectionTitle, { color: t.text }]}>Payment History</Text>
              {payments.map((pay: any, i: number) => (
                <View key={pay.id || i} style={[styles.paymentRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '500', color: t.text }}>{money(pay.amount)}</Text>
                    <Text style={{ fontSize: 12, color: t.textMuted, marginTop: 2, textTransform: 'capitalize' }}>{String(pay.method || 'payment').replace(/_/g, ' ')}</Text>
                  </View>
                  <Text style={{ fontSize: 12, color: t.textMuted }}>{new Date(pay.paidAt || pay.createdAt).toLocaleDateString()}</Text>
                </View>
              ))}
            </View>
          </AnimatedCard>
        )}

        {/* Actions */}
        <AnimatedCard index={4}>
          <View style={styles.actionsCol}>
            {canUpdate && invoice.status === 'draft' && (
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#3b82f6' }]}
                onPress={() => setShowSendConfirm(true)}>
                <Ionicons name="send" size={18} color="#fff" />
                <Text style={styles.actionText}>Send Invoice</Text>
              </TouchableOpacity>
            )}
            {canPay && (
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#22c55e' }]}
                onPress={() => {
                  setPayAmount(balance.toFixed(2))
                  setShowPayment(true)
                  paymentSheetRef.current?.expand()
                }}>
                <Ionicons name="cash" size={18} color="#fff" />
                <Text style={styles.actionText}>Record Payment</Text>
              </TouchableOpacity>
            )}
          </View>
        </AnimatedCard>
      </ScrollView>

      {/* Send Confirm */}
      <ConfirmSheet
        visible={showSendConfirm}
        onClose={() => setShowSendConfirm(false)}
        onConfirm={handleSend}
        title="Send Invoice"
        description="Send this invoice to the customer?"
        confirmLabel="Send"
      />

      {/* Payment Bottom Sheet */}
      {showPayment && (
        <BottomSheet
          ref={paymentSheetRef}
          index={0}
          snapPoints={[320]}
          onClose={() => setShowPayment(false)}
          enablePanDownToClose
          backgroundStyle={{ backgroundColor: t.surface }}
          handleIndicatorStyle={{ backgroundColor: t.textMuted }}
        >
          <BottomSheetView style={styles.paymentSheet}>
            <Text style={[styles.sectionTitle, { color: t.text }]}>Record Payment</Text>
            <Text style={[styles.fieldLabel, { color: t.textMuted }]}>Amount</Text>
            <TextInput
              style={[styles.input, { backgroundColor: t.background, color: t.text, borderColor: t.border }]}
              value={payAmount}
              onChangeText={setPayAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={t.textMuted}
            />
            <Text style={[styles.fieldLabel, { color: t.textMuted }]}>Method</Text>
            <View style={styles.methodRow}>
              {PAYMENT_METHODS.map(m => (
                <TouchableOpacity
                  key={m}
                  style={[styles.methodChip, payMethod === m && { backgroundColor: t.primary, borderColor: t.primary }]}
                  onPress={() => setPayMethod(m)}
                >
                  <Text style={[styles.methodText, payMethod === m && { color: '#fff' }]}>{m.replace('_', ' ')}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: '#22c55e', marginTop: 12 }]}
              onPress={handleRecordPayment}
              disabled={paySubmitting}
            >
              <Text style={styles.actionText}>{paySubmitting ? 'Saving...' : 'Save Payment'}</Text>
            </TouchableOpacity>
          </BottomSheetView>
        </BottomSheet>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 40 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 20, fontWeight: '700' },
  sub: { fontSize: 13, marginTop: 2 },
  amountRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e2e8f0' },
  amountLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  amount: { fontSize: 20, fontWeight: '700', marginTop: 2 },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginBottom: 12 },
  lineItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  paymentRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  actionsCol: { gap: 10, marginBottom: 20 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 10,
  },
  actionText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  // Payment sheet
  paymentSheet: { padding: 20 },
  fieldLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', marginBottom: 6, marginTop: 12 },
  input: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  methodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  methodChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    borderWidth: 1, borderColor: '#d1d5db',
  },
  methodText: { fontSize: 12, fontWeight: '600', textTransform: 'capitalize', color: '#6b7280' },
})
