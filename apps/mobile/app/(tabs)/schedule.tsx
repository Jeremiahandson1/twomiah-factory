/**
 * Schedule — field service / landscaping day view.
 *
 * GET /api/jobs?date=YYYY-MM-DD is the dispatch board's day filter (packages/tenant-backend jobs/jobs.ts); the
 * `scheduledDate=` this screen sent was not a filter at all, so every day showed the first page of ALL jobs. The day is
 * the phone's calendar day — toISOString() is the UTC one, a day ahead every evening in the Americas. `assignedTo` is a
 * person { name }, not a string.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../src/theme/ThemeContext'
import { get } from '../../src/api/client'
import { StatusBadge } from '../../src/components/StatusBadge'
import { SkeletonList } from '../../src/components/SkeletonLoader'
import { AnimatedCard } from '../../src/components/AnimatedCard'
import { EmptyState } from '../../src/components/EmptyState'

const pad = (n: number) => String(n).padStart(2, '0')
const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export default function ScheduleScreen() {
  const t = useTheme()
  const router = useRouter()
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [jobs, setJobs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const loadSchedule = useCallback(async () => {
    const res = await get(`/api/jobs?date=${dayOf(selectedDate)}&limit=100`)
    setJobs(res.ok && Array.isArray(res.data?.data) ? res.data.data : [])
    setLoading(false)
  }, [selectedDate])

  useEffect(() => { setLoading(true); loadSchedule() }, [loadSchedule])

  const onRefresh = async () => { setRefreshing(true); await loadSchedule(); setRefreshing(false) }

  const changeDate = (offset: number) => {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() + offset)
    setSelectedDate(d)
  }

  const isToday = selectedDate.toDateString() === new Date().toDateString()
  const dateLabel = isToday ? 'Today' : selectedDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      {/* Date picker */}
      <View style={[styles.dateBar, { backgroundColor: t.surface, borderColor: t.border }]}>
        <TouchableOpacity onPress={() => changeDate(-1)} style={styles.dateBtn}>
          <Ionicons name="chevron-back" size={22} color={t.primary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setSelectedDate(new Date())} style={styles.dateCenter}>
          <Text style={[styles.dateLabel, { color: t.text }]}>{dateLabel}</Text>
          <Text style={[styles.dateCount, { color: t.textSecondary }]}>{jobs.length} scheduled</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => changeDate(1)} style={styles.dateBtn}>
          <Ionicons name="chevron-forward" size={22} color={t.primary} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <SkeletonList count={4} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
        >
          {jobs.length === 0 ? (
            <EmptyState icon="calendar-outline" title="Nothing scheduled" subtitle={`No jobs on ${dateLabel}`} />
          ) : (
            jobs.map((job, idx) => (
              <AnimatedCard key={job.id} index={idx}>
                <TouchableOpacity activeOpacity={0.7} onPress={() => router.push(`/(details)/job/${job.id}`)}
                  style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                  <View style={styles.timeStrip}>
                    <Text style={[styles.time, { color: t.primary }]}>
                      {job.scheduledTime || 'TBD'}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.cardHeader}>
                      <Text style={[styles.title, { color: t.text }]} numberOfLines={1}>{job.title}</Text>
                      <StatusBadge status={job.status} />
                    </View>
                    {job.contact?.name && (
                      <Text style={[styles.sub, { color: t.textSecondary }]}>{job.contact.name}</Text>
                    )}
                    {job.address && (
                      <Text style={[styles.sub, { color: t.textMuted }]} numberOfLines={1}>
                        {job.address}{job.city ? `, ${job.city}` : ''}
                      </Text>
                    )}
                    {job.assignedTo?.name ? (
                      <View style={styles.techRow}>
                        <Ionicons name="person" size={12} color={t.textMuted} />
                        <Text style={[styles.techName, { color: t.textMuted }]}>{job.assignedTo.name}</Text>
                      </View>
                    ) : null}
                  </View>
                </TouchableOpacity>
              </AnimatedCard>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  dateBar: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12,
    marginHorizontal: 16, marginTop: 8, borderRadius: 12, borderWidth: 1,
  },
  dateBtn: { padding: 8, paddingHorizontal: 12 },
  dateCenter: { flex: 1, alignItems: 'center' },
  dateLabel: { fontSize: 16, fontWeight: '700' },
  dateCount: { fontSize: 12, marginTop: 2 },
  card: {
    flexDirection: 'row', borderRadius: 12, borderWidth: 1, padding: 14,
    marginBottom: 10, gap: 12,
  },
  timeStrip: {
    width: 56, alignItems: 'center', justifyContent: 'center',
    borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: '#e2e8f0',
    paddingRight: 10,
  },
  time: { fontSize: 13, fontWeight: '700' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 15, fontWeight: '600', flex: 1 },
  sub: { fontSize: 12, marginTop: 3 },
  techRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  techName: { fontSize: 11 },
})
