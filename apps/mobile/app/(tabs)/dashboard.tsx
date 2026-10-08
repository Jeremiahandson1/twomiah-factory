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

/**
 * What /api/dashboard/stats actually sends — which is NOT one shape. (T59)
 *
 * The jobs-family CRMs (contractor, field service, landscaping) send contacts / newLeads / jobs /
 * quotes / invoices; dispensary sends customers and today.*; RV sends inventory / sales / service. This
 * screen read the jobs-family keys for everybody, so dispensary's four cards were all 0 and its
 * "Customers" read a `contacts` key dispensary never sends. Every key is optional because the server
 * drops what the caller may not see (invoices for a technician, newLeads without the Lead Inbox).
 *
 * Money is DOLLARS on every one of them — invoice.total is decimal(12,2) and the web shows the same
 * figure unchanged. This screen divided it by 100, so $1,200 owed read "$12".
 */
interface Stats {
  contacts?: number
  newLeads?: number
  jobs?: { total?: number; today?: number; byStatus?: Record<string, number> }
  quotes?: { total?: number; pending?: number; approved?: number; totalValue?: number }
  invoices?: { total?: number; outstanding?: number; outstandingValue?: number }
  // dispensary
  customers?: number
  today?: { revenue?: number; orderCount?: number; pendingOrders?: number }
  // rv
  sales?: { openLeads?: number }
  service?: { openRepairOrders?: number }
}

const dollars = (v: unknown) => `$${Math.round(Number(v) || 0).toLocaleString()}`

export default function DashboardScreen() {
  const t = useTheme()
  const { user } = useAuth()
  const { vertical } = useVertical()
  const [stats, setStats] = useState<Stats | null>(null)
  const [todayJobs, setTodayJobs] = useState<any[]>([])
  const [unitCount, setUnitCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  usePushNotifications()

  const load = useCallback(async () => {
    const reqs: Promise<any>[] = [
      get('/api/dashboard/stats'),
      get('/api/jobs/today').catch(() => ({ ok: false, data: [] } as any)),
    ]
    if (vertical === 'rv') reqs.push(get('/api/units?limit=200').catch(() => ({ ok: false, data: [] } as any)))
    const [s, j, u] = await Promise.all(reqs)
    if (s.ok) setStats(s.data)
    if (j.ok) setTodayJobs(j.data || [])
    if (u && u.ok) { const d = u.data?.data || u.data || []; setUnitCount(Array.isArray(d) ? d.length : 0) }
    setLoading(false)
  }, [vertical])

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
  const statCards = getStatCards(vertical, stats, unitCount)

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
    case 'rv': return { todayLabel: 'Recent Activity', emptyMessage: 'Nothing scheduled today' }
    default: return { todayLabel: "Today's Jobs", emptyMessage: 'No jobs scheduled for today' }
  }
}

function getStatCards(vertical: string, stats: Stats | null, unitCount = 0) {
  if (!stats) return []
  switch (vertical) {
    // NOTE: 'rv' is not in VerticalContext's VALID_VERTICALS yet, so the app never selects it; these are
    // the keys the RV dashboard really sends, ready for when it does. "Customers" counted every contact,
    // leads included — the open sales leads are the dealership's working number.
    case 'rv':
      return [
        { label: 'Inventory', value: unitCount, icon: 'car-sport', color: '#3b82f6' },
        { label: 'Open Leads', value: stats.sales?.openLeads ?? 0, icon: 'people', color: '#8b5cf6' },
        { label: 'Open Repair Orders', value: stats.service?.openRepairOrders ?? 0, icon: 'construct', color: '#22c55e' },
      ]
    case 'dispensary':
      return [
        { label: 'Orders Today', value: stats.today?.orderCount ?? 0, icon: 'receipt', color: '#3b82f6' },
        { label: 'Customers', value: stats.customers ?? 0, icon: 'people', color: '#8b5cf6' },
        { label: 'Revenue Today', value: dollars(stats.today?.revenue), icon: 'cash', color: '#22c55e' },
        { label: 'Pending Orders', value: stats.today?.pendingOrders ?? 0, icon: 'time', color: '#f59e0b' },
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
        { label: 'Outstanding', value: dollars(stats.invoices?.outstandingValue), icon: 'cash', color: '#8b5cf6' },
      ]
    // contractor, field service, landscaping — the jobs-family dashboard (packages/tenant-backend/src/reporting/jobsDashboard.ts)
    default:
      return [
        { label: 'Jobs Today', value: stats.jobs?.today ?? 0, icon: 'hammer', color: '#3b82f6' },
        // The web's New leads tile: Lead Inbox rows still at `new`. Absent without the inbox → no card.
        ...(typeof stats.newLeads === 'number' ? [{ label: 'New Leads', value: stats.newLeads, icon: 'mail-unread', color: '#ec4899' }] : []),
        { label: 'Open Quotes', value: stats.quotes?.pending ?? 0, icon: 'document-text', color: '#f59e0b' },
        { label: 'Active Jobs', value: (stats.jobs?.byStatus?.scheduled ?? 0) + (stats.jobs?.byStatus?.in_progress ?? 0), icon: 'construct', color: '#22c55e' },
        // Sent only to somebody who may see money; a technician gets no card rather than "$0".
        ...(stats.invoices ? [{ label: 'Outstanding', value: dollars(stats.invoices.outstandingValue), icon: 'cash', color: '#8b5cf6' }] : []),
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
