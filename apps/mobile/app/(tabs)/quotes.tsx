/**
 * Quotes — list with status filters, value display, quick actions.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl,
  ActivityIndicator, TextInput, Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../src/theme/ThemeContext'
import { get, post } from '../../src/api/client'
import { StatusBadge } from '../../src/components/StatusBadge'
import { EmptyState } from '../../src/components/EmptyState'
import { useRealTimeEvent, EVENTS } from '../../src/socket/SocketContext'

const STATUS_FILTERS = ['all', 'draft', 'sent', 'approved', 'rejected'] as const

export default function QuotesScreen() {
  const t = useTheme()
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
    if (res.ok) setQuotes(prev => prev.map(q => q.id === quote.id ? { ...q, status: 'sent', sentAt: new Date() } : q))
    else Alert.alert('Error', res.error || 'Could not send quote')
  }

  const handleConvertToInvoice = async (quote: any) => {
    Alert.alert('Convert to Invoice', `Create an invoice from "${quote.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Convert', style: 'default',
        onPress: async () => {
          const res = await post(`/api/quotes/${quote.id}/convert-to-invoice`)
          if (res.ok) Alert.alert('Done', `Invoice ${res.data.number} created`)
          else Alert.alert('Error', res.error || 'Conversion failed')
        },
      },
    ])
  }

  const formatCurrency = (val: number) => `$${(val / 100).toLocaleString(undefined, { minimumFractionDigits: 0 })}`

  const renderQuote = ({ item: quote }: { item: any }) => (
    <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.qName, { color: t.text }]} numberOfLines={1}>{quote.name}</Text>
          <Text style={[styles.qSub, { color: t.textSecondary }]}>
            {quote.number}{quote.contact?.name ? ` • ${quote.contact.name}` : ''}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.amount, { color: t.text }]}>{formatCurrency(quote.total || 0)}</Text>
          <StatusBadge status={quote.status} />
        </View>
      </View>

      {quote.expiryDate && (
        <Text style={[styles.meta, { color: t.textMuted }]}>
          Expires {new Date(quote.expiryDate).toLocaleDateString()}
        </Text>
      )}

      {/* Actions */}
      <View style={styles.actions}>
        {quote.status === 'draft' && (
          <TouchableOpacity style={[styles.actionBtn, { borderColor: '#3b82f6' }]} onPress={() => handleSend(quote)}>
            <Ionicons name="send" size={14} color="#3b82f6" />
            <Text style={[styles.actionText, { color: '#3b82f6' }]}>Send</Text>
          </TouchableOpacity>
        )}
        {quote.status === 'approved' && (
          <TouchableOpacity style={[styles.actionBtn, { borderColor: '#22c55e' }]} onPress={() => handleConvertToInvoice(quote)}>
            <Ionicons name="receipt" size={14} color="#22c55e" />
            <Text style={[styles.actionText, { color: '#22c55e' }]}>Invoice</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  )

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      {/* Stats bar */}
      {stats && (
        <View style={[styles.statsBar, { backgroundColor: t.surface, borderColor: t.border }]}>
          <StatPill label="Total" value={stats.total} color={t.textSecondary} theme={t} />
          <StatPill label="Pending" value={stats.pending} color="#f59e0b" theme={t} />
          <StatPill label="Approved" value={stats.approved} color="#22c55e" theme={t} />
          <StatPill label="Value" value={formatCurrency(stats.totalValue || 0)} color={t.primary} theme={t} />
        </View>
      )}

      {/* Filters */}
      <View style={styles.filters}>
        {STATUS_FILTERS.map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.filterChip, filter === f && { backgroundColor: t.primary }]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterText, filter === f && { color: '#fff' }, filter !== f && { color: t.textSecondary }]}>
              {f === 'all' ? 'All' : f}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={t.primary} style={{ marginTop: 40 }} />
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
  filters: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingVertical: 10 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  filterText: { fontSize: 13, fontWeight: '600', textTransform: 'capitalize' },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  qName: { fontSize: 15, fontWeight: '600' },
  qSub: { fontSize: 12, marginTop: 2 },
  amount: { fontSize: 17, fontWeight: '700', marginBottom: 4 },
  meta: { fontSize: 12, marginTop: 8 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1 },
  actionText: { fontSize: 13, fontWeight: '600' },
})
