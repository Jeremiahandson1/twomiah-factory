/**
 * An after-photo for a finished visit — the customer's visit-done message carries it, and so does their portal.
 *   POST /api/visit-reports/job/:jobId/photos   multipart `photo` (+ `caption`), jobs:update, feature visit_reports; a crew seat only on its own visit.
 * Photos are sent when taken: they are not kept for later (a photo is too big to wait in the phone's offline list), so with no signal it says so.
 */
import React, { useState } from 'react'
import { Image, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { upload } from '../../src/api/client'
import { useAuth } from '../../src/auth/AuthContext'
import { useVertical } from '../../src/vertical/VerticalContext'
import { useToast } from '../../src/components/ToastProvider'
import { useCamera } from '../../src/hooks/useCamera'
import { Screen, TextField, Button, EmptyState, Card, space, radius } from '../../src/design'

export default function VisitPhoto() {
  const router = useRouter()
  const toast = useToast()
  const { can } = useAuth()
  const { hasFeature } = useVertical()
  const { jobId } = useLocalSearchParams<{ jobId: string }>()
  const { takePhoto, pickImage } = useCamera()
  const [photo, setPhoto] = useState<string | null>(null)
  const [caption, setCaption] = useState('')
  const [busy, setBusy] = useState(false)
  if (!hasFeature('visit_reports') || !can('jobs:update')) return <Screen title="After photo" onBack={() => router.back()}><EmptyState icon="lock-closed" title="Not available" body="Your business has not turned on visit-done messages for your seat." /></Screen>
  const send = async () => {
    if (!photo || !jobId) { toast.show('Take or choose a photo first', 'warning'); return }
    setBusy(true)
    const fd = new FormData()
    fd.append('photo', { uri: photo, type: 'image/jpeg', name: `after_${Date.now()}.jpg` } as any)
    if (caption.trim()) fd.append('caption', caption.trim())
    const r = await upload(`/api/visit-reports/job/${jobId}/photos`, fd).catch(() => null)
    setBusy(false)
    if (!r) { toast.show('No signal. The photo was not sent — try again when you have service.', 'error'); return }
    if (!r.ok) { toast.show(r.status === 503 ? 'Photo storage is not set up yet.' : r.error || 'The photo was not sent', 'error'); return }
    toast.show('Photo added', 'success'); router.back()
  }
  return (
    <Screen title="After photo" onBack={() => router.back()} footer={<Button label="Add photo" icon="checkmark" size="lg" fullWidth loading={busy} onPress={send} />}>
      <View style={{ gap: space[3] }}>
        <Card>
          <View style={{ gap: space[2] }}>
            {photo ? <Image source={{ uri: photo }} style={{ width: '100%', height: 260, borderRadius: radius.md }} resizeMode="contain" accessibilityLabel="The after photo" /> : null}
            <View style={{ flexDirection: 'row', gap: space[2] }}>
              <Button label={photo ? 'Retake' : 'Take a photo'} icon="camera" variant="tonal" onPress={async () => { const p = await takePhoto(); if (p) setPhoto(p.uri) }} />
              <Button label="From photos" icon="images" variant="tonal" onPress={async () => { const p = await pickImage(); if (p) setPhoto(p.uri) }} />
            </View>
          </View>
        </Card>
        <TextField label="Caption (optional)" value={caption} onChangeText={setCaption} />
      </View>
    </Screen>
  )
}
