/**
 * An inspection's checklist on the phone (feature Inspections on the Phone): answer each line Pass / Fail / Not applicable with a
 * note, add photos, and have the customer sign what was answered (feature Inspection Sign-off).
 * Route: /(details)/inspection/<inspectionId>?job=<jobId>
 *
 * Same server as the office screen (rules and routes: src/inspections/rules.ts). Answers and the signature go through the offline queue
 * under the job's record key, so with no signal they are kept on the phone ("Waiting to send"), go after the job's earlier moves, and a
 * refusal stays visible with the server's words. A line marked Fail needs a few words on what is wrong; the server puts it on the
 * project's punch list by itself. Photos are sent straight away (photos are not queued yet). Once signed the lines are final.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { get, upload } from '../../../src/api/client'
import { useAuth } from '../../../src/auth/AuthContext'
import { useVertical } from '../../../src/vertical/VerticalContext'
import { useToast } from '../../../src/components/ToastProvider'
import { useHaptics } from '../../../src/hooks/useHaptics'
import { useCamera } from '../../../src/hooks/useCamera'
import { useOfflineApi } from '../../../src/offline/useOfflineApi'
import { SignaturePad } from '../../../src/care/components/SignaturePad'
import { Screen, Card, DText, Badge, Button, Chip, ChipRow, TextField, EmptyState, SkeletonRows, space } from '../../../src/design'
import { ANSWERS, answerRequest, mayAnswer, progress, readyToSign, recordKeyFor, showsInspections, showsSignature, signRequest, standing, type Line, type Result } from '../../../src/inspections/rules'

export default function InspectionScreen() {
  const { id, job } = useLocalSearchParams<{ id: string; job?: string }>()
  const router = useRouter()
  const toast = useToast()
  const haptics = useHaptics()
  const { can } = useAuth()
  const { hasFeature } = useVertical()
  const { put, post } = useOfflineApi()
  const { takePhoto } = useCamera()
  const [visit, setVisit] = useState<any>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState('')
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [waiting, setWaiting] = useState<Record<string, boolean>>({})
  const [problem, setProblem] = useState('')
  const [lineProblem, setLineProblem] = useState<Record<string, string>>({})
  const [signerName, setSignerName] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [signature, setSignature] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [drawing, setDrawing] = useState(false)

  const open = showsInspections(hasFeature, can)
  const canAnswer = mayAnswer(can)
  const key = recordKeyFor(String(job || id))

  const load = useCallback(async () => {
    const r = await get(`/api/inspection-checklists/${id}`)
    if (r.ok) {
      setVisit(r.data)
      const rows: Line[] = r.data.items || []
      setLines(rows)
      setNotes(Object.fromEntries(rows.map((l) => [l.id, l.note || ''])))
    } else setFailed(r.error || 'This inspection could not be loaded.')
    setLoading(false)
  }, [id])
  useEffect(() => { if (open) void load(); else setLoading(false) }, [open, load])

  if (!open) return <Screen title="Inspection" onBack={() => router.back()}><EmptyState icon="search" title="Not available" body="Inspections on the phone are not switched on for this business." /></Screen>
  if (loading) return <Screen title="Inspection" onBack={() => router.back()}><SkeletonRows count={4} /></Screen>
  if (failed || !visit) return <Screen title="Inspection" onBack={() => router.back()}><EmptyState icon="search" title="No inspection" body={failed || 'This inspection is not there.'} /></Screen>

  const signed = !!visit.signedAt
  const resulted = !['scheduled', 'in_progress', 'rescheduled'].includes(visit.status)
  const editable = canAnswer && !signed && !resulted
  const done = progress(lines)
  const mayShowSignature = showsSignature(hasFeature, can) && !signed && !resulted

  const answer = async (line: Line, result: Exclude<Result, 'pending'>) => {
    const req = answerRequest(String(id), line, result, notes[line.id])
    if ('problem' in req) { haptics.error(); setLineProblem((p) => ({ ...p, [line.id]: req.problem })); return }
    setLineProblem((p) => ({ ...p, [line.id]: '' }))
    const r = await put(req.path, req.body, { recordKey: key, label: `${visit.type || 'Inspection'} · ${line.label}` })
    if (r.queued) {
      haptics.success()
      setLines((all) => all.map((l) => (l.id === line.id ? { ...l, result, note: req.body.note } : l)))
      setWaiting((w) => ({ ...w, [line.id]: true }))
      return
    }
    if (!r.ok) { haptics.error(); setLineProblem((p) => ({ ...p, [line.id]: r.error || 'That did not go through' })); return }
    haptics.success()
    setWaiting((w) => ({ ...w, [line.id]: false }))
    setLines((all) => all.map((l) => (l.id === line.id ? { ...l, result, note: req.body.note } : l)))
    if (r.data?.punchItem?.number) toast.success(`Failed — ${r.data.punchItem.number} was added to the punch list`)
  }

  const addPhoto = async () => {
    const shot = await takePhoto()
    if (!shot) return
    const fd = new FormData()
    fd.append('photo', { uri: shot.uri, type: 'image/jpeg', name: `inspection_${Date.now()}.jpg` } as any)
    const r = await upload(`/api/inspection-checklists/${id}/photos`, fd).catch(() => null)
    if (r?.ok) { haptics.success(); toast.success('Photo added'); void load() }
    else { haptics.error(); toast.error(r?.error || 'The photo could not be sent. Try again with a signal.') }
  }

  const sign = async () => {
    const req = signRequest(String(id), { signature, signedBy: signerName, consent: agreed })
    if ('problem' in req) { setProblem(req.problem); return }
    setSending(true); setProblem('')
    const r = await post(req.path, req.body, { recordKey: key, label: `${visit.type || 'Inspection'} · customer signature` })
    setSending(false)
    if (r.queued) { haptics.success(); toast.success('Saved on the phone — waiting to send'); router.back(); return }
    if (!r.ok) { haptics.error(); setProblem(r.error || 'That did not go through'); return }
    haptics.success(); toast.success('Signed'); void load()
  }

  return (
    <Screen title={`${visit.type || 'Inspection'}${visit.number ? ` · ${visit.number}` : ''}`} subtitle={standing(lines, signed)} onBack={() => router.back()} scrollEnabled={!drawing}>
      {signed ? <Badge label={`Signed by ${visit.signedBy}`} tone="success" icon="checkmark-circle" /> : null}
      {resulted && !signed ? <Badge label={visit.status === 'passed' ? 'Passed' : visit.status === 'failed' ? 'Failed' : visit.status} tone={visit.status === 'failed' ? 'danger' : 'success'} /> : null}
      {!lines.length ? <EmptyState icon="clipboard" title="No checklist yet" body="The office has not put a checklist on this inspection." /> : null}
      {done.failed ? <DText variant="callout" tone="danger">{done.failed} {done.failed === 1 ? 'line' : 'lines'} failed.</DText> : null}

      {lines.map((l) => (
        <Card key={l.id}>
          <View style={{ gap: space[2] }}>
            <DText variant="bodyStrong">{l.label}</DText>
            <ChipRow>
              {ANSWERS.map((a) => <Chip key={a.result} label={a.label} selected={l.result === a.result} onPress={editable ? () => { void answer(l, a.result) } : undefined} />)}
            </ChipRow>
            {editable ? <TextField label="Note (needed for a fail)" value={notes[l.id] ?? ''} onChangeText={(v) => setNotes((n) => ({ ...n, [l.id]: v }))} multiline /> : (l.note ? <DText variant="callout" tone="textSecondary">{l.note}</DText> : null)}
            {waiting[l.id] ? <Badge label="Waiting to send" tone="warning" icon="time" /> : null}
            {lineProblem[l.id] ? <DText variant="caption" tone="danger">{lineProblem[l.id]}</DText> : null}
          </View>
        </Card>
      ))}

      {canAnswer && !signed && !resulted ? (
        <Card>
          <View style={{ gap: space[2] }}>
            <DText variant="headline">Photos</DText>
            <DText variant="callout" tone="textSecondary">{(visit.photos || []).length} on this inspection</DText>
            <Button variant="secondary" icon="camera" label="Take a photo" onPress={() => { void addPhoto() }} />
          </View>
        </Card>
      ) : null}

      {mayShowSignature && readyToSign(lines) ? (
        <Card>
          <View style={{ gap: space[3] }}>
            <DText variant="headline">Customer signs</DText>
            <TextField label="Their full name" value={signerName} onChangeText={setSignerName} required />
            <Chip label="They agree to sign electronically" selected={agreed} onPress={() => setAgreed((v) => !v)} />
            {signature ? (
              <View style={{ gap: space[2] }}>
                <Badge label="Signature taken" tone="success" icon="checkmark-circle" />
                <Button variant="secondary" label="Sign again" onPress={() => setSignature(null)} />
              </View>
            ) : <SignaturePad onSubmit={setSignature} onDrawing={setDrawing} />}
            {problem ? <DText variant="callout" tone="danger">{problem}</DText> : null}
            <Button size="lg" fullWidth label="Send, signed by the customer" icon="send" loading={sending} onPress={() => { void sign() }} />
          </View>
        </Card>
      ) : null}
    </Screen>
  )
}
