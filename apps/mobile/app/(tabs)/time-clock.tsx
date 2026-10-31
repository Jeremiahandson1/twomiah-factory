/**
 * Clock — clock in, the open visit, clock out (Twomiah Care, home care vertical).
 *
 * Clock in: pick the client (today's first), GPS + the client's geofence, then
 * POST /api/time-entries/clock-in. No signal → the punch is saved on the phone with the tap time and
 * sent later (src/care/offlinePunches.ts). A second open visit is refused: clock out first.
 *
 * On a visit: the timer, Sandata EVV reminders, the care task checklist, medications (MAR) and
 * vitals where the client has them, visit photos, visit notes — then clock out with the note
 * (POST /api/time-entries/:id/clock-out; a VA client's visit needs a note, the server says so).
 */
import React, { useEffect, useMemo, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Modal, TextInput, Alert, Linking, ScrollView, KeyboardAvoidingView, Platform } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../src/theme/ThemeContext'
import { useHaptics } from '../../src/hooks/useHaptics'
import { useToast } from '../../src/components/ToastProvider'
import { useCare, type Fix } from '../../src/care/CareContext'
import { isOfflineId } from '../../src/care/offlinePunches'
import { formatDistance } from '../../src/care/rules'
import { formatClock, formatElapsed, formatTime12 } from '../../src/care/time'
import { CareScreen, fullAddress, openDirections } from '../../src/care/screen'
import { Banner, BannerText, Button, Card, Field, SectionTitle, SOLID, useTone } from '../../src/care/ui'
import { SandataIdBox, SandataPromptCard, VisitSandata, SandataHelp } from '../../src/care/components/Sandata'
import { CareTaskChecklist, MedicationLog, VisitPhotos, VitalsForm } from '../../src/care/components/VisitParts'
import { VisitItems } from '../../src/care/components/VisitItems'
import { ConfirmSheet } from '../../src/components/ConfirmSheet'
import { needsSandata } from '../../src/care/sandata'
import { VisitQuestionFields, useVisitQuestions } from '../../src/care/components/VisitQuestions'
import { answersBody, type VisitAnswers } from '../../src/care/rules'

