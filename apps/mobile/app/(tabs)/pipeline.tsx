/**
 * Pipeline — roofing sales pipeline with horizontal kanban-style stages.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, FlatList,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../src/theme/ThemeContext'
import { get } from '../../src/api/client'
import { StatusBadge } from '../../src/components/StatusBadge'
import { SkeletonList } from '../../src/components/SkeletonLoader'
import { AnimatedCard } from '../../src/components/AnimatedCard'
import { AvatarCircle } from '../../src/components/AvatarCircle'
import { FAB } from '../../src/components/FAB'
import { EmptyState } from '../../src/components/EmptyState'
import { useToast } from '../../src/components/ToastProvider'

const STAGES = [
  { key: 'new_lead', label: 'New Lead', color: '#3b82f6' },
  { key: 'contacted', label: 'Contacted', color: '#f59e0b' },
  { key: 'inspection_scheduled', label: 'Inspection', color: '#8b5cf6' },
  { key: 'quote_sent', label: 'Quote Sent', color: '#06b6d4' },
  { key: 'approved', label: 'Approved', color: '#22c55e' },
  { key: 'in_progress', label: 'In Progress', color: '#ec4899' },
]

export default function PipelineScreen() {
  const t = useTheme()
  const toast = useToast()
  const [leads, setLeads] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedStage, setSelectedStage] = useState<string | null>(null)

  const loadLeads = useCallback(async () => {
    // Try leads endpoint first, fallback to jobs
    const res = await get('/api/leads?limit=100')
    if (res.ok) {
      setLeads(res.data.data || res.data || [])
    } else {
      const fallback = await get('/api/jobs?limit=100')
      if (fallback.ok) setLeads(fallback.data.data || fallback.data || [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadLeads() }, [loadLeads])

  const onRefresh = async () => { setRefreshing(true); await loadLeads(); setRefreshing(false) }

  // Group leads by stage
  const grouped = STAGES.map(stage => ({
    ...stage,
    items: leads.filter(l => (l.status || l.stage) === stage.key),
  }))

  const filteredStages = selectedStage
    ? grouped.filter(s => s.key === selectedStage)
    : grouped

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
        <SkeletonList count={5} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      {/* Stage pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.stagePills}
      >
        <TouchableOpacity
          style={[styles.pill, !selectedStage && { backgroundColor: t.primary }]}
          onPress={() => setSelectedStage(null)}
        >
          <Text style={[styles.pillText, { color: !selectedStage ? '#fff' : t.textSecondary }]}>
            All ({leads.length})
          </Text>
        </TouchableOpacity>
        {STAGES.map(stage => {
          const count = leads.filter(l => (l.status || l.stage) === stage.key).length
          const active = selectedStage === stage.key
          return (
            <TouchableOpacity
              key={stage.key}
              style={[styles.pill, active && { backgroundColor: stage.color }]}
              onPress={() => setSelectedStage(active ? null : stage.key)}
            >
              <View style={[styles.pillDot, { backgroundColor: stage.color }]} />
              <Text style={[styles.pillText, { color: active ? '#fff' : t.textSecondary }]}>
                {stage.label} ({count})
              </Text>
            </TouchableOpacity>
          )
        })}
      </ScrollView>

      {/* Lead cards */}
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
      >
        {filteredStages.map(stage => {
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
                <Text style={[styles.emptyStage, { color: t.textMuted }]}>No leads in this stage</Text>
              ) : (
                stage.items.map((lead, idx) => (
                  <AnimatedCard key={lead.id} index={idx}>
                    <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                      <View style={styles.cardRow}>
                        <AvatarCircle name={lead.contact?.name || lead.name} size={36} />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.leadName, { color: t.text }]}>
                            {lead.contact?.name || lead.name || lead.title}
                          </Text>
                          <Text style={[styles.leadSub, { color: t.textSecondary }]}>
                            {lead.address || lead.source || lead.number}
                          </Text>
                        </View>
                        {lead.total && (
                          <Text style={[styles.value, { color: t.text }]}>
                            ${(lead.total / 100).toLocaleString()}
                          </Text>
                        )}
                      </View>
                      {lead.insuranceClaim && (
                        <View style={styles.insuranceTag}>
                          <Ionicons name="shield" size={12} color="#f59e0b" />
                          <Text style={styles.insuranceText}>Insurance claim</Text>
                        </View>
                      )}
                    </View>
                  </AnimatedCard>
                ))
              )}
            </View>
          )
        })}
        {leads.length === 0 && (
          <EmptyState icon="funnel-outline" title="No leads yet" subtitle="Leads will appear here as they come in" />
        )}
      </ScrollView>

      <FAB icon="add" onPress={() => toast.info('Add lead from the web dashboard')} />
    </SafeAreaView>
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
