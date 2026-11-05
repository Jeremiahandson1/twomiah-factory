/**
 * Fill a salon intake or consent form in with a client, at the chair or the desk (the stylist hands over the phone).
 *   GET  /api/intake-forms                 the forms and their questions (contacts:read, feature intake_forms)
 *   POST /api/intake-forms/:id/fill        JSON (kept in the offline list when there is no signal) — or multipart when a photo is attached
 * Every kind of question the web form has: short and long answers, yes / no, pick one, an agreement to tick, a photo or a file (a picture; PDFs are
 * chosen on the web), and a signature — typed, or drawn with a finger. A photo is sent when taken, not kept for later (too big for the offline list).
 * The rules are src/forms/intakeForm.ts (tests/mobile/intake-form.test.ts). The server checks everything again and says why when it refuses.
 */
import React, { useEffect, useState } from 'react'
import { Image, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { get, upload } from '../../src/api/client'
import { useAuth } from '../../src/auth/AuthContext'
import { useVertical } from '../../src/vertical/VerticalContext'
import { useToast } from '../../src/components/ToastProvider'
import { useCamera } from '../../src/hooks/useCamera'
import { useOfflineApi } from '../../src/offline/useOfflineApi'
import { SignaturePad } from '../../src/care/components/SignaturePad'
import { Screen, TextField, Chip, Button, DText, Card, EmptyState, SkeletonRows, space, radius } from '../../src/design'
import { missing, needsUpload, jsonBody, uploadFields, isPictureQuestion, type Filled, type PhoneForm } from '../../src/forms/intakeForm'

const blank = (): Filled => ({ answers: {}, photos: {}, signedName: '', signature: null })

export default function IntakeFormScreen() {
  const router = useRouter()
  const toast = useToast()
  const { can } = useAuth()
  const { hasFeature } = useVertical()
  const offline = useOfflineApi()
  const { takePhoto, pickImage } = useCamera()
  const { contactId, formId, clientName } = useLocalSearchParams<{ contactId: string; formId: string; clientName?: string }>()
  const [form, setForm] = useState<PhoneForm | null | undefined>(undefined)
  const [v, setV] = useState<Filled>(blank())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const allowed = hasFeature('intake_forms') && can('contacts:update')

  useEffect(() => {
    if (!allowed) return
    get('/api/intake-forms').then((r) => {
      const rows: PhoneForm[] = Array.isArray(r.data?.data) ? r.data.data : Array.isArray(r.data) ? r.data : []
      const f = rows.find((x) => x.id === formId)
      setForm(f && f.active ? f : null)
    }).catch(() => setForm(null))
  }, [allowed, formId])

  if (!allowed) return <Screen title="Form" onBack={() => router.back()}><EmptyState icon="lock-closed" title="Not available" body="Forms are not turned on for your seat." /></Screen>
  if (form === undefined) return <Screen title="Form" onBack={() => router.back()}><SkeletonRows count={4} /></Screen>
  if (form === null || !contactId) return <Screen title="Form" onBack={() => router.back()}><EmptyState icon="alert-circle" title="This form is not available" body="It may have been paused. Go back and try again." /></Screen>

  const set = (id: string, a: string) => setV((x) => ({ ...x, answers: { ...x.answers, [id]: a } }))
  const attach = async (id: string, camera: boolean) => { const p = camera ? await takePhoto() : await pickImage(); if (p) setV((x) => ({ ...x, photos: { ...x.photos, [id]: p.uri } })) }
  const send = async () => {
    const why = missing(form, v)
    if (why) { setError(why); return }
    setError(null); setBusy(true)
    if (needsUpload(form, v)) {
      const fd = new FormData()
      for (const [k, val] of Object.entries(uploadFields(form, contactId, v))) fd.append(k, val)
      for (const q of form.questions) if (isPictureQuestion(q) && v.photos[q.id]) fd.append(`f_${q.id}`, { uri: v.photos[q.id], type: 'image/jpeg', name: `${q.id}_${Date.now()}.jpg` } as any)
      const r = await upload(`/api/intake-forms/${form.id}/fill`, fd).catch(() => null)
      setBusy(false)
      if (!r) { setError('No signal. The photo was not sent — try again when you have service, or take the photo out to save the answers now.'); return }
      if (!r.ok) { setError(r.status === 503 ? 'Photo storage is not set up yet.' : r.error || 'The form was not saved.'); return }
      toast.show('Form saved', 'success'); router.back(); return
    }
    const r = await offline.post(`/api/intake-forms/${form.id}/fill`, jsonBody(form, contactId, v), { recordKey: `intake:${contactId}:${form.id}`, label: `${form.name}${clientName ? ` · ${clientName}` : ''}` })
    setBusy(false)
    if (!r.ok && !r.queued) { setError(r.error || 'The form was not saved.'); return }
    toast.show(r.queued ? 'Saved on your phone. It will be sent when you have signal.' : 'Form saved', r.queued ? 'info' : 'success'); router.back()
  }

  return (
    <Screen title={form.name} subtitle={clientName} onBack={() => router.back()} footer={<Button label="Save form" icon="checkmark" size="lg" fullWidth loading={busy} onPress={send} />}>
      <View style={{ gap: space[3] }}>
        {form.intro ? <DText variant="body">{form.intro}</DText> : null}
        {error ? <DText variant="callout" tone="danger" accessibilityRole="alert">{error}</DText> : null}
        {form.questions.map((q) => (
          <Card key={q.id}>
            <View style={{ gap: space[2] }}>
              {q.type === 'text' || q.type === 'longtext' ? (
                <TextField label={`${q.label}${q.required ? '' : ' (optional)'}`} value={v.answers[q.id] ?? ''} onChangeText={(t) => set(q.id, t)} multiline={q.type === 'longtext'} />
              ) : (
                <DText variant="bodyStrong">{q.label}{q.required || q.type === 'consent' ? '' : ' (optional)'}</DText>
              )}
              {q.type === 'yesno' ? (
                <View style={{ flexDirection: 'row', gap: space[2] }}>{['yes', 'no'].map((o) => <Chip key={o} label={o === 'yes' ? 'Yes' : 'No'} selected={v.answers[q.id] === o} onPress={() => set(q.id, o)} />)}</View>
              ) : null}
              {q.type === 'choice' ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>{(q.options || []).map((o) => <Chip key={o} label={o} selected={v.answers[q.id] === o} onPress={() => set(q.id, o)} />)}</View>
              ) : null}
              {q.type === 'consent' ? (
                <Button label={v.answers[q.id] === '1' ? 'Agreed ✓' : 'I agree'} variant={v.answers[q.id] === '1' ? 'primary' : 'secondary'} fullWidth onPress={() => set(q.id, v.answers[q.id] === '1' ? '' : '1')} />
              ) : null}
              {isPictureQuestion(q) ? (
                <View style={{ gap: space[2] }}>
                  {v.photos[q.id] ? <Image source={{ uri: v.photos[q.id] }} style={{ width: '100%', height: 200, borderRadius: radius.md }} resizeMode="contain" accessibilityLabel={q.label} /> : null}
                  <View style={{ flexDirection: 'row', gap: space[2] }}>
                    <Button label={v.photos[q.id] ? 'Retake' : 'Take a photo'} icon="camera" variant="tonal" onPress={() => attach(q.id, true)} />
                    <Button label="From photos" icon="images" variant="tonal" onPress={() => attach(q.id, false)} />
                  </View>
                </View>
              ) : null}
            </View>
          </Card>
        ))}
        {form.kind === 'consent' ? (
          <Card>
            <View style={{ gap: space[2] }}>
              {form.signature === 'drawn' ? (
                <>
                  <DText variant="bodyStrong">Signature</DText>
                  {v.signature ? <DText variant="callout" tone="textSecondary">Signed ✓ — draw again to replace it.</DText> : null}
                  <SignaturePad onSubmit={(uri) => setV((x) => ({ ...x, signature: uri }))} />
                </>
              ) : null}
              <TextField label={form.signature === 'drawn' ? 'Full name, under the signature' : 'Type your full name to sign'} value={v.signedName} onChangeText={(t) => setV((x) => ({ ...x, signedName: t }))} />
            </View>
          </Card>
        ) : null}
      </View>
    </Screen>
  )
}
