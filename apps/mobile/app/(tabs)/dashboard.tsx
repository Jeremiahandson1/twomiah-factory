/**
 * Dashboard — vertical-aware, shows relevant stats per CRM type.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuth } from '../../src/auth/AuthContext'
import { useTheme } from '../../src/theme/ThemeContext'
import { useVertical } from '../../src/vertical/VerticalContext'
import { get } from '../../src/api/client'
import { StatusBadge } from '../../src/components/StatusBadge'
import { StatCard } from '../../src/components/StatCard'
import { SkeletonList, SkeletonStatGrid } from '../../src/components/SkeletonLoader'
import { AnimatedCard } from '../../src/components/AnimatedCard'
import { useRealTimeEvent, EVENTS } from '../../src/socket/SocketContext'
import { usePushNotifications } from '../../src/hooks/usePushNotifications'

interface Stats {
  contacts: number
  jobs: { total: number; today: number; byStatus: Record<string, number> }
  quotes: { total: number; pending: number; approved: number; totalValue: number }
  invoices: { total: number; outstanding: number; outstandingValue: number }
}

export default function DashboardScreen() {
  const t = useTheme()
  const { user } = useAuth()
  const { vertical } = useVertical()
  const [stats, setStats] = useState<Stats | null>(null)
  const [todayJobs, setTodayJobs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  usePushNotifications()

  const load = useCallback(async () => {
    const [s, j] = await Promise.all([
      get('/api/dashboard/stats'),
      get('/api/jobs/today').catch(() => ({ ok: false, data: [] } as any)),
    ])
    if (s.ok) setStats(s.data)
    if (j.ok) setTodayJobs(j.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false) }

  useRealTimeEvent(EVENTS.JOB_UPDATED, load)
  useRealTimeEvent(EVENTS.JOB_CREATED, load)

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
        <View style={{ padding: 16, gap: 8 }}>
          <SkeletonStatGrid />
          <SkeletonList count={3} />
        </View>
      </SafeAreaView>
    )
  }

  const config = getVerticalConfig(vertical)
  const statCards = getStatCards(vertical, stats)

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
      >
        <Text style={[styles.greeting, { color: t.text }]}>Hey, {user?.firstName}</Text>
        <Text style={[styles.companyLabel, { color: t.textSecondary }]}>{t.companyName}</Text>

        <View style={styles.statsGrid}>
          {statCards.map((card, i) => (
            <AnimatedCard key={card.label} index={i}>
              <StatCard {...card} />
            </AnimatedCard>
          ))}
        </View>

        <Text style={[styles.sectionTitle, { color: t.text }]}>{config.todayLabel}</Text>
        {todayJobs.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Text style={{ color: t.textMuted, textAlign: 'center' }}>{config.emptyMessage}</Text>
          </View>
        ) : (
          todayJobs.slice(0, 5).map((job, idx) => (
            <AnimatedCard key={job.id} index={idx + 4}>
              <View style={[styles.jobCard, { backgroundColor: t.surface, borderColor: t.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.jobTitle, { color: t.text }]}>{job.title}</Text>
                  <Text style={[styles.jobMeta, { color: t.textSecondary }]}>
                    {job.number}{job.scheduledTime ? ` • ${job.scheduledTime}` : ''}
                  </Text>
                  {job.address && (
                    <Text style={[styles.jobMeta, { color: t.textMuted }]} numberOfLines={1}>
                      {job.address}{job.city ? `, ${job.city}` : ''}
                    </Text>
                  )}
                </View>
                <StatusBadge status={job.status} />
              </View>
            </AnimatedCard>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function getVerticalConfig(vertical: string) {
  switch (vertical) {
    case 'homecare': return { todayLabel: "Today's Shifts", emptyMessage: 'No shifts scheduled for today' }
    case 'dispensary': return { todayLabel: 'Recent Orders', emptyMessage: 'No orders yet today' }
    case 'fieldservice': return { todayLabel: "Today's Service Calls", emptyMessage: 'No service calls scheduled' }
    default: return { todayLabel: "Today's Jobs", emptyMessage: 'No jobs scheduled for today' }
  }
}

function getStatCards(vertical: string, stats: Stats | null) {
  if (!stats) return []
  switch (vertical) {
    case 'dispensary':
      return [
        { label: 'Orders Today', value: stats.jobs?.today ?? 0, icon: 'receipt', color: '#3b82f6' },
        { label: 'Customers', value: stats.contacts ?? 0, icon: 'people', color: '#8b5cf6' },
        { label: 'Revenue', value: `$${((stats.invoices?.outstandingValue ?? 0) / 100).toFixed(0)}`, icon: 'cash', color: '#22c55e' },
        { label: 'Active', value: stats.jobs?.byStatus?.in_progress ?? 0, icon: 'time', color: '#f59e0b' },
      ]
    case 'homecare':
      return [
        { label: 'Shifts Today', value: stats.jobs?.today ?? 0, icon: 'time', color: '#3b82f6' },
        { label: 'Clients', value: stats.contacts ?? 0, icon: 'heart', color: '#ec4899' },
        { label: 'Active Visits', value: stats.jobs?.byStatus?.in_progress ?? 0, icon: 'pulse', color: '#22c55e' },
        { label: 'Open Tasks', value: stats.quotes?.pending ?? 0, icon: 'clipboard', color: '#f59e0b' },
      ]
    case 'roofing':
      return [
        { label: 'Jobs Today', value: stats.jobs?.today ?? 0, icon: 'hammer', color: '#3b82f6' },
        { label: 'Pipeline', value: stats.quotes?.pending ?? 0, icon: 'funnel', color: '#f59e0b' },
        { label: 'Active Jobs', value: (stats.jobs?.byStatus?.scheduled ?? 0) + (stats.jobs?.byStatus?.in_progress ?? 0), icon: 'construct', color: '#22c55e' },
        { label: 'Revenue', value: `$${((stats.invoices?.outstandingValue ?? 0) / 100).toFixed(0)}`, icon: 'cash', color: '#8b5cf6' },
      ]
    default:
      return [
        { label: 'Jobs Today', value: stats.jobs?.today ?? 0, icon: 'hammer', color: '#3b82f6' },
        { label: 'Open Quotes', value: stats.quotes?.pending ?? 0, icon: 'document-text', color: '#f59e0b' },
        { label: 'Active Jobs', value: (stats.jobs?.byStatus?.scheduled ?? 0) + (stats.jobs?.byStatus?.in_progress ?? 0), icon: 'construct', color: '#22c55e' },
        { label: 'Outstanding', value: `$${((stats.invoices?.outstandingValue ?? 0) / 100).toFixed(0)}`, icon: 'cash', color: '#8b5cf6' },
      ]
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 40 },
  greeting: { fontSize: 24, fontWeight: '700' },
  companyLabel: { fontSize: 14, marginTop: 2, marginBottom: 20 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginBottom: 10 },
  emptyCard: { borderRadius: 10, borderWidth: 1, padding: 20, marginBottom: 16 },
  jobCard: {
    borderRadius: 10, borderWidth: 1, padding: 14, marginBottom: 8,
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  jobTitle: { fontSize: 15, fontWeight: '600' },
  jobMeta: { fontSize: 12, marginTop: 2 },
})
