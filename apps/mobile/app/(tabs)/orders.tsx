/**
 * Orders — dispensary order queue with status tabs.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, FlatList, StyleSheet, RefreshControl, TouchableOpacity,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../src/theme/ThemeContext'
import { get, post } from '../../src/api/client'
import { StatusBadge } from '../../src/components/StatusBadge'
import { FilterChips } from '../../src/components/FilterChips'
import { SearchBar } from '../../src/components/SearchBar'
import { SkeletonList } from '../../src/components/SkeletonLoader'
import { AnimatedCard } from '../../src/components/AnimatedCard'
import { SwipeableRow } from '../../src/components/SwipeableRow'
import { FAB } from '../../src/components/FAB'
import { EmptyState } from '../../src/components/EmptyState'
import { useToast } from '../../src/components/ToastProvider'
import { useHaptics } from '../../src/hooks/useHaptics'
import { useDebounce } from '../../src/hooks/useDebounce'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'ready', label: 'Ready' },
  { key: 'completed', label: 'Completed' },
]

export default function OrdersScreen() {
  const t = useTheme()
  const toast = useToast()
  const haptics = useHaptics()
  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search)

  const loadOrders = useCallback(async () => {
    const params = new URLSearchParams({ limit: '50' })
    if (filter !== 'all') params.set('status', filter)
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())
    const res = await get(`/api/orders?${params}`)
    if (res.ok) setOrders(res.data.data || res.data || [])
    setLoading(false)
  }, [filter, debouncedSearch])

  useEffect(() => { setLoading(true); loadOrders() }, [loadOrders])

  const onRefresh = async () => { setRefreshing(true); await loadOrders(); setRefreshing(false) }

  const updateStatus = async (order: any, newStatus: string) => {
    const res = await post(`/api/orders/${order.id}/status`, { status: newStatus })
    if (res.ok) {
      haptics.success()
      toast.success(`Order #${order.orderNumber} → ${newStatus}`)
      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: newStatus } : o))
    } else {
      haptics.error()
      toast.error(res.error || 'Failed to update')
    }
  }

  const renderOrder = ({ item: order, index }: { item: any; index: number }) => {
    const swipeActions = []
    if (order.status === 'pending') swipeActions.push({ icon: 'checkmark', label: 'Confirm', color: '#3b82f6', onPress: () => updateStatus(order, 'confirmed') })
    if (order.status === 'confirmed') swipeActions.push({ icon: 'restaurant', label: 'Prepare', color: '#f59e0b', onPress: () => updateStatus(order, 'preparing') })
    if (order.status === 'preparing') swipeActions.push({ icon: 'checkmark-done', label: 'Ready', color: '#22c55e', onPress: () => updateStatus(order, 'ready') })
    if (order.status === 'ready') swipeActions.push({ icon: 'bag-check', label: 'Complete', color: '#8b5cf6', onPress: () => updateStatus(order, 'completed') })

    return (
      <AnimatedCard index={index}>
        <SwipeableRow rightActions={swipeActions}>
          <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
            <View style={styles.cardRow}>
              <View style={[styles.orderNum, { backgroundColor: t.primaryLight }]}>
                <Text style={[styles.orderNumText, { color: t.primary }]}>
                  #{order.orderNumber || order.id?.slice(-4)}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.customerName, { color: t.text }]}>
                  {order.contact?.name || order.customerName || 'Walk-in'}
                </Text>
                <Text style={[styles.orderType, { color: t.textSecondary }]}>
                  {order.type || 'walk_in'} • {order.itemCount || order.items?.length || 0} items
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.total, { color: t.text }]}>
                  ${((order.total || 0) / 100).toFixed(2)}
                </Text>
                <StatusBadge status={order.status} />
              </View>
            </View>
            {order.paymentMethod && (
              <View style={styles.paymentRow}>
                <Ionicons name={order.paymentMethod === 'cash' ? 'cash' : 'card'} size={12} color={t.textMuted} />
                <Text style={[styles.paymentText, { color: t.textMuted }]}>
                  {order.paymentMethod} • {order.paymentStatus || 'pending'}
                </Text>
              </View>
            )}
          </View>
        </SwipeableRow>
      </AnimatedCard>
    )
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search orders..." />
      <FilterChips options={FILTERS} selected={filter} onSelect={setFilter} />

      {loading ? (
        <SkeletonList count={5} />
      ) : (
        <FlatList
          data={orders}
          keyExtractor={item => item.id}
          renderItem={renderOrder}
          contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
          ListEmptyComponent={<EmptyState icon="receipt-outline" title="No orders" subtitle="Orders will appear here" />}
        />
      )}

      <FAB icon="add" onPress={() => toast.info('Create orders from the POS terminal')} />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  orderNum: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  orderNumText: { fontSize: 13, fontWeight: '700' },
  customerName: { fontSize: 15, fontWeight: '600' },
  orderType: { fontSize: 12, marginTop: 2, textTransform: 'capitalize' },
  total: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  paymentRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e2e8f0',
  },
  paymentText: { fontSize: 12, textTransform: 'capitalize' },
})
