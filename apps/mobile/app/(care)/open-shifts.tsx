/**
 * Open shifts — visits the office posted for anyone (or offered to this caregiver).
 *   GET  /api/open-shifts/available     open, today or later, visible to me under the agency's setting
 *                                        { id, shiftDate, startTime, endTime, clientFirstName, clientLastName, bonusAmount, urgency, notes,
 *                                          respondBy?, seriesVisits? }
 *   POST /api/open-shifts/:id/claim      first tap wins; "It's yours" when the office set first-come, otherwise pending the office's approval.
 *                                        One visit of a series takes the whole series; an offer past its answer-by time answers 409.
 *   GET  /api/open-shift-offers/reasons  the reasons to turn one down (answers only when care_open_shift_offers is on — then Not for me shows)
 *   POST /api/open-shift-offers/:id/decline { reason, note? }   |   POST /api/open-shift-offers/:id/hide
 * Taking or turning down a shift is a live answer and never kept for later: another caregiver may have taken it while the phone was offline.
 * Confirming happens on the card itself — no native dialogs.
 */
import React, { useCallback, useState } from 'react'
import { Text, StyleSheet, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { useTheme } from '../../src/theme/ThemeContext'
import { useCare } from '../../src/care/CareContext'
import { careGet, carePost, asList } from '../../src/care/careApi'
import { CareScreen } from '../../src/care/screen'
import { Banner, Button, Card, Choice, Field } from '../../src/care/ui'
import { EmptyState } from '../../src/components/EmptyState'
import { SkeletonList } from '../../src/components/SkeletonLoader'
import { formatTime12, formatYmdLong, formatYmdShort } from '../../src/care/time'
import { answerByText, declineBody, declineProblem, takeText } from '../../src/care/rules'

type Mode = { id: string; kind: 'take' | 'decline' }

export default function OpenShiftsScreen() {
  const t = useTheme()
  const care = useCare()
  const [list, setList] = useState<any[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode | null>(null)
  const [reasons, setReasons] = useState<{ code: string; label: string }[]>([])
  const [reason, setReason] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [result, setResult] = useState<{ tone: 'success' | 'danger'; title: string; text: string } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [r, why] = await Promise.all([careGet('/api/open-shifts/available'), careGet<any>('/api/open-shift-offers/reasons')])
    if (r.ok) { setList(asList(r.data)); setFailed(false) } else { setFailed(true); setList((p) => p || []) }
    setReasons(why.ok ? (why.data?.reasons || why.data?.data?.reasons || []) : [])
  }, [])
  useFocusEffect(useCallback(() => { load() }, [load]))

  const open = (id: string, kind: Mode['kind']) => { setMode({ id, kind }); setReason(null); setNote(''); setProblem(null); setResult(null) }
  const close = () => { setMode(null); setProblem(null) }

  const take = async (s: any) => {
    setBusy(s.id)
    const r = await carePost<any>(`/api/open-shifts/${s.id}/claim`)
    setBusy(null); setMode(null)
    if (r.ok) {
      setResult({ tone: 'success', title: r.data?.assigned ? "It's yours" : 'Request sent', text: r.data?.message || 'The office will confirm it.' })
      care.reload({ silent: true })
    } else setResult({ tone: 'danger', title: "Couldn't take this shift", text: r.status === 0 ? 'No signal — try again when you have a connection.' : r.error || 'Please try again.' })
    load()
  }
  const decline = async (s: any) => {
    const p = declineProblem(reason, note)
    if (p) { setProblem(p); return }
    setBusy(s.id)
    const r = await carePost(`/api/open-shift-offers/${s.id}/decline`, declineBody(reason as string, note))
    setBusy(null)
    if (!r.ok) { setProblem(r.status === 0 ? 'No signal — try again when you have a connection.' : r.error || 'That could not be done. Try again.'); return }
    setMode(null); load()
  }
  const hide = async (s: any) => {
    setBusy(s.id)
    const r = await carePost(`/api/open-shift-offers/${s.id}/hide`)
    setBusy(null)
    if (r.ok) load(); else setResult({ tone: 'danger', title: "Couldn't hide it", text: r.status === 0 ? 'No signal — try again when you have a connection.' : r.error || 'Please try again.' })
  }

  if (list === null) return <View style={{ flex: 1, backgroundColor: t.background }}><SkeletonList count={3} /></View>
  return (
    <CareScreen onRefresh={load}>
      {failed && <Banner tone="warning" icon="cloud-offline-outline" onPress={load}>Open shifts didn't load. Tap to try again.</Banner>}
      {result ? <Banner tone={result.tone === 'success' ? 'success' : 'danger'} icon={result.tone === 'success' ? 'checkmark-circle' : 'alert-circle'} title={result.title}>{result.text}</Banner> : null}
      {list.length === 0 && !failed && <EmptyState icon="briefcase-outline" title="No open shifts right now" subtitle="When the office posts one, it shows up here." />}
      {list.map((s) => {
        const text = takeText(s.seriesVisits)
        const by = answerByText(s.respondBy, formatYmdShort, formatTime12)
        const mine = mode?.id === s.id ? mode.kind : null
        return (
          <Card key={s.id}>
            {s.urgency === 'urgent' || s.urgency === 'critical' ? <Banner tone="danger" icon="flash">Urgent — coverage needed</Banner> : null}
            <Text style={[styles.date, { color: t.text }]}>{formatYmdLong(s.shiftDate)}</Text>
            <Text style={[styles.time, { color: t.text }]}>{formatTime12(s.startTime)} – {formatTime12(s.endTime)}</Text>
            <Text style={[styles.meta, { color: t.textSecondary }]}>{`${s.clientFirstName || ''} ${s.clientLastName || ''}`.trim() || 'Client'}</Text>
            {Number(s.bonusAmount) > 0 ? <Text style={[styles.meta, { color: t.text, fontWeight: '700' }]}>Bonus ${Number(s.bonusAmount).toFixed(2)}</Text> : null}
            {Number(s.seriesVisits) > 1 ? <Text style={[styles.meta, { color: t.text, fontWeight: '700' }]}>One of {s.seriesVisits} visits offered together</Text> : null}
            {by ? <Text style={[styles.meta, { color: t.textSecondary }]}>{by}</Text> : null}
            {s.notes ? <Text style={[styles.meta, { color: t.textSecondary }]}>{s.notes}</Text> : null}

            {mine === 'take' ? (
              <View style={{ marginTop: 12 }}>
                <Text style={[styles.meta, { color: t.text, fontWeight: '700' }]}>Take {formatYmdShort(s.shiftDate)}, {formatTime12(s.startTime)} – {formatTime12(s.endTime)}?</Text>
                {text.confirm ? <Text style={[styles.meta, { color: t.textSecondary }]}>{text.confirm}</Text> : null}
                <Button style={{ marginTop: 8 }} label="Yes, take it" icon="hand-right-outline" loading={busy === s.id} disabled={!!busy} onPress={() => take(s)} />
                <Button style={{ marginTop: 8 }} variant="ghost" label="Cancel" disabled={!!busy} onPress={close} />
              </View>
            ) : mine === 'decline' ? (
              <View style={{ marginTop: 12 }}>
                <Text style={[styles.meta, { color: t.text, fontWeight: '700' }]}>Why is this one not for you?</Text>
                {reasons.map((r) => <Choice key={r.code} label={r.label} selected={reason === r.code} onPress={() => { setReason(r.code); setProblem(null) }} />)}
                {reason === 'other' ? <Field label="Your reason" value={note} onChangeText={(v) => { setNote(v); setProblem(null) }} /> : null}
                {problem ? <Banner tone="danger" icon="alert-circle">{problem}</Banner> : null}
                <Button style={{ marginTop: 8 }} label="Turn it down" variant="secondary" loading={busy === s.id} disabled={!!busy} onPress={() => decline(s)} />
                <Button style={{ marginTop: 8 }} variant="ghost" label="Cancel" disabled={!!busy} onPress={close} />
              </View>
            ) : (
              <>
                <Button style={{ marginTop: 12 }} label={text.button} icon="hand-right-outline" disabled={!!busy} onPress={() => open(s.id, 'take')} />
                {reasons.length > 0 ? (
                  <View style={styles.row}>
                    <Button small style={{ flex: 1 }} variant="secondary" label="Not for me" disabled={!!busy} onPress={() => open(s.id, 'decline')} />
                    <Button small style={{ flex: 1 }} variant="ghost" label="Hide" loading={busy === s.id} disabled={!!busy} onPress={() => hide(s)} />
                  </View>
                ) : null}
              </>
            )}
          </Card>
        )
      })}
    </CareScreen>
  )
}

const styles = StyleSheet.create({
  date: { fontSize: 16, fontWeight: '800' },
  time: { fontSize: 15, fontWeight: '600', marginTop: 2 },
  meta: { fontSize: 14, marginTop: 4, lineHeight: 19 },
  row: { flexDirection: 'row', gap: 8, marginTop: 8 },
})
