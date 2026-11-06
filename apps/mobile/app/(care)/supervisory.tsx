/**
 * Supervisory visits (row 24, care_supervisory_visits): the visits the office planned for ME — a nurse, a care manager, whoever it
 * named — soonest first. Open one: the client's address (with directions), Start, then the form — the standard questions and the
 * agency's own — and the signatures: mine, and the client's or why they could not sign (a phone visit needs none).
 *   GET  /api/supervisory-visits/mine                { visits, questions, requireSignatures }
 *   POST /api/supervisory-visits/visits/:id/start
 *   POST /api/supervisory-visits/visits/:id/complete { from: 'phone', …the form }
 * Finishing a visit needs signal and is never kept for later: the office reads it, and the cycle restarts from it.
 */
import React, { useCallback, useState } from 'react'
import { Text, StyleSheet, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { useTheme } from '../../src/theme/ThemeContext'
import { useToast } from '../../src/components/ToastProvider'
import { careGet, carePost } from '../../src/care/careApi'
import { CareScreen, fullAddress, openDirections } from '../../src/care/screen'
import { Banner, Button, Card, Choice, Field, SectionTitle } from '../../src/care/ui'
import { SignaturePad } from '../../src/care/components/SignaturePad'
import { formatYmdLong } from '../../src/care/time'
import { emptySupervisoryForm, supervisoryBody, supervisoryProblem, type SupervisoryForm, type SupervisoryQuestion } from '../../src/care/rules'

interface Visit {
  id: string; visitDate: string; plannedTime: string | null; visitType: string; startedAt: string | null
  clientFirstName: string; clientLastName: string; clientAddress: string | null; clientCity: string | null; caregiverName: string | null
}
interface Mine { visits: Visit[]; questions: SupervisoryQuestion[]; requireSignatures: boolean }

export default function SupervisoryScreen() {
  const t = useTheme()
  const toast = useToast()
  const [mine, setMine] = useState<Mine | null>(null)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState<Visit | null>(null)
  const [form, setForm] = useState<SupervisoryForm>(emptySupervisoryForm())
  const [signing, setSigning] = useState<null | 'supervisorSignature' | 'clientSignature'>(null)
  const [drawing, setDrawing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await careGet<Mine>('/api/supervisory-visits/mine')
    if (r.ok && r.data) { setMine(r.data); setFailed(false) } else setFailed(true)
  }, [])
  useFocusEffect(useCallback(() => { load() }, [load]))

  const start = async (v: Visit) => {
    setBusy(true); setProblem(null)
    const r = await carePost<Visit>(`/api/supervisory-visits/visits/${v.id}/start`)
    setBusy(false)
    if (!r.ok) { setProblem(r.status === 0 ? 'No signal — try again when you have a connection.' : r.error || 'That could not be started.'); return }
    setOpen({ ...v, startedAt: r.data?.startedAt ?? new Date().toISOString() }); setForm(emptySupervisoryForm())
  }
  const finish = async () => {
    if (!open || !mine) return
    const why = supervisoryProblem(form, mine.questions, mine.requireSignatures, open.visitType)
    if (why) { setProblem(why); return }
    setBusy(true); setProblem(null)
    const r = await carePost(`/api/supervisory-visits/visits/${open.id}/complete`, supervisoryBody(form, mine.questions))
    setBusy(false)
    if (!r.ok) { setProblem(r.status === 0 ? 'No signal — nothing was saved. Try again when you have a connection.' : r.error || 'That could not be saved. Try again.'); return }
    toast.success('Visit saved. The office has it.')
    setOpen(null); load()
  }
  const set = (patch: Partial<SupervisoryForm>) => setForm((f) => ({ ...f, ...patch }))
  const where = (v: Visit) => fullAddress({ address: v.clientAddress, city: v.clientCity })

  if (open && mine) {
    return (
      <CareScreen keyboard scrollEnabled={!drawing}>
        <Card>
          <Text style={[styles.title, { color: t.text }]}>{open.clientFirstName} {open.clientLastName}</Text>
          <Text style={[styles.meta, { color: t.textSecondary }]}>{open.visitType === 'phone' ? 'By phone' : where(open) || 'In the home'}{open.caregiverName ? ` · Caregiver: ${open.caregiverName}` : ''}</Text>
        </Card>
        {problem ? <Banner tone="danger" icon="alert-circle">{problem}</Banner> : null}
        <Field label="What did the client say?" multiline value={form.clientFeedback} onChangeText={(v) => set({ clientFeedback: v })} />
        <SectionTitle>Is the care plan being followed?</SectionTitle>
        <Choice label="Yes" selected={form.carePlanFollowed === true} onPress={() => set({ carePlanFollowed: true })} />
        <Choice label="No" selected={form.carePlanFollowed === false} onPress={() => set({ carePlanFollowed: false })} />
        <Choice label="Not sure / not checked" selected={form.carePlanFollowed === null} onPress={() => set({ carePlanFollowed: null })} />
        <View style={{ height: 12 }} />
        <Field label="How is the caregiver doing?" multiline value={form.caregiverFeedback} onChangeText={(v) => set({ caregiverFeedback: v })} />
        <Field label="Any concerns?" multiline value={form.concerns} onChangeText={(v) => set({ concerns: v })} />
        <Field label="What needs to happen next?" multiline value={form.followUpNotes} onChangeText={(v) => set({ followUpNotes: v })} />
        {mine.questions.map((q) => q.kind === 'yes_no' ? (
          <View key={q.id} style={{ marginBottom: 12 }}>
            <SectionTitle>{q.label}{q.required ? ' *' : ''}</SectionTitle>
            <Choice label="Yes" selected={form.answers[q.id] === true} onPress={() => set({ answers: { ...form.answers, [q.id]: true } })} />
            <Choice label="No" selected={form.answers[q.id] === false} onPress={() => set({ answers: { ...form.answers, [q.id]: false } })} />
          </View>
        ) : (
          <Field key={q.id} label={`${q.label}${q.required ? ' *' : ''}`} multiline value={String(form.answers[q.id] ?? '')} onChangeText={(v) => set({ answers: { ...form.answers, [q.id]: v } })} />
        ))}

        <SectionTitle>Signatures{mine.requireSignatures ? ' (required)' : ''}</SectionTitle>
        {signing ? (
          <Card>
            <Text style={[styles.meta, { color: t.text }]}>{signing === 'supervisorSignature' ? 'Your signature' : `${open.clientFirstName}'s signature`}</Text>
            <SignaturePad onDrawing={setDrawing} onSubmit={(uri) => { set({ [signing]: uri } as Partial<SupervisoryForm>); setSigning(null); setDrawing(false) }} />
            <Button small variant="secondary" label="Not now" onPress={() => { setSigning(null); setDrawing(false) }} style={{ marginTop: 8 }} />
          </Card>
        ) : (
          <View style={styles.row}>
            <Button small variant={form.supervisorSignature ? 'secondary' : 'primary'} icon={form.supervisorSignature ? 'checkmark' : 'create-outline'} label={form.supervisorSignature ? 'You signed' : 'Sign'} onPress={() => setSigning('supervisorSignature')} />
            {open.visitType !== 'phone' && <Button small variant={form.clientSignature ? 'secondary' : 'primary'} icon={form.clientSignature ? 'checkmark' : 'create-outline'} label={form.clientSignature ? 'Client signed' : 'Client signs'} disabled={!!form.clientSignReason.trim()} onPress={() => setSigning('clientSignature')} />}
          </View>
        )}
        {open.visitType !== 'phone' && !form.clientSignature && (
          <Field label="Or why the client could not sign" value={form.clientSignReason} onChangeText={(v) => set({ clientSignReason: v })} />
        )}
        <Button label="Save the visit" icon="checkmark-circle-outline" loading={busy} onPress={finish} style={{ marginTop: 8 }} />
        <Button variant="secondary" label="Back to my visits" disabled={busy} onPress={() => { setOpen(null); setProblem(null) }} style={{ marginTop: 8 }} />
      </CareScreen>
    )
  }

  return (
    <CareScreen onRefresh={load}>
      {failed && !mine && <Banner tone="warning" icon="cloud-offline-outline" onPress={load}>Your visits didn't load. Tap to try again.</Banner>}
      {problem ? <Banner tone="danger" icon="alert-circle">{problem}</Banner> : null}
      {mine && (mine.visits.length === 0
        ? <Text style={[styles.meta, { color: t.textSecondary }]}>No supervisory visits planned for you.</Text>
        : mine.visits.map((v) => (
          <Card key={v.id}>
            <Text style={[styles.title, { color: t.text }]}>{v.clientFirstName} {v.clientLastName}</Text>
            <Text style={[styles.meta, { color: t.text }]}>{formatYmdLong(v.visitDate)}{v.plannedTime ? ` at ${v.plannedTime}` : ''} · {v.visitType === 'phone' ? 'by phone' : 'in the home'}</Text>
            {v.visitType !== 'phone' && where(v) ? <Text style={[styles.meta, { color: t.textSecondary }]}>{where(v)}</Text> : null}
            <View style={styles.row}>
              <Button small label={v.startedAt ? 'Continue' : 'Start the visit'} icon="play-outline" loading={busy} onPress={() => start(v)} />
              {v.visitType !== 'phone' && where(v) ? <Button small variant="secondary" label="Directions" icon="navigate-outline" onPress={() => openDirections(where(v))} /> : null}
            </View>
          </Card>
        )))}
    </CareScreen>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 16, fontWeight: '700' },
  meta: { fontSize: 14, marginTop: 4, lineHeight: 19 },
  row: { flexDirection: 'row', gap: 10, marginTop: 10, flexWrap: 'wrap' },
})
