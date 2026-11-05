/**
 * Scan a supplier invoice (restaurant-bar parity #7) — take or pick a PHOTO and send it to the server to be read:
 *   POST /api/stock/invoices   multipart `file` (bar:update, bar_invoice_scan)
 * The photo is NOT kept for later (the offline queue holds JSON only, src/offline/README.md): with no signal this says so and keeps
 * nothing. Reading changes no count and no price; the saved scan opens to be checked, and Receive is its own step.
 */
import React, { useState } from 'react'
import { Image, View } from 'react-native'
import { useRouter } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import { upload } from '../../src/api/client'
import { OfflineQueue } from '../../src/offline/OfflineQueue'
import { useToast } from '../../src/components/ToastProvider'
import { useHaptics } from '../../src/hooks/useHaptics'
import { Screen, Button, DText, Card, space, radius } from '../../src/design'
import { NEEDS_SIGNAL, scanFailure } from '../../src/trades/invoiceScan'

// A lower quality keeps a 12-megapixel photo under the 5 MB the reader takes, and a printed page stays readable.
const OPTIONS = { mediaTypes: ['images'] as ImagePicker.MediaType[], quality: 0.5, base64: false }

export default function StockInvoice() {
  const router = useRouter()
  const toast = useToast()
  const haptics = useHaptics()
  const [photo, setPhoto] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const choose = async (camera: boolean) => {
    setProblem(null)
    const ask = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (ask.status !== 'granted') { setProblem(camera ? 'Camera access is needed to photograph the invoice. Allow it in your phone’s settings.' : 'Photo access is needed to pick the invoice. Allow it in your phone’s settings.'); return }
    const r = camera ? await ImagePicker.launchCameraAsync(OPTIONS) : await ImagePicker.launchImageLibraryAsync(OPTIONS)
    if (!r.canceled && r.assets[0]) setPhoto(r.assets[0].uri)
  }

  const send = async () => {
    if (!photo) return
    setProblem(null)
    if (!OfflineQueue.status().online) { setProblem(NEEDS_SIGNAL); return }
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', { uri: photo, type: 'image/jpeg', name: `invoice_${Date.now()}.jpg` } as any)
      const res = await upload('/api/stock/invoices', fd)
      if (!res.ok) { haptics.error(); setProblem(scanFailure(res.status, res.error)); return }
      haptics.success()
      toast.success('Invoice read. Check the lines, then receive it.')
      router.replace({ pathname: '/(details)/t/[spec]/[id]', params: { spec: 'bar-invoices', id: res.data?.id } } as any)
    } catch (e) {
      haptics.error()
      setProblem(scanFailure(0, e instanceof Error ? e.message : ''))
    } finally { setBusy(false) }
  }

  return (
    <Screen title="Scan an invoice" onBack={() => router.back()} footer={<Button label="Read the invoice" icon="scan" size="lg" fullWidth loading={busy} disabled={!photo} onPress={send} />}>
      <View style={{ gap: space[3] }}>
        <DText variant="body">Photograph the whole invoice, flat and in good light, or pick a photo you already took. It is read into lines for you to check. Nothing changes your counts or prices until you receive it.</DText>
        <Card>
          <View style={{ gap: space[2] }}>
            {photo ? <Image source={{ uri: photo }} style={{ width: '100%', height: 320, borderRadius: radius.md }} resizeMode="contain" accessibilityLabel="The invoice photo" /> : null}
            <View style={{ flexDirection: 'row', gap: space[2] }}>
              <Button label={photo ? 'Retake' : 'Take a photo'} icon="camera" variant="tonal" onPress={() => choose(true)} />
              <Button label="From photos" icon="images" variant="tonal" onPress={() => choose(false)} />
            </View>
          </View>
        </Card>
        {problem ? <View accessibilityRole="alert"><DText variant="callout" tone="danger">{problem}</DText></View> : null}
        <DText variant="callout" tone="textSecondary">Reading needs a signal and takes up to a minute. A PDF is sent from the desktop.</DText>
      </View>
    </Screen>
  )
}
