/**
 * Jobs / Work Orders — list, status actions, GPS clock-in, camera.
 * Used by contractor and roofing verticals.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, FlatList, StyleSheet, RefreshControl, Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../src/theme/ThemeContext'
import { useVertical } from '../../src/vertical/VerticalContext'
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

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'dispatched', label: 'Dispatched' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed', label: 'Completed' },
]

export default function JobsScreen() {
  const t = useTheme()
  const { vertical } = useVertical()
  const toast = useToast()
  const haptics = useHaptics()
  const { takePhoto } = useCamera()
  const { requestLocation, loading: locLoading } = useLocation()
  const [jobs, setJobs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)

  const loadJobs = useCallback(async (p = 1, append = false) => {
    const params = new URLSearchParams({ page: String(p), limit: '25' })
    if (filter !== 'all') params.set('status', filter)
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())
    const res = await get(`/api/jobs?${params}`)
    if (res.ok) {
      const data = res.data.data || res.data
      if (append) setJobs(prev => [...prev, ...data])
      else setJobs(data)
      setHasMore(data.length === 25)
    }
    setLoading(false)
  }, [filter, debouncedSearch])

  useEffect(() => { setLoading(true); setPage(1); loadJobs(1) }, [loadJobs])

  const onRefresh = async () => { setRefreshing(true); await loadJobs(1); setRefreshing(false) }
  const loadMore = () => { if (hasMore) { setPage(p => p + 1); loadJobs(page + 1, true) } }

  useRealTimeEvent(EVENTS.JOB_UPDATED, () => loadJobs(1))
  useRealTimeEvent(EVENTS.JOB_CREATED, () => loadJobs(1))

  const handleClockIn = async (job: any) => {
    const loc = await requestLocation()
    if (!loc) return
    const res = await post(`/api/jobs/${job.id}/start`)
    if (res.ok) {
      haptics.success()
      toast.success(`Clocked in: ${job.title}`)
      setJobs(prev => prev.map(j => j.id === job.id ? { ...j, ...res.data } : j))
    } else {
      haptics.error()
      toast.error(res.error || 'Clock-in failed')
    }
  }

  const handleComplete = async (job: any) => {
    const res = await post(`/api/jobs/${job.id}/complete`)
    if (res.ok) {
      haptics.success()
      toast.success(`Completed: ${job.title}`)
      setJobs(prev => prev.map(j => j.id === job.id ? { ...j, ...res.data } : j))
    } else {
      haptics.error()
      toast.error(res.error || 'Failed to complete')
    }
  }

  const handlePhoto = async (job: any) => {
    const photo = await takePhoto()
    if (photo) {
      haptics.light()
      toast.success(`Photo captured for ${job.number}`)
    }
  }

  const navigate = (job: any) => {
    if (!job.address) return
    const addr = encodeURIComponent(`${job.address}, ${job.city || ''} ${job.state || ''} ${job.zip || ''}`)
    Linking.openURL(`https://maps.google.com/?q=${addr}`)
  }

  const renderJob = ({ item: job, index }: { item: any; index: number }) => {
    const swipeActions = []
    if (job.address) swipeActions.push({ icon: 'navigate', label: 'Navigate', color: '#3b82f6', onPress: () => navigate(job) })
    if (job.status === 'scheduled' || job.status === 'dispatched') {
      swipeActions.push({ icon: 'play', label: 'Start', color: '#22c55e', onPress: () => handleClockIn(job) })
    }
    if (job.status === 'in_progress') {
      swipeActions.push({ icon: 'checkmark-circle', label: 'Complete', color: '#8b5cf6', onPress: () => handleComplete(job) })
    }
    swipeActions.push({ icon: 'camera', label: 'Photo', color: '#f59e0b', onPress: () => handlePhoto(job) })

    return (
      <AnimatedCard index={index}>
        <SwipeableRow rightActions={swipeActions}>
          <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
            <View style={styles.cardHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.jobTitle, { color: t.text }]} numberOfLines={1}>{job.title}</Text>
                <Text style={[styles.jobSub, { color: t.textSecondary }]}>
                  {job.number}{job.contact?.name ? ` • ${job.contact.name}` : ''}
                </Text>
              </View>
              <StatusBadge status={job.status} />
            </View>

            {job.scheduledDate && (
              <Text style={[styles.meta, { color: t.textMuted }]}>
                {new Date(job.scheduledDate).toLocaleDateString()}{job.scheduledTime ? ` at ${job.scheduledTime}` : ''}
              </Text>
            )}
            {job.address && (
              <Text style={[styles.meta, { color: t.textMuted }]} numberOfLines={1}>
                {job.address}{job.city ? `, ${job.city}` : ''}
              </Text>
            )}
            {/* Roofing: show insurance info */}
            {vertical === 'roofing' && job.insuranceClaim && (
              <View style={styles.insuranceTag}>
                <Ionicons name="shield" size={12} color="#f59e0b" />
                <Text style={styles.insuranceText}>Insurance claim</Text>
              </View>
            )}
          </View>
        </SwipeableRow>
      </AnimatedCard>
    )
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search jobs..." />
      <FilterChips options={STATUS_FILTERS} selected={filter} onSelect={setFilter} />

      {loading ? (
        <SkeletonList count={5} />
      ) : (
        <FlatList
          data={jobs}
          keyExtractor={item => item.id}
          renderItem={renderJob}
          contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={<EmptyState icon="hammer-outline" title="No jobs found" subtitle="Pull to refresh or change filters" />}
        />
      )}

      <FAB icon="add" onPress={() => toast.info('Create jobs from the web dashboard')} />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  jobTitle: { fontSize: 15, fontWeight: '600' },
  jobSub: { fontSize: 12, marginTop: 2 },
  meta: { fontSize: 12, marginTop: 6 },
  insuranceTag: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e2e8f0',
  },
  insuranceText: { fontSize: 12, color: '#f59e0b', fontWeight: '600' },
})
