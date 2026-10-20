/**
 * Quote Detail — line items, totals, send/approve/reject/convert actions.
 *
 * GET /api/quotes/:id (packages/tenant-backend invoicing/quotes.ts) answers `lineItems` [{ description, quantity,
 * unitPrice, total }] and subtotal / taxAmount / discount / total — all decimal DOLLARS (strings). Send, approve and
 * reject need quotes:update; converting raises an invoice, invoices:create. The PDF (GET /:id/pdf) needs the session,
 * which a browser opened from the phone does not carry, so the phone does not offer it.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter, Stack } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
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

export default function QuoteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const t = useTheme()
  const toast = useToast()
  const haptics = useHaptics()
  const { can } = useAuth()
  const canUpdate = can('quotes:update')
  const canInvoice = can('invoices:create')
  const [quote, setQuote] = useState<any>(null)
  const [refused, setRefused] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [confirmAction, setConfirmAction] = useState<{ title: string; desc: string; label: string; action: () => Promise<void>; destructive?: boolean } | null>(null)

  const load = useCallback(async () => {
    const res = await get(`/api/quotes/${id}`)
    if (res.ok) setQuote(res.data)
    setRefused(res.status === 403)
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false) }
  useRealTimeEvent(EVENTS.QUOTE_UPDATED, load, [load])

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
        <View style={styles.centered}><Text style={{ color: t.textMuted }}>{refused ? 'Quotes are not part of your role.' : 'Quote not found'}</Text></View>
      </SafeAreaView>
    )
  }

  const items: any[] = Array.isArray(quote.lineItems) ? quote.lineItems : []
  const num = (v: unknown) => Number(v) || 0
  const money = (v: unknown) => `$${num(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const subtotal = num(quote.subtotal)
  const tax = num(quote.taxAmount)
  const discount = num(quote.discount)
  const total = num(quote.total)

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
            <Text style={[styles.totalAmount, { color: t.text }]}>{money(total)}</Text>
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
                  {quote.contact.name}
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
                  <Text style={[styles.itemDesc, { color: t.text }]}>{item.description}</Text>
                  <Text style={[styles.itemMeta, { color: t.textMuted }]}>
                    {num(item.quantity)} x {money(item.unitPrice)}
                  </Text>
                </View>
                <Text style={[styles.itemTotal, { color: t.text }]}>{money(item.total)}</Text>
              </View>
            ))}
            {/* Totals */}
            <View style={[styles.totalsBlock, { borderTopColor: t.border }]}>
              <View style={styles.totalRow}>
                <Text style={{ color: t.textSecondary, fontSize: 13 }}>Subtotal</Text>
                <Text style={{ color: t.textSecondary, fontSize: 13 }}>{money(subtotal)}</Text>
              </View>
              {discount > 0 && (
                <View style={styles.totalRow}>
                  <Text style={{ color: t.textSecondary, fontSize: 13 }}>Discount</Text>
                  <Text style={{ color: t.textSecondary, fontSize: 13 }}>-{money(discount)}</Text>
                </View>
              )}
              {tax > 0 && (
                <View style={styles.totalRow}>
                  <Text style={{ color: t.textSecondary, fontSize: 13 }}>Tax</Text>
                  <Text style={{ color: t.textSecondary, fontSize: 13 }}>{money(tax)}</Text>
                </View>
              )}
              <View style={styles.totalRow}>
                <Text style={[styles.grandTotal, { color: t.text }]}>Total</Text>
                <Text style={[styles.grandTotal, { color: t.text }]}>{money(total)}</Text>
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
            {canUpdate && quote.status === 'draft' && (
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#3b82f6' }]}
                onPress={() => setConfirmAction({ title: 'Send Quote', desc: 'Send this quote to the customer?', label: 'Send', action: () => doAction('send', 'Quote sent') })}>
                <Ionicons name="send" size={18} color="#fff" />
                <Text style={styles.actionText}>Send Quote</Text>
              </TouchableOpacity>
            )}
            {canUpdate && quote.status === 'sent' && (
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
            {canInvoice && quote.status === 'approved' && (
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#8b5cf6' }]}
                onPress={() => setConfirmAction({ title: 'Convert to Invoice', desc: 'Create an invoice from this quote?', label: 'Convert', action: async () => {
                  const res = await post(`/api/quotes/${id}/convert-to-invoice`)
                  if (res.ok) { haptics.success(); toast.success('Invoice created'); router.push(`/(details)/invoice/${res.data.id}`) }
                  else { haptics.error(); toast.error(res.error || 'Conversion failed') }
                }})}>
                <Ionicons name="receipt" size={18} color="#fff" />
                <Text style={styles.actionText}>Convert to Invoice</Text>
              </TouchableOpacity>
            )}
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
