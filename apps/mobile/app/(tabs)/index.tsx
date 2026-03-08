/**
 * Dashboard — jobs today, stats, recent activity.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../src/auth/AuthContext'
import { useTheme } from '../../src/theme/ThemeContext'
import { get } from '../../src/api/client'
import { StatusBadge } from '../../src/components/StatusBadge'
import { useRealTimeEvent, EVENTS } from '../../src/socket/SocketContext'
import { usePushNotifications } from '../../src/hooks/usePushNotifications'

interface Stats {
  contacts: number
  jobs: { total: number; today: number; byStatus: Record<string, number> }
  quotes: { total: number; pending: number; approved: number; totalValue: number }
  invoices: { total: number; outstanding: number; outstandingValue: number }
}

interface Activity {
  recentJobs: any[]
  recentQuotes: any[]
  recentInvoices: any[]
}

export default function DashboardScreen() {
  const t = useTheme()
  const { user } = useAuth()
  const [stats, setStats] = useState<Stats | null>(null)
  const [activity, setActivity] = useState<Activity | null>(null)
  const [todayJobs, setTodayJobs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Register for push notifications
  usePushNotifications()

  const load = useCallback(async () => {
    const [s, a, j] = await Promise.all([
      get('/api/dashboard/stats'),
      get('/api/dashboard/recent-activity'),
      get('/api/jobs/today'),
    ])
    if (s.ok) setStats(s.data)
    if (a.ok) setActivity(a.data)
    if (j.ok) setTodayJobs(j.data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false) }

  // Real-time refresh on job updates
  useRealTimeEvent(EVENTS.JOB_UPDATED, load)
  useRealTimeEvent(EVENTS.JOB_CREATED, load)

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={t.primary} />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
      >
        {/* Greeting */}
        <Text style={[styles.greeting, { color: t.text }]}>
          Hey, {user?.firstName} 👋
        </Text>
        <Text style={[styles.companyLabel, { color: t.textSecondary }]}>{t.companyName}</Text>

        {/* Stat Cards */}
        <View style={styles.statsGrid}>
          <StatCard label="Jobs Today" value={stats?.jobs.today ?? 0} icon="hammer" color="#3b82f6" theme={t} />
          <StatCard label="Open Quotes" value={stats?.quotes.pending ?? 0} icon="document-text" color="#f59e0b" theme={t} />
          <StatCard label="Active Jobs" value={(stats?.jobs.byStatus?.scheduled ?? 0) + (stats?.jobs.byStatus?.in_progress ?? 0)} icon="construct" color="#22c55e" theme={t} />
          <StatCard label="Outstanding" value={`$${((stats?.invoices.outstandingValue ?? 0) / 100).toFixed(0)}`} icon="cash" color="#8b5cf6" theme={t} />
        </View>

        {/* Today's Jobs */}
        <Text style={[styles.sectionTitle, { color: t.text }]}>Today's Jobs</Text>
        {todayJobs.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Text style={{ color: t.textMuted, textAlign: 'center' }}>No jobs scheduled for today</Text>
          </View>
        ) : (
          todayJobs.slice(0, 5).map(job => (
            <View key={job.id} style={[styles.jobCard, { backgroundColor: t.surface, borderColor: t.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.jobTitle, { color: t.text }]}>{job.title}</Text>
                <Text style={[styles.jobMeta, { color: t.textSecondary }]}>
                  {job.number} {job.scheduledTime ? `• ${job.scheduledTime}` : ''}
                </Text>
                {job.address && (
                  <Text style={[styles.jobMeta, { color: t.textMuted }]} numberOfLines={1}>
                    📍 {job.address}{job.city ? `, ${job.city}` : ''}
                  </Text>
                )}
              </View>
              <StatusBadge status={job.status} />
            </View>
          ))
        )}

        {/* Recent Activity */}
        <Text style={[styles.sectionTitle, { color: t.text }]}>Recent Activity</Text>
        {activity?.recentJobs?.slice(0, 3).map(j => (
          <ActivityRow key={j.id} icon="hammer" label={j.title} sub={j.number} status={j.status} theme={t} />
        ))}
        {activity?.recentQuotes?.slice(0, 3).map(q => (
          <ActivityRow key={q.id} icon="document-text" label={q.name} sub={q.number} status={q.status} theme={t} />
        ))}
        {!activity?.recentJobs?.length && !activity?.recentQuotes?.length && (
          <View style={[styles.emptyCard, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Text style={{ color: t.textMuted, textAlign: 'center' }}>No recent activity</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function StatCard({ label, value, icon, color, theme: t }: any) {
  return (
    <View style={[styles.statCard, { backgroundColor: t.surface, borderColor: t.border }]}>
      <Ionicons name={icon} size={20} color={color} />
      <Text style={[styles.statValue, { color: t.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: t.textSecondary }]}>{label}</Text>
    </View>
  )
}

function ActivityRow({ icon, label, sub, status, theme: t }: any) {
  return (
    <View style={[styles.actRow, { backgroundColor: t.surface, borderColor: t.border }]}>
      <Ionicons name={icon} size={18} color={t.textMuted} />
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={{ color: t.text, fontSize: 14, fontWeight: '500' }} numberOfLines={1}>{label}</Text>
        <Text style={{ color: t.textMuted, fontSize: 12 }}>{sub}</Text>
      </View>
      <StatusBadge status={status} />
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 40 },
  greeting: { fontSize: 24, fontWeight: '700' },
  companyLabel: { fontSize: 14, marginTop: 2, marginBottom: 20 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  statCard: {
    width: '48%', flexGrow: 1, borderRadius: 12, padding: 14,
    borderWidth: 1, gap: 6,
  },
  statValue: { fontSize: 22, fontWeight: '700' },
  statLabel: { fontSize: 12 },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginBottom: 10 },
  emptyCard: { borderRadius: 10, borderWidth: 1, padding: 20, marginBottom: 16 },
  jobCard: {
    borderRadius: 10, borderWidth: 1, padding: 14, marginBottom: 8,
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  jobTitle: { fontSize: 15, fontWeight: '600' },
  jobMeta: { fontSize: 12, marginTop: 2 },
  actRow: {
    flexDirection: 'row', alignItems: 'center', borderRadius: 10,
    borderWidth: 1, padding: 12, marginBottom: 6,
  },
})
