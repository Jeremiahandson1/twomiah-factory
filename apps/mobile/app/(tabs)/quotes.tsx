/**
 * Quotes — list with status filters, value display, quick actions.
 *
 * GET /api/quotes is { data, pagination }; GET /api/quotes/stats is { total, draft, sent, approved, declined|rejected,
 * expired, totalValue, approvedValue } (packages/tenant-backend invoicing/quotes.ts) — no `pending`: waiting on the
 * customer is draft + sent. Every figure is DOLLARS. The tab needs quotes:read (a field seat has none; the tab bar
 * hides it, and this screen says so rather than show an empty list if it is reached anyway).
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useTile } from '../../src/home/useTile'
import { FilterBanner } from '../../src/home/FilterBanner'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../src/theme/ThemeContext'
import { get, post } from '../../src/api/client'
import { useAuth } from '../../src/auth/AuthContext'
import { StatusBadge } from '../../src/components/StatusBadge'
import { FilterChips } from '../../src/components/FilterChips'
import { SkeletonList, SkeletonLine } from '../../src/components/SkeletonLoader'
import { AnimatedCard } from '../../src/components/AnimatedCard'
import { SwipeableRow } from '../../src/components/SwipeableRow'
import { FAB } from '../../src/components/FAB'
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
  { key: 'declined', label: 'Declined' },
]

export default function QuotesScreen() {
  const router = useRouter()
  const t = useTheme()
  const toast = useToast()
  const haptics = useHaptics()
  const { can } = useAuth()
  const canRead = can('quotes:read')
  const canCreate = can('quotes:create')
  const canSend = can('quotes:update')
  const canInvoice = can('invoices:create')
  const [quotes, setQuotes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const { tile, clear } = useTile()
  const [tileTotal, setTileTotal] = useState<number | undefined>(undefined)
  const { status: statusParam } = useLocalSearchParams<{ status?: string }>()
  const [filter, setFilter] = useState(statusParam ? String(statusParam) : 'all')
  useEffect(() => { if (statusParam) setFilter(String(statusParam)) }, [statusParam])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [stats, setStats] = useState<any>(null)

  const loadQuotes = useCallback(async (p = 1, append = false) => {
    if (!canRead) { setLoading(false); return }
    const params = new URLSearchParams({ page: String(p), limit: '25' })
    if (tile) Object.entries(tile.list.query || {}).forEach(([k, v]) => params.set(k, v))
    else if (filter !== 'all') params.set('status', filter)
    const [res, statsRes] = await Promise.all([
      get(`/api/quotes?${params}`),
      p === 1 ? get('/api/quotes/stats') : Promise.resolve(null),
    ])
    if (res.ok) {
      const data: any[] = Array.isArray(res.data?.data) ? res.data.data : []
      if (append) setQuotes(prev => [...prev, ...data])
      else setQuotes(data)
      setHasMore(data.length === 25)
      setTileTotal(typeof res.data?.pagination?.total === 'number' ? res.data.pagination.total : undefined)
    }
    if (statsRes?.ok) setStats(statsRes.data)
    setLoading(false)
  }, [filter, canRead, tile?.id])

  useEffect(() => { setLoading(true); setPage(1); loadQuotes(1) }, [loadQuotes])

  const onRefresh = async () => { setRefreshing(true); await loadQuotes(1); setRefreshing(false) }
  const loadMore = () => { if (hasMore) { setPage(p => p + 1); loadQuotes(page + 1, true) } }

  useRealTimeEvent(EVENTS.QUOTE_CREATED, () => loadQuotes(1), [loadQuotes])
  useRealTimeEvent(EVENTS.QUOTE_UPDATED, () => loadQuotes(1), [loadQuotes])
  useRealTimeEvent(EVENTS.QUOTE_APPROVED, () => loadQuotes(1), [loadQuotes])

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
      toast.success(`Invoice ${res.data?.number || ''} created`)
      if (res.data?.id) router.push(`/(details)/invoice/${res.data.id}`)
    } else {
      toast.error(res.error || 'Conversion failed')
    }
  }

  // Dollars, as the server keeps them (decimal strings).
  const fmt = (val: unknown) => `$${(Number(val) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const renderQuote = ({ item: quote, index }: { item: any; index: number }) => {
    const swipeActions = []
    if (canSend && quote.status === 'draft') swipeActions.push({ icon: 'send', label: 'Send', color: t.primary, onPress: () => handleSend(quote) })
    if (canInvoice && quote.status === 'approved') swipeActions.push({ icon: 'receipt', label: 'Invoice', color: t.primary, onPress: () => handleConvert(quote) })

    return (
      <AnimatedCard index={index}>
        <SwipeableRow rightActions={swipeActions}>
          <TouchableOpacity style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}
            onPress={() => router.push(`/(details)/quote/${quote.id}`)} activeOpacity={0.7}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.qName, { color: t.text }]} numberOfLines={1}>{quote.name}</Text>
                <Text style={[styles.qSub, { color: t.textSecondary }]}>
                  {quote.number}{quote.contact?.name ? ` • ${quote.contact.name}` : ''}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.amount, { color: t.text }]}>{fmt(quote.total)}</Text>
                <StatusBadge status={quote.status} />
              </View>
            </View>
            {quote.expiryDate && (
              <Text style={[styles.meta, { color: t.textMuted }]}>
                Expires {new Date(quote.expiryDate).toLocaleDateString()}
              </Text>
            )}
          </TouchableOpacity>
        </SwipeableRow>
      </AnimatedCard>
    )
  }

  if (!canRead) {
    return (
      <View style={[styles.safe, { backgroundColor: t.background }]}>
        <EmptyState icon="document-text-outline" title="Quotes are not part of your role" subtitle="Ask the office for a quote's details." />
      </View>
    )
  }

  return (
    <View style={[styles.safe, { backgroundColor: t.background }]}>
      {/* Stats bar */}
      {stats && (
        <View style={[styles.statsBar, { backgroundColor: t.surface, borderColor: t.border }]}>
          <StatPill label="Total" value={stats.total} color={t.textSecondary} theme={t} />
          <StatPill label="Pending" value={(stats.draft ?? 0) + (stats.sent ?? 0)} color="#f59e0b" theme={t} />
          <StatPill label="Approved" value={stats.approved} color="#22c55e" theme={t} />
          {stats.totalValue !== undefined && <StatPill label="Value" value={fmt(stats.totalValue)} color={t.primaryText} theme={t} />}
        </View>
      )}

      {tile ? <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}><FilterBanner label={tile.banner} count={tileTotal} onClear={clear} /></View> : null}
      {tile ? null : <FilterChips options={FILTERS} selected={filter} onSelect={setFilter} />}

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

      {canCreate && <FAB icon="add" onPress={() => router.push('/(details)/quote/form')} />}
    </View>
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
