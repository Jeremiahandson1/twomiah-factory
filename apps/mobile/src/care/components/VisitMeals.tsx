/**
 * What the client ate on this visit (care_family_content): the caregiver records breakfast, lunch, dinner or a snack — what was served and
 * how much was eaten. The family sees it in their portal. Sent now when the phone has signal, kept and sent later when it has not.
 *   GET /api/visit-meals/options → { meals, amounts }, GET /api/visit-meals/visit/:id → { meals }, PUT /api/visit-meals/visit/:id/:meal
 * An agency without the feature answers 403/404 and nothing is shown. A visit clocked in offline has not reached the office yet, so its
 * meals wait until it has.
 */
import React, { useEffect, useState } from 'react'
import { View, Text, StyleSheet, Modal, ScrollView, KeyboardAvoidingView, Platform } from 'react-native'
import { useTheme } from '../../theme/ThemeContext'
import { useToast } from '../../components/ToastProvider'
import { careGet } from '../careApi'
import { useOfflineApi } from '../../offline/useOfflineApi'
import { isOfflineId } from '../offlinePunches'
import { mealBody, mealProblem, type MealOption, type MealRecord } from '../rules'
import { Banner, Button, Card, Choice, Field, SectionTitle } from '../ui'

interface Options { meals: MealOption[]; amounts: MealOption[]; }

export function VisitMeals({ visitId }: { visitId: string }) {
  const t = useTheme()
  const toast = useToast()
  const queue = useOfflineApi()
  const offline = isOfflineId(visitId)
  const [opts, setOpts] = useState<Options | null>(null)
  const [meals, setMeals] = useState<MealRecord[]>([])
  const [open, setOpen] = useState(false)
  const [meal, setMeal] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      const r = await careGet<Options>('/api/visit-meals/options')
      if (live && r.ok && r.data && Array.isArray((r.data as any).meals)) setOpts(r.data)
    })()
    return () => { live = false }
  }, [])
  useEffect(() => {
    if (!opts || offline) return
    careGet<{ meals: MealRecord[] }>(`/api/visit-meals/visit/${visitId}`).then((r) => { if (r.ok && r.data) setMeals(r.data.meals || []) })
  }, [opts, visitId, offline])

  if (!opts) return null
  const label = (list: MealOption[], code?: string | null) => list.find((o) => o.code === code)?.label || code || ''

  const start = (code?: string) => {
    const kept = meals.find((m) => m.meal === code)
    setMeal(code ?? null); setDescription(kept?.description || ''); setAmount(kept?.amountEaten || null); setNote(kept?.note || ''); setProblem(null); setOpen(true)
  }
  const save = async () => {
    const p = mealProblem(meal, description, amount)
    if (p) { setProblem(p); return }
    const body = mealBody({ description, amountEaten: amount!, note }, new Date().toISOString())
    const rec: MealRecord = { meal: meal!, description: body.description, amountEaten: amount!, note: body.note ?? null }
    const r = await queue.put(`/api/visit-meals/visit/${visitId}/${meal}`, body, { recordKey: `meal:${visitId}:${meal}`, label: `${label(opts.meals, meal)} record` })
    if (!r.ok) { setProblem(r.error || 'That could not be saved. Check it and try again.'); return }
    if (r.queued) toast.info('Saved on your phone. It will be sent when you have signal.')
    setMeals((cur) => [...cur.filter((m) => m.meal !== meal), rec])
    setOpen(false)
  }

  return (
    <View>
      <SectionTitle>Meals</SectionTitle>
      <Card>
        {offline ? (
          <Banner tone="info" icon="information-circle">You clocked in without signal. Meals can be recorded once this visit has reached the office.</Banner>
        ) : (
          <>
            {meals.length === 0 ? <Text style={{ color: t.textSecondary }}>No meal recorded yet. The family sees what you record.</Text> : meals.map((m) => (
              <Text key={m.meal} style={{ color: t.text, marginBottom: 4 }}>
                {label(opts.meals, m.meal)}: {m.description} — {label(opts.amounts, m.amountEaten)}
              </Text>
            ))}
            <View style={styles.row}>
              <Button small label="Record a meal" icon="restaurant" onPress={() => start()} />
              {meals.length > 0 ? <Button small variant="secondary" label="Change last" onPress={() => start(meals[meals.length - 1].meal)} /> : null}
            </View>
          </>
        )}
      </Card>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: t.surface }]}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={[styles.title, { color: t.text }]}>Record a meal</Text>
              {opts.meals.map((o) => <Choice key={o.code} label={o.label} selected={meal === o.code} onPress={() => { setMeal(o.code); setProblem(null) }} />)}
              <Field label="What was served *" value={description} onChangeText={(v) => { setDescription(v); setProblem(null) }} maxLength={300} />
              <Text style={[styles.sub, { color: t.textSecondary }]}>How much was eaten *</Text>
              {opts.amounts.map((o) => <Choice key={o.code} label={o.label} selected={amount === o.code} onPress={() => { setAmount(o.code); setProblem(null) }} />)}
              <Field label="Note (optional)" value={note} onChangeText={setNote} multiline maxLength={500} />
              {problem ? <Banner tone="danger" icon="alert-circle">{problem}</Banner> : null}
              <View style={styles.row}>
                <Button variant="secondary" label="Cancel" onPress={() => setOpen(false)} style={{ flex: 1 }} />
                <Button label="Save" onPress={save} style={{ flex: 1 }} />
              </View>
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
  sub: { fontSize: 13, fontWeight: '700', marginTop: 8, marginBottom: 6 },
})
