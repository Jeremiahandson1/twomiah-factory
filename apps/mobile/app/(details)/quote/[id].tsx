/**
 * Quote Detail — line items, totals, send/approve/reject/convert actions.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter, Stack } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../../src/theme/ThemeContext'
import { get, post } from '../../../src/api/client'
import { StatusBadge } from '../../../src/components/StatusBadge'
import { SkeletonList } from '../../../src/components/SkeletonLoader'
import { AnimatedCard } from '../../../src/components/AnimatedCard'
import { ConfirmSheet } from '../../../src/components/ConfirmSheet'
import { useToast } from '../../../src/components/ToastProvider'
import { useHaptics } from '../../../src/hooks/useHaptics'
import { useRealTimeEvent, EVENTS } from '../../../src/socket/SocketContext'
import { getApiUrl } from '../../../src/api/client'

export default function QuoteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const t = useTheme()
  const toast = useToast()
  const haptics = useHaptics()
  const [quote, setQuote] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [confirmAction, setConfirmAction] = useState<{ title: string; desc: string; label: string; action: () => Promise<void>; destructive?: boolean } | null>(null)

  const load = useCallback(async () => {
    const res = await get(`/api/quotes/${id}`)
    if (res.ok) setQuote(res.data)
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false) }
  useRealTimeEvent(EVENTS.QUOTE_UPDATED, load)

  const doAction = async (endpoint: string, successMsg: string) => {
    const res = await post(`/api/quotes/${id}/${endpoint}`)
    if (res.ok) { haptics.success(); toast.success(successMsg); load() }
    else { haptics.error(); toast.error(res.error || 'Action failed') }
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
        <Stack.Screen options={{ title: 'Quote' }} />
        <SkeletonList count={4} />
      </SafeAreaView>
    )
  }

  if (!quote) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
        <Stack.Screen options={{ title: 'Quote' }} />
        <View style={styles.centered}><Text style={{ color: t.textMuted }}>Quote not found</Text></View>
      </SafeAreaView>
    )
  }

  const items = quote.items || quote.lineItems || []
  const subtotal = items.reduce((sum: number, item: any) => sum + (item.quantity || 1) * (item.rate || item.unitPrice || 0), 0)
  const tax = quote.taxAmount || quote.tax || 0
  const total = quote.total || subtotal + tax

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      <Stack.Screen options={{ title: quote.number || 'Quote' }} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
      >
        {/* Header */}
        <AnimatedCard index={0}>
          <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
            <View style={styles.headerRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: t.text }]}>{quote.name || quote.number}</Text>
                {quote.number && quote.name && <Text style={[styles.sub, { color: t.textSecondary }]}>{quote.number}</Text>}
              </View>
              <StatusBadge status={quote.status} />
            </View>
            <Text style={[styles.totalAmount, { color: t.text }]}>${(total / 100).toFixed(2)}</Text>
            {quote.expiryDate && (
              <Text style={[styles.expiry, { color: new Date(quote.expiryDate) < new Date() ? '#ef4444' : t.textMuted }]}>
                Expires: {new Date(quote.expiryDate).toLocaleDateString()}
              </Text>
            )}
          </View>
        </AnimatedCard>

        {/* Contact */}
        {quote.contact && (
          <AnimatedCard index={1}>
            <TouchableOpacity
              style={[styles.card, { backgroundColor: t.surface, borderColor: t.border, flexDirection: 'row', alignItems: 'center', gap: 10 }]}
              onPress={() => router.push(`/(details)/contact/${quote.contact.id || quote.contactId}`)}
            >
              <Ionicons name="person-circle-outline" size={24} color={t.primary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.contactName, { color: t.text }]}>
                  {quote.contact.name || [quote.contact.firstName, quote.contact.lastName].filter(Boolean).join(' ')}
                </Text>
                {quote.contact.email && <Text style={{ fontSize: 12, color: t.textMuted }}>{quote.contact.email}</Text>}
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
                  <Text style={[styles.itemDesc, { color: t.text }]}>{item.description || item.name}</Text>
                  <Text style={[styles.itemMeta, { color: t.textMuted }]}>
                    {item.quantity || 1} x ${((item.rate || item.unitPrice || 0) / 100).toFixed(2)}
                  </Text>
                </View>
                <Text style={[styles.itemTotal, { color: t.text }]}>
                  ${(((item.quantity || 1) * (item.rate || item.unitPrice || 0)) / 100).toFixed(2)}
                </Text>
              </View>
            ))}
            {/* Totals */}
            <View style={[styles.totalsBlock, { borderTopColor: t.border }]}>
              <View style={styles.totalRow}>
                <Text style={{ color: t.textSecondary, fontSize: 13 }}>Subtotal</Text>
                <Text style={{ color: t.textSecondary, fontSize: 13 }}>${(subtotal / 100).toFixed(2)}</Text>
              </View>
              {tax > 0 && (
                <View style={styles.totalRow}>
                  <Text style={{ color: t.textSecondary, fontSize: 13 }}>Tax</Text>
                  <Text style={{ color: t.textSecondary, fontSize: 13 }}>${(tax / 100).toFixed(2)}</Text>
                </View>
              )}
              <View style={styles.totalRow}>
                <Text style={[styles.grandTotal, { color: t.text }]}>Total</Text>
                <Text style={[styles.grandTotal, { color: t.text }]}>${(total / 100).toFixed(2)}</Text>
              </View>
            </View>
          </View>
        </AnimatedCard>

        {/* Notes */}
        {quote.notes && (
          <AnimatedCard index={3}>
            <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
              <Text style={[styles.sectionTitle, { color: t.text }]}>Notes / Terms</Text>
              <Text style={{ color: t.textSecondary, fontSize: 14, lineHeight: 20 }}>{quote.notes}</Text>
            </View>
          </AnimatedCard>
        )}

        {/* Actions */}
        <AnimatedCard index={4}>
          <View style={styles.actionsCol}>
            {quote.status === 'draft' && (
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#3b82f6' }]}
                onPress={() => setConfirmAction({ title: 'Send Quote', desc: 'Send this quote to the customer?', label: 'Send', action: () => doAction('send', 'Quote sent') })}>
                <Ionicons name="send" size={18} color="#fff" />
                <Text style={styles.actionText}>Send Quote</Text>
              </TouchableOpacity>
            )}
            {quote.status === 'sent' && (
              <>
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#22c55e' }]}
                  onPress={() => setConfirmAction({ title: 'Approve Quote', desc: 'Mark this quote as approved?', label: 'Approve', action: () => doAction('approve', 'Quote approved') })}>
                  <Ionicons name="checkmark-circle" size={18} color="#fff" />
                  <Text style={styles.actionText}>Approve</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#ef4444' }]}
                  onPress={() => setConfirmAction({ title: 'Reject Quote', desc: 'Reject this quote?', label: 'Reject', destructive: true, action: () => doAction('reject', 'Quote rejected') })}>
                  <Ionicons name="close-circle" size={18} color="#fff" />
                  <Text style={styles.actionText}>Reject</Text>
                </TouchableOpacity>
              </>
            )}
            {quote.status === 'approved' && (
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#8b5cf6' }]}
                onPress={() => setConfirmAction({ title: 'Convert to Invoice', desc: 'Create an invoice from this quote?', label: 'Convert', action: async () => {
                  const res = await post(`/api/quotes/${id}/convert-to-invoice`)
                  if (res.ok) { haptics.success(); toast.success('Invoice created'); router.push(`/(details)/invoice/${res.data.id || res.data.invoiceId}`) }
                  else { haptics.error(); toast.error(res.error || 'Conversion failed') }
                }})}>
                <Ionicons name="receipt" size={18} color="#fff" />
                <Text style={styles.actionText}>Convert to Invoice</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: t.surface, borderWidth: 1, borderColor: t.border }]}
              onPress={() => Linking.openURL(`${getApiUrl()}/api/quotes/${id}/pdf`)}>
              <Ionicons name="document" size={18} color={t.text} />
              <Text style={[styles.actionText, { color: t.text }]}>View PDF</Text>
            </TouchableOpacity>
          </View>
        </AnimatedCard>
      </ScrollView>

      {confirmAction && (
        <ConfirmSheet
          visible={!!confirmAction}
          onClose={() => setConfirmAction(null)}
          onConfirm={async () => { await confirmAction.action(); setConfirmAction(null) }}
          title={confirmAction.title}
          description={confirmAction.desc}
          confirmLabel={confirmAction.label}
          destructive={confirmAction.destructive}
        />
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
  totalAmount: { fontSize: 28, fontWeight: '700', marginTop: 12 },
  expiry: { fontSize: 12, marginTop: 4 },
  contactName: { fontSize: 15, fontWeight: '600' },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginBottom: 12 },
  lineItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  itemDesc: { fontSize: 14, fontWeight: '500' },
  itemMeta: { fontSize: 12, marginTop: 2 },
  itemTotal: { fontSize: 14, fontWeight: '600' },
  totalsBlock: { borderTopWidth: 1, marginTop: 8, paddingTop: 10 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  grandTotal: { fontSize: 16, fontWeight: '700' },
  actionsCol: { gap: 10, marginBottom: 20 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 10,
  },
  actionText: { color: '#fff', fontSize: 15, fontWeight: '600' },
})
