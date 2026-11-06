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
 *
 * Kinds of question: pass / fail, yes / no, write-in, dropdown, multi-select, number, date, photo and signature, with headings
 * that group them. A photo question's pictures are taken here and kept as files on the phone; the queue uploads them just
 * before the checklist goes (src/offline/localPhotos.ts), so a checklist photographed with no signal still arrives whole.
 * The rules (what is answered, what is wrong, the request) are src/jobflow/checklistAnswers.ts, tested by tests/mobile.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Image, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { get } from '../../../src/api/client'
import { useAuth } from '../../../src/auth/AuthContext'
import { useToast } from '../../../src/components/ToastProvider'
import { useHaptics } from '../../../src/hooks/useHaptics'
import { useCamera } from '../../../src/hooks/useCamera'
import { useOfflineApi } from '../../../src/offline/useOfflineApi'
import { jobKey } from '../../../src/jobflow/flow'
import { answerLine, CHOICES, groupBySection, MAX_QUESTION_PHOTOS, problemsFor, submitRequest, type Draft, type Drafts, type Question } from '../../../src/jobflow/checklistAnswers'
import { SignaturePad } from '../../../src/care/components/SignaturePad'
import { DateTimeField } from '../../../src/care/components/DateTimeField'
import { Screen, Card, DText, Badge, Button, Chip, ChipRow, TextField, EmptyState, SkeletonRows, space } from '../../../src/design'

