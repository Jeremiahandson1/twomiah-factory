/**
 * The client's signature on every visit (care_visit_signature): the client signs with a finger, or the caregiver says why they
 * could not. Kept on the phone at once (a restart or a lost signal loses nothing), sent right away when the visit has reached the
 * office, and sent again with the clock-out — so an offline visit still carries it. When the agency requires it, the Clock out
 * button stays grey until it is done (src/care/openRequired.ts).
 *   GET /api/visit-signature/config → { required, reasons } (kept on the phone), GET|PUT /api/visit-signature/visit/:id
 * An agency without the feature answers 403/404 and nothing is shown.
 */
import React, { useEffect, useState } from 'react'
import { View, Text, StyleSheet, Modal, ScrollView, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useTheme } from '../../theme/ThemeContext'
import { useToast } from '../../components/ToastProvider'
import { careGet } from '../careApi'
import { useOfflineApi } from '../../offline/useOfflineApi'
import { isOfflineId } from '../offlinePunches'
import { formatClock } from '../time'
import { reasonProblem, signatureBody, type PendingSignature, type SignatureConfig } from '../rules'
import { clearOpen, reportOpen } from '../openRequired'
import { loadPending, savePending } from '../visitSignatureStore'
import { Banner, Button, Card, Field, SectionTitle, useTone } from '../ui'
import { SignaturePad } from './SignaturePad'

const CONFIG_KEY = 'twomiah_care_visit_signature_config_v1'

/** The agency's rule: fresh from the server when it answers, else the last one kept on the phone. null = the agency does not use it. */
function useSignatureConfig(): SignatureConfig | null {
  const [cfg, setCfg] = useState<SignatureConfig | null>(null)
  useEffect(() => {
    let live = true
    ;(async () => {
      const r = await careGet<SignatureConfig>('/api/visit-signature/config')
      if (!live) return
      if (r.ok && r.data && Array.isArray((r.data as any).reasons)) {
        setCfg(r.data); AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(r.data)).catch(() => {})
      } else if (r.status === 0 || r.status >= 500) {
        try { const kept = JSON.parse((await AsyncStorage.getItem(CONFIG_KEY)) || 'null'); if (live && kept && Array.isArray(kept.reasons)) setCfg(kept) } catch { /* none kept */ }
      } else if (r.status === 403 || r.status === 404) AsyncStorage.removeItem(CONFIG_KEY).catch(() => {})
    })()
    return () => { live = false }
  }, [])
  return cfg
}

