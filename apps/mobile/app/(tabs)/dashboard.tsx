/**
 * Dashboard — vertical-aware, shows relevant stats per CRM type.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, useWindowDimensions,
} from 'react-native'
import { useAuth } from '../../src/auth/AuthContext'
import { useTheme } from '../../src/theme/ThemeContext'
import { useVertical } from '../../src/vertical/VerticalContext'
import { get } from '../../src/api/client'
import { StatusBadge } from '../../src/components/StatusBadge'
import { StatCard } from '../../src/components/StatCard'
import { SkeletonList, SkeletonStatGrid } from '../../src/components/SkeletonLoader'
import { AnimatedCard } from '../../src/components/AnimatedCard'
import { useRealTimeEvent, EVENTS } from '../../src/socket/SocketContext'
import { statCardWidth } from '../../src/theme/insets'

/**
 * What /api/dashboard/stats actually sends — which is NOT one shape. (T59)
 *
 * The jobs-family CRMs (contractor, basic, field service, landscaping) send contacts / newLeads / jobs / quotes /
 * invoices (packages/tenant-backend reporting/jobsDashboard.ts); roofing sends its own jobs.{open, inspectionsToday,
 * installsToday} (server/crm/roof/field/dashboard.ts); the dealership sends inventory / sales / service
 * (server/crm/rv/dashboard.ts). Every key is optional because the server drops what the caller may not see (invoices
 * for a technician, newLeads without the Lead Inbox, the quotes' value without quotes:read).
 *
 * Money is DOLLARS on every one of them — invoice.total is decimal(12,2) and the web shows the same figure unchanged.
 */
interface Stats {
  contacts?: number
  newLeads?: number
  jobs?: { total?: number; today?: number; byStatus?: Record<string, number>; open?: number; inspectionsToday?: number; installsToday?: number }
  quotes?: { total?: number; pending?: number; approved?: number; totalValue?: number }
  invoices?: { total?: number; outstanding?: number; outstandingValue?: number }
  // rv
  inventory?: { total?: number; available?: number }
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
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  // Two stat cards per row, a real width on each animated wrapper (see AnimatedCard).
  const { width: screenWidth } = useWindowDimensions()
  const cardWidth = statCardWidth(screenWidth)

  const load = useCallback(async () => {
    // Today's work is the shared jobs module's /api/jobs/today. Roofing's job module has no such route (it would read
    // "today" as a job id) and a dealership's jobs are not switched on (403), so neither asks.
    const asksToday = vertical !== 'rv' && vertical !== 'roofing'
    const [s, j] = await Promise.all([
      get('/api/dashboard/stats'),
      asksToday ? get('/api/jobs/today') : Promise.resolve(null),
    ])
    setStats(s.ok ? s.data : null)
    if (j?.ok && Array.isArray(j.data)) setTodayJobs(j.data)
    setLoading(false)
  }, [vertical])