function ActiveVisitView() {
  const t = useTheme()
  const care = useCare()
  const toast = useToast()
  const haptics = useHaptics()
  const a = care.active!
  const [now, setNow] = useState(Date.now())
  const [outOpen, setOutOpen] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)
  // The agency's clock-out questions (care_visit_questions): none unless the agency has them.
  const outQuestions = useVisitQuestions('clock_out')
  const [outAnswers, setOutAnswers] = useState<VisitAnswers>({})
  const [outMissing, setOutMissing] = useState<string[]>([])
  useEffect(() => { const iv = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(iv) }, [])
  const start = new Date(a.startTime).getTime()
  const elapsed = isNaN(start) ? 0 : (now - start) / 1000
  const name = a.clientName || care.clientName(a.clientId)
  const client = care.clientById(a.clientId)
  const offline = isOfflineId(a.id)
  const success = useTone('success')
  const dangerTone = useTone('danger')
  const todays = care.todayVisits.find((v) => v.clientId === a.clientId)

  const doClockOut = async () => {
    setNoteError(null)
    // The server holds a live clock-out until the required questions are answered (409, handled below); a clock-out with no signal is
    // saved with whatever was answered.
    setOutMissing([])
    const r = await care.clockOut(care.visitNote, answersBody(outQuestions, outAnswers))
    if (!r.ok) {
      if (r.code === 'questions_required') { setOutMissing(outQuestions.filter((q) => q.required).map((q) => q.id)); haptics.error(); Alert.alert('Answer the questions first', r.error || ''); return }
      haptics.error()
      // A note the server or the offline rule requires: keep the sheet open and say why.
      if (r.code === 'required_items_pending') { setOutOpen(false); Alert.alert('Finish these first', r.error || ''); return }
      if (r.code === 'va_note_required' || r.code === 'note_required') { setNoteError(r.error || 'A visit note is required.'); return }
      setOutOpen(false)
      Alert.alert('Clock-out failed', r.error || 'Please try again.')
      return
    }
    haptics.success()
    setOutOpen(false)
    if (r.queued) Alert.alert('Saved on your phone', r.message || '')
    else toast.success(r.message || 'Clocked out.')
  }

  return (
    <CareScreen keyboard refreshing={care.refreshing} onRefresh={() => care.reload()}>
      <SandataPromptCard />
      <View style={[styles.timerCard, { backgroundColor: success.bg, borderColor: success.border }]}>
        <Text style={[styles.timerLabel, { color: success.text }]}>CLOCKED IN WITH</Text>
        <Text style={[styles.timerName, { color: success.text }]}>{name}</Text>
        <Text style={[styles.timer, { color: success.text }]}>{formatElapsed(elapsed)}</Text>
        <Text style={[styles.timerSub, { color: success.text }]}>
          Since {formatClock(a.startTime)}{todays ? ` · scheduled ${formatTime12(todays.startTime)}–${formatTime12(todays.endTime)}` : ''}
        </Text>
        {offline && <Text style={[styles.timerSub, { color: success.text, fontWeight: '700' }]}>Saved on this phone — sends when you have signal</Text>}
      </View>
      {elapsed > 16 * 3600 && (
        <Banner tone="warning" icon="alarm" title={`Open for ${Math.round(elapsed / 3600)} hours`}>
          If you forgot to clock out, clock out now and tell the office the right time.
        </Banner>
      )}
      <VisitSandata clientId={a.clientId} sandataRequired={a.sandataRequired} />

      {client && fullAddress(client) ? (
        <Button variant="secondary" icon="navigate" label="Directions to this client" onPress={() => openDirections(fullAddress(client))} style={{ marginBottom: 12 }} />
      ) : null}

      <SectionTitle>Care tasks</SectionTitle>
      <CareTaskChecklist timeEntryId={a.id} />

      <VisitItems timeEntryId={a.id} />
      <MedicationLog clientId={a.clientId} timeEntryId={a.id} />
      <VitalsForm clientId={a.clientId} timeEntryId={a.id} />
      <VisitPhotos />

      <SectionTitle>Visit notes</SectionTitle>
      <Field label="How did the visit go?" value={care.visitNote} onChangeText={care.setVisitNote} multiline
        placeholder="What you did, how the client was, anything the office or family should know"
        hint="Saved on this phone as you type, and sent when you clock out." />

      <Button variant="danger" icon="stop-circle" label="Clock out" onPress={() => { care.warmFix(); setNoteError(null); setOutOpen(true) }} style={{ marginTop: 6 }} />

      <Modal visible={outOpen} transparent animationType="slide" onRequestClose={() => !care.clockingOut && setOutOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetBackdrop}>
          <View style={[styles.sheet, { backgroundColor: t.surface }]}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={[styles.sheetTitle, { color: t.text }]}>Clock out of {name}'s visit</Text>
              <Text style={[styles.sheetText, { color: noteError ? dangerTone.text : t.textSecondary, fontWeight: noteError ? '700' : '400' }]}>
                {noteError || (offline ? 'No signal — a short note is required so this visit can be saved on your phone.' : 'Add or check your visit note.')}
              </Text>
              <TextInput
                value={care.visitNote}
                onChangeText={(v) => { care.setVisitNote(v); if (noteError) setNoteError(null) }}
                multiline
                placeholder="How did the visit go?"
                placeholderTextColor={t.textMuted}
                style={[styles.noteInput, { color: t.text, borderColor: noteError ? dangerTone.border : t.border, backgroundColor: t.background }]}
              />
              <VisitQuestionFields title="Before you go" questions={outQuestions} answers={outAnswers} onChange={(a) => { setOutAnswers(a); setOutMissing([]) }} missing={outMissing} />
              {care.photos.some((p) => p.status !== 'sent') && (
                <Text style={[styles.sheetText, { color: t.textSecondary }]}>Photos not sent yet will be retried when you clock out.</Text>
              )}
              <View style={styles.sheetActions}>
                <Button variant="secondary" label="Cancel" disabled={care.clockingOut} onPress={() => setOutOpen(false)} style={{ flex: 1 }} />
                <Button variant="danger" label={care.clockingOut ? 'Clocking out…' : 'Clock out'} loading={care.clockingOut} onPress={doClockOut} style={{ flex: 1 }} />
              </View>
              {care.clockingOut && <Text style={[styles.sheetText, { color: t.textSecondary, textAlign: 'center' }]}>Working — no need to tap again.</Text>}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </CareScreen>
  )
}

