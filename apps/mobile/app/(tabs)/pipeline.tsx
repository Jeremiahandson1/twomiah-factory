/**
 * Pipeline — roofing's jobs, grouped by pipeline stage.
 *
 * A roofer's pipeline IS its jobs: GET /api/jobs (server/crm/roof/jobs.ts) — every roofing job carries a stage from
 * lead to collected (validation.ts PIPELINE_STATUSES), the same board the web's PipelineBoard draws. /api/leads, which
 * this screen read before, is the Lead Inbox (website enquiries and marketplace leads), not the roofing pipeline, and
 * its rows have no stage. A row's contact is { id, name }; its estimatedValue is DOLLARS and is absent for a seat that
 * may not see what work is worth (a field seat), so the figure shows only when the server sent it.
 *
 * Adding a lead (contact + job at `lead`) needs contacts:create and jobs:create — the office's.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../src/theme/ThemeContext'
import { get } from '../../src/api/client'
import { useAuth } from '../../src/auth/AuthContext'
import { SkeletonList } from '../../src/components/SkeletonLoader'
import { AnimatedCard } from '../../src/components/AnimatedCard'
import { AvatarCircle } from '../../src/components/AvatarCircle'
import { FAB } from '../../src/components/FAB'
import { EmptyState } from '../../src/components/EmptyState'
import { useRealTimeEvent, EVENTS } from '../../src/socket/SocketContext'

/** The pipeline, in order (server/crm/roof/validation.ts PIPELINE_STATUSES), and the two ways a job ends unpaid. */
const STAGES = [
  { key: 'lead', label: 'Lead', color: '#3b82f6' },
  { key: 'inspection_scheduled', label: 'Inspection Scheduled', color: '#6366f1' },
  { key: 'inspected', label: 'Inspected', color: '#8b5cf6' },
  { key: 'measurement_ordered', label: 'Measurement Ordered', color: '#a855f7' },
  { key: 'proposal_sent', label: 'Proposal Sent', color: '#f59e0b' },
  { key: 'signed', label: 'Signed', color: '#22c55e' },
  { key: 'material_ordered', label: 'Material Ordered', color: '#d97706' },
  { key: 'in_production', label: 'In Production', color: '#06b6d4' },
  { key: 'final_inspection', label: 'Final Inspection', color: '#14b8a6' },
  { key: 'invoiced', label: 'Invoiced', color: '#ec4899' },
  { key: 'collected', label: 'Collected', color: '#10b981' },
  { key: 'lost', label: 'Lost', color: '#ef4444' },
  { key: 'cancelled', label: 'Cancelled', color: '#94a3b8' },
]
const PAGE = 500

