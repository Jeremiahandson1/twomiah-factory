/**
 * Requests — visit changes waiting on someone (GET /api/visit-change-requests: open requests on my
 * visits, from either side).
 *   · From a client: approve / deny / suggest another time
 *       PUT /api/visit-change-requests/:id/resolve { action, counterDate?, counterStartTime?, counterEndTime?, counterMessage? }
 *   · Mine (asked to move a visit): waiting on the office — the server refuses to let me approve my own.
 */
import React, { useState } from 'react'
import { Text, StyleSheet, View, Alert } from 'react-native'
import { useTheme } from '../../src/theme/ThemeContext'
import { useToast } from '../../src/components/ToastProvider'
import { useCare } from '../../src/care/CareContext'
import { carePut } from '../../src/care/careApi'
import { CareScreen } from '../../src/care/screen'
import { Banner, Button, Card, Field, SectionTitle } from '../../src/care/ui'
import { EmptyState } from '../../src/components/EmptyState'
import { formatTime12, formatYmdShort, isYmd } from '../../src/care/time'

function ClientRequest({ r }: { r: any }) {
  const t = useTheme()
  const toast = useToast()
  const care = useCare()
  const [busy, setBusy] = useState(false)
  const [counter, setCounter] = useState(false)
  const [f, setF] = useState({ date: '', start: '', end: '', message: '' })

  const resolve = async (action: 'approve' | 'deny' | 'counter') => {
    if (action === 'counter') {
      if (!isYmd(f.date) || !/^\d{1,2}:\d{2}$/.test(f.start) || !/^\d{1,2}:\d{2}$/.test(f.end)) { toast.warning('Enter the date as YYYY-MM-DD and times as HH:MM.'); return }
    }
    setBusy(true)
    const res = await carePut(`/api/visit-change-requests/${r.id}/resolve`, action === 'counter'
      ? { action, counterDate: f.date, counterStartTime: f.start, counterEndTime: f.end, counterMessage: f.message || null }
      : { action })
    setBusy(false)
    if (res.ok) { toast.success(action === 'approve' ? 'Approved.' : action === 'deny' ? 'Declined.' : 'Suggestion sent to the client.'); care.reload({ silent: true }) }
    else Alert.alert('Not saved', res.error || 'Please try again.')
  }

  return (
    <Card>
      <Text style={[styles.title, { color: t.text }]}>{`${r.client_first_name || ''} ${r.client_last_name || ''}`.trim()}</Text>
      <Text style={[styles.meta, { color: t.text }]}>
        {r.request_type === 'cancel' ? 'Wants to cancel' : 'Wants to move'} the visit on {formatYmdShort(r.visit_date)} at {formatTime12(r.original_start_time)}
      </Text>
      {r.request_type === 'reschedule' && r.proposed_date ? (
        <Text style={[styles.meta, { color: t.text }]}>To: {formatYmdShort(r.proposed_date)}, {formatTime12(r.proposed_start_time)} – {formatTime12(r.proposed_end_time)}</Text>
      ) : null}
      {r.cancel_reason ? <Text style={[styles.meta, { color: t.textSecondary }]}>Reason: {r.cancel_reason}</Text> : null}
      {r.request_reason ? <Text style={[styles.meta, { color: t.textSecondary }]}>"{r.request_reason}"</Text> : null}
      {r.status === 'counter_offered' && <Text style={[styles.meta, { color: t.textSecondary }]}>You suggested {formatYmdShort(r.counter_date)} at {formatTime12(r.counter_start_time)} — waiting on the client.</Text>}
      {counter ? (
        <View style={{ marginTop: 10 }}>
          <Field label="Suggested date (YYYY-MM-DD)" value={f.date} onChangeText={(v) => setF({ ...f, date: v })} autoCapitalize="none" />
          <Field label="Start (HH:MM, 24-hour)" value={f.start} onChangeText={(v) => setF({ ...f, start: v })} keyboardType="numbers-and-punctuation" />
          <Field label="End (HH:MM, 24-hour)" value={f.end} onChangeText={(v) => setF({ ...f, end: v })} keyboardType="numbers-and-punctuation" />
          <Field label="Message to the client (optional)" value={f.message} onChangeText={(v) => setF({ ...f, message: v })} multiline />
          <View style={styles.actions}>
            <Button small label="Send suggestion" loading={busy} onPress={() => resolve('counter')} />
            <Button small variant="secondary" label="Back" disabled={busy} onPress={() => setCounter(false)} />
          </View>
        </View>
      ) : r.status === 'pending' ? (
        <View style={styles.actions}>
          <Button small variant="success" label="Approve" loading={busy} disabled={busy} onPress={() => resolve('approve')} />
          <Button small variant="secondary" label="Decline" disabled={busy} onPress={() => resolve('deny')} />
          {r.request_type === 'reschedule' && <Button small variant="ghost" label="Suggest another time" disabled={busy} onPress={() => setCounter(true)} />}
        </View>
      ) : null}
    </Card>
  )
}

export default function RequestsScreen() {
  const t = useTheme()
  const care = useCare()
  return (
    <CareScreen keyboard refreshing={care.refreshing} onRefresh={() => care.reload()}>
      <SectionTitle>From your clients</SectionTitle>
      {care.clientRequests.length
        ? care.clientRequests.map((r) => <ClientRequest key={r.id} r={r} />)
        : <Text style={[styles.meta, { color: t.textSecondary, marginBottom: 12 }]}>No client requests.</Text>}

      <SectionTitle>Waiting on the office</SectionTitle>
      {care.myRequests.length === 0 && <EmptyState icon="git-compare-outline" title="Nothing waiting" subtitle="To ask to move a visit, open it on the Schedule tab and tap Move." />}
      {care.myRequests.map((r) => (
        <Card key={r.id}>
          <Text style={[styles.title, { color: t.text }]}>{`${r.client_first_name || ''} ${r.client_last_name || ''}`.trim()}</Text>
          <Text style={[styles.meta, { color: t.text }]}>
            {formatYmdShort(r.visit_date)} {formatTime12(r.original_start_time)} → {formatYmdShort(r.proposed_date)} {formatTime12(r.proposed_start_time)}–{formatTime12(r.proposed_end_time)}
          </Text>
          {r.status === 'counter_offered'
            ? <Banner tone="info" icon="chatbox-ellipses-outline">{`The office suggested ${formatYmdShort(r.counter_date)} at ${formatTime12(r.counter_start_time)}${r.counter_message ? ` — "${r.counter_message}"` : ''}. Call the office to confirm.`}</Banner>
            : <Text style={[styles.meta, { color: t.textSecondary }]}>Pending — work the original time until the office approves it.</Text>}
        </Card>
      ))}
    </CareScreen>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 16, fontWeight: '800' },
  meta: { fontSize: 14, marginTop: 4, lineHeight: 19 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
})
