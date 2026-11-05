/**
 * My hours and time off (care_pickup_rewards): the caregiver says how many hours a week they WANT and the most they will work, which days and
 * hours they can work, and asks the office for time off. Saved on the phone and sent when there is signal (the offline queue); a time-off
 * request is always "waiting for the office" until the office answers.
 *   GET /api/caregiver-availability/:me      PUT /api/caregiver-availability/:me { hoursWanted, maxHoursPerWeek, mondayAvailable, mondayStartTime … }
 *   GET /api/pto (my own)                    POST /api/pto { startDate, endDate, type, reason? }
 */
import React, { useCallback, useState } from 'react'
import { Text, StyleSheet, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { useTheme } from '../../src/theme/ThemeContext'
import { useToast } from '../../src/components/ToastProvider'
import { useCare } from '../../src/care/CareContext'
import { careGet, asList } from '../../src/care/careApi'
import { useOfflineApi } from '../../src/offline/useOfflineApi'
import { CareScreen } from '../../src/care/screen'
import { Banner, Button, Card, Choice, Field, SectionTitle } from '../../src/care/ui'
import { DateTimeField } from '../../src/care/components/DateTimeField'
import { formatYmdShort } from '../../src/care/time'
import { DAYS, TIME_OFF_STATUS, TIME_OFF_TYPES, availabilityBody, availabilityProblem, timeOffBody, timeOffProblem, type DayChoice } from '../../src/care/rules'

const blankDays = (): Record<string, DayChoice> => Object.fromEntries(DAYS.map((d) => [d.key, { available: d.key !== 'saturday' && d.key !== 'sunday', start: '08:00', end: '16:00' }]))
const hhmm = (v: unknown, fallback: string) => (typeof v === 'string' && /^\d{2}:\d{2}/.test(v) ? v.slice(0, 5) : fallback)

export default function AvailabilityScreen() {
  const t = useTheme()
  const toast = useToast()
  const care = useCare()
  const queue = useOfflineApi()
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [wanted, setWanted] = useState('')
  const [max, setMax] = useState('')
  const [days, setDays] = useState<Record<string, DayChoice>>(blankDays())
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [requests, setRequests] = useState<any[]>([])
  const [off, setOff] = useState({ start: care.today, end: care.today, type: null as string | null, reason: '' })
  const [offProblem, setOffProblem] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)

  const load = useCallback(async () => {
    if (!care.userId) return
    const [a, p] = await Promise.all([careGet<any>(`/api/caregiver-availability/${encodeURIComponent(care.userId)}`), careGet('/api/pto')])
    if (a.ok && a.data) {
      const row: any = a.data
      setWanted(row.hoursWanted != null ? String(row.hoursWanted) : '')
      setMax(row.maxHoursPerWeek != null ? String(row.maxHoursPerWeek) : '')
      setDays(Object.fromEntries(DAYS.map((d) => [d.key, { available: !!row[`${d.key}Available`], start: hhmm(row[`${d.key}StartTime`], '08:00'), end: hhmm(row[`${d.key}EndTime`], '16:00') }])))
      setFailed(false)
    } else if (a.status !== 404) setFailed(true)
    if (p.ok) setRequests(asList(p.data).filter((r: any) => !r.caregiverId || r.caregiverId === care.userId))
    setLoaded(true)
  }, [care.userId])
  useFocusEffect(useCallback(() => { load() }, [load]))

  const save = async () => {
    const p = availabilityProblem(wanted, max, days)
    if (p) { setProblem(p); return }
    setProblem(null); setSaving(true)
    const r = await queue.put(`/api/caregiver-availability/${care.userId}`, availabilityBody(wanted, max, days), { recordKey: `availability:${care.userId}`, label: 'My hours' })
    setSaving(false)
    if (!r.ok) { setProblem(r.error || 'That could not be saved. Check it and try again.'); return }
    toast.success(r.queued ? 'Saved on your phone. It will be sent when you have signal.' : 'Your hours are saved.')
  }

  const ask = async () => {
    const p = timeOffProblem(off.start, off.end, off.type, care.today)
    if (p) { setOffProblem(p); return }
    setOffProblem(null); setAsking(true)
    const r = await queue.post('/api/pto', timeOffBody(off.start, off.end, off.type!, off.reason), { recordKey: `timeoff:${off.start}:${off.end}:${off.type}`, label: 'Time-off request' })
    setAsking(false)
    if (!r.ok) { setOffProblem(r.error || 'That could not be sent. Check it and try again.'); return }
    toast.success(r.queued ? 'Saved on your phone. It will be sent when you have signal.' : 'Sent to the office.')
    setOff({ start: care.today, end: care.today, type: null, reason: '' })
    if (!r.queued) load()
  }

  const setDay = (key: string, patch: Partial<DayChoice>) => { setDays((cur) => ({ ...cur, [key]: { ...cur[key], ...patch } })); setProblem(null) }
  return (
    <CareScreen keyboard onRefresh={load}>
      {failed && <Banner tone="warning" icon="cloud-offline-outline" onPress={load}>Your hours didn't load. Tap to try again.</Banner>}
      <SectionTitle>Hours you want</SectionTitle>
      <Card>
        <Text style={[styles.meta, { color: t.textSecondary }]}>The office uses this when it looks for someone to cover a shift.</Text>
        <Field label="Hours a week I want" value={wanted} onChangeText={(v) => { setWanted(v); setProblem(null) }} keyboardType="number-pad" placeholder="e.g. 24" />
        <Field label="The most hours a week I will work" value={max} onChangeText={(v) => { setMax(v); setProblem(null) }} keyboardType="number-pad" placeholder="e.g. 32" />
        <Text style={[styles.label, { color: t.text }]}>Days and hours I can work</Text>
        {DAYS.map((d) => (
          <View key={d.key} style={{ marginBottom: 6 }}>
            <Choice label={d.label} sub={days[d.key].available ? `${days[d.key].start} to ${days[d.key].end}` : 'Not working'} selected={days[d.key].available} onPress={() => setDay(d.key, { available: !days[d.key].available })} />
            {days[d.key].available ? (
              <View style={styles.row}>
                <View style={{ flex: 1 }}><Field label="From (HH:MM)" value={days[d.key].start} onChangeText={(v) => setDay(d.key, { start: v })} keyboardType="numbers-and-punctuation" /></View>
                <View style={{ flex: 1 }}><Field label="To (HH:MM)" value={days[d.key].end} onChangeText={(v) => setDay(d.key, { end: v })} keyboardType="numbers-and-punctuation" /></View>
              </View>
            ) : null}
          </View>
        ))}
        {problem ? <Banner tone="danger" icon="alert-circle">{problem}</Banner> : null}
        <Button label="Save my hours" icon="save-outline" loading={saving} disabled={!loaded} onPress={save} />
      </Card>

      <SectionTitle>Ask for time off</SectionTitle>
      <Card>
        <DateTimeField label="First day" mode="date" value={off.start} onChange={(v) => setOff({ ...off, start: v, end: off.end < v ? v : off.end })} />
        <DateTimeField label="Last day" mode="date" value={off.end} onChange={(v) => setOff({ ...off, end: v })} minimumDate={new Date(`${off.start}T12:00:00`)} />
        <Text style={[styles.label, { color: t.text }]}>What kind</Text>
        {TIME_OFF_TYPES.map((o) => <Choice key={o.code} label={o.label} selected={off.type === o.code} onPress={() => { setOff({ ...off, type: o.code }); setOffProblem(null) }} />)}
        <Field label="Anything the office should know (optional)" value={off.reason} onChangeText={(v) => setOff({ ...off, reason: v })} multiline maxLength={300} />
        {offProblem ? <Banner tone="danger" icon="alert-circle">{offProblem}</Banner> : null}
        <Button label="Send to the office" icon="send-outline" loading={asking} onPress={ask} />
      </Card>

      <SectionTitle>My time-off requests</SectionTitle>
      {requests.length === 0 ? <Text style={[styles.meta, { color: t.textSecondary }]}>None yet.</Text> : requests.slice(0, 15).map((r) => (
        <Card key={r.id}>
          <Text style={[styles.title, { color: t.text }]}>{formatYmdShort(String(r.startDate).slice(0, 10))}{String(r.endDate).slice(0, 10) !== String(r.startDate).slice(0, 10) ? ` – ${formatYmdShort(String(r.endDate).slice(0, 10))}` : ''}</Text>
          <Text style={[styles.meta, { color: t.textSecondary }]}>{TIME_OFF_TYPES.find((o) => o.code === r.type)?.label || 'Time off'} · {TIME_OFF_STATUS[r.status] || 'Waiting for the office'}</Text>
        </Card>
      ))}
    </CareScreen>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 15, fontWeight: '700' },
  meta: { fontSize: 14, marginTop: 2, lineHeight: 19 },
  label: { fontSize: 14, fontWeight: '700', marginBottom: 6, marginTop: 4 },
  row: { flexDirection: 'row', gap: 10 },
})
