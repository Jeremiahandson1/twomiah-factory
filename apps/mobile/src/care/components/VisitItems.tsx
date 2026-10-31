/**
 * Inside a visit (care_visit_items): forms to fill in, interventions, goals, and tasks for every visit.
 *   GET  /api/visit-items/visit/:id                      the items and what is recorded
 *   PUT  /api/visit-items/visit/:id/:itemId              done / skipped / refused (a goal: how it went), through the offline queue
 *   POST /api/visit-items/visit/:id/:itemId/form         the filled-in form (with a signature when the form needs one), through the offline queue
 *   GET  /api/forms/templates/:id                        the form's fields
 * Saved on the phone with the time it was done when there is no signal. An agency without the feature answers 403/404: nothing shows.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { View, Text, StyleSheet, Modal, ScrollView, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native'
import { useTheme } from '../../theme/ThemeContext'
import { useToast } from '../../components/ToastProvider'
import { careGet, asList } from '../careApi'
import { useOfflineApi } from '../../offline/useOfflineApi'
import { isOfflineId } from '../offlinePunches'
import { formMissing, GOAL_RATINGS, openRequiredItems, reasonNeeded, type FormField } from '../rules'
import { clearOpen, reportOpen } from '../openRequired'
import { Banner, Button, Field, SectionTitle, useTone } from '../ui'
import { SignaturePad } from './SignaturePad'

interface Item { id: string; kind: 'form' | 'intervention' | 'goal' | 'general_task'; name: string; detail: string | null; formTemplateId: string | null; required: boolean; status: string | null; rating: string | null; note: string | null }
const HEAD: Record<string, string> = { form: 'Forms', intervention: 'Interventions', goal: 'Goals', general_task: 'Tasks for every visit' }
const STATE_LABEL: Record<string, string> = { done: 'Done', skipped: 'Skipped', refused: 'Refused' }

function FormSheet({ item, visitId, onClose, onSent }: { item: Item; visitId: string; onClose: () => void; onSent: () => void }) {
  const t = useTheme()
  const toast = useToast()
  const queue = useOfflineApi()
  const [fields, setFields] = useState<FormField[] | null>(null)
  const [needsSignature, setNeedsSignature] = useState(false)
  const [data, setData] = useState<Record<string, unknown>>({})
  const [missing, setMissing] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [drawing, setDrawing] = useState(false)

  useEffect(() => {
    careGet(`/api/forms/templates/${item.formTemplateId}`).then((r) => {
      if (!r.ok) { toast.error('The form did not load. Try again.'); onClose(); return }
      const tpl: any = r.data
      setFields(Array.isArray(tpl.fields) ? tpl.fields : [])
      setNeedsSignature(!!tpl.requiresSignature)
    })
  }, [item.formTemplateId]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (signature?: string) => {
    const miss = formMissing(fields || [], data)
    if (miss.length) { setMissing(miss); toast.warning(`Please answer: ${miss.join(' · ')}`); return }
    setBusy(true)
    const r = await queue.post(`/api/visit-items/visit/${visitId}/${item.id}/form`, { data, ...(signature ? { signature } : {}), savedAt: new Date().toISOString() },
      { recordKey: `visit:${visitId}`, label: `${item.name} · form` })
    setBusy(false)
    if (!r.ok) { toast.error(r.error || 'Could not save the form.'); return }
    if (r.queued) toast.info('Saved on your phone. It will be sent when you have signal.')
    onSent(); onClose()
  }
  const set = (id: string, v: unknown) => { setData((d) => ({ ...d, [id]: v })); setMissing([]) }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: t.surface }]}>
          <ScrollView keyboardShouldPersistTaps="handled" scrollEnabled={!drawing}>
            <Text style={[styles.title, { color: t.text }]}>{item.name}</Text>
            {fields === null ? <Text style={{ color: t.textSecondary }}>Loading…</Text> : fields.map((f) => {
              const bad = missing.includes(f.label || f.id)
              if (f.type === 'section') return <Text key={f.id} style={[styles.section, { color: t.text }]}>{f.label}</Text>
              if (f.type === 'select' || f.type === 'radio' || (f.type === 'checkbox' && f.options?.length)) {
                const multi = f.type === 'checkbox'
                const chosen = (v: string) => multi ? Array.isArray(data[f.id]) && (data[f.id] as string[]).includes(v) : data[f.id] === v
                return (
                  <View key={f.id} style={{ marginBottom: 14 }}>
                    <Text style={[styles.label, { color: t.text }]}>{f.label}{f.required ? ' *' : ''}</Text>
                    <View style={styles.row}>
                      {(f.options || []).map((o) => (
                        <TouchableOpacity key={o} accessibilityRole={multi ? 'checkbox' : 'radio'} accessibilityState={{ selected: chosen(o) }} activeOpacity={0.8}
                          onPress={() => set(f.id, multi ? (chosen(o) ? (data[f.id] as string[]).filter((x) => x !== o) : [...((data[f.id] as string[]) || []), o]) : o)}
                          style={[styles.chip, { borderColor: chosen(o) ? t.primary : t.border, backgroundColor: chosen(o) ? t.primaryLight : t.surface }]}>
                          <Text style={{ color: t.text, fontWeight: chosen(o) ? '800' : '600' }}>{o}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    {bad ? <Text style={styles.err}>This question needs an answer.</Text> : null}
                  </View>
                )
              }
              if (f.type === 'checkbox') {
                const on = !!data[f.id]
                return (
                  <TouchableOpacity key={f.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => set(f.id, !on)} style={[styles.chip, { marginBottom: 14, borderColor: on ? t.primary : t.border, backgroundColor: on ? t.primaryLight : t.surface }]}>
                    <Text style={{ color: t.text, fontWeight: on ? '800' : '600' }}>{on ? '☑' : '☐'} {f.label}{f.required ? ' *' : ''}</Text>
                  </TouchableOpacity>
                )
              }
              return (
                <Field key={f.id} label={`${f.label || f.id}${f.required ? ' *' : ''}`} value={String(data[f.id] ?? '')} onChangeText={(v) => set(f.id, v)}
                  multiline={f.type === 'textarea'} keyboardType={f.type === 'number' ? 'numeric' : 'default'} placeholder={f.type === 'date' ? 'YYYY-MM-DD' : undefined}
                  error={bad ? 'This question needs an answer.' : null} />
              )
            })}
            {fields && needsSignature ? (
              <View>
                <Text style={[styles.label, { color: t.text }]}>Signature *</Text>
                <SignaturePad submitting={busy} onDrawing={setDrawing} onSubmit={(uri) => send(uri)} />
              </View>
            ) : null}
            <View style={styles.actions}>
              <Button variant="secondary" label="Cancel" onPress={onClose} style={{ flex: 1 }} />
              {!needsSignature && fields ? <Button label={busy ? 'Saving…' : 'Save form'} loading={busy} onPress={() => send()} style={{ flex: 1 }} /> : null}
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

function ItemRow({ item, onRecord, onForm }: { item: Item; onRecord: (status: 'done' | 'skipped' | 'refused', extra?: { note?: string; rating?: string }) => Promise<void>; onForm: () => void }) {
  const t = useTheme()
  const tone = useTone(item.status === 'done' ? 'success' : item.status ? 'warning' : 'neutral')
  const [ask, setAsk] = useState<null | 'skipped' | 'refused' | 'rating'>(null)
  const [note, setNote] = useState(item.note || '')
  const settled = !!item.status
  const rating = GOAL_RATINGS.find((r) => r.value === item.rating)?.label
  return (
    <View style={[styles.item, { borderColor: tone.border, backgroundColor: settled ? tone.bg : t.surface }]}>
      <Text style={[styles.name, { color: settled ? tone.text : t.text }]}>{item.name}{item.required ? '  · Required' : ''}</Text>
      {item.detail ? <Text style={[styles.detail, { color: settled ? tone.text : t.textSecondary }]}>{item.detail}</Text> : null}
      {settled ? <Text style={[styles.detail, { color: tone.text, fontWeight: '700' }]}>{STATE_LABEL[item.status!]}{rating ? ` · ${rating}` : ''}{item.note ? ` · ${item.note}` : ''}</Text> : null}
      {ask ? (
        <View style={{ marginTop: 8 }}>
          {ask === 'rating' ? (
            <View style={styles.row}>
              {GOAL_RATINGS.map((r) => <Button key={r.value} small variant="secondary" label={r.label} onPress={async () => { await onRecord('done', { rating: r.value, note }); setAsk(null) }} />)}
            </View>
          ) : null}
          <Field label={ask === 'rating' ? 'Note (optional)' : ask === 'refused' ? 'Why did the client refuse? (required)' : item.required ? 'Why are you skipping it? (required)' : 'Reason (optional)'} value={note} onChangeText={setNote} multiline />
          {ask !== 'rating' ? <Button small label={ask === 'refused' ? 'Mark refused' : 'Mark skipped'} disabled={reasonNeeded(ask, item.required) && !note.trim()} onPress={async () => { await onRecord(ask, { note }); setAsk(null) }} /> : null}
          <Button small variant="ghost" label="Cancel" onPress={() => setAsk(null)} />
        </View>
      ) : (
        <View style={styles.row}>
          {item.kind === 'form'
            ? <Button small variant="success" label={item.status === 'done' ? 'Fill in again' : 'Fill in'} icon="document-text-outline" onPress={onForm} />
            : item.kind === 'goal'
              ? <Button small variant="success" label="How did it go?" icon="checkmark" onPress={() => setAsk('rating')} />
              : <Button small variant="success" label="Done" icon="checkmark" onPress={() => onRecord('done')} />}
          {item.status !== 'skipped' ? <Button small variant="secondary" label="Skip" onPress={() => (item.required ? setAsk('skipped') : onRecord('skipped'))} /> : null}
          {item.status !== 'refused' ? <Button small variant="secondary" label="Refused" onPress={() => setAsk('refused')} /> : null}
        </View>
      )}
    </View>
  )
}

export function VisitItems({ timeEntryId }: { timeEntryId: string }) {
  const toast = useToast()
  const queue = useOfflineApi()
  const [items, setItems] = useState<Item[] | null>(null)
  const [form, setForm] = useState<Item | null>(null)
  const offline = isOfflineId(timeEntryId)

  const load = useCallback(async () => {
    if (offline) return
    const r = await careGet(`/api/visit-items/visit/${timeEntryId}`)
    setItems(r.ok ? (asList(r.data) as Item[]) : null) // 403/404: the agency has not got this switched on
  }, [timeEntryId, offline])
  useEffect(() => { load() }, [load])
  // What the Clock out button waits for: required items with nothing recorded.
  useEffect(() => {
    if (items) reportOpen('items', openRequiredItems(items))
    return () => clearOpen('items')
  }, [items])

  const record = async (item: Item, status: 'done' | 'skipped' | 'refused', extra?: { note?: string; rating?: string }) => {
    const r = await queue.put(`/api/visit-items/visit/${timeEntryId}/${item.id}`, { status, note: extra?.note || null, rating: extra?.rating, savedAt: new Date().toISOString() },
      { recordKey: `visit:${timeEntryId}`, label: `${item.name} · ${status}` })
    if (!r.ok) { toast.error(r.error || 'Could not save that.'); return }
    setItems((prev) => (prev || []).map((x) => (x.id === item.id ? { ...x, status, note: extra?.note || null, rating: extra?.rating ?? null } : x)))
    if (r.queued) toast.info('Saved on your phone. It will be sent when you have signal.')
  }

  if (offline || !items || !items.length) return null
  return (
    <View>
      {(['form', 'intervention', 'goal', 'general_task'] as const).map((k) => {
        const list = items.filter((i) => i.kind === k)
        if (!list.length) return null
        return (
          <View key={k}>
            <SectionTitle>{HEAD[k]}</SectionTitle>
            {list.map((i) => <ItemRow key={i.id} item={i} onRecord={(s, e) => record(i, s, e)} onForm={() => setForm(i)} />)}
          </View>
        )
      })}
      {form ? <FormSheet item={form} visitId={timeEntryId} onClose={() => setForm(null)} onSent={() => setItems((prev) => (prev || []).map((x) => (x.id === form.id ? { ...x, status: 'done' } : x)))} /> : null}
      {items.some((i) => i.required && !i.status) ? <Banner tone="warning" icon="alert-circle">Finish the items marked Required before you clock out.</Banner> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  item: { borderWidth: 1.5, borderRadius: 12, padding: 12, marginBottom: 8 },
  name: { fontSize: 15, fontWeight: '700' },
  detail: { fontSize: 13, marginTop: 3, lineHeight: 18 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '90%' },
  title: { fontSize: 19, fontWeight: '800', marginBottom: 12 },
  section: { fontSize: 16, fontWeight: '800', marginTop: 8, marginBottom: 8 },
  label: { fontSize: 15, fontWeight: '700', marginBottom: 6 },
  chip: { borderWidth: 1.5, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center' },
  err: { fontSize: 13, marginTop: 6, color: '#b91c1c' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
})
