/**
 * Invoice Detail — line items, payment history, record payment, send, PDF.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, Linking, TextInput,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter, Stack } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet'
import { useTheme } from '../../../src/theme/ThemeContext'
import { get, post, getApiUrl } from '../../../src/api/client'
import { StatusBadge } from '../../../src/components/StatusBadge'
import { SkeletonList } from '../../../src/components/SkeletonLoader'
import { AnimatedCard } from '../../../src/components/AnimatedCard'
import { ConfirmSheet } from '../../../src/components/ConfirmSheet'
import { useToast } from '../../../src/components/ToastProvider'
import { useHaptics } from '../../../src/hooks/useHaptics'
import { useRealTimeEvent, EVENTS } from '../../../src/socket/SocketContext'

const PAYMENT_METHODS = ['cash', 'check', 'card', 'bank_transfer', 'other']

export default function InvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const t = useTheme()
  const toast = useToast()
  const haptics = useHaptics()
  const [invoice, setInvoice] = useState<any>(null)
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
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false) }
  useRealTimeEvent(EVENTS.INVOICE_UPDATED, load)
  useRealTimeEvent(EVENTS.INVOICE_PAID, load)
  useRealTimeEvent(EVENTS.PAYMENT_RECEIVED, load)

  const handleSend = async () => {
    const res = await post(`/api/invoices/${id}/send`)
    if (res.ok) { haptics.success(); toast.success('Invoice sent'); load() }
    else { haptics.error(); toast.error(res.error || 'Send failed') }
  }

  const handleRecordPayment = async () => {
    const amount = Math.round(parseFloat(payAmount) * 100)
    if (!amount || amount <= 0) { toast.error('Enter a valid amount'); return }
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
        <View style={styles.centered}><Text style={{ color: t.textMuted }}>Invoice not found</Text></View>
      </SafeAreaView>
    )
  }

  const items = invoice.items || invoice.lineItems || []
  const total = invoice.total || 0
  const paid = invoice.paidAmount || (invoice.payments || []).reduce((s: number, p: any) => s + (p.amount || 0), 0)
  const balance = total - paid

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
                <Text style={[styles.amount, { color: t.text }]}>${(total / 100).toFixed(2)}</Text>
              </View>
              <View>
                <Text style={[styles.amountLabel, { color: t.textMuted }]}>Paid</Text>
                <Text style={[styles.amount, { color: '#22c55e' }]}>${(paid / 100).toFixed(2)}</Text>
              </View>
              <View>
                <Text style={[styles.amountLabel, { color: t.textMuted }]}>Balance</Text>
                <Text style={[styles.amount, { color: balance > 0 ? '#ef4444' : '#22c55e' }]}>${(balance / 100).toFixed(2)}</Text>
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
                  {invoice.contact.name || [invoice.contact.firstName, invoice.contact.lastName].filter(Boolean).join(' ')}
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
                  <Text style={{ fontSize: 14, fontWeight: '500', color: t.text }}>{item.description || item.name}</Text>
                  <Text style={{ fontSize: 12, color: t.textMuted, marginTop: 2 }}>{item.quantity || 1} x ${((item.rate || item.unitPrice || 0) / 100).toFixed(2)}</Text>
                </View>
                <Text style={{ fontSize: 14, fontWeight: '600', color: t.text }}>${(((item.quantity || 1) * (item.rate || item.unitPrice || 0)) / 100).toFixed(2)}</Text>
              </View>
            ))}
          </View>
        </AnimatedCard>

        {/* Payment History */}
        {(invoice.payments || []).length > 0 && (
          <AnimatedCard index={3}>
            <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
              <Text style={[styles.sectionTitle, { color: t.text }]}>Payment History</Text>
              {invoice.payments.map((pay: any, i: number) => (
                <View key={pay.id || i} style={[styles.paymentRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '500', color: t.text }}>${(pay.amount / 100).toFixed(2)}</Text>
                    <Text style={{ fontSize: 12, color: t.textMuted, marginTop: 2, textTransform: 'capitalize' }}>{pay.method || 'payment'}</Text>
                  </View>
                  <Text style={{ fontSize: 12, color: t.textMuted }}>{new Date(pay.createdAt || pay.date).toLocaleDateString()}</Text>
                </View>
              ))}
            </View>
          </AnimatedCard>
        )}

        {/* Actions */}
        <AnimatedCard index={4}>
          <View style={styles.actionsCol}>
            {invoice.status === 'draft' && (
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#3b82f6' }]}
                onPress={() => setShowSendConfirm(true)}>
                <Ionicons name="send" size={18} color="#fff" />
                <Text style={styles.actionText}>Send Invoice</Text>
              </TouchableOpacity>
            )}
            {balance > 0 && (
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#22c55e' }]}
                onPress={() => {
                  setPayAmount((balance / 100).toFixed(2))
                  setShowPayment(true)
                  paymentSheetRef.current?.expand()
                }}>
                <Ionicons name="cash" size={18} color="#fff" />
                <Text style={styles.actionText}>Record Payment</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: t.surface, borderWidth: 1, borderColor: t.border }]}
              onPress={() => Linking.openURL(`${getApiUrl()}/api/invoices/${id}/pdf`)}>
              <Ionicons name="document" size={18} color={t.text} />
              <Text style={[styles.actionText, { color: t.text }]}>View PDF</Text>
            </TouchableOpacity>
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
