/**
 * Lead Detail — roofing lead with stage management, inspection scheduling, convert to job.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, Linking, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter, Stack } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import DateTimePicker from '@react-native-community/datetimepicker'
import { useTheme } from '../../../src/theme/ThemeContext'
import { get, post, put } from '../../../src/api/client'
import { StatusBadge } from '../../../src/components/StatusBadge'
import { AvatarCircle } from '../../../src/components/AvatarCircle'
import { SkeletonList } from '../../../src/components/SkeletonLoader'
import { AnimatedCard } from '../../../src/components/AnimatedCard'
import { ConfirmSheet } from '../../../src/components/ConfirmSheet'
import { FilterChips } from '../../../src/components/FilterChips'
import { useToast } from '../../../src/components/ToastProvider'
import { PhotoGallery } from '../../../src/components/PhotoGallery'
import { useHaptics } from '../../../src/hooks/useHaptics'

const STAGES = [
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'inspection_scheduled', label: 'Inspection' },
  { key: 'estimate_sent', label: 'Estimate Sent' },
  { key: 'negotiation', label: 'Negotiation' },
  { key: 'won', label: 'Won' },
  { key: 'lost', label: 'Lost' },
]

export default function LeadDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const t = useTheme()
  const toast = useToast()
  const haptics = useHaptics()
  const [lead, setLead] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showConvert, setShowConvert] = useState(false)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [inspectionDate, setInspectionDate] = useState(new Date())

  const load = useCallback(async () => {
    // Try /api/leads/:id first, fall back to /api/contacts/:id
    let res = await get(`/api/leads/${id}`)
    if (!res.ok) res = await get(`/api/contacts/${id}`)
    if (res.ok) setLead(res.data)
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false) }

  const updateStage = async (stage: string) => {
    const res = await put(`/api/leads/${id}`, { stage })
      .catch(() => put(`/api/contacts/${id}`, { stage }))
    if (res.ok) { haptics.success(); toast.success(`Stage → ${stage}`); load() }
    else { haptics.error(); toast.error(res.error || 'Failed') }
  }

  const scheduleInspection = async () => {
    const res = await put(`/api/leads/${id}`, {
      stage: 'inspection_scheduled',
      inspectionDate: inspectionDate.toISOString(),
    }).catch(() => put(`/api/contacts/${id}`, {
      stage: 'inspection_scheduled',
      inspectionDate: inspectionDate.toISOString(),
    }))
    if (res.ok) { haptics.success(); toast.success('Inspection scheduled'); setShowDatePicker(false); load() }
    else { haptics.error(); toast.error(res.error || 'Failed') }
  }

  const handleConvert = async () => {
    const res = await post(`/api/leads/${id}/convert`)
      .catch(() => post(`/api/contacts/${id}/convert`))
    if (res.ok) {
      haptics.success()
      toast.success('Converted to job')
      if (res.data?.jobId || res.data?.id) {
        router.replace(`/(details)/job/${res.data.jobId || res.data.id}`)
      } else {
        router.back()
      }
    } else {
      haptics.error()
      toast.error(res.error || 'Conversion failed')
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
        <Stack.Screen options={{ title: 'Lead' }} />
        <SkeletonList count={4} />
      </SafeAreaView>
    )
  }

  if (!lead) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
        <Stack.Screen options={{ title: 'Lead' }} />
        <View style={styles.centered}><Text style={{ color: t.textMuted }}>Lead not found</Text></View>
      </SafeAreaView>
    )
  }

  const name = lead.name || [lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'Unknown'
  const stage = lead.stage || lead.status || 'new'

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      <Stack.Screen options={{ title: name }} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
      >
        {/* Header */}
        <AnimatedCard index={0}>
          <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
            <View style={styles.headerRow}>
              <AvatarCircle name={name} size={48} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, { color: t.text }]}>{name}</Text>
                {lead.source && <Text style={[styles.source, { color: t.textSecondary }]}>Source: {lead.source}</Text>}
              </View>
              <StatusBadge status={stage} />
            </View>
          </View>
        </AnimatedCard>

        {/* Quick Actions */}
        <AnimatedCard index={1}>
          <View style={styles.actionsRow}>
            {(lead.phone || lead.phoneNumber) && (
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: t.surface, borderColor: t.border }]}
                onPress={() => Linking.openURL(`tel:${lead.phone || lead.phoneNumber}`)}>
                <Ionicons name="call" size={20} color="#22c55e" />
                <Text style={[styles.actionLabel, { color: t.text }]}>Call</Text>
              </TouchableOpacity>
            )}
            {lead.email && (
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: t.surface, borderColor: t.border }]}
                onPress={() => Linking.openURL(`mailto:${lead.email}`)}>
                <Ionicons name="mail" size={20} color="#3b82f6" />
                <Text style={[styles.actionLabel, { color: t.text }]}>Email</Text>
              </TouchableOpacity>
            )}
            {lead.address && (
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: t.surface, borderColor: t.border }]}
                onPress={() => {
                  const addr = encodeURIComponent(`${lead.address}, ${lead.city || ''} ${lead.state || ''} ${lead.zip || ''}`)
                  Linking.openURL(`https://maps.google.com/?q=${addr}`)
                }}>
                <Ionicons name="navigate" size={20} color="#f59e0b" />
                <Text style={[styles.actionLabel, { color: t.text }]}>Map</Text>
              </TouchableOpacity>
            )}
          </View>
        </AnimatedCard>

        {/* Info */}
        <AnimatedCard index={2}>
          <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Text style={[styles.sectionTitle, { color: t.text }]}>Details</Text>
            {(lead.phone || lead.phoneNumber) && <InfoRow icon="call-outline" value={lead.phone || lead.phoneNumber} t={t} />}
            {lead.email && <InfoRow icon="mail-outline" value={lead.email} t={t} />}
            {lead.address && <InfoRow icon="location-outline" value={[lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(', ')} t={t} />}
            {lead.notes && <InfoRow icon="document-text-outline" value={lead.notes} t={t} />}
            {lead.insuranceCompany && <InfoRow icon="shield-outline" value={`Insurance: ${lead.insuranceCompany}`} t={t} />}
            {lead.inspectionDate && <InfoRow icon="calendar-outline" value={`Inspection: ${new Date(lead.inspectionDate).toLocaleDateString()}`} t={t} />}
          </View>
        </AnimatedCard>

        {/* Stage Picker */}
        <AnimatedCard index={3}>
          <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Text style={[styles.sectionTitle, { color: t.text }]}>Pipeline Stage</Text>
            <FilterChips
              options={STAGES}
              selected={stage}
              onSelect={(s) => updateStage(s)}
            />
          </View>
        </AnimatedCard>

        {/* Photos */}
        <AnimatedCard index={4}>
          <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
            <PhotoGallery entityType="leadId" entityId={id!} />
          </View>
        </AnimatedCard>

        {/* Actions */}
        <AnimatedCard index={5}>
          <View style={styles.actionsCol}>
            <TouchableOpacity style={[styles.actionBtnLg, { backgroundColor: '#3b82f6' }]}
              onPress={() => setShowDatePicker(true)}>
              <Ionicons name="calendar" size={18} color="#fff" />
              <Text style={styles.actionBtnText}>Schedule Inspection</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.actionBtnLg, { backgroundColor: '#22c55e' }]}
              onPress={() => setShowConvert(true)}>
              <Ionicons name="arrow-forward-circle" size={18} color="#fff" />
              <Text style={styles.actionBtnText}>Convert to Job</Text>
            </TouchableOpacity>
          </View>
        </AnimatedCard>

        {/* Date Picker */}
        {showDatePicker && (
          <AnimatedCard index={6}>
            <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
              <Text style={[styles.sectionTitle, { color: t.text }]}>Select Inspection Date</Text>
              <DateTimePicker
                value={inspectionDate}
                mode="datetime"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(_, date) => { if (date) setInspectionDate(date) }}
                minimumDate={new Date()}
              />
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                <TouchableOpacity style={[styles.actionBtnLg, { flex: 1, backgroundColor: t.border }]}
                  onPress={() => setShowDatePicker(false)}>
                  <Text style={[styles.actionBtnText, { color: t.text }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionBtnLg, { flex: 1, backgroundColor: '#3b82f6' }]}
                  onPress={scheduleInspection}>
                  <Text style={styles.actionBtnText}>Confirm</Text>
                </TouchableOpacity>
              </View>
            </View>
          </AnimatedCard>
        )}
      </ScrollView>

      <ConfirmSheet
        visible={showConvert}
        onClose={() => setShowConvert(false)}
        onConfirm={handleConvert}
        title="Convert to Job"
        description="Create a new job from this lead? The lead will be marked as won."
        confirmLabel="Convert"
      />
    </SafeAreaView>
  )
}

function InfoRow({ icon, value, t }: { icon: string; value: string; t: any }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10, alignItems: 'flex-start' }}>
      <Ionicons name={icon as any} size={16} color={t.textMuted} />
      <Text style={{ flex: 1, fontSize: 14, color: t.text }}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 40 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontSize: 20, fontWeight: '700' },
  source: { fontSize: 13, marginTop: 2 },
  actionsRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  actionBtn: {
    flex: 1, alignItems: 'center', gap: 4,
    paddingVertical: 12, borderRadius: 10, borderWidth: 1,
  },
  actionLabel: { fontSize: 11, fontWeight: '600' },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginBottom: 12 },
  actionsCol: { gap: 10, marginBottom: 20 },
  actionBtnLg: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 10,
  },
  actionBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
})
