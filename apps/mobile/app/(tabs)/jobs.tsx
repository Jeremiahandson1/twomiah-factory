/**
 * Jobs / Work Orders — list, status actions, camera.
 * Used by contractor, basic, landscaping and roofing.
 *
 * GET /api/jobs is { data, pagination } from both job modules. The shared one (packages/tenant-backend jobs/jobs.ts)
 * refuses a status it has no word for, and moves a job with POST /:id/start and /:id/complete; roofing's
 * (server/crm/roof/jobs.ts) has its pipeline statuses and moves a job with POST /:id/advance — so the filters and the
 * swipe actions are the vertical's. A photo goes onto the job (components/PhotoGallery uploadJobPhoto).
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, FlatList, StyleSheet, RefreshControl, Linking, TouchableOpacity,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useTile } from '../../src/home/useTile'
import { FilterBanner } from '../../src/home/FilterBanner'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../src/theme/ThemeContext'
import { ACTION } from '../../src/theme/actions'
import { useVertical } from '../../src/vertical/VerticalContext'
import { get, post } from '../../src/api/client'
import { getSaved } from '../../src/offline/readThrough'
import { useAuth } from '../../src/auth/AuthContext'
import { uploadJobPhoto } from '../../src/components/PhotoGallery'
import { StatusBadge } from '../../src/components/StatusBadge'
import { useStageName } from '../../src/pipeline/useStageName'
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
import { useRealTimeEvent, EVENTS } from '../../src/socket/SocketContext'

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'dispatched', label: 'Dispatched' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed', label: 'Completed' },
]
// Roofing's statuses (server/crm/roof/validation.ts) — the ones a crew filters by.
const ROOF_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'lead', label: 'Lead' },
  { key: 'inspection_scheduled', label: 'Inspection' },
  { key: 'signed', label: 'Signed' },
  { key: 'material_ordered', label: 'Materials' },
  { key: 'in_production', label: 'In Production' },
  { key: 'final_inspection', label: 'Final' },
  { key: 'collected', label: 'Collected' },
]
const ROOF_LAST = 'collected'
const ROOF_CLOSED = ['lost', 'cancelled']

export default function JobsScreen() {
  const router = useRouter()
  const t = useTheme()
  const { vertical, hasFeature } = useVertical()
  const { stageName } = useStageName()
  const { can } = useAuth()
  const isRoof = vertical === 'roofing'
  const canWork = can('jobs:update')
  const canCreate = can('jobs:create')
  const canPhoto = hasFeature('photo_capture') && (vertical === 'contractor' ? can('documents:create') : canWork)
  const toast = useToast()
  const haptics = useHaptics()
  const { takePhoto } = useCamera()
  const [jobs, setJobs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const { tile, clear } = useTile()
  const [tileTotal, setTileTotal] = useState<number | undefined>(undefined)
  // A pipeline stage row on the roofing home opens this list already on that stage (?status=).
  const { status: statusParam } = useLocalSearchParams<{ status?: string }>()
  const [filter, setFilter] = useState(statusParam ? String(statusParam) : 'all')
  useEffect(() => { if (statusParam) setFilter(String(statusParam)) }, [statusParam])
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)

  const loadJobs = useCallback(async (p = 1, append = false) => {
    const params = new URLSearchParams({ page: String(p), limit: '25' })
    if (tile) Object.entries(tile.list.query || {}).forEach(([k, v]) => params.set(k, v))
    else if (filter !== 'all') params.set('status', filter)
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())
    // The first page is kept on the phone: with no signal the list opens from the last good copy.
    const res = p === 1 ? await getSaved(`/api/jobs?${params}`) : await get(`/api/jobs?${params}`)
    if (res.ok) {
      const data: any[] = Array.isArray(res.data?.data) ? res.data.data : []
      if (append) setJobs(prev => [...prev, ...data])
      else setJobs(data)
      setHasMore(data.length === 25)
      setTileTotal(typeof res.data?.pagination?.total === 'number' ? res.data.pagination.total : undefined)
    }
    setLoading(false)
  }, [filter, debouncedSearch, tile?.id])

  useEffect(() => { setLoading(true); setPage(1); loadJobs(1) }, [loadJobs])

  const onRefresh = async () => { setRefreshing(true); await loadJobs(1); setRefreshing(false) }
  const loadMore = () => { if (hasMore) { setPage(p => p + 1); loadJobs(page + 1, true) } }

  useRealTimeEvent(EVENTS.JOB_UPDATED, () => loadJobs(1), [loadJobs])
  useRealTimeEvent(EVENTS.JOB_CREATED, () => loadJobs(1), [loadJobs])
  useRealTimeEvent(EVENTS.JOB_STATUS_CHANGED, () => loadJobs(1), [loadJobs])

  const handleStart = async (job: any) => {
    const res = await post(`/api/jobs/${job.id}/start`)
    if (res.ok) {
      haptics.success()
      toast.success(`Started: ${job.title}`)
      setJobs(prev => prev.map(j => j.id === job.id ? { ...j, ...res.data } : j))
    } else {
      haptics.error()
      toast.error(res.error || 'Could not start the job')
    }
  }

  // Roofing: the next pipeline stage (POST /:id/advance).
  const handleAdvance = async (job: any) => {
    const res = await post(`/api/jobs/${job.id}/advance`)
    if (res.ok) {
      haptics.success()
      toast.success(`${job.number} moved to ${String(res.data?.status || '').replace(/_/g, ' ')}`)
      setJobs(prev => prev.map(j => j.id === job.id ? { ...j, status: res.data?.status ?? j.status } : j))
    } else {
      haptics.error()
      toast.error(res.error || 'Could not advance the job')
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
    if (!photo) return
    const res = await uploadJobPhoto(vertical, job.id, photo.uri, photo.stamp)
    if (res.ok) { haptics.success(); toast.success(`Photo added to ${job.number}`) }
    else { haptics.error(); toast.error(res.error || 'Photo upload failed') }
  }

  const navigate = (job: any) => {
    if (!job.address) return
    const addr = encodeURIComponent(`${job.address}, ${job.city || ''} ${job.state || ''} ${job.zip || ''}`)
    Linking.openURL(`https://maps.google.com/?q=${addr}`)
  }

  const renderJob = ({ item: job, index }: { item: any; index: number }) => {
    const swipeActions = []
    if (job.address) swipeActions.push({ icon: 'navigate', label: 'Navigate', color: ACTION.slate, onPress: () => navigate(job) })
    if (canWork && !isRoof && (job.status === 'scheduled' || job.status === 'dispatched')) {
      swipeActions.push({ icon: 'play', label: 'Start', color: t.primary, onPress: () => handleStart(job) })
    }
    if (canWork && !isRoof && job.status === 'in_progress') {
      swipeActions.push({ icon: 'checkmark-circle', label: 'Complete', color: t.primary, onPress: () => handleComplete(job) })
    }
    if (canWork && isRoof && job.status !== ROOF_LAST && !ROOF_CLOSED.includes(job.status)) {
      swipeActions.push({ icon: 'arrow-forward-circle', label: 'Advance', color: t.primary, onPress: () => handleAdvance(job) })
    }
    if (canPhoto) swipeActions.push({ icon: 'camera', label: 'Photo', color: ACTION.slate, onPress: () => handlePhoto(job) })

    return (
      <AnimatedCard index={index}>
        <SwipeableRow rightActions={swipeActions}>
          <TouchableOpacity style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}
            onPress={() => router.push(`/(details)/job/${job.id}`)} activeOpacity={0.7}>
            <View style={styles.cardHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.jobTitle, { color: t.text }]} numberOfLines={1}>{job.title}</Text>
                <Text style={[styles.jobSub, { color: t.textSecondary }]}>
                  {job.number}{job.contact?.name ? ` • ${job.contact.name}` : ''}
                </Text>
              </View>
              <StatusBadge status={job.status} label={stageName(job.status, job.jobType)} />
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
            {/* Roofing: an insurance job, and its claim number when there is one */}
            {isRoof && job.jobType === 'insurance' && (
              <View style={[styles.insuranceTag, { borderTopColor: t.border }]}>
                <Ionicons name="shield" size={12} color="#f59e0b" />
                <Text style={[styles.insuranceText, { color: t.warning }]}>Insurance{job.claimNumber ? ` • Claim ${job.claimNumber}` : ''}</Text>
              </View>
            )}
          </TouchableOpacity>
        </SwipeableRow>
      </AnimatedCard>
    )
  }

  return (
    <View style={[styles.safe, { backgroundColor: t.background }]}>
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search jobs..." />
      {tile ? <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}><FilterBanner label={tile.banner} count={tileTotal} onClear={clear} /></View> : null}
      {tile ? null : <FilterChips options={isRoof ? ROOF_FILTERS : STATUS_FILTERS} selected={filter} onSelect={setFilter} />}

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

      {canCreate && <FAB icon="add" onPress={() => router.push('/(details)/job/form')} />}
    </View>
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
    marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'transparent',
  },
  insuranceText: { fontSize: 12, fontWeight: '600' },
})
