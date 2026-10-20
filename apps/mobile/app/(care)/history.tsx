/**
 * Visit history — the caregiver's recent finished visits (GET /api/time-entries/recent, via CareContext).
 */
import React from 'react'
import { Text, StyleSheet, View } from 'react-native'
import { useTheme } from '../../src/theme/ThemeContext'
import { useCare } from '../../src/care/CareContext'
import { CareScreen } from '../../src/care/screen'
import { Card } from '../../src/care/ui'
import { EmptyState } from '../../src/components/EmptyState'
import { formatClock, formatYmdShort, ymdOf } from '../../src/care/time'

export default function HistoryScreen() {
  const t = useTheme()
  const care = useCare()
  return (
    <CareScreen refreshing={care.refreshing} onRefresh={() => care.reload()}>
      {care.recent.length === 0 && <EmptyState icon="time-outline" title="No finished visits yet" />}
      {care.recent.map((v) => {
        // GET /api/time-entries/recent: { id, clientId, startTime, endTime, notes, hoursWorked, clientName }
        const s = new Date(v.startTime), e = v.endTime ? new Date(v.endTime) : null
        return (
          <Card key={v.id}>
            <View style={styles.row}>
              <Text style={[styles.date, { color: t.text }]}>{isNaN(s.getTime()) ? '' : formatYmdShort(ymdOf(s))}</Text>
              <Text style={[styles.hours, { color: t.text }]}>{v.hoursWorked ? `${Number(v.hoursWorked).toFixed(2)} h` : '—'}</Text>
            </View>
            <Text style={[styles.client, { color: t.text }]}>{v.clientName || care.clientName(v.clientId)}</Text>
            <Text style={[styles.meta, { color: t.textSecondary }]}>{formatClock(s)}{e ? ` – ${formatClock(e)}` : ''}</Text>
            {v.notes ? <Text style={[styles.meta, { color: t.textSecondary }]} numberOfLines={3}>{v.notes}</Text> : null}
          </Card>
        )
      })}
    </CareScreen>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  date: { fontSize: 14, fontWeight: '700' },
  hours: { fontSize: 15, fontWeight: '800' },
  client: { fontSize: 16, fontWeight: '700', marginTop: 4 },
  meta: { fontSize: 14, marginTop: 3, lineHeight: 19 },
})
