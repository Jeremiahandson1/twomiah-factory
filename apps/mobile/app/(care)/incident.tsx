/**
 * Report an incident from the field.
 *   GET  /api/incidents/my-clients        the clients the caregiver may report for (their own)
 *   POST /api/incidents/caregiver-report  { clientId, incidentType, incidentDate, incidentTime?, description,
 *                                           injuriesOrDamage?, actionsTaken?, witnesses?, photos: [{ dataUri, fileName }] ≤ 3 }
 * The office gets an incident alert and the report opens as a case.
 */
import React, { useEffect, useState } from 'react'
import { Text, StyleSheet, View, Image, TouchableOpacity, Alert } from 'react-native'
import { useRouter } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../src/theme/ThemeContext'
import { OVERLAY_INK } from '../../src/theme/actions'
import { useCare } from '../../src/care/CareContext'
import { careGet, carePost, asList } from '../../src/care/careApi'
import { CareScreen } from '../../src/care/screen'
import { Banner, Button, Choice, Field, SectionTitle } from '../../src/care/ui'
import { DateTimeField } from '../../src/care/components/DateTimeField'

// The server's list (crm-homecare config/incidentOptions.ts INCIDENT_TYPES).
const TYPES = [
  { value: 'fall', label: 'Fall' },
  { value: 'injury', label: 'Injury' },
  { value: 'medication_error', label: 'Medication error' },
  { value: 'missing_medication', label: 'Missing / misappropriated medication' },
  { value: 'health_emergency', label: 'Health emergency' },
  { value: 'behavioral', label: 'Behavioral issue' },
  { value: 'accident', label: 'Accident' },
  { value: 'property_damage', label: 'Property damage' },
  { value: 'other', label: 'Other' },
]
const MAX_PHOTOS = 3
const MAX_PHOTO_CHARS = 7_000_000

