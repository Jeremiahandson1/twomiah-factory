/**
 * Shift swaps — a coworker takes ONE day of a shift; the office approves.
 *   GET /api/shift-swaps                    swaps I'm in (as the asker or the one asked)
 *   PUT /api/shift-swaps/:id/respond        { accepted } — only the caregiver asked answers
 *   PUT /api/shift-swaps/:id/cancel         the asker withdraws
 * New swap requests start from a visit on the Schedule tab.
 */
import React, { useState } from 'react'
import { Text, StyleSheet, View, Alert } from 'react-native'
import { useTheme } from '../../src/theme/ThemeContext'
import { useToast } from '../../src/components/ToastProvider'
import { useCare } from '../../src/care/CareContext'
import { carePut } from '../../src/care/careApi'
import { CareScreen } from '../../src/care/screen'
import { Button, Card, SectionTitle } from '../../src/care/ui'
import { EmptyState } from '../../src/components/EmptyState'
import { StatusBadge } from '../../src/components/StatusBadge'
import { formatTime12, formatYmdLong } from '../../src/care/time'

export default function SwapsScreen() {
  const t = useTheme()
  const toast = useToast()
  const care = useCare()
  const [busy, setBusy] = useState<string | null>(null)
  const me = care.userId
  // GET /api/shift-swaps rows: { id, requesterId, targetId, shiftDate, startTime, endTime, status, reason,
  //   clientFirstName, clientLastName, requesterFirstName, requesterLastName, targetFirstName, targetLastName }
  const incoming = care.swaps.filter((s) => s.targetId === me)
  const outgoing = care.swaps.filter((s) => s.requesterId === me)

  const act = async (s: any, path: string, body: any, ok: string) => {
    setBusy(s.id)
    const r = await carePut(`/api/shift-swaps/${s.id}/${path}`, body)
    setBusy(null)
    if (r.ok) { toast.success(ok); care.reload({ silent: true }) } else Alert.alert('Not saved', r.error || 'Please try again.')
  }

  const row = (s: any, mine: boolean) => (
    <Card key={s.id}>
      <View style={styles.head}>
        <Text style={[styles.date, { color: t.text }]}>{formatYmdLong(s.shiftDate)}</Text>
        <StatusBadge status={s.status === 'accepted' ? 'approved' : s.status === 'rejected' ? 'rejected' : s.status === 'cancelled' ? 'cancelled' : s.status} label={s.status === 'accepted' ? 'Accepted — office to approve' : undefined} />
      </View>
      <Text style={[styles.meta, { color: t.text }]}>{formatTime12(s.startTime)} – {formatTime12(s.endTime)} · {`${s.clientFirstName || ''} ${s.clientLastName || ''}`.trim()}</Text>
      <Text style={[styles.meta, { color: t.textSecondary }]}>
        {mine ? `You asked ${`${s.targetFirstName || ''} ${s.targetLastName || ''}`.trim() || 'a coworker'}` : `${`${s.requesterFirstName || ''} ${s.requesterLastName || ''}`.trim() || 'A coworker'} asked you to take it`}
      </Text>
      {s.reason ? <Text style={[styles.meta, { color: t.textSecondary }]}>"{s.reason}"</Text> : null}
      {!mine && s.status === 'pending' && (
        <View style={styles.actions}>
          <Button small variant="success" label="Take it" loading={busy === s.id} disabled={!!busy} onPress={() => act(s, 'respond', { accepted: true }, 'Accepted — the office approves the swap.')} />
          <Button small variant="secondary" label="Decline" disabled={!!busy} onPress={() => act(s, 'respond', { accepted: false }, 'Declined.')} />
        </View>
      )}
      {mine && (s.status === 'pending' || s.status === 'accepted') && (
        <View style={styles.actions}>
          <Button small variant="secondary" label="Withdraw" loading={busy === s.id} disabled={!!busy} onPress={() => act(s, 'cancel', {}, 'Swap request withdrawn.')} />
        </View>
      )}
    </Card>
  )

  return (
    <CareScreen refreshing={care.refreshing} onRefresh={() => care.reload()}>
      <SectionTitle>Asked of you</SectionTitle>
      {incoming.length ? incoming.map((s) => row(s, false)) : <Text style={[styles.meta, { color: t.textSecondary, marginBottom: 12 }]}>No one has asked you to take a shift.</Text>}
      <SectionTitle>You asked</SectionTitle>
      {outgoing.length ? outgoing.map((s) => row(s, true)) : <EmptyState icon="swap-horizontal" title="No swap requests" subtitle="To ask a coworker, open a visit on the Schedule tab and tap Swap." />}
    </CareScreen>
  )
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  date: { fontSize: 16, fontWeight: '800', flex: 1 },
  meta: { fontSize: 14, marginTop: 4, lineHeight: 19 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
})
