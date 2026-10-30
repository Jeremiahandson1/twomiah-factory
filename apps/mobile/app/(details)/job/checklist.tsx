/**
 * Job checklist — the owner's checklist for this kind of job, filled in on the job and (when it asks) signed by the customer
 * on the spot.
 * Route: /(details)/job/checklist?id=<jobId>            — fill one in
 *        /(details)/job/checklist?id=<jobId>&sign=<id>  — the customer signs one that was filled in earlier
 *
 * Same routes as the desktop's checklists (server crm/field/checklistRoutes.ts): GET /api/checklists/job/:id, then
 * POST /api/checklists/job/:id/submit — jobs:update. Sent through the offline queue under the job's record key, so with no signal
 * it is kept on the phone ("Waiting to send"), goes after the job's earlier moves, and a refusal stays visible
 * ("Couldn't send — tap to fix") with the server's words. The send carries an id made here, so a send repeated after a lost
 * reply saves one copy. The customer's signature is drawn with the care app's pad, typed name and agreement to sign
 * electronically go with it; the server keeps the evidence.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { get } from '../../../src/api/client'
import { useAuth } from '../../../src/auth/AuthContext'
import { useToast } from '../../../src/components/ToastProvider'
import { useHaptics } from '../../../src/hooks/useHaptics'
import { useOfflineApi } from '../../../src/offline/useOfflineApi'
import { jobKey } from '../../../src/jobflow/flow'
import { SignaturePad } from '../../../src/care/components/SignaturePad'
import { Screen, Card, DText, Badge, Button, Chip, ChipRow, TextField, EmptyState, SkeletonRows, space } from '../../../src/design'

interface Q { id: string; label: string; type: 'pass_fail' | 'yes_no' | 'text'; required: boolean }
interface Tpl { id: string; name: string; description: string | null; fields: Q[]; requireSignature: boolean; requirePhoto: boolean }
const CHOICES: Record<string, Array<{ v: string; label: string }>> = {
  pass_fail: [{ v: 'pass', label: 'Pass' }, { v: 'fail', label: 'Fail' }, { v: 'attention', label: 'Needs attention' }],
  yes_no: [{ v: 'yes', label: 'Yes' }, { v: 'no', label: 'No' }],
}
/** An id the phone makes for one send (8–64 letters, digits, - or _): the server saves one copy however often it is sent. */
export const makeSendId = () => `ck_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

export default function JobChecklistScreen() {
  const { id, sign } = useLocalSearchParams<{ id: string; sign?: string }>()
  const router = useRouter()
  const toast = useToast()
  const haptics = useHaptics()
  const { can } = useAuth()
  const canWork = can('jobs:update')
  const { post } = useOfflineApi()
  const [view, setView] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState('')
  const [pick, setPick] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState('')
  const [signerName, setSignerName] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [signature, setSignature] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [problem, setProblem] = useState('')
  const [fieldProblems, setFieldProblems] = useState<Record<string, string>>({})
  // One id for this checklist's send, kept until it is sent: pressing Send twice, or a retry, is one checklist.
  const sendId = useMemo(makeSendId, [])

  const load = useCallback(async () => {
    const r = await get(`/api/checklists/job/${id}`)
    if (r.ok) {
      setView(r.data)
      setPick((cur) => cur || sign ? cur : (r.data.outstanding[0]?.templateId ?? r.data.templates[0]?.id ?? null))
    } else setFailed(r.error || 'The checklists could not be loaded.')
    setLoading(false)
  }, [id, sign])
  useEffect(() => { void load() }, [load])

  const signing = sign ? (view?.submissions || []).find((s: any) => s.id === sign) : null
  const tpl: Tpl | undefined = signing ? view?.templates?.find((t: Tpl) => t.id === signing.templateId) : view?.templates?.find((t: Tpl) => t.id === pick)
  const needSig = !!tpl?.requireSignature
  const signedOk = !needSig || (!!signature && !!signerName.trim() && agreed)

  const evidence = () => ({ signature, signedBy: signerName.trim(), consent: true })

  const send = async (withSignature: boolean) => {
    if (!tpl) return
    setSending(true); setProblem(''); setFieldProblems({})
    const label = `${tpl.name}${withSignature ? ' · signed' : ''}`
    const r = signing
      ? await post(`/api/checklists/submissions/${signing.id}/sign`, evidence(), { recordKey: jobKey(String(id)), label: `${tpl.name} · signature` })
      : await post(`/api/checklists/job/${id}/submit`, {
        id: sendId, templateId: tpl.id, overallNotes: notes || undefined,
        answers: tpl.fields.map((f) => ({ id: f.id, value: answers[f.id] ?? '' })),
        ...(withSignature ? { signature: evidence() } : {}),
      }, { recordKey: jobKey(String(id)), label })
    setSending(false)
    if (r.queued) { haptics.success(); toast.success('Saved on the phone — waiting to send'); router.back(); return }
    if (!r.ok) { haptics.error(); setProblem(r.error || 'That did not go through'); setFieldProblems((r.data as any)?.fields || {}); return }
    haptics.success(); toast.success(withSignature || signing ? 'Checklist signed' : 'Checklist sent'); router.back()
  }

  if (loading) return <Screen title="Checklist" onBack={() => router.back()}><SkeletonRows count={4} /></Screen>
  if (failed || !view) return <Screen title="Checklist" onBack={() => router.back()}><EmptyState icon="clipboard" title="No checklist" body={failed || 'This job has none.'} /></Screen>
  if (!tpl) return <Screen title="Checklist" onBack={() => router.back()}><EmptyState icon="clipboard" title="Nothing to fill in" body="The office has not set up a checklist for this kind of job." /></Screen>

  const owed = (view.outstanding || []).map((o: any) => o.templateId)
  const done = (view.submissions || []).filter((s: any) => s.templateId === tpl.id && (s.status === 'signed' || s.status === 'submitted'))

  return (
    <Screen title={tpl.name} subtitle={signing ? 'The customer signs' : tpl.description || undefined} onBack={() => router.back()}
      footer={canWork ? (
        <View style={{ gap: space[2] }}>
          {problem ? <DText variant="callout" tone="danger">{problem}</DText> : null}
          <Button size="lg" fullWidth label={signing ? 'Sign' : needSig ? 'Send, signed by the customer' : 'Send checklist'} icon="send" loading={sending} disabled={!signedOk} onPress={() => send(needSig)} />
          {needSig && !signing ? <Button variant="secondary" fullWidth label="Customer isn't here — send without signature" disabled={sending} onPress={() => send(false)} /> : null}
        </View>
      ) : undefined}>
      {!signing && (view.templates.length > 1) ? (
        <ChipRow>{view.templates.map((t: Tpl) => <Chip key={t.id} label={t.name} selected={t.id === tpl.id} count={owed.includes(t.id) ? 1 : undefined} onPress={() => setPick(t.id)} />)}</ChipRow>
      ) : null}
      {done.length && !signing ? <Badge label={`Done ${done.length} time${done.length === 1 ? '' : 's'} on this job`} tone="success" icon="checkmark-circle" /> : null}
      {tpl.requirePhoto && !signing ? <DText variant="callout" tone="textSecondary">This checklist needs a photo of the job first (Photos on the job screen).</DText> : null}

      {!signing ? tpl.fields.map((f) => (
        <Card key={f.id}>
          <View style={{ gap: space[2] }}>
            <DText variant="bodyStrong">{f.label}{f.required ? '' : ' (optional)'}</DText>
            {f.type === 'text'
              ? <TextField label="Your answer" value={answers[f.id] ?? ''} onChangeText={(v) => setAnswers((a) => ({ ...a, [f.id]: v }))} multiline error={fieldProblems[f.id]} />
              : <ChipRow>{CHOICES[f.type].map((c) => <Chip key={c.v} label={c.label} selected={answers[f.id] === c.v} onPress={() => setAnswers((a) => ({ ...a, [f.id]: c.v }))} />)}</ChipRow>}
            {fieldProblems[f.id] && f.type !== 'text' ? <DText variant="caption" tone="danger">{fieldProblems[f.id]}</DText> : null}
          </View>
        </Card>
      )) : (
        <Card><DText variant="body">{(signing.values?.items || []).map((i: any) => `${i.label}: ${i.value || '—'}`).join('\n')}</DText></Card>
      )}
      {!signing ? <TextField label="Notes for the office (optional)" value={notes} onChangeText={setNotes} multiline /> : null}

      {needSig ? (
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
            ) : <SignaturePad onSubmit={setSignature} />}
          </View>
        </Card>
      ) : null}
    </Screen>
  )
}
