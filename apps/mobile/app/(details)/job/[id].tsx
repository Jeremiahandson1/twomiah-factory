/**
 * Job Detail — full job info, status timeline, photos, notes, actions.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, Linking, TextInput,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter, Stack } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../../src/theme/ThemeContext'
import { useVertical } from '../../../src/vertical/VerticalContext'
import { get, post } from '../../../src/api/client'
import { StatusBadge } from '../../../src/components/StatusBadge'
import { SkeletonList } from '../../../src/components/SkeletonLoader'
import { AnimatedCard } from '../../../src/components/AnimatedCard'
import { ConfirmSheet } from '../../../src/components/ConfirmSheet'
import { useToast } from '../../../src/components/ToastProvider'
import { useHaptics } from '../../../src/hooks/useHaptics'
import { useLocation } from '../../../src/hooks/useLocation'
import { useRealTimeEvent, EVENTS } from '../../../src/socket/SocketContext'
import { PhotoGallery } from '../../../src/components/PhotoGallery'

const STATUS_STEPS = ['scheduled', 'dispatched', 'in_progress', 'completed']

export default function JobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const t = useTheme()
  const { vertical } = useVertical()
  const toast = useToast()
  const haptics = useHaptics()
  const { requestLocation } = useLocation()
  const [job, setJob] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showComplete, setShowComplete] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [addingNote, setAddingNote] = useState(false)

  const load = useCallback(async () => {
    const res = await get(`/api/jobs/${id}`)
    if (res.ok) setJob(res.data)
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false) }

  useRealTimeEvent(EVENTS.JOB_UPDATED, load)
  useRealTimeEvent(EVENTS.JOB_STATUS_CHANGED, load)

  const handleStart = async () => {
    const loc = await requestLocation()
    const res = await post(`/api/jobs/${id}/start`, loc ? { latitude: loc.latitude, longitude: loc.longitude } : undefined)
    if (res.ok) { haptics.success(); toast.success('Job started'); load() }
    else { haptics.error(); toast.error(res.error || 'Failed to start') }
  }

  const handleComplete = async () => {
    const res = await post(`/api/jobs/${id}/complete`)
    if (res.ok) { haptics.success(); toast.success('Job completed'); load() }
    else { haptics.error(); toast.error(res.error || 'Failed to complete') }
  }

  const handleDispatch = async () => {
    const res = await post(`/api/jobs/${id}/dispatch`)
    if (res.ok) { haptics.success(); toast.success('Job dispatched'); load() }
    else { haptics.error(); toast.error(res.error || 'Failed to dispatch') }
  }

  const handleAddNote = async () => {
    if (!noteText.trim()) return
    setAddingNote(true)
    const res = await post(`/api/jobs/${id}/notes`, { content: noteText.trim() })
    if (res.ok) { toast.success('Note added'); setNoteText(''); load() }
    else { toast.error(res.error || 'Failed to add note') }
    setAddingNote(false)
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
        <Stack.Screen options={{ title: 'Job' }} />
        <SkeletonList count={4} />
      </SafeAreaView>
    )
  }

  if (!job) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
        <Stack.Screen options={{ title: 'Job' }} />
        <View style={styles.centered}><Text style={{ color: t.textMuted }}>Job not found</Text></View>
      </SafeAreaView>
    )
  }

  const currentStep = STATUS_STEPS.indexOf(job.status)

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      <Stack.Screen options={{
        title: job.number || 'Job',
        headerRight: () => (
          <TouchableOpacity onPress={() => router.push(`/(details)/job/form?id=${id}`)}>
            <Ionicons name="create-outline" size={22} color={t.text} />
          </TouchableOpacity>
        ),
      }} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
      >
        {/* Header */}
        <AnimatedCard index={0}>
          <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
            <View style={styles.headerRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: t.text }]}>{job.title}</Text>
                <Text style={[styles.jobNumber, { color: t.textSecondary }]}>{job.number}</Text>
              </View>
              <StatusBadge status={job.status} />
            </View>
          </View>
        </AnimatedCard>

        {/* Status Timeline */}
        <AnimatedCard index={1}>
          <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Text style={[styles.sectionTitle, { color: t.text }]}>Progress</Text>
            <View style={styles.timeline}>
              {STATUS_STEPS.map((step, i) => {
                const isActive = i <= currentStep
                const isCurrent = i === currentStep
                return (
                  <View key={step} style={styles.timelineStep}>
                    <View style={[
                      styles.dot,
                      { backgroundColor: isActive ? t.primary : t.border },
                      isCurrent && styles.dotCurrent,
                    ]} />
                    <Text style={[
                      styles.stepLabel,
                      { color: isActive ? t.text : t.textMuted },
                      isCurrent && { fontWeight: '700' },
                    ]}>{step.replace('_', ' ')}</Text>
                    {i < STATUS_STEPS.length - 1 && (
                      <View style={[styles.connector, { backgroundColor: i < currentStep ? t.primary : t.border }]} />
                    )}
                  </View>
                )
              })}
            </View>
          </View>
        </AnimatedCard>

        {/* Info */}
        <AnimatedCard index={2}>
          <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Text style={[styles.sectionTitle, { color: t.text }]}>Details</Text>
            {job.contact && (
              <TouchableOpacity style={styles.infoRow} onPress={() => router.push(`/(details)/contact/${job.contact.id || job.contactId}`)}>
                <Ionicons name="person-outline" size={16} color={t.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.infoLabel, { color: t.textMuted }]}>Contact</Text>
                  <Text style={[styles.infoValue, { color: t.primary }]}>{job.contact.name || [job.contact.firstName, job.contact.lastName].filter(Boolean).join(' ')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={t.textMuted} />
              </TouchableOpacity>
            )}
            {job.address && (
              <TouchableOpacity style={styles.infoRow} onPress={() => {
                const addr = encodeURIComponent(`${job.address}, ${job.city || ''} ${job.state || ''} ${job.zip || ''}`)
                Linking.openURL(`https://maps.google.com/?q=${addr}`)
              }}>
                <Ionicons name="location-outline" size={16} color={t.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.infoLabel, { color: t.textMuted }]}>Address</Text>
                  <Text style={[styles.infoValue, { color: t.primary }]}>{job.address}{job.city ? `, ${job.city}` : ''}</Text>
                </View>
                <Ionicons name="navigate" size={16} color={t.textMuted} />
              </TouchableOpacity>
            )}
            {job.scheduledDate && (
              <View style={styles.infoRow}>
                <Ionicons name="calendar-outline" size={16} color={t.textMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.infoLabel, { color: t.textMuted }]}>Scheduled</Text>
                  <Text style={[styles.infoValue, { color: t.text }]}>
                    {new Date(job.scheduledDate).toLocaleDateString()}{job.scheduledTime ? ` at ${job.scheduledTime}` : ''}
                  </Text>
                </View>
              </View>
            )}
            {job.description && (
              <View style={styles.infoRow}>
                <Ionicons name="document-text-outline" size={16} color={t.textMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.infoLabel, { color: t.textMuted }]}>Description</Text>
                  <Text style={[styles.infoValue, { color: t.text }]}>{job.description}</Text>
                </View>
              </View>
            )}
          </View>
        </AnimatedCard>

        {/* Assigned Team */}
        {job.assignedTeam?.length > 0 && (
          <AnimatedCard index={3}>
            <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
              <Text style={[styles.sectionTitle, { color: t.text }]}>Crew</Text>
              {job.assignedTeam.map((member: any) => (
                <View key={member.id} style={styles.crewRow}>
                  <View style={[styles.crewAvatar, { backgroundColor: t.primaryLight }]}>
                    <Text style={{ color: t.primary, fontWeight: '700', fontSize: 13 }}>
                      {(member.firstName || member.name || '?')[0].toUpperCase()}
                    </Text>
                  </View>
                  <Text style={[styles.crewName, { color: t.text }]}>
                    {member.firstName ? `${member.firstName} ${member.lastName || ''}` : member.name}
                  </Text>
                </View>
              ))}
            </View>
          </AnimatedCard>
        )}

        {/* Insurance (roofing) */}
        {vertical === 'roofing' && job.insuranceClaim && (
          <AnimatedCard index={4}>
            <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Ionicons name="shield" size={18} color="#f59e0b" />
                <Text style={[styles.sectionTitle, { color: t.text, marginBottom: 0 }]}>Insurance Claim</Text>
              </View>
              {job.insuranceCompany && <Text style={{ color: t.textSecondary, fontSize: 13 }}>Carrier: {job.insuranceCompany}</Text>}
              {job.claimNumber && <Text style={{ color: t.textSecondary, fontSize: 13, marginTop: 4 }}>Claim #: {job.claimNumber}</Text>}
            </View>
          </AnimatedCard>
        )}

        {/* Photos */}
        <AnimatedCard index={5}>
          <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
            <PhotoGallery entityType="jobId" entityId={id!} />
          </View>
        </AnimatedCard>

        {/* Notes */}
        <AnimatedCard index={6}>
          <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Text style={[styles.sectionTitle, { color: t.text }]}>Notes</Text>
            {(job.notes || []).map((note: any, i: number) => (
              <View key={note.id || i} style={[styles.noteRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border }]}>
                <Text style={[styles.noteText, { color: t.text }]}>{note.content || note.text || note}</Text>
                {note.createdAt && <Text style={[styles.noteMeta, { color: t.textMuted }]}>{new Date(note.createdAt).toLocaleString()}</Text>}
              </View>
            ))}
            <View style={styles.noteInput}>
              <TextInput
                style={[styles.noteField, { backgroundColor: t.background, color: t.text, borderColor: t.border }]}
                placeholder="Add a note..."
                placeholderTextColor={t.textMuted}
                value={noteText}
                onChangeText={setNoteText}
                multiline
              />
              <TouchableOpacity
                style={[styles.noteSend, { backgroundColor: t.primary, opacity: noteText.trim() ? 1 : 0.5 }]}
                onPress={handleAddNote}
                disabled={!noteText.trim() || addingNote}
              >
                <Ionicons name="send" size={16} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        </AnimatedCard>

        {/* Actions */}
        <AnimatedCard index={7}>
          <View style={styles.actionsCol}>
            {(job.status === 'scheduled' || job.status === 'dispatched') && (
              <TouchableOpacity style={[styles.actionBtnLg, { backgroundColor: '#22c55e' }]} onPress={handleStart}>
                <Ionicons name="play" size={20} color="#fff" />
                <Text style={styles.actionBtnText}>Start Job</Text>
              </TouchableOpacity>
            )}
            {job.status === 'scheduled' && (
              <TouchableOpacity style={[styles.actionBtnLg, { backgroundColor: '#3b82f6' }]} onPress={handleDispatch}>
                <Ionicons name="paper-plane" size={20} color="#fff" />
                <Text style={styles.actionBtnText}>Dispatch</Text>
              </TouchableOpacity>
            )}
            {job.status === 'in_progress' && (
              <TouchableOpacity style={[styles.actionBtnLg, { backgroundColor: '#8b5cf6' }]} onPress={() => setShowComplete(true)}>
                <Ionicons name="checkmark-circle" size={20} color="#fff" />
                <Text style={styles.actionBtnText}>Complete Job</Text>
              </TouchableOpacity>
            )}
          </View>
        </AnimatedCard>
      </ScrollView>

      <ConfirmSheet
        visible={showComplete}
        onClose={() => setShowComplete(false)}
        onConfirm={handleComplete}
        title="Complete Job"
        description="Mark this job as completed? This action cannot be undone."
        confirmLabel="Complete"
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 40 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 20, fontWeight: '700' },
  jobNumber: { fontSize: 13, marginTop: 2 },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginBottom: 12 },
  // Timeline
  timeline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  timelineStep: { alignItems: 'center', flex: 1 },
  dot: { width: 12, height: 12, borderRadius: 6, marginBottom: 4 },
  dotCurrent: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: '#fff' },
  stepLabel: { fontSize: 10, textTransform: 'capitalize', textAlign: 'center' },
  connector: { position: 'absolute', top: 5, left: '60%', right: '-40%', height: 2 },
  // Info
  infoRow: { flexDirection: 'row', gap: 10, marginBottom: 12, alignItems: 'flex-start' },
  infoLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  infoValue: { fontSize: 14, marginTop: 1 },
  // Crew
  crewRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  crewAvatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  crewName: { fontSize: 14, fontWeight: '500' },
  // Notes
  noteRow: { paddingVertical: 8 },
  noteText: { fontSize: 14 },
  noteMeta: { fontSize: 11, marginTop: 4 },
  noteInput: { flexDirection: 'row', gap: 8, marginTop: 8 },
  noteField: { flex: 1, borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, maxHeight: 80 },
  noteSend: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  // Actions
  actionsCol: { gap: 10, marginBottom: 20 },
  actionBtnLg: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 10,
  },
  actionBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
})
