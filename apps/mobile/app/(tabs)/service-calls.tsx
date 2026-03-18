/**
 * Service Calls — field service vertical. Similar to Jobs but with dispatch terminology.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl, Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../src/theme/ThemeContext'
import { get, post } from '../../src/api/client'
import { StatusBadge } from '../../src/components/StatusBadge'
import { SearchBar } from '../../src/components/SearchBar'
import { FilterChips } from '../../src/components/FilterChips'
import { SkeletonList } from '../../src/components/SkeletonLoader'
import { AnimatedCard } from '../../src/components/AnimatedCard'
import { SwipeableRow } from '../../src/components/SwipeableRow'
import { FAB } from '../../src/components/FAB'
import { EmptyState } from '../../src/components/EmptyState'
import { useToast } from '../../src/components/ToastProvider'
import { useDebounce } from '../../src/hooks/useDebounce'
import { useHaptics } from '../../src/hooks/useHaptics'
import { useCamera } from '../../src/hooks/useCamera'
import { useLocation } from '../../src/hooks/useLocation'
import { useRealTimeEvent, EVENTS } from '../../src/socket/SocketContext'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'dispatched', label: 'Dispatched' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed', label: 'Completed' },
]

export default function ServiceCallsScreen() {
  const t = useTheme()
  const toast = useToast()
  const haptics = useHaptics()
  const { takePhoto } = useCamera()
  const { requestLocation } = useLocation()
  const [calls, setCalls] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)

  const loadCalls = useCallback(async (p = 1, append = false) => {
    const params = new URLSearchParams({ page: String(p), limit: '25' })
    if (filter !== 'all') params.set('status', filter)
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())
    const res = await get(`/api/jobs?${params}`)
    if (res.ok) {
      const data = res.data.data || res.data
      if (append) setCalls(prev => [...prev, ...data])
      else setCalls(data)
      setHasMore(data.length === 25)
    }
    setLoading(false)
  }, [filter, debouncedSearch])

  useEffect(() => { setLoading(true); setPage(1); loadCalls(1) }, [loadCalls])

  const onRefresh = async () => { setRefreshing(true); await loadCalls(1); setRefreshing(false) }
  const loadMore = () => { if (hasMore) { setPage(p => p + 1); loadCalls(page + 1, true) } }

  useRealTimeEvent(EVENTS.JOB_UPDATED, () => loadCalls(1))
  useRealTimeEvent(EVENTS.JOB_CREATED, () => loadCalls(1))

  const handleStart = async (call: any) => {
    const loc = await requestLocation()
    const res = await post(`/api/jobs/${call.id}/start`)
    if (res.ok) {
      haptics.success()
      toast.success(`Started: ${call.title}`)
      setCalls(prev => prev.map(c => c.id === call.id ? { ...c, ...res.data } : c))
    } else {
      haptics.error()
      toast.error(res.error || 'Failed to start')
    }
  }

  const handleComplete = async (call: any) => {
    const res = await post(`/api/jobs/${call.id}/complete`)
    if (res.ok) {
      haptics.success()
      toast.success(`Completed: ${call.title}`)
      setCalls(prev => prev.map(c => c.id === call.id ? { ...c, ...res.data } : c))
    } else {
      haptics.error()
      toast.error(res.error || 'Failed to complete')
    }
  }

  const navigate = (call: any) => {
    if (!call.address) return
    const addr = encodeURIComponent(`${call.address}, ${call.city || ''} ${call.state || ''} ${call.zip || ''}`)
    Linking.openURL(`https://maps.google.com/?q=${addr}`)
  }

  const renderCall = ({ item: call, index }: { item: any; index: number }) => {
    const swipeActions = []
    if (call.address) swipeActions.push({ icon: 'navigate', label: 'Navigate', color: '#3b82f6', onPress: () => navigate(call) })
    if (call.status === 'scheduled' || call.status === 'dispatched') {
      swipeActions.push({ icon: 'play', label: 'Start', color: '#22c55e', onPress: () => handleStart(call) })
    }
    if (call.status === 'in_progress') {
      swipeActions.push({ icon: 'checkmark-circle', label: 'Complete', color: '#8b5cf6', onPress: () => handleComplete(call) })
    }

    return (
      <AnimatedCard index={index}>
        <SwipeableRow rightActions={swipeActions}>
          <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
            <View style={styles.cardHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: t.text }]} numberOfLines={1}>{call.title}</Text>
                <Text style={[styles.sub, { color: t.textSecondary }]}>
                  {call.number}{call.contact?.name ? ` • ${call.contact.name}` : ''}
                </Text>
              </View>
              <StatusBadge status={call.status} />
            </View>
            {call.scheduledDate && (
              <Text style={[styles.meta, { color: t.textMuted }]}>
                {new Date(call.scheduledDate).toLocaleDateString()}{call.scheduledTime ? ` at ${call.scheduledTime}` : ''}
              </Text>
            )}
            {call.address && (
              <Text style={[styles.meta, { color: t.textMuted }]} numberOfLines={1}>
                {call.address}{call.city ? `, ${call.city}` : ''}
              </Text>
            )}
          </View>
        </SwipeableRow>
      </AnimatedCard>
    )
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search service calls..." />
      <FilterChips options={FILTERS} selected={filter} onSelect={setFilter} />

      {loading ? (
        <SkeletonList count={5} />
      ) : (
        <FlatList
          data={calls}
          keyExtractor={item => item.id}
          renderItem={renderCall}
          contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={<EmptyState icon="build-outline" title="No service calls found" subtitle="Pull to refresh or change filters" />}
        />
      )}

      <FAB icon="add" onPress={() => toast.info('Create service call from the web dashboard')} />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 15, fontWeight: '600' },
  sub: { fontSize: 12, marginTop: 2 },
  meta: { fontSize: 12, marginTop: 6 },
})
