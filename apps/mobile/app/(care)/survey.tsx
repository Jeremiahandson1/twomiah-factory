/**
 * How is it going? (care_caregiver_surveys): the surveys the agency asked this caregiver — after a first visit with a client, so many
 * days in, or at a regular check-in — answered here, one at a time. Sending needs signal (an answer is read by the office at once and a
 * low score raises an alert, so it is never kept for later); the questions themselves come from the agency.
 *   GET  /api/caregiver-surveys/me                     { pending: [{ id, surveyName, reason, dueOn, questions }], answered: [...] }
 *   POST /api/caregiver-surveys/me/:id/answer          { <questionId>: 1–5 | true/false | text }
 */
import React, { useCallback, useState } from 'react'
import { Text, StyleSheet, View, TouchableOpacity } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { useTheme } from '../../src/theme/ThemeContext'
import { useToast } from '../../src/components/ToastProvider'
import { careGet, carePost } from '../../src/care/careApi'
import { CareScreen } from '../../src/care/screen'
import { Banner, Button, Card, Choice, Field, SectionTitle } from '../../src/care/ui'
import { formatYmdShort } from '../../src/care/time'
import { SCALE_WORDS, surveyBody, surveyProblem, type SurveyAnswers, type SurveyQuestion } from '../../src/care/rules'

interface Pending { id: string; surveyName: string; reason: string; dueOn: string; questions: SurveyQuestion[] }

export default function SurveyScreen() {
  const t = useTheme()
  const toast = useToast()
  const [pending, setPending] = useState<Pending[]>([])
  const [answered, setAnswered] = useState<any[]>([])
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [answers, setAnswers] = useState<Record<string, SurveyAnswers>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await careGet<any>('/api/caregiver-surveys/me')
    if (r.ok && r.data) { setPending(r.data.pending ?? []); setAnswered(r.data.answered ?? []); setFailed(false) } else setFailed(true)
    setLoaded(true)
  }, [])
  useFocusEffect(useCallback(() => { load() }, [load]))

  const set = (reqId: string, qId: string, v: number | boolean | string) => setAnswers({ ...answers, [reqId]: { ...(answers[reqId] ?? {}), [qId]: v } })
  const send = async (p: Pending) => {
    const a = answers[p.id] ?? {}
    const bad = surveyProblem(p.questions, a)
    if (bad) { setProblem(bad); return }
    setProblem(null); setBusy(p.id)
    const r = await carePost(`/api/caregiver-surveys/me/${p.id}/answer`, surveyBody(p.questions, a))
    setBusy(null)
    if (!r.ok) { setProblem(r.status === 0 ? 'No signal — try again when you have a connection.' : r.error || 'That could not be sent. Try again.'); return }
    toast.success('Thank you — sent to the office.')
    load()
  }

  return (
    <CareScreen refreshing={!loaded} onRefresh={load} keyboard>
      <Text style={[styles.title, { color: t.text }]}>How is it going?</Text>
      <Text style={[styles.sub, { color: t.textSecondary }]}>Your agency asks a few questions now and then. Your answers go to the office.</Text>
      {failed && <Banner tone="warning" icon="cloud-offline-outline" title="Could not load">Pull down to try again.</Banner>}
      {problem && <Banner tone="danger" icon="alert-circle-outline" title="Not sent yet">{problem}</Banner>}
      {loaded && !failed && pending.length === 0 && <Banner tone="success" icon="checkmark-circle-outline" title="Nothing waiting">You have answered every survey your agency asked.</Banner>}
      {pending.map((p) => (
        <Card key={p.id} style={{ marginBottom: 14 }}>
          <Text style={[styles.name, { color: t.text }]}>{p.surveyName}</Text>
          <Text style={[styles.reason, { color: t.textSecondary }]}>{p.reason} · {formatYmdShort(p.dueOn)}</Text>
          {p.questions.map((q) => (
            <View key={q.id} style={{ marginTop: 12 }}>
              <Text style={[styles.q, { color: t.text }]}>{q.text}</Text>
              {q.kind === 'scale' && (
                <View style={styles.scale} accessibilityRole="radiogroup">
                  {[1, 2, 3, 4, 5].map((n) => {
                    const on = answers[p.id]?.[q.id] === n
                    return (
                      <TouchableOpacity key={n} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${n}, ${SCALE_WORDS[n - 1]}`}
                        style={[styles.dot, { borderColor: on ? t.primary : t.border, backgroundColor: on ? t.primary : t.surface }]} onPress={() => set(p.id, q.id, n)}>
                        <Text style={{ color: on ? '#fff' : t.text, fontWeight: '700' }}>{n}</Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>
              )}
              {q.kind === 'scale' && typeof answers[p.id]?.[q.id] === 'number' && <Text style={[styles.word, { color: t.textSecondary }]}>{SCALE_WORDS[(answers[p.id][q.id] as number) - 1]}</Text>}
              {q.kind === 'yes_no' && (
                <View style={{ gap: 6, marginTop: 6 }}>
                  <Choice label="Yes" selected={answers[p.id]?.[q.id] === true} onPress={() => set(p.id, q.id, true)} />
                  <Choice label="No" selected={answers[p.id]?.[q.id] === false} onPress={() => set(p.id, q.id, false)} />
                </View>
              )}
              {q.kind === 'text' && <Field label="" placeholder="In your own words (optional)" multiline value={String(answers[p.id]?.[q.id] ?? '')} onChangeText={(v) => set(p.id, q.id, v)} />}
            </View>
          ))}
          <View style={{ marginTop: 14 }}><Button label="Send to the office" icon="send-outline" loading={busy === p.id} disabled={busy !== null} onPress={() => send(p)} /></View>
        </Card>
      ))}
      {answered.length > 0 && (
        <>
          <SectionTitle>Answered</SectionTitle>
          {answered.map((a) => (
            <Card key={a.id} style={{ marginBottom: 8 }}>
              <Text style={[styles.name, { color: t.text }]}>{a.surveyName}</Text>
              <Text style={[styles.reason, { color: t.textSecondary }]}>{a.reason}{a.score !== null && a.score !== undefined ? ` · you gave ${(a.score / 100).toFixed(1)} of 5` : ''}</Text>
            </Card>
          ))}
        </>
      )}
    </CareScreen>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '800', marginBottom: 4 },
  sub: { fontSize: 14, marginBottom: 14 },
  name: { fontSize: 16, fontWeight: '700' },
  reason: { fontSize: 13, marginTop: 2 },
  q: { fontSize: 15, fontWeight: '600', marginBottom: 6 },
  scale: { flexDirection: 'row', gap: 8 },
  dot: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  word: { fontSize: 13, marginTop: 4 },
})
