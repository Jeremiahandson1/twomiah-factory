/**
 * Order Detail — dispensary order with items, customer info, status progression.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, Stack } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../../src/theme/ThemeContext'
import { get, post } from '../../../src/api/client'
import { StatusBadge } from '../../../src/components/StatusBadge'
import { SkeletonList } from '../../../src/components/SkeletonLoader'
import { AnimatedCard } from '../../../src/components/AnimatedCard'
import { ConfirmSheet } from '../../../src/components/ConfirmSheet'
import { useToast } from '../../../src/components/ToastProvider'
import { useHaptics } from '../../../src/hooks/useHaptics'

const STATUS_FLOW = ['pending', 'confirmed', 'preparing', 'ready', 'completed']
const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b', confirmed: '#3b82f6', preparing: '#8b5cf6', ready: '#22c55e', completed: '#6b7280',
}

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const t = useTheme()
  const toast = useToast()
  const haptics = useHaptics()
  const [order, setOrder] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [confirmNext, setConfirmNext] = useState(false)

  const load = useCallback(async () => {
    const res = await get(`/api/orders/${id}`)
    if (res.ok) setOrder(res.data)
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false) }

  const nextStatus = order ? STATUS_FLOW[STATUS_FLOW.indexOf(order.status) + 1] : null

  const advanceStatus = async () => {
    if (!nextStatus) return
    const res = await post(`/api/orders/${id}/status`, { status: nextStatus })
    if (res.ok) { haptics.success(); toast.success(`Order → ${nextStatus}`); load() }
    else { haptics.error(); toast.error(res.error || 'Failed') }
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
        <Stack.Screen options={{ title: 'Order' }} />
        <SkeletonList count={4} />
      </SafeAreaView>
    )
  }

  if (!order) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
        <Stack.Screen options={{ title: 'Order' }} />
        <View style={styles.centered}><Text style={{ color: t.textMuted }}>Order not found</Text></View>
      </SafeAreaView>
    )
  }

  const items = order.items || []
  const currentIdx = STATUS_FLOW.indexOf(order.status)

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      <Stack.Screen options={{ title: `Order #${order.orderNumber || order.id?.slice(-4)}` }} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
      >
        {/* Header */}
        <AnimatedCard index={0}>
          <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
            <View style={styles.headerRow}>
              <View style={[styles.orderBadge, { backgroundColor: t.primaryLight }]}>
                <Text style={[styles.orderBadgeText, { color: t.primary }]}>#{order.orderNumber || order.id?.slice(-4)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.customerName, { color: t.text }]}>{order.contact?.name || order.customerName || 'Walk-in'}</Text>
                <Text style={{ fontSize: 12, color: t.textMuted, textTransform: 'capitalize' }}>{order.type || 'walk_in'}</Text>
              </View>
              <StatusBadge status={order.status} />
            </View>
            <Text style={[styles.total, { color: t.text }]}>${((order.total || 0) / 100).toFixed(2)}</Text>
          </View>
        </AnimatedCard>

        {/* Status Progress */}
        <AnimatedCard index={1}>
          <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Text style={[styles.sectionTitle, { color: t.text }]}>Status</Text>
            <View style={styles.progressRow}>
              {STATUS_FLOW.map((step, i) => (
                <View key={step} style={styles.progressStep}>
                  <View style={[
                    styles.progressDot,
                    { backgroundColor: i <= currentIdx ? (STATUS_COLORS[step] || t.primary) : t.border },
                  ]} />
                  <Text style={[
                    styles.progressLabel,
                    { color: i <= currentIdx ? t.text : t.textMuted },
                    i === currentIdx && { fontWeight: '700' },
                  ]}>{step}</Text>
                </View>
              ))}
            </View>
          </View>
        </AnimatedCard>

        {/* Items */}
        <AnimatedCard index={2}>
          <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Text style={[styles.sectionTitle, { color: t.text }]}>Items ({items.length})</Text>
            {items.map((item: any, i: number) => (
              <View key={item.id || i} style={[styles.itemRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '500', color: t.text }}>{item.name || item.productName}</Text>
                  {item.category && <Text style={{ fontSize: 11, color: t.textMuted, marginTop: 2, textTransform: 'capitalize' }}>{item.category}</Text>}
                </View>
                <Text style={{ fontSize: 13, color: t.textSecondary }}>x{item.quantity || 1}</Text>
                <Text style={{ fontSize: 14, fontWeight: '600', color: t.text, minWidth: 60, textAlign: 'right' }}>
                  ${((item.price || item.unitPrice || 0) / 100).toFixed(2)}
                </Text>
              </View>
            ))}
            <View style={[styles.totalRow, { borderTopColor: t.border }]}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: t.text }}>Total</Text>
              <Text style={{ fontSize: 15, fontWeight: '700', color: t.text }}>${((order.total || 0) / 100).toFixed(2)}</Text>
            </View>
          </View>
        </AnimatedCard>

        {/* Payment */}
        <AnimatedCard index={3}>
          <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Text style={[styles.sectionTitle, { color: t.text }]}>Payment</Text>
            <View style={styles.payInfo}>
              <View style={styles.payRow}>
                <Ionicons name={order.paymentMethod === 'cash' ? 'cash-outline' : 'card-outline'} size={18} color={t.textMuted} />
                <Text style={{ fontSize: 14, color: t.text, textTransform: 'capitalize' }}>{order.paymentMethod || 'Not set'}</Text>
              </View>
              <StatusBadge status={order.paymentStatus || 'pending'} />
            </View>
          </View>
        </AnimatedCard>

        {/* Delivery Info */}
        {order.type === 'delivery' && order.deliveryAddress && (
          <AnimatedCard index={4}>
            <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Ionicons name="car" size={18} color={t.primary} />
                <Text style={[styles.sectionTitle, { color: t.text, marginBottom: 0 }]}>Delivery</Text>
              </View>
              <Text style={{ fontSize: 14, color: t.textSecondary }}>{order.deliveryAddress}</Text>
              {order.driver && <Text style={{ fontSize: 13, color: t.textMuted, marginTop: 4 }}>Driver: {order.driver.name || order.driver}</Text>}
              {order.estimatedDelivery && <Text style={{ fontSize: 13, color: t.textMuted, marginTop: 4 }}>ETA: {order.estimatedDelivery}</Text>}
            </View>
          </AnimatedCard>
        )}

        {/* Advance Status */}
        {nextStatus && (
          <AnimatedCard index={5}>
            <TouchableOpacity
              style={[styles.advanceBtn, { backgroundColor: STATUS_COLORS[nextStatus] || t.primary }]}
              onPress={() => setConfirmNext(true)}
            >
              <Ionicons name="arrow-forward-circle" size={20} color="#fff" />
              <Text style={styles.advanceBtnText}>Mark as {nextStatus}</Text>
            </TouchableOpacity>
          </AnimatedCard>
        )}
      </ScrollView>

      <ConfirmSheet
        visible={confirmNext}
        onClose={() => setConfirmNext(false)}
        onConfirm={advanceStatus}
        title={`Move to ${nextStatus}?`}
        description={`Change order status to "${nextStatus}".`}
        confirmLabel={`Mark ${nextStatus}`}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 40 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  orderBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  orderBadgeText: { fontSize: 14, fontWeight: '700' },
  customerName: { fontSize: 16, fontWeight: '600' },
  total: { fontSize: 28, fontWeight: '700', marginTop: 12 },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginBottom: 12 },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between' },
  progressStep: { alignItems: 'center', flex: 1 },
  progressDot: { width: 12, height: 12, borderRadius: 6, marginBottom: 4 },
  progressLabel: { fontSize: 10, textTransform: 'capitalize', textAlign: 'center' },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, marginTop: 8, paddingTop: 10 },
  payInfo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  payRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  advanceBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 10, marginBottom: 20,
  },
  advanceBtnText: { color: '#fff', fontSize: 16, fontWeight: '600', textTransform: 'capitalize' },
})