  useEffect(() => { load() }, [load])

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false) }

  useRealTimeEvent(EVENTS.JOB_UPDATED, load)
  useRealTimeEvent(EVENTS.JOB_CREATED, load)

  if (loading) {
    return (
      <View style={[styles.safe, { backgroundColor: t.background }]}>
        <View style={{ padding: 16, gap: 8 }}>
          <SkeletonStatGrid />
          <SkeletonList count={3} />
        </View>
      </View>
    )
  }

  const config = getVerticalConfig(vertical)
  const statCards = getStatCards(vertical, stats)

  return (
    <View style={[styles.safe, { backgroundColor: t.background }]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
      >
        <Text style={[styles.greeting, { color: t.text }]}>Hey, {user?.firstName}</Text>
        <Text style={[styles.companyLabel, { color: t.textSecondary }]}>{t.companyName}</Text>

        <View style={styles.statsGrid}>
          {statCards.map((card, i) => (
            <AnimatedCard key={card.label} index={i} style={{ width: cardWidth }}>
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
    </View>
  )
}

function getVerticalConfig(vertical: string) {
  switch (vertical) {
    case 'homecare': return { todayLabel: "Today's Shifts", emptyMessage: 'No shifts scheduled for today' }
    case 'fieldservice': return { todayLabel: "Today's Service Calls", emptyMessage: 'No service calls scheduled' }
    case 'rv': return { todayLabel: 'Recent Activity', emptyMessage: 'Nothing scheduled today' }
    default: return { todayLabel: "Today's Jobs", emptyMessage: 'No jobs scheduled for today' }
  }
}

function getStatCards(vertical: string, stats: Stats | null) {
  if (!stats) return []
  switch (vertical) {
    // The keys the RV dashboard really sends (selected since T59 via detectVertical's RV-only features).
    // "Customers" counted every contact, leads included — the open sales leads are the dealership's
    // working number.
    case 'rv':
      return [
        // The dashboard's own count of units on the lot (inventory.total), not a second fetch of the unit list.
        { label: 'Inventory', value: stats.inventory?.total ?? 0, icon: 'car-sport', color: '#3b82f6' },
        { label: 'Open Leads', value: stats.sales?.openLeads ?? 0, icon: 'people', color: '#8b5cf6' },
        { label: 'Open Repair Orders', value: stats.service?.openRepairOrders ?? 0, icon: 'construct', color: '#22c55e' },
      ]
    case 'homecare':
      return [
        { label: 'Shifts Today', value: stats.jobs?.today ?? 0, icon: 'time', color: '#3b82f6' },
        { label: 'Clients', value: stats.contacts ?? 0, icon: 'heart', color: '#ec4899' },
        { label: 'Active Visits', value: stats.jobs?.byStatus?.in_progress ?? 0, icon: 'pulse', color: '#22c55e' },
        { label: 'Open Tasks', value: stats.quotes?.pending ?? 0, icon: 'clipboard', color: '#f59e0b' },
      ]
    // crm-roof's own dashboard (backend/src/routes/dashboard.ts, T59) — it had none, so this screen
    // showed no cards. A roofing job is inspected and installed, not "scheduled", so it counts those.
    case 'roofing':
      return [
        { label: 'Inspections Today', value: stats.jobs?.inspectionsToday ?? 0, icon: 'search', color: '#3b82f6' },
        { label: 'Installs Today', value: stats.jobs?.installsToday ?? 0, icon: 'hammer', color: '#22c55e' },
        ...(typeof stats.newLeads === 'number' ? [{ label: 'New Leads', value: stats.newLeads, icon: 'mail-unread', color: '#ec4899' }] : []),
        { label: 'Open Jobs', value: stats.jobs?.open ?? 0, icon: 'construct', color: '#f59e0b' },
        ...(stats.invoices ? [{ label: 'Outstanding', value: dollars(stats.invoices.outstandingValue), icon: 'cash', color: '#8b5cf6' }] : []),
      ]
    // contractor, field service, landscaping — the jobs-family dashboard (packages/tenant-backend/src/reporting/jobsDashboard.ts)
    default:
      return [
        { label: 'Jobs Today', value: stats.jobs?.today ?? 0, icon: 'hammer', color: '#3b82f6' },
        // The web's New leads tile: Lead Inbox rows still at `new`. Absent without the inbox → no card.
        ...(typeof stats.newLeads === 'number' ? [{ label: 'New Leads', value: stats.newLeads, icon: 'mail-unread', color: '#ec4899' }] : []),
        { label: 'Open Quotes', value: stats.quotes?.pending ?? 0, icon: 'document-text', color: '#f59e0b' },
        // Still to do: everything not finished or called off (the server's jobs.open — scheduled, dispatched, in progress…).
        { label: 'Active Jobs', value: stats.jobs?.open ?? 0, icon: 'construct', color: '#22c55e' },
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
