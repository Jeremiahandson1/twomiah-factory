/**
 * Payday verification — confirm or dispute the last pay period's hours before payroll runs.
 *   GET  /api/payroll-verification/me/pending   { pending } — null unless the agency has it switched on
 *   POST /api/payroll-verification/me/verify    { payPeriodStart, payPeriodEnd, confirmed, disputeReason?, reportedTotalHours, reportedGrossPay }
 * Never blocks the clock: this is a screen the caregiver opens from a card, with "Remind me later".
 */
import React, { useState } from 'react'
import { Text, StyleSheet, View, Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { useTheme } from '../../src/theme/ThemeContext'
import { useToast } from '../../src/components/ToastProvider'
import { useCare } from '../../src/care/CareContext'
import { carePost } from '../../src/care/careApi'
import { CareScreen } from '../../src/care/screen'
import { Banner, Button, Card, Field, SectionTitle } from '../../src/care/ui'
import { EmptyState } from '../../src/components/EmptyState'
import { formatDuration, formatTime12, formatYmdShort } from '../../src/care/time'

const money = (n: unknown) => `$${(Number(n) || 0).toFixed(2)}`

export default function PaydayScreen() {
  const t = useTheme()
  const toast = useToast()
  const router = useRouter()
  const care = useCare()
  const p = care.payday as any
  const [mode, setMode] = useState<'review' | 'dispute'>('review')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  if (!p) return <CareScreen><EmptyState icon="checkmark-done-outline" title="Nothing to confirm" subtitle="When your agency asks you to confirm a pay period, it shows here." /></CareScreen>

  const submit = async (confirmed: boolean) => {
    if (!confirmed && !reason.trim()) return Alert.alert('Tell us what is wrong', 'Which shift, which date, what you expected and what you see.')
    setSaving(true)
    const r = await carePost('/api/payroll-verification/me/verify', {
      payPeriodStart: p.payPeriodStart, payPeriodEnd: p.payPeriodEnd, confirmed,
      disputeReason: confirmed ? null : reason.trim(), reportedTotalHours: p.totalHours, reportedGrossPay: p.grossPay,
    })
    setSaving(false)
    if (!r.ok) { Alert.alert('Not sent', r.status === 0 ? 'No connection — try again when you have signal.' : r.error || 'Please try again.'); return }
    toast.success(confirmed ? 'Thanks — hours confirmed.' : 'Sent to the office. They will review it.')
    care.paydayResolved()
    router.back()
  }

  const shifts: any[] = Array.isArray(p.shifts) ? p.shifts : []
  return (
    <CareScreen keyboard>
      <Card>
        <Text style={[styles.label, { color: t.textSecondary }]}>PAY PERIOD</Text>
        <Text style={[styles.period, { color: t.text }]}>{formatYmdShort(p.payPeriodStart)} – {formatYmdShort(p.payPeriodEnd)}</Text>
        {p.payDate ? <Text style={[styles.meta, { color: t.textSecondary }]}>Expected pay date {formatYmdShort(p.payDate)}</Text> : null}
        <View style={styles.stats}>
          <View style={styles.stat}><Text style={[styles.statLabel, { color: t.textSecondary }]}>Hours</Text><Text style={[styles.statValue, { color: t.text }]}>{Number(p.totalHours || 0).toFixed(2)}</Text></View>
          <View style={styles.stat}><Text style={[styles.statLabel, { color: t.textSecondary }]}>Rate</Text><Text style={[styles.statValue, { color: t.text }]}>{money(p.hourlyRate)}</Text></View>
          <View style={styles.stat}><Text style={[styles.statLabel, { color: t.textSecondary }]}>Gross</Text><Text style={[styles.statValue, { color: t.text }]}>{money(p.grossPay)}</Text></View>
        </View>
        <Text style={[styles.meta, { color: t.textSecondary }]}>Gross pay is before taxes; your check will be less after deductions.</Text>
      </Card>

      <SectionTitle>Shifts ({shifts.length})</SectionTitle>
      {shifts.map((s) => (
        <View key={s.id} style={[styles.shift, { borderColor: t.border, backgroundColor: t.surface }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.shiftDate, { color: t.text }]}>{formatYmdShort(String(s.shiftDate || s.shift_date).slice(0, 10))} · {`${s.clientFirst || s.client_first || ''} ${String(s.clientLast || s.client_last || '').charAt(0)}.`.trim()}</Text>
            <Text style={[styles.meta, { color: t.textSecondary }]}>Scheduled {formatTime12(s.scheduledStart || s.scheduled_start)} – {formatTime12(s.scheduledEnd || s.scheduled_end)}</Text>
          </View>
          <Text style={[styles.paid, { color: t.text }]}>{formatDuration(Number(s.payableMinutes ?? s.payable_minutes) || 0)}</Text>
        </View>
      ))}

      {mode === 'review' ? (
        <View style={styles.actions}>
          <Button label="Looks right — confirm" icon="checkmark" variant="success" loading={saving} onPress={() => submit(true)} />
          <Button label="Something's wrong" variant="secondary" disabled={saving} onPress={() => setMode('dispute')} />
          <Button label="Remind me later" variant="ghost" disabled={saving} onPress={() => { care.snoozePaydayNow(); router.back() }} />
        </View>
      ) : (
        <View style={styles.actions}>
          <Field label="What's wrong?" value={reason} onChangeText={setReason} multiline
            placeholder="e.g. Tuesday the 15th with Jane D. — I worked 4 hours but 3 show." />
          <Banner tone="warning" icon="information-circle">The office reviews it and reaches out. Payroll for this period may be held until it's resolved.</Banner>
          <Button label="Send to the office" icon="send" variant="danger" loading={saving} onPress={() => submit(false)} />
          <Button label="Back" variant="ghost" disabled={saving} onPress={() => setMode('review')} />
        </View>
      )}
    </CareScreen>
  )
}

const styles = StyleSheet.create({
  label: { fontSize: 12, fontWeight: '800', letterSpacing: 0.4 },
  period: { fontSize: 20, fontWeight: '800', marginTop: 2 },
  meta: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  stats: { flexDirection: 'row', gap: 8, marginVertical: 12 },
  stat: { flex: 1, alignItems: 'center' },
  statLabel: { fontSize: 12, fontWeight: '700' },
  statValue: { fontSize: 20, fontWeight: '800', marginTop: 2 },
  shift: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 8, gap: 10 },
  shiftDate: { fontSize: 15, fontWeight: '700' },
  paid: { fontSize: 15, fontWeight: '800' },
  actions: { gap: 10, marginTop: 12 },
})