function ClockInView() {
  const t = useTheme()
  const care = useCare()
  const toast = useToast()
  const haptics = useHaptics()
  const router = useRouter()
  const params = useLocalSearchParams<{ clientId?: string }>()
  const [selected, setSelected] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [stage, setStage] = useState<null | 'gps' | 'send'>(null)
  const [confirm, setConfirm] = useState<{ fix: Fix | null; text: string } | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  // The agency's clock-in questions (care_visit_questions): none unless the agency has them.
  const inQuestions = useVisitQuestions('clock_in')
  const [inAnswers, setInAnswers] = useState<VisitAnswers>({})
  const [inMissing, setInMissing] = useState<string[]>([])

  useEffect(() => { care.warmFix() }, []) // a fix is usually in hand before the tap
  useEffect(() => { if (params.clientId) setSelected(String(params.clientId)) }, [params.clientId])

  const todayIds = useMemo(() => Array.from(new Set(care.todayVisits.map((v) => v.clientId))), [care.todayVisits])
  const list = useMemo(() => {
    const all = care.clients.length ? care.clients : todayIds.map((id) => ({ id, firstName: care.clientName(id), lastName: '' } as any))
    const today = all.filter((c) => todayIds.includes(c.id))
    return showAll || !today.length ? all : today
  }, [care.clients, todayIds, showAll, care.clientName])

  const send = async (clientId: string, fix: Fix | null) => {
    setStage('send')
    const r = await care.clockIn(clientId, fix, answersBody(inQuestions, inAnswers))
    setStage(null)
    if (!r.ok && r.code === 'questions_required') { setInMissing(inQuestions.filter((q) => q.required).map((q) => q.id)); haptics.error(); Alert.alert('Answer the questions first', r.error || ''); return }
    if (r.ok) setInAnswers({})
    if (!r.ok) { haptics.error(); Alert.alert('Clock-in failed', r.error || 'Please try again.'); return }
    haptics.success()
    if (r.queued) Alert.alert('Saved on your phone', r.message || '')
    else toast.success(r.message || 'Clocked in.')
    router.setParams({ clientId: '' } as any)
  }

  const start = async () => {
    if (!selected) { toast.warning('Pick the client you are with.'); return }
    // The server holds a live clock-in until the required questions are answered (409 questions_required, handled in send()); a punch
    // with no signal is saved with whatever was answered and never refused, so the phone does not pre-block it here.
    setInMissing([])
    haptics.medium()
    setStage('gps')
    const chk = await care.checkClockIn(selected)
    if (chk.blocked) {
      setStage(null)
      haptics.error()
      Alert.alert("Can't clock in yet", chk.blocked, chk.openSettings
        ? [{ text: 'Not now', style: 'cancel' }, { text: 'Open Settings', onPress: () => Linking.openSettings() }]
        : [{ text: 'OK' }])
      return
    }
    if (chk.verdict.status === 'outside') {
      setStage(null)
      setConfirm({
        fix: chk.fix,
        text: `Your phone shows you about ${formatDistance(chk.verdict.distanceFeet)} from ${care.clientName(selected)}'s home (the agency allows ${formatDistance(chk.verdict.radiusFeet)}). Your location is recorded with the clock-in and the office may review it.`,
      })
      return
    }
    await send(selected, chk.fix)
  }

  const sc = care.sandataClient(selected)
  const client = care.clientById(selected)
  const busy = stage !== null || care.clockingIn

  return (
    <CareScreen refreshing={care.refreshing} onRefresh={() => care.reload()}>
      <SandataPromptCard />
      <Text style={[styles.h1, { color: t.text }]}>Ready to start a visit?</Text>
      <Text style={[styles.sub, { color: t.textSecondary }]}>Pick your client, then tap Clock In when you arrive.</Text>

      {care.sandata?.clients?.some(needsSandata) && (
        <>
          <Button small variant="ghost" icon="phone-portrait-outline" label={showHelp ? 'Hide Sandata setup help' : 'Set up Sandata (needed for some of your clients)'} onPress={() => setShowHelp((v) => !v)} />
          {showHelp && <SandataHelp />}
        </>
      )}

      <SectionTitle right={todayIds.length && care.clients.length > todayIds.length
        ? <Button small variant="ghost" label={showAll ? "Today's clients" : 'All my clients'} onPress={() => setShowAll((v) => !v)} />
        : undefined}>Client</SectionTitle>
      {list.length === 0 ? (
        <Banner tone="warning" icon="people-outline" title="No clients to show" onPress={() => care.reload()}>
          {care.loadFailed ? 'Your client list did not load. Tap to try again.' : 'You have no clients assigned yet. Ask the office, or tap to refresh.'}
        </Banner>
      ) : list.map((c) => {
        const on = selected === c.id
        const v = care.todayVisits.find((x) => x.clientId === c.id)
        return (
          <TouchableOpacity key={c.id} onPress={() => setSelected(c.id)} activeOpacity={0.8} accessibilityRole="radio" accessibilityState={{ selected: on }}
            style={[styles.pick, { borderColor: on ? t.primary : t.border, backgroundColor: on ? t.primaryLight : t.surface }]}>
            <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={on ? t.primary : t.textSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.pickName, { color: t.text }]}>{`${c.firstName || ''} ${c.lastName || ''}`.trim()}</Text>
              {v ? <Text style={[styles.pickSub, { color: t.textSecondary }]}>Today {formatTime12(v.startTime)} – {formatTime12(v.endTime)}</Text> : null}
            </View>
          </TouchableOpacity>
        )
      })}

      {selected && client && fullAddress(client) ? (
        <Button small variant="ghost" icon="navigate" label={fullAddress(client)} onPress={() => openDirections(fullAddress(client))} style={{ alignSelf: 'flex-start' }} />
      ) : null}
      {selected ? <SandataIdBox client={sc} /> : null}

      {selected ? <VisitQuestionFields title="Before you start" questions={inQuestions} answers={inAnswers} onChange={(a) => { setInAnswers(a); setInMissing([]) }} missing={inMissing} /> : null}

      <Button
        style={{ marginTop: 16, minHeight: 60 }}
        icon="play-circle"
        label={stage === 'gps' ? 'Finding your location…' : stage === 'send' || care.clockingIn ? 'Clocking in…' : 'Clock In'}
        loading={busy}
        disabled={!selected}
        onPress={start}
      />
      {busy && <Text style={[styles.sub, { color: t.textSecondary, textAlign: 'center', marginTop: 8 }]}>Working — no need to tap again.</Text>}
      <Banner tone="neutral" icon="shield-checkmark-outline">
        Your location is recorded when you clock in and out, to verify the visit (EVV). No signal? Clock in anyway — the punch is saved with the time you tapped and sent when you're back online.
      </Banner>

      <ConfirmSheet
        visible={!!confirm}
        onClose={() => setConfirm(null)}
        title="You don't seem to be at the client's home"
        description={confirm?.text}
        confirmLabel="Clock in anyway"
        confirmColor={SOLID.warning}
        onConfirm={async () => { const c = confirm; setConfirm(null); if (selected) await send(selected, c?.fix ?? null) }}
      />
    </CareScreen>
  )
}

