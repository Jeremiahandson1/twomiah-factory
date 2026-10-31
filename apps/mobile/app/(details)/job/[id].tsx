/**
 * Job Detail — the job, its progress, photos, notes and the actions this seat may take.
 *
 * Two job modules answer /api/jobs on the unified server (modules/crm.ts):
 *   · the shared one (packages/tenant-backend jobs/jobs.ts) — contractor, basic, field service, landscaping: statuses
 *     scheduled → dispatched → in_progress → completed moved by POST /:id/start, /dispatch, /complete (jobs:update);
 *     `notes` is ONE text column, saved with PUT /:id { notes }; the person on it is `assignedTo` { name }.
 *   · roofing's (server/crm/roof/jobs.ts) — the pipeline lead → … → collected moved by POST /:id/advance, ended by
 *     POST /:id/close { status: lost|cancelled, lostReason } and undone by /:id/reopen; GET /:id answers `notes` as the
 *     job's NOTE ROWS ({ id, body, createdAt }), added by POST /:id/notes { body }; the crew is `crew` { name,
 *     foremanName }; the claim is claimNumber / insuranceCompany / adjusterName on the job itself.
 * Every action here is jobs:update — the office and the field seat hold it, the read-only viewer does not.
 *
 * The shared job's moves (on my way, arrived, checklist, photos, customer signs, complete) are ONE flow card
 * (src/jobflow/JobFlowCard.tsx). Its moves go through the offline queue under the job's record key, so with no signal they are kept
 * on the phone and shown as "Waiting to send" (never as done); the job shows the status it will have once they are sent.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, Linking, TextInput, Platform,
} from 'react-native'
import { useLocalSearchParams, useRouter, Stack } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import DateTimePicker from '@react-native-community/datetimepicker'
import { useTheme } from '../../../src/theme/ThemeContext'
import { ACTION, ACTION_INK } from '../../../src/theme/actions'
import { useVertical } from '../../../src/vertical/VerticalContext'
import { get, post, put } from '../../../src/api/client'
import { useAuth } from '../../../src/auth/AuthContext'
import { StatusBadge } from '../../../src/components/StatusBadge'
import { useStageName } from '../../../src/pipeline/useStageName'
import { SkeletonList } from '../../../src/components/SkeletonLoader'
import { AnimatedCard } from '../../../src/components/AnimatedCard'
import { ConfirmSheet } from '../../../src/components/ConfirmSheet'
import { useToast } from '../../../src/components/ToastProvider'
import { useHaptics } from '../../../src/hooks/useHaptics'
import { useRealTimeEvent, EVENTS } from '../../../src/socket/SocketContext'
import { PhotoGallery } from '../../../src/components/PhotoGallery'
import { useOfflineQueue } from '../../../src/offline/OfflineContext'
import { useOfflineApi } from '../../../src/offline/useOfflineApi'
import { JobFlowCard } from '../../../src/jobflow/JobFlowCard'
import { useJobFlowData } from '../../../src/jobflow/useJobFlowData'
import { effectiveStatus, jobKey, moveBody } from '../../../src/jobflow/flow'
import { getSaved, savedCopyNote } from '../../../src/offline/readThrough'

const STATUS_STEPS = ['scheduled', 'dispatched', 'in_progress', 'completed']
/** Roofing's pipeline, in order (server/crm/roof/validation.ts PIPELINE_STATUSES — Advance steps along it). */
export const ROOF_STAGES = [
  'lead', 'inspection_scheduled', 'inspected', 'measurement_ordered', 'proposal_sent',
  'signed', 'material_ordered', 'in_production', 'final_inspection', 'invoiced', 'collected',
]
const ROOF_CLOSED = ['lost', 'cancelled']
const label = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
const pad = (n: number) => String(n).padStart(2, '0')
/** A wall-clock time with no zone: the roofing server reads it on the company's clock (validation.ts onCompanyClock). */
const wallTime = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`

export default function JobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const t = useTheme()
  const { vertical } = useVertical()
  const { stageName } = useStageName()
  const { can } = useAuth()
  const isRoof = vertical === 'roofing'
  // jobs:update — the office and the field seat hold it; the viewer reads only.
  const canWork = can('jobs:update')
  // A contractor's photos are documents (documents:create); every other vertical's are the job's (jobs:update).
  const canAddPhotos = vertical === 'contractor' ? can('documents:create') : canWork
  const toast = useToast()
  const haptics = useHaptics()
  const [job, setJob] = useState<any>(null)
  const { queue } = useOfflineQueue()
  const offline = useOfflineApi()
  const [moving, setMoving] = useState(false)
  const flowData = useJobFlowData(id, !isRoof && canWork)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showComplete, setShowComplete] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [closeReason, setCloseReason] = useState('')
  const [showInspection, setShowInspection] = useState<null | 'date' | 'time'>(null)
  const [inspectionAt, setInspectionAt] = useState(() => { const d = new Date(); d.setHours(10, 0, 0, 0); return d })

  const [savedCopy, setSavedCopy] = useState<string | null>(null)
  const load = useCallback(async () => {
    // A job opened before can be read again with no signal: the last good copy, said to be one.
    const res = await getSaved(`/api/jobs/${id}`)
    setSavedCopy(res.ok && res.fromCache ? savedCopyNote(res.savedAt) : null)
    if (res.ok) {
      setJob(res.data)
      // The shared job's notes are one text: the box edits it in place.
      if (!isRoof) setNoteText(typeof res.data?.notes === 'string' ? res.data.notes : '')
    }
    setLoading(false)
  }, [id, isRoof])

  useEffect(() => { load() }, [load])
  // When something waiting on the phone is sent (or refused), the job and its checklists are read again.
  const queueSignature = queue.filter((q) => q.recordKey === jobKey(String(id))).map((q) => `${q.id}:${q.state}`).join(',')
  useEffect(() => { void flowData.reload(); void load() }, [queueSignature]) // eslint-disable-line react-hooks/exhaustive-deps

  /** On my way / arrived / complete: sent now with signal, kept on the phone without — never lost, never shown as done early. */
  const moveJob = async (m: 'dispatch' | 'start' | 'complete' | 'hold' | 'pause' | 'resume') => {
    setMoving(true)
    const words = { dispatch: 'On my way', start: job?.status === 'on_hold' ? 'Resumed' : 'Arrived', complete: 'Completed', hold: 'On hold', pause: 'Paused', resume: 'Resumed' }[m]
    // The body says when the tech tapped, so a move kept until signal returns still records the real time (flow.ts moveBody).
    const r = await offline.post(`/api/jobs/${id}/${m}`, moveBody(), { recordKey: jobKey(String(id)), label: `${job?.number || 'Job'} \u00b7 ${words.toLowerCase()}` })
    setMoving(false)
    if (r.queued) { haptics.success(); toast.success('Saved on the phone \u2014 waiting to send') }
    else if (r.ok) { haptics.success(); toast.success(words); load(); void flowData.reload() }
    else { haptics.error(); toast.error(r.error || 'That did not go through') }
  }
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false) }

  useRealTimeEvent(EVENTS.JOB_UPDATED, load, [load])
  useRealTimeEvent(EVENTS.JOB_STATUS_CHANGED, load, [load])

  const act = async (path: string, body: any, success: string) => {
    const res = await post(`/api/jobs/${id}/${path}`, body)
    if (res.ok) { haptics.success(); toast.success(success); load() }
    else { haptics.error(); toast.error(res.error || 'That did not go through') }
    return res.ok
  }

  const handleSaveNote = async () => {
    setSavingNote(true)
    if (isRoof) {
      const res = await post(`/api/jobs/${id}/notes`, { body: noteText.trim() })
      if (res.ok) { toast.success('Note added'); setNoteText(''); load() }
      else { toast.error(res.error || 'Failed to add note') }
    } else {
      const res = await put(`/api/jobs/${id}`, { notes: noteText })
      if (res.ok) { toast.success('Notes saved'); load() }
      else { toast.error(res.error || 'Failed to save notes') }
    }
    setSavingNote(false)
  }

  const scheduleInspection = async (at: Date) => {
    const res = await put(`/api/jobs/${id}`, { inspectionDate: wallTime(at) })
    if (res.ok) { haptics.success(); toast.success('Inspection scheduled'); load() }
    else { haptics.error(); toast.error(res.error || 'Could not schedule the inspection') }
  }

  const closeJob = async (status: 'lost' | 'cancelled') => {
    if (!closeReason.trim()) { toast.error('Say why — close-rate reporting is built on it'); return }
    if (await act('close', { status, lostReason: closeReason.trim() }, `Job closed as ${status}`)) setCloseReason('')
  }

  if (loading) {
    return (
      <View style={[styles.safe, { backgroundColor: t.background }]}>
        <Stack.Screen options={{ title: 'Job' }} />
        <SkeletonList count={4} />
      </View>
    )
  }

  if (!job) {
    return (
      <View style={[styles.safe, { backgroundColor: t.background }]}>
        <Stack.Screen options={{ title: 'Job' }} />
        <View style={styles.centered}><Text style={{ color: t.textMuted }}>Job not found</Text></View>
      </View>
    )
  }

  // What the job will be once the moves waiting on this phone are sent.
  const shownStatus = isRoof ? job.status : effectiveStatus({ jobId: String(id), status: job.status, queue, checklists: null, photoCount: null })
  const steps = isRoof ? ROOF_STAGES : STATUS_STEPS
  const currentStep = steps.indexOf(shownStatus)
  const roofClosed = isRoof && ROOF_CLOSED.includes(job.status)
  const nextStage = isRoof && currentStep >= 0 && currentStep < ROOF_STAGES.length - 1 ? ROOF_STAGES[currentStep + 1] : null
  // Roofing shows four stages around where the job is, not eleven dots across a phone.
  const windowStart = Math.max(0, Math.min(currentStep - 1, ROOF_STAGES.length - 4))
  const shownSteps = isRoof ? ROOF_STAGES.slice(windowStart, windowStart + 4) : STATUS_STEPS
  const roofNotes: any[] = isRoof && Array.isArray(job.notes) ? job.notes : []
  const hasClaim = isRoof && (job.jobType === 'insurance' || job.claimNumber || job.insuranceCompany)
  const assignee: string = job.assignedTo?.name || [job.assignedTo?.firstName, job.assignedTo?.lastName].filter(Boolean).join(' ')
  const savedNotes = typeof job.notes === 'string' ? job.notes : ''
  const noteReady = isRoof ? !!noteText.trim() : noteText !== savedNotes

  return (
    <View style={[styles.safe, { backgroundColor: t.background }]}>
      <Stack.Screen options={{
        title: job.number || 'Job',
        headerRight: canWork ? () => (
          <TouchableOpacity onPress={() => router.push(`/(details)/job/form?id=${id}`)}>
            <Ionicons name="create-outline" size={22} color={t.text} />
          </TouchableOpacity>
        ) : undefined,
      }} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
      >
        {savedCopy ? <Text accessibilityRole="alert" style={{ color: t.textSecondary, fontSize: 13, marginBottom: 8 }}>{savedCopy}</Text> : null}
        {/* Header */}
        <AnimatedCard index={0}>
          <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
            <View style={styles.headerRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: t.text }]}>{job.title}</Text>
                <Text style={[styles.jobNumber, { color: t.textSecondary }]}>
                  {job.number}{isRoof && job.jobType ? ` • ${label(job.jobType)}` : ''}
                </Text>
              </View>
              <StatusBadge status={shownStatus} label={stageName(shownStatus, job.jobType)} />
            </View>
          </View>
        </AnimatedCard>

        {/* Status Timeline */}
        {!roofClosed && (
          <AnimatedCard index={1}>
            <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
              <Text style={[styles.sectionTitle, { color: t.text }]}>Progress</Text>
              <View style={styles.timeline}>
                {shownSteps.map((step, i) => {
                  const at = steps.indexOf(step)
                  const isActive = at <= currentStep
                  const isCurrent = at === currentStep
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
                      ]}>{isRoof ? (stageName(step, job.jobType) ?? step.replace(/_/g, ' ')) : step.replace(/_/g, ' ')}</Text>
                      {i < shownSteps.length - 1 && (
                        <View style={[styles.connector, { backgroundColor: at < currentStep ? t.primary : t.border }]} />
                      )}
                    </View>
                  )
                })}
              </View>
            </View>
          </AnimatedCard>
        )}

        {/* Info */}
        <AnimatedCard index={2}>
          <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Text style={[styles.sectionTitle, { color: t.text }]}>Details</Text>
            {job.contact ? (
              <TouchableOpacity style={styles.infoRow} onPress={() => router.push(`/(details)/contact/${job.contact.id || job.contactId}`)}>
                <Ionicons name="person-outline" size={16} color={t.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.infoLabel, { color: t.textMuted }]}>{isRoof ? 'Homeowner' : 'Contact'}</Text>
                  <Text style={[styles.infoValue, { color: t.primaryText }]}>{job.contact.name}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={t.textMuted} />
              </TouchableOpacity>
            ) : null}
            {job.contact?.phone ? (
              <TouchableOpacity style={styles.infoRow} onPress={() => Linking.openURL(`tel:${job.contact.phone}`)}>
                <Ionicons name="call-outline" size={16} color={t.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.infoLabel, { color: t.textMuted }]}>Phone</Text>
                  <Text style={[styles.infoValue, { color: t.primaryText }]}>{job.contact.phone}</Text>
                </View>
              </TouchableOpacity>
            ) : null}
            {job.address ? (
              <TouchableOpacity style={styles.infoRow} onPress={() => {
                const addr = encodeURIComponent(`${job.address}, ${job.city || ''} ${job.state || ''} ${job.zip || ''}`)
                Linking.openURL(`https://maps.google.com/?q=${addr}`)
              }}>
                <Ionicons name="location-outline" size={16} color={t.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.infoLabel, { color: t.textMuted }]}>Address</Text>
                  <Text style={[styles.infoValue, { color: t.primaryText }]}>{job.address}{job.city ? `, ${job.city}` : ''}</Text>
                </View>
                <Ionicons name="navigate" size={16} color={t.textMuted} />
              </TouchableOpacity>
            ) : null}
            {job.scheduledDate ? (
              <InfoRow icon="calendar-outline" label="Scheduled" t={t}
                value={`${new Date(job.scheduledDate).toLocaleDateString()}${job.scheduledTime ? ` at ${job.scheduledTime}` : ''}`} />
            ) : null}
            {isRoof && job.inspectionDate ? (
              <InfoRow icon="search-outline" label="Inspection" t={t} value={new Date(job.inspectionDate).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} />
            ) : null}
            {isRoof && job.installDate ? (
              <InfoRow icon="hammer-outline" label="Install" t={t} value={new Date(job.installDate).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} />
            ) : null}
            {isRoof && job.roofType ? (
              <InfoRow icon="home-outline" label="Roof" t={t} value={`${job.roofType}${job.stories ? ` • ${job.stories} ${job.stories === 1 ? 'story' : 'stories'}` : ''}`} />
            ) : null}
            {job.description ? <InfoRow icon="document-text-outline" label="Description" t={t} value={job.description} /> : null}
            {roofClosed && job.lostReason ? <InfoRow icon="close-circle-outline" label={`Closed as ${job.status}`} t={t} value={job.lostReason} /> : null}
          </View>
        </AnimatedCard>

        {/* Who is on it */}
        {assignee || job.crew ? (
          <AnimatedCard index={3}>
            <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
              <Text style={[styles.sectionTitle, { color: t.text }]}>Crew</Text>
              {assignee ? (
                <View style={styles.crewRow}>
                  <View style={[styles.crewAvatar, { backgroundColor: t.primaryLight }]}>
                    <Text style={{ color: t.primaryText, fontWeight: '700', fontSize: 13 }}>{assignee[0].toUpperCase()}</Text>
                  </View>
                  <Text style={[styles.crewName, { color: t.text }]}>{assignee}</Text>
                </View>
              ) : null}
              {job.crew ? (
                <View style={styles.crewRow}>
                  <View style={[styles.crewAvatar, { backgroundColor: t.primaryLight }]}>
                    <Text style={{ color: t.primaryText, fontWeight: '700', fontSize: 13 }}>{String(job.crew.name || '?')[0].toUpperCase()}</Text>
                  </View>
                  <View>
                    <Text style={[styles.crewName, { color: t.text }]}>{job.crew.name}</Text>
                    {job.crew.foremanName ? <Text style={{ color: t.textMuted, fontSize: 12 }}>Foreman: {job.crew.foremanName}</Text> : null}
                  </View>
                </View>
              ) : null}
            </View>
          </AnimatedCard>
        ) : null}

        {/* Insurance (roofing) — the claim fields on the job itself */}
        {hasClaim ? (
          <AnimatedCard index={4}>
            <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Ionicons name="shield" size={18} color="#f59e0b" />
                <Text style={[styles.sectionTitle, { color: t.text, marginBottom: 0 }]}>Insurance Claim</Text>
              </View>
              {job.insuranceCompany ? <Text style={{ color: t.textSecondary, fontSize: 13 }}>Carrier: {job.insuranceCompany}</Text> : null}
              {job.claimNumber ? <Text style={{ color: t.textSecondary, fontSize: 13, marginTop: 4 }}>Claim #: {job.claimNumber}</Text> : null}
              {job.adjusterName ? <Text style={{ color: t.textSecondary, fontSize: 13, marginTop: 4 }}>Adjuster: {job.adjusterName}{job.adjusterPhone ? ` • ${job.adjusterPhone}` : ''}</Text> : null}
              {!job.insuranceCompany && !job.claimNumber ? <Text style={{ color: t.textMuted, fontSize: 13 }}>No claim details yet</Text> : null}
            </View>
          </AnimatedCard>
        ) : null}

        {/* Photos */}
        <AnimatedCard index={5}>
          <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
            <PhotoGallery jobId={id!} canAdd={canAddPhotos} />
          </View>
        </AnimatedCard>

        {/* Notes */}
        <AnimatedCard index={6}>
          <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Text style={[styles.sectionTitle, { color: t.text }]}>Notes</Text>
            {isRoof ? roofNotes.map((note: any, i: number) => (
              <View key={note.id || i} style={[styles.noteRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border }]}>
                <Text style={[styles.noteText, { color: t.text }]}>{note.body}</Text>
                {note.createdAt ? <Text style={[styles.noteMeta, { color: t.textMuted }]}>{new Date(note.createdAt).toLocaleString()}</Text> : null}
              </View>
            )) : !canWork ? (
              <Text style={[styles.noteText, { color: savedNotes ? t.text : t.textMuted }]}>{savedNotes || 'No notes'}</Text>
            ) : null}
            {canWork && (
              <View style={styles.noteInput}>
                <TextInput
                  style={[styles.noteField, !isRoof && styles.noteFieldTall, { backgroundColor: t.background, color: t.text, borderColor: t.border }]}
                  placeholder={isRoof ? 'Add a note...' : 'Notes about this job...'}
                  placeholderTextColor={t.textMuted}
                  value={noteText}
                  onChangeText={setNoteText}
                  multiline
                  textAlignVertical="top"
                />
                <TouchableOpacity
                  style={[styles.noteSend, { backgroundColor: t.primary, opacity: noteReady ? 1 : 0.5 }]}
                  onPress={handleSaveNote}
                  disabled={savingNote || !noteReady}
                >
                  <Ionicons name={isRoof ? 'send' : 'checkmark'} size={16} color={t.onPrimary} />
                </TouchableOpacity>
              </View>
            )}
          </View>
        </AnimatedCard>

        {/* Actions — jobs:update */}
        {canWork && (
          <AnimatedCard index={7}>
            <View style={styles.actionsCol}>
              {!isRoof && (
                <JobFlowCard
                  jobId={String(id)} status={job.status} queue={queue} checklists={flowData.checklists} photoCount={flowData.photoCount}
                  busy={moving} startedAt={job.startedAt} pausedAt={job.pausedAt} onMove={(m) => { void moveJob(m) }} onComplete={() => setShowComplete(true)}
                />
              )}

              {isRoof && job.status === 'lead' && (
                <TouchableOpacity style={[styles.actionBtnLg, { backgroundColor: ACTION.sky }]} onPress={() => setShowInspection('date')}>
                  <Ionicons name="calendar" size={20} color={ACTION_INK} />
                  <Text style={styles.actionBtnText}>{job.inspectionDate ? 'Reschedule Inspection' : 'Schedule Inspection'}</Text>
                </TouchableOpacity>
              )}
              {isRoof && nextStage && (
                <TouchableOpacity style={[styles.actionBtnLg, { backgroundColor: ACTION.green }]} onPress={() => act('advance', undefined, `Moved to ${stageName(nextStage, job.jobType) ?? label(nextStage)}`)}>
                  <Ionicons name="arrow-forward-circle" size={20} color={ACTION_INK} />
                  <Text style={styles.actionBtnText}>Advance to {stageName(nextStage, job.jobType) ?? label(nextStage)}</Text>
                </TouchableOpacity>
              )}
              {isRoof && !roofClosed && job.status !== 'collected' && (
                <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border, marginBottom: 0 }]}>
                  <Text style={[styles.infoLabel, { color: t.textMuted, marginBottom: 6 }]}>Close this job</Text>
                  <TextInput
                    style={[styles.reasonField, { backgroundColor: t.background, color: t.text, borderColor: t.border }]}
                    placeholder="Why? (e.g. went with another roofer)"
                    placeholderTextColor={t.textMuted}
                    value={closeReason}
                    onChangeText={setCloseReason}
                  />
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                    <TouchableOpacity style={[styles.actionBtnSm, { borderColor: '#ef4444' }]} onPress={() => closeJob('lost')}>
                      <Text style={{ color: '#ef4444', fontWeight: '600' }}>Lost</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.actionBtnSm, { borderColor: t.textMuted }]} onPress={() => closeJob('cancelled')}>
                      <Text style={{ color: t.textSecondary, fontWeight: '600' }}>Cancelled</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
              {roofClosed && (
                <TouchableOpacity style={[styles.actionBtnLg, { backgroundColor: ACTION.blue }]} onPress={() => act('reopen', { status: 'lead' }, 'Job reopened')}>
                  <Ionicons name="refresh" size={20} color={ACTION_INK} />
                  <Text style={styles.actionBtnText}>Reopen as Lead</Text>
                </TouchableOpacity>
              )}
            </View>
          </AnimatedCard>
        )}
      </ScrollView>

      {showInspection && (
        <DateTimePicker
          value={inspectionAt}
          mode={showInspection}
          minimumDate={showInspection === 'date' ? new Date() : undefined}
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(e: any, d?: Date) => {
            if (e?.type === 'dismissed' || !d) { setShowInspection(null); return }
            const next = new Date(inspectionAt)
            if (showInspection === 'date') next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate())
            else next.setHours(d.getHours(), d.getMinutes(), 0, 0)
            setInspectionAt(next)
            if (showInspection === 'date') setShowInspection('time')
            else { setShowInspection(null); scheduleInspection(next) }
          }}
        />
      )}

      <ConfirmSheet
        visible={showComplete}
        onClose={() => setShowComplete(false)}
        onConfirm={() => { void moveJob('complete') }}
        title="Complete Job"
        description="Mark this job as completed?"
        confirmLabel="Complete"
      />
    </View>
  )
}

function InfoRow({ icon, label: title, value, t }: { icon: string; label: string; value: string; t: any }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon as any} size={16} color={t.textMuted} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.infoLabel, { color: t.textMuted }]}>{title}</Text>
        <Text style={[styles.infoValue, { color: t.text }]}>{value}</Text>
      </View>
    </View>
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
  noteFieldTall: { minHeight: 80, maxHeight: 160 },
  noteSend: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  reasonField: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14 },
  // Actions
  actionsCol: { gap: 10, marginBottom: 20 },
  actionBtnLg: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 10,
  },
  actionBtnText: { color: ACTION_INK, fontSize: 16, fontWeight: '600' },
  actionBtnSm: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 8, borderWidth: 1 },
})
