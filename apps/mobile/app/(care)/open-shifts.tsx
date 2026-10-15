/**
 * Open shifts — visits the office posted for anyone (or offered to this caregiver).
 *   GET  /api/open-shifts/available     open, today or later, visible to me
 *   POST /api/open-shifts/:id/claim      first tap wins; "It's yours" when the office set first-come,
 *                                        otherwise pending the office's approval
 */
import React, { useCallback, useState } from 'react'
import { Text, StyleSheet, View, Alert } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { useTheme } from '../../src/theme/ThemeContext'
import { useCare } from '../../src/care/CareContext'
import { careGet, carePost, asList } from '../../src/care/careApi'
import { CareScreen } from '../../src/care/screen'
import { Banner, Button, Card } from '../../src/care/ui'
import { EmptyState } from '../../src/components/EmptyState'
import { SkeletonList } from '../../src/components/SkeletonLoader'
import { formatTime12, formatYmdLong } from '../../src/care/time'

export default function OpenShiftsScreen() {
  const t = useTheme()
  const care = useCare()
  const [list, setList] = useState<any[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await careGet('/api/open-shifts/available')
    if (r.ok) { setList(asList(r.data)); setFailed(false) } else { setFailed(true); setList((p) => p || []) }
  }, [])
  useFocusEffect(useCallback(() => { load() }, [load]))

  const claim = (s: any) => {
    Alert.alert('Take this shift?', `${s.client_first_name || ''} ${s.client_last_name || ''} — ${formatYmdLong(s.shift_date || s.date)}, ${formatTime12(s.start_time)} – ${formatTime12(s.end_time)}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Take it', onPress: async () => {
          setBusy(s.id)
          const r = await carePost(`/api/open-shifts/${s.id}/claim`)
          setBusy(null)
          if (r.ok) { Alert.alert(r.data?.assigned ? "It's yours" : 'Request sent', r.data?.message || 'The office will confirm it.'); load(); care.reload({ silent: true }) }
          else { Alert.alert("Couldn't take this shift", r.error || 'Please try again.'); load() }
        },
      },
    ])
  }

  if (list === null) return <View style={{ flex: 1, backgroundColor: t.background }}><SkeletonList count={3} /></View>
  return (
    <CareScreen onRefresh={load}>
      {failed && <Banner tone="warning" icon="cloud-offline-outline" onPress={load}>Open shifts didn't load. Tap to try again.</Banner>}
      {list.length === 0 && !failed && <EmptyState icon="briefcase-outline" title="No open shifts right now" subtitle="When the office posts one, it shows up here." />}
      {list.map((s) => (
        <Card key={s.id}>
          {s.urgency === 'urgent' || s.urgency === 'critical' ? <Banner tone="danger" icon="flash">Urgent — coverage needed</Banner> : null}
          <Text style={[styles.date, { color: t.text }]}>{formatYmdLong(s.shift_date || s.date)}</Text>
          <Text style={[styles.time, { color: t.text }]}>{formatTime12(s.start_time)} – {formatTime12(s.end_time)}</Text>
          <Text style={[styles.meta, { color: t.textSecondary }]}>{`${s.client_first_name || ''} ${s.client_last_name || ''}`.trim() || 'Client'}</Text>
          {Number(s.bonus_amount) > 0 ? <Text style={[styles.meta, { color: t.text, fontWeight: '700' }]}>Bonus ${Number(s.bonus_amount).toFixed(2)}</Text> : null}
          {s.notes ? <Text style={[styles.meta, { color: t.textSecondary }]}>{s.notes}</Text> : null}
          <Button style={{ marginTop: 12 }} label="Take this shift" icon="hand-right-outline" loading={busy === s.id} disabled={!!busy} onPress={() => claim(s)} />
        </Card>
      ))}
    </CareScreen>
  )
}

const styles = StyleSheet.create({
  date: { fontSize: 16, fontWeight: '800' },
  time: { fontSize: 15, fontWeight: '600', marginTop: 2 },
  meta: { fontSize: 14, marginTop: 4, lineHeight: 19 },
})