export default function TimeClockScreen() {
  const care = useCare()
  return care.active ? <ActiveVisitView /> : <ClockInView />
}

const styles = StyleSheet.create({
  timerCard: { borderWidth: 1.5, borderRadius: 16, padding: 18, alignItems: 'center', marginBottom: 12 },
  timerLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  timerName: { fontSize: 20, fontWeight: '800', marginTop: 4, textAlign: 'center' },
  timer: { fontSize: 48, fontWeight: '900', fontVariant: ['tabular-nums'], marginVertical: 6 },
  timerSub: { fontSize: 14, textAlign: 'center', marginTop: 2 },
  h1: { fontSize: 22, fontWeight: '800' },
  sub: { fontSize: 15, marginTop: 4, marginBottom: 6, lineHeight: 21 },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderRadius: 12, padding: 14, marginBottom: 8 },
  pickName: { fontSize: 16, fontWeight: '700' },
  pickSub: { fontSize: 13, marginTop: 2 },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '85%' },
  sheetTitle: { fontSize: 19, fontWeight: '800', marginBottom: 6 },
  sheetText: { fontSize: 14, lineHeight: 20, marginBottom: 10 },
  noteInput: { borderWidth: 1, borderRadius: 10, minHeight: 110, padding: 12, fontSize: 16, textAlignVertical: 'top', marginBottom: 10 },
  sheetActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
})
