/**
 * One visit, one action (?kind=…&scheduleId&date&start&end&clientName):
 *
 *   unavailable  The CLIENT is why the visit didn't happen (refused, not home, hospital, cancelled).
 *                POST /api/emergency/client-unavailable { scheduleId, date, reason, note } — the visit
 *                is cancelled with that reason: not billed, not paid, no coverage needed.
 *   swap         Ask a coworker to take this day. POST /api/shift-swaps
 *                { scheduleId, targetCaregiverId, reason, shiftDate } (coworkers: GET /api/messages/users)
 *   move         Ask the office to move it. POST /api/visit-change-requests/reschedule-request — nothing
 *                moves until the office approves.
 *   miss         The CAREGIVER can't make it. POST /api/emergency/miss-report { scheduleId?, date,
 *                reason, alternativeContact } — the office is told and an urgent open shift is posted.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { Text, StyleSheet, View, Alert } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useTheme } from '../../src/theme/ThemeContext'
import { useCare } from '../../src/care/CareContext'
import { isFieldRole } from '../../src/auth/roles'
import { careGet, carePost, asList } from '../../src/care/careApi'
import { CareScreen } from '../../src/care/screen'
import { Banner, Button, Card, Choice, Field, SectionTitle } from '../../src/care/ui'
import { DateTimeField } from '../../src/care/components/DateTimeField'
import { formatTime12, formatYmdLong, hm } from '../../src/care/time'

// The server's list (crm-homecare helpers/cancelReasons.ts CLIENT_UNAVAILABLE_REASONS).
const UNAVAILABLE = [
  { value: 'client_refused', label: 'Client refused services' },
  { value: 'client_not_home', label: 'Client not home / not answering' },
  { value: 'client_hospital', label: 'Client in hospital or facility' },
  { value: 'client_cancelled', label: 'Client cancelled ahead of time' },
  { value: 'other', label: 'Other (add a note)' },
]
const MISS_REASONS = [
  'Illness — not feeling well', 'Family emergency', 'Car trouble / transportation', 'Personal emergency', 'Prior commitment conflict', 'Other',
]
const TITLES: Record<string, string> = { unavailable: 'Client not available', swap: 'Ask a coworker to swap', move: 'Ask to move this visit', miss: "Can't make a shift" }

export default function ShiftActionScreen() {
  const t = useTheme()
  const router = useRouter()
  const care = useCare()
  const p = useLocalSearchParams<{ kind?: string; scheduleId?: string; date?: string; start?: string; end?: string; clientName?: string }>()
  const kind = String(p.kind || 'miss')
  const [scheduleId, setScheduleId] = useState(p.scheduleId ? String(p.scheduleId) : '')
  const [date, setDate] = useState(p.date ? String(p.date) : '')
  const [start, setStart] = useState(p.start ? String(p.start) : '')
  const [end, setEnd] = useState(p.end ? String(p.end) : '')
  const [clientName, setClientName] = useState(p.clientName ? String(p.clientName) : '')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [target, setTarget] = useState('')
  const [coworkers, setCoworkers] = useState<any[] | null>(null)
  const [moveTo, setMoveTo] = useState({ date: p.date ? String(p.date) : '', start: hm(p.start), end: hm(p.end) })
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    if (kind !== 'swap') return
    careGet('/api/messages/users').then((r) => {
      // /api/messages/users answers { id, firstName, lastName, role }; a coworker is the field seat (role 'field').
      setCoworkers(r.ok ? asList(r.data).filter((u: any) => isFieldRole(u.role) && u.id !== care.userId) : [])
    })
  }, [kind, care.userId])

  // For "can't make a shift" opened without a visit: pick one of the next two weeks', or any date.
  const upcoming = useMemo(() => care.visits.filter((v) => v.date >= care.today).slice(0, 20), [care.visits, care.today])

  const submit = async () => {
    let path = '', body: Record<string, unknown> = {}, ok = ''
    if (kind === 'unavailable') {
      if (!reason) return Alert.alert('Pick what happened')
      if (reason === 'other' && !note.trim()) return Alert.alert('Add a short note for "Other"')
      path = '/api/emergency/client-unavailable'; body = { scheduleId, date, reason, note: note.trim() || null }
      ok = 'Saved — the office has been told, and this visit will not be billed or paid.'
    } else if (kind === 'swap') {
      if (!target) return Alert.alert('Pick a coworker to ask')
      path = '/api/shift-swaps'; body = { scheduleId, targetCaregiverId: target, reason: note.trim() || null, shiftDate: date }
      ok = 'Swap request sent. If they accept, the office approves it — work the shift until then.'
    } else if (kind === 'move') {
      if (!moveTo.date || !moveTo.start || !moveTo.end) return Alert.alert('Pick the new day and times')
      if (moveTo.date === date && moveTo.start === hm(start) && moveTo.end === hm(end)) return Alert.alert('That is the same day and time it already has')
      path = '/api/visit-change-requests/reschedule-request'
      body = { scheduleId, visitDate: date, startTime: start, endTime: end, proposedDate: moveTo.date, proposedStartTime: moveTo.start, proposedEndTime: moveTo.end, reason: note.trim() || null }
      ok = 'Sent to the office. The visit moves only when they approve it — work the current time until then.'
    } else {
      if (!date) return Alert.alert('Pick the date you cannot work')
      if (!reason) return Alert.alert('Pick a reason')
      path = '/api/emergency/miss-report'; body = { scheduleId: scheduleId || null, date, reason, alternativeContact: note.trim() || null }
      ok = 'Your supervisor has been notified and will arrange coverage. If you don\'t hear back within 30 minutes, call the office.'
    }
    setSaving(true)
    const r = await carePost(path, body)
    setSaving(false)
    if (!r.ok) {
      Alert.alert('Not sent', r.status === 0 ? 'No connection — this needs signal. If it is urgent, call the office.' : (r.error || 'Please try again, or call the office.'))
      return
    }
    care.reload({ silent: true })
    setDone(ok)
  }

  if (done) {
    return (
      <CareScreen>
        <Stack.Screen options={{ title: TITLES[kind] || 'Visit' }} />
        <Banner tone="success" icon="checkmark-circle" title="Sent">{done}</Banner>
        <Button label="Done" onPress={() => router.back()} />
      </CareScreen>
    )
  }

  return (
    <CareScreen keyboard>
      <Stack.Screen options={{ title: TITLES[kind] || 'Visit' }} />
      {scheduleId && date ? (
        <Card>
          <Text style={[styles.visitName, { color: t.text }]}>{clientName || 'Visit'}</Text>
          <Text style={[styles.meta, { color: t.textSecondary }]}>{formatYmdLong(date)}{start ? ` · ${formatTime12(start)} – ${formatTime12(end)}` : ''}</Text>
        </Card>
      ) : null}

      {kind === 'unavailable' && (
        <>
          <Banner tone="info" icon="information-circle">Use this when the CLIENT is the reason the visit didn't happen. The office is told and the visit is not billed or paid. If YOU can't make a shift, use "Can't make it" instead so it can be covered.</Banner>
          <SectionTitle>What happened?</SectionTitle>
          {UNAVAILABLE.map((r) => <Choice key={r.value} label={r.label} selected={reason === r.value} onPress={() => setReason(r.value)} />)}
          <Field label={reason === 'other' ? 'Note (required)' : 'Note (optional)'} value={note} onChangeText={setNote} multiline maxLength={500}
            placeholder="Who you spoke to, what they said, anything the office should know" />
        </>
      )}

      {kind === 'swap' && (
        <>
          <SectionTitle>Ask which coworker?</SectionTitle>
          {coworkers === null ? <Text style={[styles.meta, { color: t.textSecondary }]}>Loading coworkers…</Text>
            : coworkers.length === 0 ? <Banner tone="warning" icon="people-outline">No coworkers to choose from. Ask the office to arrange it.</Banner>
              : coworkers.map((u) => <Choice key={u.id} label={`${u.firstName || ''} ${u.lastName || ''}`.trim()} selected={target === u.id} onPress={() => setTarget(u.id)} />)}
          <Field label="Reason (optional, but it helps)" value={note} onChangeText={setNote} multiline placeholder="Doctor appointment, family emergency…" />
        </>
      )}

      {kind === 'move' && (
        <>
          <DateTimeField label="New day" mode="date" value={moveTo.date} onChange={(v) => setMoveTo({ ...moveTo, date: v })} minimumDate={new Date()} />
          <View style={styles.two}>
            <View style={{ flex: 1 }}><DateTimeField label="Start" mode="time" value={moveTo.start} onChange={(v) => setMoveTo({ ...moveTo, start: v })} /></View>
            <View style={{ flex: 1 }}><DateTimeField label="End" mode="time" value={moveTo.end} onChange={(v) => setMoveTo({ ...moveTo, end: v })} /></View>
          </View>
          <Field label="Reason (helps the office decide)" value={note} onChangeText={setNote} multiline placeholder="Client asked for a later start, appointment conflict…" />
          <Banner tone="warning" icon="alert-circle">Work the visit at its current time until the office approves the move. Your pay and the client's billing follow the schedule, not the request.</Banner>
        </>
      )}

      {kind === 'miss' && (
        <>
          {!p.scheduleId && upcoming.length > 0 && (
            <>
              <SectionTitle>Which shift? (optional)</SectionTitle>
              {upcoming.map((v) => (
                <Choice key={v.key} label={v.clientName} sub={`${formatYmdLong(v.date)} · ${formatTime12(v.startTime)} – ${formatTime12(v.endTime)}`}
                  selected={scheduleId === v.scheduleId && date === v.date}
                  onPress={() => { setScheduleId(v.scheduleId); setDate(v.date); setStart(v.startTime); setEnd(v.endTime); setClientName(v.clientName) }} />
              ))}
            </>
          )}
          {!p.date && <DateTimeField label="Date you can't work" mode="date" value={date} onChange={(v) => { setDate(v); if (!upcoming.some((x) => x.scheduleId === scheduleId && x.date === v)) setScheduleId('') }} minimumDate={new Date()} />}
          <SectionTitle>Reason</SectionTitle>
          {MISS_REASONS.map((r) => <Choice key={r} label={r} selected={reason === r} onPress={() => setReason(r)} />)}
          <Field label="Anything else (optional)" value={note} onChangeText={setNote} multiline placeholder="How to reach you, when you'll be back…" />
          <Banner tone="danger" icon="warning">This notifies your supervisor right away. If it's an emergency, also call the office.</Banner>
        </>
      )}

      <Button label={kind === 'miss' ? "Send — I can't make it" : 'Send'} icon="send" variant={kind === 'miss' ? 'danger' : 'primary'} loading={saving} onPress={submit} />
    </CareScreen>
  )
}

const styles = StyleSheet.create({
  visitName: { fontSize: 17, fontWeight: '800' },
  meta: { fontSize: 14, marginTop: 3 },
  two: { flexDirection: 'row', gap: 10 },
})