export function ClientSignature({ visitId, clientName }: { visitId: string; clientName: string }) {
  const t = useTheme()
  const toast = useToast()
  const okTone = useTone('success')
  const queue = useOfflineApi()
  const cfg = useSignatureConfig()
  const offline = isOfflineId(visitId)
  const [pending, setPending] = useState<PendingSignature | null>(null)
  const [onServer, setOnServer] = useState(false)
  const [sheet, setSheet] = useState<null | 'sign' | 'reason'>(null)
  const [drawing, setDrawing] = useState(false)
  const [code, setCode] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => { loadPending(visitId).then(setPending) }, [visitId])
  // Something already recorded for this visit (another phone, the office): then nothing is waiting for the caregiver.
  useEffect(() => {
    if (offline) return
    careGet<{ signature?: unknown }>(`/api/visit-signature/visit/${visitId}`).then((r) => { if (r.ok && r.data?.signature) setOnServer(true) })
  }, [visitId, offline])

  const have = !!pending || onServer
  useEffect(() => {
    reportOpen('signature', cfg?.required && !have ? ['the client\'s signature (or why they could not sign)'] : [])
    return () => clearOpen('signature')
  }, [cfg?.required, have])

  if (!cfg) return null

  const keep = async (p: PendingSignature) => {
    await savePending(visitId, p)
    setPending(p); setSheet(null); setProblem(null)
    // Sent now when the visit has reached the office; it is sent again with the clock-out either way.
    if (!offline) {
      const r = await queue.put(`/api/visit-signature/visit/${visitId}`, signatureBody(p), { recordKey: `visit:${visitId}`, label: 'Client signature' })
      if (!r.ok) toast.warning(r.error || 'Saved on your phone. It will be sent when you clock out.')
      else if (r.queued) toast.info('Saved on your phone. It will be sent when you have signal.')
    }
  }
  const reasonLabel = (c?: string) => cfg.reasons.find((r) => r.code === c)?.label || ''

  return (
    <View>
      <SectionTitle>Client signature</SectionTitle>
      <Card>
        {pending ? (
          <Text style={{ color: okTone.text, fontWeight: '700' }}>
            {pending.signature ? `Signed ${formatClock(pending.savedAt)}` : `Not signed — ${reasonLabel(pending.reasonCode)}${pending.note ? ` (${pending.note})` : ''}`}
          </Text>
        ) : onServer ? (
          <Text style={{ color: okTone.text, fontWeight: '700' }}>Already recorded for this visit.</Text>
        ) : (
          <Text style={{ color: t.textSecondary }}>{cfg.required ? `Have ${clientName || 'the client'} sign before you clock out.` : `Ask ${clientName || 'the client'} to sign for this visit.`}</Text>
        )}
        <View style={styles.row}>
          <Button small label={pending?.signature ? 'Sign again' : 'Client signs'} icon="create" onPress={() => setSheet('sign')} />
          <Button small variant="secondary" label="Client could not sign" onPress={() => { setCode(null); setNote(''); setProblem(null); setSheet('reason') }} />
        </View>
      </Card>
      {cfg.required && !have ? <Banner tone="warning" icon="alert-circle">The agency needs the client&apos;s signature (or the reason) before you can clock out.</Banner> : null}

      <Modal visible={sheet !== null} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: t.surface }]}>
            <ScrollView keyboardShouldPersistTaps="handled" scrollEnabled={!drawing}>
              {sheet === 'sign' ? (
                <View>
                  <Text style={[styles.title, { color: t.text }]}>{clientName ? `${clientName} signs here` : 'Client signs here'}</Text>
                  <SignaturePad onDrawing={setDrawing} onSubmit={(uri) => keep({ signature: uri, savedAt: new Date().toISOString() })} />
                  <Button variant="secondary" label="Cancel" onPress={() => setSheet(null)} style={{ marginTop: 10 }} />
                </View>
              ) : (
                <View>
                  <Text style={[styles.title, { color: t.text }]}>Why could the client not sign?</Text>
                  {cfg.reasons.map((r) => (
                    <TouchableOpacity key={r.code} accessibilityRole="radio" accessibilityState={{ selected: code === r.code }} activeOpacity={0.8}
                      onPress={() => { setCode(r.code); setProblem(null) }}
                      style={[styles.chip, { borderColor: code === r.code ? t.primary : t.border, backgroundColor: code === r.code ? t.primaryLight : t.surface }]}>
                      <Text style={{ color: t.text, fontWeight: code === r.code ? '800' : '600' }}>{r.label}</Text>
                    </TouchableOpacity>
                  ))}
                  <Field label={code === 'other' ? 'Reason *' : 'Note (optional)'} value={note} onChangeText={(v) => { setNote(v); setProblem(null) }} multiline maxLength={500} error={problem} />
                  <View style={styles.row}>
                    <Button variant="secondary" label="Cancel" onPress={() => setSheet(null)} style={{ flex: 1 }} />
                    <Button label="Save" style={{ flex: 1 }} onPress={() => {
                      const p = reasonProblem(code, note)
                      if (p) { setProblem(p); return }
                      keep({ reasonCode: code!, note: note.trim() || undefined, savedAt: new Date().toISOString() })
                    }} />
                  </View>
                </View>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '90%' },
  title: { fontSize: 19, fontWeight: '800', marginBottom: 12 },
  chip: { borderWidth: 1.5, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center', marginBottom: 8 },
})