interface Tpl { id: string; name: string; description: string | null; fields: Question[]; requireSignature: boolean; requirePhoto: boolean }
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
  const { takePhoto, pickImage } = useCamera()
  const [view, setView] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState('')
  const [pick, setPick] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Drafts>({})
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

  const evidence = () => ({ signature: signature as string, signedBy: signerName.trim(), consent: true as const })
  const setDraft = (qid: string, patch: Partial<Draft>) => { setDrafts((d) => ({ ...d, [qid]: { ...d[qid], ...patch } })); setFieldProblems((p) => { if (!p[qid]) return p; const { [qid]: _gone, ...rest } = p; return rest }) }

  const addPhoto = async (q: Question, mode: 'camera' | 'gallery') => {
    const got = mode === 'camera' ? await takePhoto() : await pickImage()
    if (!got) return
    const have = drafts[q.id]?.photoUris ?? []
    if (have.length >= MAX_QUESTION_PHOTOS) { toast.error(`At most ${MAX_QUESTION_PHOTOS} photos on one question`); return }
    setDraft(q.id, { photoUris: [...have, got.uri] })
  }

  const send = async (withSignature: boolean) => {
    if (!tpl) return
    setProblem(''); setFieldProblems({})
    if (!signing) {
      // The same rule the server runs, before the send: no signal is no reason to find out later.
      const local = problemsFor(tpl.fields, drafts)
      if (Object.keys(local).length) {
        const first = tpl.fields.find((f) => local[f.id])
        haptics.error(); setFieldProblems(local); setProblem(`Answer “${first?.label}”${Object.keys(local).length > 1 ? ` and ${Object.keys(local).length - 1} more` : ''} first.`)
        return
      }
    }
    setSending(true)
    const label = `${tpl.name}${withSignature ? ' · signed' : ''}`
    const r = signing
      ? await post(`/api/checklists/submissions/${signing.id}/sign`, evidence(), { recordKey: jobKey(String(id)), label: `${tpl.name} · signature` })
      : await (() => {
        const req = submitRequest({ jobId: String(id), sendId, templateId: tpl.id, label, questions: tpl.fields, drafts, notes, recordKey: jobKey(String(id)), ...(withSignature ? { signature: evidence() } : {}) })
        return post(req.path, req.body, { recordKey: req.recordKey, label: req.label })
      })()
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

  /** The control for one question, by kind. */
  const control = (q: Question) => {
    const d = drafts[q.id] ?? {}
    const err = fieldProblems[q.id]
    switch (q.type) {
      case 'text':
        return <TextField label="Your answer" value={d.value ?? ''} onChangeText={(v) => setDraft(q.id, { value: v })} multiline error={err} />
      case 'number':
        return <TextField label="Number" value={d.value ?? ''} onChangeText={(v) => setDraft(q.id, { value: v })} keyboardType="decimal-pad" error={err} />
      case 'date':
        return <DateTimeField label="Date" mode="date" value={d.value ?? ''} onChange={(v) => setDraft(q.id, { value: v })} />
      case 'dropdown':
        return <ChipRow>{(q.options ?? []).map((o) => <Chip key={o} label={o} selected={d.value === o} onPress={() => setDraft(q.id, { value: d.value === o ? '' : o })} />)}</ChipRow>
      case 'multi_select': {
        const on = d.choices ?? []
        return <ChipRow>{(q.options ?? []).map((o) => <Chip key={o} label={o} selected={on.includes(o)} onPress={() => setDraft(q.id, { choices: on.includes(o) ? on.filter((x) => x !== o) : [...on, o] })} />)}</ChipRow>
      }
      case 'photo': {
        const uris = d.photoUris ?? []
        return (
          <View style={{ gap: space[2] }}>
            {uris.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
                {uris.map((u, i) => (
                  <View key={`${u}${i}`} style={{ gap: 4 }}>
                    <Image source={{ uri: u }} style={{ width: 72, height: 72, borderRadius: 8 }} accessibilityLabel={`Photo ${i + 1} for ${q.label}`} />
                    <Button variant="ghost" label="Remove" onPress={() => setDraft(q.id, { photoUris: uris.filter((_, k) => k !== i) })} />
                  </View>
                ))}
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', gap: space[2] }}>
              <Button variant="secondary" icon="camera" label={uris.length ? 'Another photo' : 'Take a photo'} disabled={uris.length >= MAX_QUESTION_PHOTOS} onPress={() => addPhoto(q, 'camera')} />
              <Button variant="secondary" icon="images" label="From the library" disabled={uris.length >= MAX_QUESTION_PHOTOS} onPress={() => addPhoto(q, 'gallery')} />
            </View>
          </View>
        )
      }
      case 'signature':
        return d.signature ? (
          <View style={{ gap: space[2] }}>
            <Badge label="Signature taken" tone="success" icon="checkmark-circle" />
            <Button variant="secondary" label="Sign again" onPress={() => setDraft(q.id, { signature: null })} />
          </View>
        ) : <SignaturePad onSubmit={(s) => setDraft(q.id, { signature: s })} />
      default:
        return <ChipRow>{(CHOICES[q.type] ?? []).map((c) => <Chip key={c.v} label={c.label} selected={d.value === c.v} onPress={() => setDraft(q.id, { value: c.v })} />)}</ChipRow>
    }
  }

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
        <ChipRow>{view.templates.map((t: Tpl) => <Chip key={t.id} label={t.name} selected={t.id === tpl.id} count={owed.includes(t.id) ? 1 : undefined} onPress={() => { setPick(t.id); setDrafts({}); setFieldProblems({}); setProblem('') }} />)}</ChipRow>
      ) : null}
      {done.length && !signing ? <Badge label={`Done ${done.length} time${done.length === 1 ? '' : 's'} on this job`} tone="success" icon="checkmark-circle" /> : null}
      {tpl.requirePhoto && !signing ? <DText variant="callout" tone="textSecondary">This checklist needs a photo of the job first (Photos on the job screen).</DText> : null}

      {!signing ? groupBySection(tpl.fields).map((g, gi) => (
        <View key={`${g.heading ?? ''}${gi}`} style={{ gap: space[2] }}>
          {g.heading ? <DText variant="headline">{g.heading}</DText> : null}
          {g.items.map((f) => (
            <Card key={f.id}>
              <View style={{ gap: space[2] }}>
                <DText variant="bodyStrong">{f.label}{f.required ? '' : ' (optional)'}</DText>
                {control(f)}
                {fieldProblems[f.id] && f.type !== 'text' && f.type !== 'number' ? <DText variant="caption" tone="danger">{fieldProblems[f.id]}</DText> : null}
              </View>
            </Card>
          ))}
        </View>
      )) : (
        <Card><DText variant="body">{(signing.values?.items || []).map((i: any) => answerLine(i)).join('\n')}</DText></Card>
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
