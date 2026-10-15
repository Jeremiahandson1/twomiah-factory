/**
 * What a caregiver does DURING a visit, each against its crm-homecare endpoint:
 *   · CareTaskChecklist  GET /api/care-tasks/time-entry/:id, PUT /api/care-tasks/time-entry/:id/:taskId
 *   · MedicationLog      GET /api/medications/due/:clientId, GET /api/medications/logs/time-entry/:id,
 *                        POST /api/medications/log   (shown only when the client has active medications)
 *   · VitalsForm         POST /api/medications/vitals, GET /api/medications/vitals/latest/:clientId
 *   · VisitPhotos        POST /api/time-entries/:id/photos (via CareContext)
 * A visit saved offline has no server id yet, so these say so instead of failing.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator, Alert } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../theme/ThemeContext'
import { useToast } from '../../components/ToastProvider'
import { useCare } from '../CareContext'
import { careGet, carePost, carePut, asList } from '../careApi'
import { isOfflineId } from '../offlinePunches'
import { formatClock } from '../time'
import { Banner, Button, Card, Field, SectionTitle, useTone } from '../ui'

// ─── care task checklist ─────────────────────────────────────────────────────────────────────

const TASK_STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral'; icon: string }> = {
  pending: { label: 'To do', tone: 'neutral', icon: 'ellipse-outline' },
  completed: { label: 'Done', tone: 'success', icon: 'checkmark-circle' },
  skipped: { label: 'Skipped', tone: 'warning', icon: 'play-skip-forward' },
  refused: { label: 'Refused', tone: 'danger', icon: 'close-circle' },
}

function TaskRow({ task, onSet }: { task: any; onSet: (status: string, notes?: string | null) => Promise<void> }) {
  const t = useTheme()
  const s = TASK_STATUS[task.status] || TASK_STATUS.pending
  const tone = useTone(s.tone)
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState(task.notes || '')
  const weeklyDone = task.cadence === 'weekly' && task.done_this_week && task.status !== 'completed'
  return (
    <View style={[styles.task, { borderColor: tone.border, backgroundColor: task.status === 'pending' ? t.surface : tone.bg }]}>
      <View style={styles.taskHead}>
        <Ionicons name={s.icon as any} size={20} color={task.status === 'pending' ? t.textSecondary : tone.text} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.taskName, { color: task.status === 'pending' ? t.text : tone.text }]}>{task.task_name}</Text>
          <Text style={[styles.taskMeta, { color: task.status === 'pending' ? t.textSecondary : tone.text }]}>
            {[task.category ? String(task.category).toUpperCase() : null, task.allotted_minutes > 0 ? `${task.allotted_minutes} min` : null, weeklyDone ? 'done earlier this week' : null].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <Text style={[styles.taskStatus, { color: task.status === 'pending' ? t.textSecondary : tone.text }]}>{s.label}</Text>
      </View>
      {task.description ? <Text style={[styles.taskDesc, { color: task.status === 'pending' ? t.textSecondary : tone.text }]}>{task.description}</Text> : null}
      {task.notes && !noteOpen ? <Text style={[styles.taskDesc, { color: task.status === 'pending' ? t.text : tone.text }]}>Note: {task.notes}</Text> : null}
      {noteOpen ? (
        <View style={{ marginTop: 8 }}>
          <Field label="Note" value={note} onChangeText={setNote} multiline placeholder="What happened with this task?" />
          <Button small label="Save note" onPress={async () => { await onSet(task.status, note); setNoteOpen(false) }} />
        </View>
      ) : (
        <View style={styles.taskActions}>
          {task.status !== 'completed' && <Button small variant="success" label="Done" icon="checkmark" onPress={() => onSet('completed', task.notes)} />}
          {task.status !== 'skipped' && <Button small variant="secondary" label="Skip" onPress={() => onSet('skipped', task.notes)} />}
          {task.status !== 'refused' && <Button small variant="secondary" label="Refused" onPress={() => onSet('refused', task.notes)} />}
          {task.status !== 'pending' && <Button small variant="ghost" label="Undo" onPress={() => onSet('pending', task.notes)} />}
          <Button small variant="ghost" label={task.notes ? 'Edit note' : 'Note'} onPress={() => setNoteOpen(true)} />
        </View>
      )}
    </View>
  )
}

export function CareTaskChecklist({ timeEntryId }: { timeEntryId: string }) {
  const t = useTheme()
  const toast = useToast()
  const [items, setItems] = useState<any[] | null>(null)
  const [failed, setFailed] = useState(false)
  const offline = isOfflineId(timeEntryId)

  const load = useCallback(async () => {
    if (offline) return
    const r = await careGet(`/api/care-tasks/time-entry/${timeEntryId}`)
    if (r.ok) { setItems(asList(r.data)); setFailed(false) } else setFailed(true)
  }, [timeEntryId, offline])
  useEffect(() => { load() }, [load])

  const setStatus = async (taskId: string, status: string, notes?: string | null) => {
    const r = await carePut(`/api/care-tasks/time-entry/${timeEntryId}/${taskId}`, { status, notes: notes ?? null })
    if (r.ok) setItems((prev) => (prev || []).map((x) => (x.task_id === taskId ? { ...x, status, notes: notes ?? x.notes } : x)))
    else toast.error(r.error || 'Could not save that task.')
  }

  if (offline) return <Banner tone="neutral" icon="cloud-offline-outline">The task checklist opens once this visit reaches the office (it is saved on your phone for now).</Banner>
  if (items === null) {
    return failed
      ? <Banner tone="warning" icon="alert-circle" title="Tasks didn't load" onPress={load}>Tap to try again.</Banner>
      : <ActivityIndicator color={t.primary} style={{ marginVertical: 16 }} />
  }
  if (!items.length) return <Text style={[styles.empty, { color: t.textSecondary }]}>No care tasks are set up for this client.</Text>
  const done = items.filter((x) => x.status === 'completed').length
  const daily = items.filter((x) => (x.cadence || 'daily') !== 'weekly')
  const weekly = items.filter((x) => (x.cadence || 'daily') === 'weekly')
  return (
    <View>
      <View style={[styles.progressTrack, { backgroundColor: t.surfaceAlt }]}>
        <View style={[styles.progressFill, { backgroundColor: t.primary, width: `${Math.round((done / items.length) * 100)}%` }]} />
      </View>
      <Text style={[styles.progressText, { color: t.textSecondary }]}>{done} of {items.length} done</Text>
      {daily.map((task) => <TaskRow key={task.task_id} task={task} onSet={(s, n) => setStatus(task.task_id, s, n)} />)}
      {weekly.length > 0 && <Text style={[styles.subhead, { color: t.textSecondary }]}>Weekly tasks</Text>}
      {weekly.map((task) => <TaskRow key={task.task_id} task={task} onSet={(s, n) => setStatus(task.task_id, s, n)} />)}
    </View>
  )
}

// ─── medication log (MAR) ────────────────────────────────────────────────────────────────────

const MAR_ACTIONS: { status: string; label: string }[] = [
  { status: 'given', label: 'Given' },
  { status: 'self_administered', label: 'Self-administered' },
  { status: 'refused', label: 'Refused' },
  { status: 'held', label: 'Held' },
  { status: 'missed', label: 'Missed' },
]

export function MedicationLog({ clientId, timeEntryId }: { clientId: string; timeEntryId: string }) {
  const t = useTheme()
  const okTone = useTone('success')
  const toast = useToast()
  const [meds, setMeds] = useState<any[] | null>(null)
  const [logs, setLogs] = useState<any[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const offline = isOfflineId(timeEntryId)

  const load = useCallback(async () => {
    const [m, l] = await Promise.all([
      careGet(`/api/medications/due/${clientId}`),
      offline ? Promise.resolve({ ok: true, data: [] } as any) : careGet(`/api/medications/logs/time-entry/${timeEntryId}`),
    ])
    setMeds(m.ok ? asList(m.data) : [])
    if (l.ok) setLogs(asList(l.data))
  }, [clientId, timeEntryId, offline])
  useEffect(() => { load() }, [load])

  if (!meds || !meds.length) return null // only when the client has medications
  const record = async (med: any, status: string) => {
    if (offline) { toast.warning('No signal — medications can be recorded once this visit reaches the office.'); return }
    setBusy(med.id)
    const r = await carePost('/api/medications/log', { medicationId: med.id, clientId, timeEntryId, status })
    setBusy(null)
    if (r.ok) { toast.success(`${med.medication_name || med.name}: ${status.replace('_', ' ')}`); load() }
    else toast.error(r.error || 'Could not record that.')
  }
  return (
    <View>
      <SectionTitle>Medications (MAR)</SectionTitle>
      {meds.map((med) => {
        const mine = logs.filter((l) => l.medication_id === med.id)
        const last = mine[mine.length - 1]
        return (
          <Card key={med.id}>
            <Text style={[styles.medName, { color: t.text }]}>{med.medication_name || med.name}{med.is_prn ? ' (as needed)' : ''}</Text>
            <Text style={[styles.medMeta, { color: t.textSecondary }]}>{[med.dosage, med.route, med.frequency].filter(Boolean).join(' · ')}</Text>
            {med.instructions ? <Text style={[styles.medMeta, { color: t.text }]}>{med.instructions}</Text> : null}
            {last ? <Text style={[styles.medLogged, { color: okTone.text }]}>Recorded this visit: {String(last.status).replace('_', ' ')} at {formatClock(last.administered_time || last.administered_at)}</Text> : null}
            <View style={styles.taskActions}>
              {MAR_ACTIONS.map((a) => (
                <Button key={a.status} small variant={a.status === 'given' ? 'success' : 'secondary'} label={a.label} loading={busy === med.id && a.status === 'given'} disabled={!!busy} onPress={() => record(med, a.status)} />
              ))}
            </View>
          </Card>
        )
      })}
    </View>
  )
}

// ─── vitals ──────────────────────────────────────────────────────────────────────────────────

const VITAL_FIELDS: { key: string; label: string; hint: string; decimal?: boolean }[] = [
  { key: 'systolicBp', label: 'Blood pressure — top (systolic)', hint: '50–260' },
  { key: 'diastolicBp', label: 'Blood pressure — bottom (diastolic)', hint: '25–160' },
  { key: 'pulse', label: 'Pulse (beats/min)', hint: '25–220' },
  { key: 'respirations', label: 'Breaths per minute', hint: '4–70' },
  { key: 'oxygenSaturation', label: 'Oxygen (SpO2 %)', hint: '50–100' },
  { key: 'temperatureF', label: 'Temperature (°F)', hint: '85–112, one decimal', decimal: true },
  { key: 'bloodGlucose', label: 'Blood sugar (mg/dL)', hint: '20–800' },
  { key: 'weightLbs', label: 'Weight (lb)', hint: '30–800, one decimal', decimal: true },
  { key: 'painScale', label: 'Pain (0–10)', hint: '0–10' },
]

export function VitalsForm({ clientId, timeEntryId }: { clientId: string; timeEntryId: string }) {
  const t = useTheme()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [vals, setVals] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [latest, setLatest] = useState<any>(null)
  const offline = isOfflineId(timeEntryId)

  useEffect(() => {
    careGet(`/api/medications/vitals/latest/${clientId}`).then((r) => { if (r.ok) setLatest(r.data) })
  }, [clientId])

  const save = async () => {
    if (offline) { toast.warning('No signal — vitals can be recorded once this visit reaches the office.'); return }
    const body: Record<string, unknown> = { clientId, timeEntryId, notes: notes.trim() || null }
    for (const f of VITAL_FIELDS) if (vals[f.key]?.trim()) body[f.key] = vals[f.key].trim()
    if (Object.keys(body).length <= 3) { toast.warning('Enter at least one reading.'); return }
    setSaving(true)
    const r = await carePost('/api/medications/vitals', body)
    setSaving(false)
    if (r.ok) { toast.success('Vitals saved.'); setLatest(r.data); setVals({}); setNotes(''); setOpen(false) }
    else Alert.alert('Vitals not saved', r.error || 'Please check the numbers.')
  }

  const last = latest && latest.recorded_at
    ? [latest.systolic_bp && latest.diastolic_bp ? `BP ${latest.systolic_bp}/${latest.diastolic_bp}` : null,
      latest.pulse ? `pulse ${latest.pulse}` : null,
      latest.temperature_f ? `${latest.temperature_f}°F` : null,
      latest.oxygen_saturation ? `SpO2 ${latest.oxygen_saturation}%` : null].filter(Boolean).join(', ')
    : ''

  return (
    <View>
      <SectionTitle right={<Button small variant="ghost" label={open ? 'Close' : 'Record vitals'} onPress={() => setOpen((v) => !v)} />}>Vitals</SectionTitle>
      {last ? <Text style={[styles.medMeta, { color: t.textSecondary, marginBottom: 8 }]}>Last recorded: {last}</Text> : null}
      {open && (
        <Card>
          {VITAL_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint} value={vals[f.key] || ''} keyboardType={f.decimal ? 'decimal-pad' : 'number-pad'}
              onChangeText={(v) => setVals((p) => ({ ...p, [f.key]: v }))} />
          ))}
          <Field label="Notes" value={notes} onChangeText={setNotes} multiline placeholder="Anything the nurse or office should know" />
          <Button label="Save vitals" icon="save-outline" loading={saving} onPress={save} />
        </Card>
      )}
    </View>
  )
}

// ─── visit photos ────────────────────────────────────────────────────────────────────────────

export function VisitPhotos() {
  const t = useTheme()
  const toast = useToast()
  const { active, photos, addPhoto, retryPhoto, removePhoto } = useCare()
  const [taking, setTaking] = useState(false)
  if (!active) return null

  const take = async (fromLibrary: boolean) => {
    const perm = fromLibrary ? await ImagePicker.requestMediaLibraryPermissionsAsync() : await ImagePicker.requestCameraPermissionsAsync()
    if (perm.status !== 'granted') { Alert.alert('Permission needed', fromLibrary ? 'Allow photo access in Settings to attach a photo.' : 'Allow camera access in Settings to take visit photos.'); return }
    setTaking(true)
    try {
      const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.45, base64: true, exif: false }
      const res = fromLibrary ? await ImagePicker.launchImageLibraryAsync(opts) : await ImagePicker.launchCameraAsync(opts)
      const a = !res.canceled ? res.assets?.[0] : null
      if (!a) return
      if (!a.base64) { toast.error('That photo could not be read.'); return }
      addPhoto(a.uri, `data:${a.mimeType && a.mimeType.startsWith('image/') ? a.mimeType : 'image/jpeg'};base64,${a.base64}`)
    } finally { setTaking(false) }
  }

  return (
    <View>
      <SectionTitle>Visit photos</SectionTitle>
      {isOfflineId(active.id) && <Banner tone="warning" icon="cloud-offline-outline">No signal: photos can't be sent until this visit reaches the office, and can't be saved for later.</Banner>}
      <View style={styles.photoRow}>
        {photos.map((p) => (
          <View key={p.localId} style={[styles.photo, { borderColor: t.border }]}>
            <Image source={{ uri: p.uri }} style={styles.photoImg} />
            <View style={[styles.photoStatus, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
              {p.status === 'sending' ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name={p.status === 'sent' ? 'checkmark-circle' : p.status === 'failed' ? 'alert-circle' : 'time'} size={16} color="#fff" />}
            </View>
            {p.status === 'failed' && (
              <TouchableOpacity style={styles.photoRetry} onPress={() => retryPhoto(p.localId)} accessibilityLabel="Retry upload">
                <Text style={styles.photoRetryText}>Retry</Text>
              </TouchableOpacity>
            )}
            {p.status !== 'sent' && p.status !== 'sending' && (
              <TouchableOpacity style={styles.photoRemove} onPress={() => removePhoto(p.localId)} accessibilityLabel="Remove photo">
                <Ionicons name="close" size={14} color="#fff" />
              </TouchableOpacity>
            )}
          </View>
        ))}
      </View>
      <View style={styles.taskActions}>
        <Button small label="Take photo" icon="camera" loading={taking} onPress={() => take(false)} />
        <Button small variant="secondary" label="From library" icon="images-outline" disabled={taking} onPress={() => take(true)} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  task: { borderWidth: 1.5, borderRadius: 12, padding: 12, marginBottom: 10 },
  taskHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  taskName: { fontSize: 15, fontWeight: '700' },
  taskMeta: { fontSize: 12, marginTop: 2 },
  taskStatus: { fontSize: 12, fontWeight: '800' },
  taskDesc: { fontSize: 13, marginTop: 6, lineHeight: 18 },
  taskActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  empty: { fontSize: 14, marginVertical: 8 },
  progressTrack: { height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 6 },
  progressFill: { height: 8, borderRadius: 4 },
  progressText: { fontSize: 13, marginBottom: 10, fontWeight: '600' },
  subhead: { fontSize: 13, fontWeight: '700', marginTop: 6, marginBottom: 8 },
  medName: { fontSize: 16, fontWeight: '700' },
  medMeta: { fontSize: 13, marginTop: 3, lineHeight: 18 },
  medLogged: { fontSize: 13, marginTop: 6, fontWeight: '700' },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photo: { width: 96, height: 96, borderRadius: 10, overflow: 'hidden', borderWidth: 1 },
  photoImg: { width: '100%', height: '100%' },
  photoStatus: { position: 'absolute', left: 4, bottom: 4, borderRadius: 10, padding: 3 },
  photoRetry: { position: 'absolute', right: 4, bottom: 4, backgroundColor: '#b91c1c', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 },
  photoRetryText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  photoRemove: { position: 'absolute', right: 4, top: 4, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 10, padding: 3 },
})