export default function PipelineScreen() {
  const router = useRouter()
  const t = useTheme()
  const { can } = useAuth()
  const canAddLead = can('contacts:create') && can('jobs:create')
  const [jobs, setJobs] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedStage, setSelectedStage] = useState<string | null>(null)

  const loadJobs = useCallback(async () => {
    const res = await get(`/api/jobs?limit=${PAGE}`)
    if (res.ok && Array.isArray(res.data?.data)) {
      setJobs(res.data.data)
      setTotal(Number(res.data.pagination?.total) || res.data.data.length)
      setFailed(false)
    } else {
      setFailed(true)
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadJobs() }, [loadJobs])
  useRealTimeEvent(EVENTS.JOB_CREATED, loadJobs, [loadJobs])
  useRealTimeEvent(EVENTS.JOB_UPDATED, loadJobs, [loadJobs])
  useRealTimeEvent(EVENTS.JOB_STATUS_CHANGED, loadJobs, [loadJobs])

  const onRefresh = async () => { setRefreshing(true); await loadJobs(); setRefreshing(false) }

  const grouped = STAGES.map(stage => ({ ...stage, items: jobs.filter(j => j.status === stage.key) }))
  // Closed stages only appear when something is in them.
  const visible = grouped.filter(s => !['lost', 'cancelled'].includes(s.key) || s.items.length > 0)
  const filteredStages = selectedStage ? visible.filter(s => s.key === selectedStage) : visible
  const money = (v: unknown) => `$${Math.round(Number(v) || 0).toLocaleString()}`

  if (loading) {
    return (
      <View style={[styles.safe, { backgroundColor: t.background }]}>
        <SkeletonList count={5} />
      </View>
    )
  }

  return (
    <View style={[styles.safe, { backgroundColor: t.background }]}>
      {/* Stage pills */}
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stagePills}>
          <TouchableOpacity
            style={[styles.pill, !selectedStage && { backgroundColor: t.primary }]}
            onPress={() => setSelectedStage(null)}
          >
            <Text style={[styles.pillText, { color: !selectedStage ? '#fff' : t.textSecondary }]}>All ({jobs.length})</Text>
          </TouchableOpacity>
          {visible.map(stage => {
            const active = selectedStage === stage.key
            return (
              <TouchableOpacity
                key={stage.key}
                style={[styles.pill, active && { backgroundColor: stage.color }]}
                onPress={() => setSelectedStage(active ? null : stage.key)}
              >
                <View style={[styles.pillDot, { backgroundColor: stage.color }]} />
                <Text style={[styles.pillText, { color: active ? '#fff' : t.textSecondary }]}>
                  {stage.label} ({stage.items.length})
                </Text>
              </TouchableOpacity>
            )
          })}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
      >
        {failed && (
          <Text style={[styles.emptyStage, { color: '#ef4444', marginLeft: 0 }]}>The pipeline could not be loaded. Pull to refresh.</Text>
        )}
        {total > jobs.length && (
          <Text style={[styles.emptyStage, { color: t.textMuted, marginLeft: 0 }]}>Showing the newest {jobs.length} of {total} jobs.</Text>
        )}
        {jobs.length > 0 && filteredStages.map(stage => {
          if (stage.items.length === 0 && selectedStage) return null
          return (
            <View key={stage.key} style={styles.stageSection}>
              {!selectedStage && (
                <View style={styles.stageHeader}>
                  <View style={[styles.stageDot, { backgroundColor: stage.color }]} />
                  <Text style={[styles.stageLabel, { color: t.text }]}>{stage.label}</Text>
                  <Text style={[styles.stageCount, { color: t.textMuted }]}>{stage.items.length}</Text>
                </View>
              )}
              {stage.items.length === 0 ? (
                <Text style={[styles.emptyStage, { color: t.textMuted }]}>No jobs at this stage</Text>
              ) : (
                stage.items.map((job, idx) => (
                  <AnimatedCard key={job.id} index={idx}>
                    <TouchableOpacity style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}
                      onPress={() => router.push(`/(details)/job/${job.id}`)} activeOpacity={0.7}>
                      <View style={styles.cardRow}>
                        <AvatarCircle name={job.contact?.name || job.title} size={36} />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.leadName, { color: t.text }]} numberOfLines={1}>
                            {job.contact?.name || job.title}
                          </Text>
                          <Text style={[styles.leadSub, { color: t.textSecondary }]} numberOfLines={1}>
                            {job.number}{job.address ? ` • ${job.address}` : ''}
                          </Text>
                        </View>
                        {job.estimatedValue != null && Number(job.estimatedValue) > 0 ? (
                          <Text style={[styles.value, { color: t.text }]}>{money(job.estimatedValue)}</Text>
                        ) : null}
                      </View>
                      {job.jobType === 'insurance' && (
                        <View style={styles.insuranceTag}>
                          <Ionicons name="shield" size={12} color="#f59e0b" />
                          <Text style={styles.insuranceText}>Insurance{job.claimNumber ? ` • Claim ${job.claimNumber}` : ''}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  </AnimatedCard>
                ))
              )}
            </View>
          )
        })}
        {jobs.length === 0 && !failed && (
          <EmptyState icon="funnel-outline" title="No jobs yet" subtitle="New leads appear here at the Lead stage" />
        )}
      </ScrollView>

      {canAddLead && <FAB icon="add" onPress={() => router.push('/(details)/lead/quick-add')} />}
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  stagePills: { paddingHorizontal: 16, paddingVertical: 10, gap: 6 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8,
  },
  pillDot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { fontSize: 13, fontWeight: '600' },
  stageSection: { marginBottom: 16 },
  stageHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  stageDot: { width: 10, height: 10, borderRadius: 5 },
  stageLabel: { fontSize: 15, fontWeight: '700' },
  stageCount: { fontSize: 13 },
  emptyStage: { fontSize: 13, marginLeft: 18, marginBottom: 8 },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 8 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  leadName: { fontSize: 15, fontWeight: '600' },
  leadSub: { fontSize: 12, marginTop: 2 },
  value: { fontSize: 16, fontWeight: '700' },
  insuranceTag: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e2e8f0',
  },
  insuranceText: { fontSize: 12, color: '#f59e0b', fontWeight: '600' },
})
