/**
 * Customers — dispensary customer list with loyalty tier badges.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, FlatList, StyleSheet, RefreshControl, TouchableOpacity, Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../src/theme/ThemeContext'
import { get } from '../../src/api/client'
import { SearchBar } from '../../src/components/SearchBar'
import { SkeletonList } from '../../src/components/SkeletonLoader'
import { AnimatedCard } from '../../src/components/AnimatedCard'
import { AvatarCircle } from '../../src/components/AvatarCircle'
import { EmptyState } from '../../src/components/EmptyState'
import { useDebounce } from '../../src/hooks/useDebounce'

const TIER_COLORS: Record<string, { bg: string; text: string }> = {
  bronze: { bg: '#fef3c7', text: '#92400e' },
  silver: { bg: '#f1f5f9', text: '#475569' },
  gold: { bg: '#fef3c7', text: '#b45309' },
  platinum: { bg: '#e0e7ff', text: '#3730a3' },
}

export default function CustomersScreen() {
  const t = useTheme()
  const [customers, setCustomers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)

  const loadCustomers = useCallback(async (p = 1, append = false) => {
    const params = new URLSearchParams({ page: String(p), limit: '25' })
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())
    const res = await get(`/api/contacts?${params}`)
    if (res.ok) {
      const data = res.data.data || res.data
      if (append) setCustomers(prev => [...prev, ...data])
      else setCustomers(data)
      setHasMore(data.length === 25)
    }
    setLoading(false)
  }, [debouncedSearch])

  useEffect(() => { setLoading(true); setPage(1); loadCustomers(1) }, [loadCustomers])

  const onRefresh = async () => { setRefreshing(true); await loadCustomers(1); setRefreshing(false) }
  const loadMore = () => { if (hasMore) { setPage(p => p + 1); loadCustomers(page + 1, true) } }

  const renderCustomer = ({ item: customer, index }: { item: any; index: number }) => {
    const tier = customer.loyaltyTier || customer.tier
    const tierStyle = tier ? TIER_COLORS[tier] : null

    return (
      <AnimatedCard index={index}>
        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
          <View style={styles.row}>
            <AvatarCircle name={customer.name} size={44} />
            <View style={{ flex: 1 }}>
              <View style={styles.nameRow}>
                <Text style={[styles.name, { color: t.text }]} numberOfLines={1}>{customer.name}</Text>
                {tierStyle && (
                  <View style={[styles.tierBadge, { backgroundColor: tierStyle.bg }]}>
                    <Ionicons name="star" size={10} color={tierStyle.text} />
                    <Text style={[styles.tierText, { color: tierStyle.text }]}>{tier}</Text>
                  </View>
                )}
              </View>
              {customer.loyaltyPoints != null && (
                <Text style={[styles.points, { color: t.textSecondary }]}>
                  {customer.loyaltyPoints} pts • ${((customer.totalSpent || 0) / 100).toFixed(0)} lifetime
                </Text>
              )}
            </View>
          </View>
          <View style={styles.actions}>
            {customer.phone && (
              <TouchableOpacity style={[styles.actionBtn, { borderColor: t.border }]} onPress={() => Linking.openURL(`tel:${customer.phone}`)}>
                <Ionicons name="call" size={14} color="#22c55e" />
                <Text style={[styles.actionLabel, { color: t.textSecondary }]}>{customer.phone}</Text>
              </TouchableOpacity>
            )}
            {customer.email && (
              <TouchableOpacity style={[styles.actionBtn, { borderColor: t.border }]} onPress={() => Linking.openURL(`mailto:${customer.email}`)}>
                <Ionicons name="mail" size={14} color="#3b82f6" />
                <Text style={[styles.actionLabel, { color: t.textSecondary }]} numberOfLines={1}>{customer.email}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </AnimatedCard>
    )
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search customers..." />

      {loading ? (
        <SkeletonList count={6} />
      ) : (
        <FlatList
          data={customers}
          keyExtractor={item => item.id}
          renderItem={renderCustomer}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={<EmptyState icon="people-outline" title="No customers" />}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 15, fontWeight: '600' },
  tierBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  tierText: { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' },
  points: { fontSize: 12, marginTop: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1,
  },
  actionLabel: { fontSize: 12 },
})