export default function IncidentScreen() {
  const t = useTheme()
  const router = useRouter()
  const care = useCare()
  const [clients, setClients] = useState<any[] | null>(null)
  const [f, setF] = useState({ clientId: care.active?.clientId || '', incidentType: '', incidentDate: care.today, incidentTime: '', description: '', injuriesOrDamage: '', actionsTaken: '', witnesses: '' })
  const [photos, setPhotos] = useState<{ uri: string; dataUri: string; fileName: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }))

  useEffect(() => {
    careGet('/api/incidents/my-clients').then((r) => setClients(r.ok ? asList(r.data) : care.clients))
  }, [])

  const addPhoto = async (library: boolean) => {
    if (photos.length >= MAX_PHOTOS) { Alert.alert(`Up to ${MAX_PHOTOS} photos`); return }
    const perm = library ? await ImagePicker.requestMediaLibraryPermissionsAsync() : await ImagePicker.requestCameraPermissionsAsync()
    if (perm.status !== 'granted') { Alert.alert('Permission needed', 'Allow camera or photo access in Settings.'); return }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.45, base64: true }
    const res = library ? await ImagePicker.launchImageLibraryAsync(opts) : await ImagePicker.launchCameraAsync(opts)
    const a = !res.canceled ? res.assets?.[0] : null
    if (!a?.base64) return
    // The server takes jpeg/png/gif/webp; with quality < 1 the picker re-encodes as JPEG.
    const mime = a.mimeType && /^image\/(jpeg|png|gif|webp)$/.test(a.mimeType) ? a.mimeType : 'image/jpeg'
    const dataUri = `data:${mime};base64,${a.base64}`
    if (dataUri.length > MAX_PHOTO_CHARS) { Alert.alert('Photo too large', 'Try again a little further back.'); return }
    setPhotos((p) => [...p, { uri: a.uri, dataUri, fileName: `incident_${Date.now()}.jpg` }])
  }

  const submit = async () => {
    if (!f.clientId) return Alert.alert('Pick the client')
    if (!f.incidentType) return Alert.alert('Pick what happened')
    if (!f.incidentDate) return Alert.alert('Enter the date')
    if (!f.description.trim()) return Alert.alert('Describe what happened')
    setSaving(true)
    const r = await carePost('/api/incidents/caregiver-report', {
      ...f, incidentTime: f.incidentTime || null, photos: photos.map((p) => ({ dataUri: p.dataUri, fileName: p.fileName })),
    }, 60000)
    setSaving(false)
    if (!r.ok) {
      Alert.alert('Not sent', `${r.status === 0 ? 'No connection.' : r.error || 'It did not go through.'} Please call the office directly.`)
      return
    }
    setDone(r.data?.incidentNumber ? `Report ${r.data.incidentNumber}` : 'Report sent')
  }

  if (done) {
    return (
      <CareScreen>
        <Banner tone="success" icon="checkmark-circle" title={done}>The office has been notified and will follow up with you. If anyone is hurt or in danger, call 911 first, then the office.</Banner>
        <Button label="Done" onPress={() => router.back()} />
      </CareScreen>
    )
  }

  return (
    <CareScreen keyboard>
      <Banner tone="danger" icon="warning">If anyone is hurt or in danger, call 911 first. This report notifies the office right away.</Banner>
      <Text style={[styles.lead, { color: t.textSecondary }]}>Falls, injuries, medication problems, missing property, or anything unsafe. Report it the same day.</Text>

      <SectionTitle>Client</SectionTitle>
      {clients === null ? <Text style={[styles.lead, { color: t.textSecondary }]}>Loading…</Text>
        : clients.length === 0 ? <Banner tone="warning" icon="people-outline">No clients found. Call the office to report this.</Banner>
          : clients.map((c) => <Choice key={c.id} label={`${c.firstName || ''} ${c.lastName || ''}`.trim()} selected={f.clientId === c.id} onPress={() => set('clientId', c.id)} />)}

      <SectionTitle>What happened?</SectionTitle>
      {TYPES.map((x) => <Choice key={x.value} label={x.label} selected={f.incidentType === x.value} onPress={() => set('incidentType', x.value)} />)}

      <View style={styles.two}>
        <View style={{ flex: 1 }}><DateTimeField label="Date" mode="date" value={f.incidentDate} onChange={(v) => set('incidentDate', v)} maximumDate={new Date()} /></View>
        <View style={{ flex: 1 }}><DateTimeField label="Time (optional)" mode="time" value={f.incidentTime} onChange={(v) => set('incidentTime', v)} /></View>
      </View>
      <Field label="Describe what happened" value={f.description} onChangeText={(v) => set('description', v)} multiline placeholder="Facts only: what you saw, heard, and did." />
      <Field label="Injuries or damage" value={f.injuriesOrDamage} onChangeText={(v) => set('injuriesOrDamage', v)} multiline placeholder="Who was hurt, what was damaged or missing" />
      <Field label="What you did about it" value={f.actionsTaken} onChangeText={(v) => set('actionsTaken', v)} multiline placeholder="Called 911, called family, helped the client up…" />
      <Field label="Anyone else there?" value={f.witnesses} onChangeText={(v) => set('witnesses', v)} placeholder="Names of anyone who saw it" />

      <SectionTitle>Photos (optional, up to {MAX_PHOTOS})</SectionTitle>
      <View style={styles.photos}>
        {photos.map((p, i) => (
          <View key={i} style={[styles.photo, { borderColor: t.border }]}>
            <Image source={{ uri: p.uri }} style={styles.photoImg} />
            <TouchableOpacity style={styles.remove} onPress={() => setPhotos((l) => l.filter((_, j) => j !== i))} accessibilityLabel="Remove photo">
              <Ionicons name="close" size={14} color={OVERLAY_INK} />
            </TouchableOpacity>
          </View>
        ))}
      </View>
      {photos.length < MAX_PHOTOS && (
        <View style={styles.actions}>
          <Button small icon="camera" label="Take photo" onPress={() => addPhoto(false)} />
          <Button small variant="secondary" icon="images-outline" label="From library" onPress={() => addPhoto(true)} />
        </View>
      )}

      <Button style={{ marginTop: 18 }} variant="danger" icon="send" label="Send incident report" loading={saving} onPress={submit} />
    </CareScreen>
  )
}

const styles = StyleSheet.create({
  lead: { fontSize: 14, lineHeight: 20, marginBottom: 8 },
  two: { flexDirection: 'row', gap: 10, marginTop: 8 },
  photos: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  photo: { width: 90, height: 90, borderRadius: 10, overflow: 'hidden', borderWidth: 1 },
  photoImg: { width: '100%', height: '100%' },
  remove: { position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 10, padding: 3 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
})
