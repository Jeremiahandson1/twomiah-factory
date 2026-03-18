/**
 * My Shifts — homecare vertical. Caregiver's daily shift list.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, FlatList, StyleSheet, RefreshControl, TouchableOpacity, Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../src/theme/ThemeContext'
import { get } from '../../src/api/client'
import { StatusBadge } from '../../src/components/StatusBadge'
import { FilterChips } from '../../src/components/FilterChips'
import { SkeletonList } from '../../src/components/SkeletonLoader'
import { AnimatedCard } from '../../src/components/AnimatedCard'
import { EmptyState } from '../../src/components/EmptyState'

const FILTERS = [
  { key: 'today', label: 'Today' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
]

export default function ShiftsScreen() {
  const t = useTheme()
  const [shifts, setShifts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState('today')

  const loadShifts = useCallback(async () => {
    // Try homecare-specific endpoint first, fall back to jobs
    const res = await get(`/api/scheduling/my-shifts?filter=${filter}`)
    if (res.ok) {
      setShifts(res.data.data || res.data || [])
    } else {
      // Fallback: load today's jobs
      const fallback = await get('/api/jobs/today')
      if (fallback.ok) setShifts(fallback.data || [])
    }
    setLoading(false)
  }, [filter])

  useEffect(() => { setLoading(true); loadShifts() }, [loadShifts])

  const onRefresh = async () => { setRefreshing(true); await loadShifts(); setRefreshing(false) }

  const renderShift = ({ item: shift, index }: { item: any; index: number }) => (
    <AnimatedCard index={index}>
      <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
        <View style={[styles.timeBlock, { backgroundColor: t.primaryLight }]}>
          <Text style={[styles.timeText, { color: t.primary }]}>
            {shift.scheduledTime || shift.startTime || 'TBD'}
          </Text>
          {(shift.endTime || shift.duration) && (
            <Text style={[styles.duration, { color: t.primary }]}>
              {shift.endTime || `${shift.duration}h`}
            </Text>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.row}>
            <Text style={[styles.clientName, { color: t.text }]} numberOfLines={1}>
              {shift.contact?.name || shift.clientName || shift.title}
            </Text>
            <StatusBadge status={shift.status} />
          </View>
          {shift.address && (
            <TouchableOpacity
              onPress={() => {
                const addr = encodeURIComponent(`${shift.address}, ${shift.city || ''} ${shift.state || ''}`)
                Linking.openURL(`https://maps.google.com/?q=${addr}`)
              }}
              style={styles.addressRow}
            >
              <Ionicons name="location" size={12} color={t.primary} />
              <Text style={[styles.address, { color: t.primary }]} numberOfLines={1}>{shift.address}</Text>
            </TouchableOpacity>
          )}
          {shift.notes && (
            <Text style={[styles.notes, { color: t.textMuted }]} numberOfLines={2}>{shift.notes}</Text>
          )}
          {shift.tasks && (
            <View style={styles.taskBar}>
              <Ionicons name="checkbox" size={12} color={t.textMuted} />
              <Text style={[styles.taskCount, { color: t.textMuted }]}>
                {shift.tasksCompleted || 0}/{shift.tasksTotal || shift.tasks?.length || 0} tasks
              </Text>
            </View>
          )}
        </View>
      </View>
    </AnimatedCard>
  )

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      <FilterChips options={FILTERS} selected={filter} onSelect={setFilter} />

      {loading ? (
        <SkeletonList count={4} />
      ) : (
        <FlatList
          data={shifts}
          keyExtractor={item => item.id}
          renderItem={renderShift}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
          ListEmptyComponent={<EmptyState icon="time-outline" title="No shifts" subtitle={`No ${filter} shifts found`} />}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  card: {
    flexDirection: 'row', borderRadius: 12, borderWidth: 1, padding: 14,
    marginBottom: 10, gap: 12,
  },
  timeBlock: {
    width: 60, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 8,
  },
  timeText: { fontSize: 13, fontWeight: '700' },
  duration: { fontSize: 11, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  clientName: { fontSize: 15, fontWeight: '600', flex: 1 },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  address: { fontSize: 12 },
  notes: { fontSize: 12, marginTop: 4, lineHeight: 16 },
  taskBar: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  taskCount: { fontSize: 11 },
})
