/**
 * Quotes — list with status filters, value display, quick actions.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../src/theme/ThemeContext'
import { get, post } from '../../src/api/client'
import { StatusBadge } from '../../src/components/StatusBadge'
import { FilterChips } from '../../src/components/FilterChips'
import { SkeletonList, SkeletonLine } from '../../src/components/SkeletonLoader'
import { AnimatedCard } from '../../src/components/AnimatedCard'
import { SwipeableRow } from '../../src/components/SwipeableRow'
import { EmptyState } from '../../src/components/EmptyState'
import { StatCard } from '../../src/components/StatCard'
import { useToast } from '../../src/components/ToastProvider'
import { useHaptics } from '../../src/hooks/useHaptics'
import { useRealTimeEvent, EVENTS } from '../../src/socket/SocketContext'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'sent', label: 'Sent' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
]

export default function QuotesScreen() {
  const t = useTheme()
  const toast = useToast()
  const haptics = useHaptics()
  const [quotes, setQuotes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [stats, setStats] = useState<any>(null)

  const loadQuotes = useCallback(async (p = 1, append = false) => {
    const params = new URLSearchParams({ page: String(p), limit: '25' })
    if (filter !== 'all') params.set('status', filter)
    const [res, statsRes] = await Promise.all([
      get(`/api/quotes?${params}`),
      p === 1 ? get('/api/quotes/stats') : Promise.resolve(null),
    ])
    if (res.ok) {
      const data = res.data.data || res.data
      if (append) setQuotes(prev => [...prev, ...data])
      else setQuotes(data)
      setHasMore(data.length === 25)
    }
    if (statsRes?.ok) setStats(statsRes.data)
    setLoading(false)
  }, [filter])

  useEffect(() => { setLoading(true); setPage(1); loadQuotes(1) }, [loadQuotes])

  const onRefresh = async () => { setRefreshing(true); await loadQuotes(1); setRefreshing(false) }
  const loadMore = () => { if (hasMore) { setPage(p => p + 1); loadQuotes(page + 1, true) } }

  useRealTimeEvent(EVENTS.QUOTE_CREATED, () => loadQuotes(1))
  useRealTimeEvent(EVENTS.QUOTE_UPDATED, () => loadQuotes(1))
  useRealTimeEvent(EVENTS.QUOTE_APPROVED, () => loadQuotes(1))

  const handleSend = async (quote: any) => {
    const res = await post(`/api/quotes/${quote.id}/send`)
    if (res.ok) {
      haptics.success()
      toast.success(`Quote ${quote.number} sent`)
      setQuotes(prev => prev.map(q => q.id === quote.id ? { ...q, status: 'sent' } : q))
    } else {
      haptics.error()
      toast.error(res.error || 'Could not send quote')
    }
  }

  const handleConvert = async (quote: any) => {
    haptics.medium()
    const res = await post(`/api/quotes/${quote.id}/convert-to-invoice`)
    if (res.ok) {
      toast.success(`Invoice ${res.data.number} created`)
    } else {
      toast.error(res.error || 'Conversion failed')
    }
  }

  const fmt = (val: number) => `$${(val / 100).toLocaleString(undefined, { minimumFractionDigits: 0 })}`

  const renderQuote = ({ item: quote, index }: { item: any; index: number }) => {
    const swipeActions = []
    if (quote.status === 'draft') swipeActions.push({ icon: 'send', label: 'Send', color: '#3b82f6', onPress: () => handleSend(quote) })
    if (quote.status === 'approved') swipeActions.push({ icon: 'receipt', label: 'Invoice', color: '#22c55e', onPress: () => handleConvert(quote) })

    return (
      <AnimatedCard index={index}>
        <SwipeableRow rightActions={swipeActions}>
          <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.qName, { color: t.text }]} numberOfLines={1}>{quote.name}</Text>
                <Text style={[styles.qSub, { color: t.textSecondary }]}>
                  {quote.number}{quote.contact?.name ? ` • ${quote.contact.name}` : ''}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.amount, { color: t.text }]}>{fmt(quote.total || 0)}</Text>
                <StatusBadge status={quote.status} />
              </View>
            </View>
            {quote.expiryDate && (
              <Text style={[styles.meta, { color: t.textMuted }]}>
                Expires {new Date(quote.expiryDate).toLocaleDateString()}
              </Text>
            )}
          </View>
        </SwipeableRow>
      </AnimatedCard>
    )
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      {/* Stats bar */}
      {stats && (
        <View style={[styles.statsBar, { backgroundColor: t.surface, borderColor: t.border }]}>
          <StatPill label="Total" value={stats.total} color={t.textSecondary} theme={t} />
          <StatPill label="Pending" value={stats.pending} color="#f59e0b" theme={t} />
          <StatPill label="Approved" value={stats.approved} color="#22c55e" theme={t} />
          <StatPill label="Value" value={fmt(stats.totalValue || 0)} color={t.primary} theme={t} />
        </View>
      )}

      <FilterChips options={FILTERS} selected={filter} onSelect={setFilter} />

      {loading ? (
        <SkeletonList count={5} />
      ) : (
        <FlatList
          data={quotes}
          keyExtractor={item => item.id}
          renderItem={renderQuote}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={<EmptyState icon="document-text-outline" title="No quotes found" />}
        />
      )}
    </SafeAreaView>
  )
}

function StatPill({ label, value, color, theme: t }: any) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ fontSize: 16, fontWeight: '700', color }}>{value}</Text>
      <Text style={{ fontSize: 10, color: t.textMuted, marginTop: 1 }}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  statsBar: {
    flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 12,
    marginHorizontal: 16, marginTop: 8, borderRadius: 10, borderWidth: 1,
  },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  qName: { fontSize: 15, fontWeight: '600' },
  qSub: { fontSize: 12, marginTop: 2 },
  amount: { fontSize: 17, fontWeight: '700', marginBottom: 4 },
  meta: { fontSize: 12, marginTop: 8 },
})
