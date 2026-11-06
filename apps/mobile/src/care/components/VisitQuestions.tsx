/**
 * The agency's clock-in / clock-out questions (care_visit_questions): yes/no, one pick, or a short answer.
 * GET /api/visit-questions/active?phase=… — the list is kept on the phone, so a caregiver with no signal at the door is still
 * asked the questions they were last given (their punch is then saved on the phone with the answers).
 * Agency without the feature: the server answers 403/404 and nothing is shown.
 */
import React, { useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useTheme } from '../../theme/ThemeContext'
import { careGet } from '../careApi'
import { Field, SectionTitle, useTone } from '../ui'
import type { VisitAnswers, VisitQuestion } from '../rules'

const KEY = (phase: string) => `twomiah_care_visit_questions_${phase}_v1`

/** The questions for this moment: fresh from the server when it answers, else the last list kept on the phone. */
export function useVisitQuestions(phase: 'clock_in' | 'clock_out'): VisitQuestion[] {
  const [list, setList] = useState<VisitQuestion[]>([])
  useEffect(() => {
    let live = true
    ;(async () => {
      const r = await careGet<{ data?: VisitQuestion[] }>(`/api/visit-questions/active?phase=${phase}`)
      if (!live) return
      if (r.ok && Array.isArray(r.data?.data)) {
        setList(r.data.data!)
        AsyncStorage.setItem(KEY(phase), JSON.stringify(r.data.data)).catch(() => {})
      } else if (r.status === 0 || r.status >= 500) {
        // No signal: the questions kept from last time. (A 403/404 means the agency has switched them off: nothing to show.)
        try { const kept = JSON.parse((await AsyncStorage.getItem(KEY(phase))) || '[]'); if (live && Array.isArray(kept)) setList(kept) } catch { /* none kept */ }
      } else if (r.status === 403 || r.status === 404) {
        AsyncStorage.removeItem(KEY(phase)).catch(() => {})
      }
    })()
    return () => { live = false }
  }, [phase])
  return list
}

export function VisitQuestionFields({ questions, answers, onChange, title, missing }: {
  questions: VisitQuestion[]; answers: VisitAnswers; onChange: (next: VisitAnswers) => void; title: string; missing?: string[]
}) {
  const t = useTheme()
  const danger = useTone('danger')
  if (!questions.length) return null
  const set = (id: string, v: string) => onChange({ ...answers, [id]: v })
  return (
    <View>
      <SectionTitle>{title}</SectionTitle>
      {questions.map((q) => {
        const need = missing?.includes(q.id)
        const choices = q.kind === 'yes_no' ? [['yes', 'Yes'], ['no', 'No']] : (q.options || []).map((o) => [o, o])
        return (
          <View key={q.id} style={{ marginBottom: 14 }}>
            {q.kind === 'text' ? (
              <Field label={`${q.prompt}${q.required ? ' *' : ''}`} value={answers[q.id] || ''} onChangeText={(v) => set(q.id, v)} multiline maxLength={1000}
                error={need ? 'This question needs an answer.' : null} />
            ) : (
              <>
                <Text style={[styles.prompt, { color: t.text }]}>{q.prompt}{q.required ? ' *' : ''}</Text>
                <View style={styles.row}>
                  {choices.map(([value, label]) => {
                    const on = (answers[q.id] || '').toLowerCase() === value.toLowerCase()
                    return (
                      <TouchableOpacity key={value} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => set(q.id, on && !q.required ? '' : value)} activeOpacity={0.8}
                        style={[styles.chip, { borderColor: on ? t.primary : t.border, backgroundColor: on ? t.primaryLight : t.surface }]}>
                        <Text style={{ color: t.text, fontWeight: on ? '800' : '600', fontSize: 15 }}>{label}</Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>
                {need ? <Text style={[styles.err, { color: danger.text }]}>This question needs an answer.</Text> : null}
              </>
            )}
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  prompt: { fontSize: 15, fontWeight: '700', marginBottom: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1.5, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, minHeight: 44, justifyContent: 'center' },
  err: { fontSize: 13, marginTop: 6 },
})
