/**
 * Jobs / Work Orders — list, status actions, GPS clock-in, camera.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl,
  ActivityIndicator, Alert, TextInput, Modal,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../src/theme/ThemeContext'
import { get, post } from '../../src/api/client'
import { StatusBadge } from '../../src/components/StatusBadge'
import { EmptyState } from '../../src/components/EmptyState'
import { useCamera } from '../../src/hooks/useCamera'
import { useLocation } from '../../src/hooks/useLocation'
import { useRealTimeEvent, EVENTS } from '../../src/socket/SocketContext'

const STATUS_FILTERS = ['all', 'scheduled', 'dispatched', 'in_progress', 'completed'] as const

export default function JobsScreen() {
  const t = useTheme()
  const [jobs, setJobs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { takePhoto } = useCamera()
  const { requestLocation, loading: locLoading } = useLocation()

  const loadJobs = useCallback(async (p = 1, append = false) => {
    const params = new URLSearchParams({ page: String(p), limit: '25' })
    if (filter !== 'all') params.set('status', filter)
    const res = await get(`/api/jobs?${params}`)
    if (res.ok) {
      const data = res.data.data || res.data
      if (append) setJobs(prev => [...prev, ...data])
      else setJobs(data)
      setHasMore(data.length === 25)
    }
    setLoading(false)
  }, [filter])

  useEffect(() => { setLoading(true); setPage(1); loadJobs(1) }, [loadJobs])

  const onRefresh = async () => { setRefreshing(true); await loadJobs(1); setRefreshing(false) }
  const loadMore = () => { if (hasMore) { setPage(p => p + 1); loadJobs(page + 1, true) } }

  useRealTimeEvent(EVENTS.JOB_UPDATED, () => loadJobs(1))
  useRealTimeEvent(EVENTS.JOB_CREATED, () => loadJobs(1))

  const handleStatusAction = async (job: any, action: 'start' | 'complete' | 'dispatch') => {
    const res = await post(`/api/jobs/${job.id}/${action}`)
    if (res.ok) {
      setJobs(prev => prev.map(j => j.id === job.id ? { ...j, ...res.data } : j))
    } else {
      Alert.alert('Error', res.error || 'Action failed')
    }
  }

  const handleClockIn = async (job: any) => {
    const loc = await requestLocation()
    if (!loc) return
    // Update job with GPS coordinates + start
    const res = await post(`/api/jobs/${job.id}/start`)
    if (res.ok) {
      Alert.alert('Clocked In', `Location: ${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}`)
      setJobs(prev => prev.map(j => j.id === job.id ? { ...j, ...res.data } : j))
    }
  }

  const handlePhoto = async (job: any) => {
    const photo = await takePhoto()
    if (!photo) return
    Alert.alert('Photo Saved', `Job site photo captured for ${job.number}`)
    // TODO: Upload photo to CRM backend
  }

  const filteredJobs = search
    ? jobs.filter(j => j.title?.toLowerCase().includes(search.toLowerCase()) || j.number?.toLowerCase().includes(search.toLowerCase()))
    : jobs

  const renderJob = ({ item: job }: { item: any }) => {
    const expanded = expandedId === job.id
    return (
      <TouchableOpacity
        style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}
        onPress={() => setExpandedId(expanded ? null : job.id)}
        activeOpacity={0.7}
      >
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
            📅 {new Date(job.scheduledDate).toLocaleDateString()}{job.scheduledTime ? ` at ${job.scheduledTime}` : ''}
          </Text>
        )}

        {job.address && (
          <Text style={[styles.meta, { color: t.textMuted }]} numberOfLines={1}>
            📍 {job.address}{job.city ? `, ${job.city}` : ''}
          </Text>
        )}

        {expanded && (
          <View style={styles.actions}>
            {job.status === 'scheduled' && (
              <ActionBtn icon="play" label="Clock In" color="#22c55e" onPress={() => handleClockIn(job)} loading={locLoading} />
            )}
            {job.status === 'dispatched' && (
              <ActionBtn icon="play" label="Start" color="#22c55e" onPress={() => handleStatusAction(job, 'start')} />
            )}
            {job.status === 'in_progress' && (
              <ActionBtn icon="checkmark-circle" label="Complete" color="#3b82f6" onPress={() => handleStatusAction(job, 'complete')} />
            )}
            <ActionBtn icon="camera" label="Photo" color="#8b5cf6" onPress={() => handlePhoto(job)} />
            {job.address && (
              <ActionBtn icon="navigate" label="Navigate" color="#f59e0b" onPress={() => {
                const addr = encodeURIComponent(`${job.address}, ${job.city || ''} ${job.state || ''} ${job.zip || ''}`)
                const url = `https://maps.google.com/?q=${addr}`
                import('expo-linking').then(Linking => Linking.openURL(url))
              }} />
            )}
          </View>
        )}
      </TouchableOpacity>
    )
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      {/* Search */}
      <View style={[styles.searchWrap, { backgroundColor: t.surface, borderColor: t.border }]}>
        <Ionicons name="search" size={18} color={t.textMuted} />
        <TextInput
          style={[styles.searchInput, { color: t.text }]}
          value={search}
          onChangeText={setSearch}
          placeholder="Search jobs..."
          placeholderTextColor={t.textMuted}
        />
      </View>

      {/* Filters */}
      <View style={styles.filters}>
        {STATUS_FILTERS.map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.filterChip, filter === f && { backgroundColor: t.primary }]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterText, filter === f && { color: '#fff' }, filter !== f && { color: t.textSecondary }]}>
              {f === 'all' ? 'All' : f.replace('_', ' ')}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={t.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={filteredJobs}
          keyExtractor={item => item.id}
          renderItem={renderJob}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={<EmptyState icon="hammer-outline" title="No jobs found" subtitle="Pull to refresh or change filters" />}
        />
      )}
    </SafeAreaView>
  )
}

function ActionBtn({ icon, label, color, onPress, loading }: any) {
  return (
    <TouchableOpacity style={[styles.actionBtn, { borderColor: color }]} onPress={onPress} disabled={loading}>
      {loading ? <ActivityIndicator size="small" color={color} /> : <Ionicons name={icon} size={16} color={color} />}
      <Text style={[styles.actionLabel, { color }]}>{label}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16,
    marginTop: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 15 },
  filters: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingVertical: 10 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: 'transparent' },
  filterText: { fontSize: 13, fontWeight: '600', textTransform: 'capitalize' },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  jobTitle: { fontSize: 15, fontWeight: '600' },
  jobSub: { fontSize: 12, marginTop: 2 },
  meta: { fontSize: 12, marginTop: 6 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e2e8f0' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  actionLabel: { fontSize: 13, fontWeight: '600' },
})
