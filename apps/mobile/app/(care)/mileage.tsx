/**
 * Mileage — miles driven for work.
 *   GET  /api/mileage?caregiverId=me   my entries ({ entries })
 *   POST /api/mileage                  { caregiverId: me, date, startLocation, endLocation, miles, clientId?, notes? }
 * Miles only: the reimbursement amount is the office's (the server applies its own rate).
 */
import React, { useCallback, useState } from 'react'
import { Text, StyleSheet, View, Alert } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { useTheme } from '../../src/theme/ThemeContext'
import { useToast } from '../../src/components/ToastProvider'
import { useCare } from '../../src/care/CareContext'
import { careGet, carePost, asList } from '../../src/care/careApi'
import { CareScreen } from '../../src/care/screen'
import { Banner, Button, Card, Choice, Field, SectionTitle } from '../../src/care/ui'
import { DateTimeField } from '../../src/care/components/DateTimeField'
import { formatYmdShort } from '../../src/care/time'

export default function MileageScreen() {
  const t = useTheme()
  const toast = useToast()
  const care = useCare()
  const [entries, setEntries] = useState<any[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [f, setF] = useState({ date: care.today, startLocation: '', endLocation: '', miles: '', clientId: '', notes: '' })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!care.userId) return
    const r = await careGet(`/api/mileage?caregiverId=${encodeURIComponent(care.userId)}&limit=30`)
    if (r.ok) { setEntries(asList(r.data, 'entries').filter((e: any) => !e.caregiverId || e.caregiverId === care.userId)); setFailed(false) }
    else { setFailed(true); setEntries((p) => p || []) }
  }, [care.userId])
  useFocusEffect(useCallback(() => { load() }, [load]))

  const save = async () => {
    const miles = Number(f.miles)
    if (!f.date) return Alert.alert('Pick the date')
    if (!Number.isFinite(miles) || miles <= 0 || miles > 1000) return Alert.alert('Enter the miles driven (more than 0)')
    if (!f.startLocation.trim() || !f.endLocation.trim()) return Alert.alert('Enter where you started and where you went')
    setSaving(true)
    const r = await carePost('/api/mileage', {
      caregiverId: care.userId, date: f.date, startLocation: f.startLocation.trim(), endLocation: f.endLocation.trim(),
      miles: String(miles), clientId: f.clientId || null, notes: f.notes.trim() || null,
    })
    setSaving(false)
    if (!r.ok) { Alert.alert('Not saved', r.status === 0 ? 'No connection — try again when you have signal.' : r.error || 'Please try again.'); return }
    toast.success(`${miles} mi logged`)
    setF({ date: care.today, startLocation: '', endLocation: '', miles: '', clientId: '', notes: '' })
    load()
  }

  const total = (entries || []).reduce((s, e) => s + (Number(e.miles) || 0), 0)
  return (
    <CareScreen keyboard onRefresh={load}>
      <SectionTitle>Log a trip</SectionTitle>
      <Card>
        <DateTimeField label="Date" mode="date" value={f.date} onChange={(v) => setF({ ...f, date: v })} maximumDate={new Date()} />
        <Field label="From" value={f.startLocation} onChangeText={(v) => setF({ ...f, startLocation: v })} placeholder="e.g. Home, or the last client's address" />
        <Field label="To" value={f.endLocation} onChangeText={(v) => setF({ ...f, endLocation: v })} placeholder="e.g. the client's address, the pharmacy" />
        <Field label="Miles" value={f.miles} onChangeText={(v) => setF({ ...f, miles: v })} keyboardType="decimal-pad" placeholder="0.0" />
        {care.clients.length > 0 && (
          <>
            <Text style={[styles.label, { color: t.text }]}>For a client (optional)</Text>
            {care.clients.map((c) => (
              <Choice key={c.id} label={`${c.first_name || ''} ${c.last_name || ''}`.trim()} selected={f.clientId === c.id} onPress={() => setF({ ...f, clientId: f.clientId === c.id ? '' : c.id })} />
            ))}
          </>
        )}
        <Field label="Notes (optional)" value={f.notes} onChangeText={(v) => setF({ ...f, notes: v })} multiline placeholder="Errand for the client, grocery run…" />
        <Button label="Save trip" icon="save-outline" loading={saving} onPress={save} />
      </Card>

      <SectionTitle right={entries && entries.length ? <Text style={[styles.meta, { color: t.textSecondary }]}>{total.toFixed(1)} mi</Text> : undefined}>Recent trips</SectionTitle>
      {failed && <Banner tone="warning" icon="cloud-offline-outline" onPress={load}>Trips didn't load. Tap to try again.</Banner>}
      {entries && entries.length === 0 && !failed && <Text style={[styles.meta, { color: t.textSecondary }]}>No trips logged yet.</Text>}
      {(entries || []).map((e) => (
        <Card key={e.id}>
          <View style={styles.row}>
            <Text style={[styles.date, { color: t.text }]}>{formatYmdShort(String(e.date).slice(0, 10))}</Text>
            <Text style={[styles.miles, { color: t.text }]}>{Number(e.miles || 0).toFixed(1)} mi</Text>
          </View>
          <Text style={[styles.meta, { color: t.textSecondary }]}>{[e.startLocation, e.endLocation].filter(Boolean).join(' → ')}</Text>
          {e.clientName ? <Text style={[styles.meta, { color: t.textSecondary }]}>{e.clientName}</Text> : null}
        </Card>
      ))}
    </CareScreen>
  )
}

const styles = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '700', marginBottom: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  date: { fontSize: 15, fontWeight: '700' },
  miles: { fontSize: 16, fontWeight: '800' },
  meta: { fontSize: 14, marginTop: 3 },
})
