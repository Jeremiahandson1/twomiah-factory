/**
 * Documents waiting for the caregiver's signature.
 *   GET  /api/documents/unsigned/:me      company documents I haven't signed + my own unsigned ones
 *   GET  /api/documents/:id/download      the file (images are shown here; see below for others)
 *   POST /api/documents/:id/sign          { signatureImageBase64 (data:image URI), typedName }
 * The signature is drawn on the pad (src/care/components/SignaturePad.tsx).
 *
 * Reading a PDF or Word file needs a document viewer this app does not ship yet, so for those the
 * caregiver is told to read it on the agency's web portal (or ask the office) and confirms they have.
 */
import React, { useState } from 'react'
import { Text, StyleSheet, View, Image, Alert, ActivityIndicator } from 'react-native'
import { useTheme } from '../../src/theme/ThemeContext'
import { useToast } from '../../src/components/ToastProvider'
import { useAuth } from '../../src/auth/AuthContext'
import { useCare } from '../../src/care/CareContext'
import { carePost } from '../../src/care/careApi'
import { getAccessToken, getApiUrl } from '../../src/api/client'
import { CareScreen } from '../../src/care/screen'
import { Banner, Button, Card, Choice, Field, useTone } from '../../src/care/ui'
import { SignaturePad } from '../../src/care/components/SignaturePad'
import { EmptyState } from '../../src/components/EmptyState'
import { formatYmdShort } from '../../src/care/time'

const IMAGE_TYPES = ['png', 'jpg', 'jpeg', 'gif']

async function fetchImageDataUri(id: string): Promise<string | null> {
  try {
    const res = await fetch(`${getApiUrl()}/api/documents/${id}/download`, { headers: { Authorization: `Bearer ${getAccessToken()}` } })
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise<string | null>((resolve) => {
      const r = new FileReader()
      r.onload = () => resolve(typeof r.result === 'string' ? r.result : null)
      r.onerror = () => resolve(null)
      r.readAsDataURL(blob)
    })
  } catch { return null }
}

function DocumentCard({ d, onDrawing }: { d: any; onDrawing: (v: boolean) => void }) {
  const t = useTheme()
  const toast = useToast()
  const { user } = useAuth()
  const care = useCare()
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<string | null | 'loading'>(null)
  const [read, setRead] = useState(false)
  const [typedName, setTypedName] = useState(`${user?.firstName || ''} ${user?.lastName || ''}`.trim())
  const [saving, setSaving] = useState(false)
  const dangerTone = useTone('danger')
  const isImage = IMAGE_TYPES.includes(String(d.file_type || '').toLowerCase())
  const name = d.name || d.document_name || d.file_name || 'Document'

  const expand = async () => {
    setOpen(true)
    if (isImage && preview === null) { setPreview('loading'); setPreview(await fetchImageDataUri(d.id)) }
  }

  const sign = async (dataUri: string) => {
    if (!typedName.trim()) { Alert.alert('Type your full name'); return }
    setSaving(true)
    const r = await carePost(`/api/documents/${d.id}/sign`, { signatureImageBase64: dataUri, typedName: typedName.trim() })
    setSaving(false)
    if (r.ok) { toast.success(`Signed: ${name}`); care.reload({ silent: true }) }
    else Alert.alert('Not signed', r.status === 0 ? 'No connection — try again when you have signal.' : r.error || 'Please try again.')
  }

  return (
    <Card>
      <Text style={[styles.name, { color: t.text }]}>{name}</Text>
      {d.description ? <Text style={[styles.meta, { color: t.textSecondary }]}>{d.description}</Text> : null}
      {d.expiration_date ? <Text style={[styles.meta, { color: dangerTone.text, fontWeight: '700' }]}>Expires {formatYmdShort(String(d.expiration_date).slice(0, 10))}</Text> : null}
      {!open ? (
        <Button small style={{ marginTop: 10, alignSelf: 'flex-start' }} icon="create-outline" label="Read and sign" onPress={expand} />
      ) : (
        <View style={{ marginTop: 12 }}>
          {isImage ? (
            preview === 'loading' ? <ActivityIndicator color={t.primary} />
              : preview ? <Image source={{ uri: preview }} style={styles.preview} resizeMode="contain" />
                : <Banner tone="warning" icon="alert-circle">The document didn't load. Check your signal, or read it on your agency's web portal.</Banner>
          ) : (
            <Banner tone="info" icon="document-text-outline">
              {`This is a ${String(d.file_type || 'document').toUpperCase()} file. Read it on your agency's web portal (or ask the office for a copy) before you sign.`}
            </Banner>
          )}
          <Choice label="I have read this document" selected={read} onPress={() => setRead((v) => !v)} />
          <Field label="Your full name" value={typedName} onChangeText={setTypedName} autoCapitalize="words" />
          {read ? <SignaturePad onSubmit={sign} submitting={saving} onDrawing={onDrawing} /> : <Text style={[styles.meta, { color: t.textSecondary }]}>Confirm you've read it to sign.</Text>}
        </View>
      )}
    </Card>
  )
}

export default function DocumentsScreen() {
  const care = useCare()
  const [drawing, setDrawing] = useState(false)
  return (
    <CareScreen keyboard scrollEnabled={!drawing} refreshing={care.refreshing} onRefresh={() => care.reload()}>
      {care.unsignedDocs.length === 0
        ? <EmptyState icon="checkmark-done-outline" title="Nothing to sign" subtitle="Documents from your agency that need your signature appear here." />
        : care.unsignedDocs.map((d) => <DocumentCard key={d.id} d={d} onDrawing={setDrawing} />)}
    </CareScreen>
  )
}

const styles = StyleSheet.create({
  name: { fontSize: 16, fontWeight: '800' },
  meta: { fontSize: 14, marginTop: 4, lineHeight: 19 },
  preview: { width: '100%', height: 360, borderRadius: 10, marginBottom: 10, backgroundColor: '#ffffff' },
})
