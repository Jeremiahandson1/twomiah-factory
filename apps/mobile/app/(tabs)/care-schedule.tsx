/**
 * Schedule — the caregiver's next two weeks (Twomiah Care, home care vertical).
 *
 * Visits come from the schedule rows expanded on the phone with the server engine's rules
 * (src/care/schedule.ts). Each visit offers what the agency's web caregiver schedule offers:
 *   · Client not available  → POST /api/emergency/client-unavailable  (not billed, not paid)
 *   · Swap                  → POST /api/shift-swaps                    (a coworker takes it)
 *   · Move                  → POST /api/visit-change-requests/reschedule-request (office approves)
 *   · Can't make it         → POST /api/emergency/miss-report          (office finds coverage)
 * — each on /(care)/shift-action.
 */
import React, { useMemo } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { useRouter } from 'expo-router'
import { useTheme } from '../../src/theme/ThemeContext'
import { useCare } from '../../src/care/CareContext'
import { totalHours, type Visit } from '../../src/care/schedule'
import { addDaysYmd, dowOfYmd, formatTime12, formatYmdLong } from '../../src/care/time'
import { CareScreen } from '../../src/care/screen'
import { Banner, Button, Card, SectionTitle, useTone } from '../../src/care/ui'
import { EmptyState } from '../../src/components/EmptyState'
import { SkeletonList } from '../../src/components/SkeletonLoader'

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function actionParams(kind: string, v: Visit) {
  return {
    pathname: '/(care)/shift-action',
    params: { kind, scheduleId: v.scheduleId, date: v.date, start: v.startTime, end: v.endTime, clientName: v.clientName },
  }
}

function VisitCard({ v, movePending }: { v: Visit; movePending: boolean }) {
  const t = useTheme()
  const router = useRouter()
  const warn = useTone('warning')
  return (
    <Card>
      <TouchableOpacity onPress={() => router.push(`/(care)/client/${v.clientId}` as any)} accessibilityRole="button">
        <Text style={[styles.time, { color: t.text }]}>{formatTime12(v.startTime)} – {formatTime12(v.endTime)}</Text>
        <Text style={[styles.client, { color: t.text }]}>{v.clientName}</Text>
        {v.movedIn ? <Text style={[styles.meta, { color: t.textSecondary }]}>Covering this visit</Text> : null}
        {v.isTraining ? <Text style={[styles.meta, { color: t.textSecondary }]}>Training shift</Text> : null}
        {v.notes ? <Text style={[styles.meta, { color: t.textSecondary }]} numberOfLines={2}>{v.notes}</Text> : null}
      </TouchableOpacity>
      <View style={styles.actions}>
        <Button small variant="secondary" label="Client N/A" onPress={() => router.push(actionParams('unavailable', v) as any)} />
        <Button small variant="secondary" label="Swap" onPress={() => router.push(actionParams('swap', v) as any)} />
        {movePending
          ? <View style={[styles.pending, { backgroundColor: warn.bg, borderColor: warn.border }]}><Text style={[styles.pendingText, { color: warn.text }]}>Move sent</Text></View>
          : <Button small variant="secondary" label="Move" onPress={() => router.push(actionParams('move', v) as any)} />}
        <Button small variant="ghost" label="Can't make it" onPress={() => router.push(actionParams('miss', v) as any)} />
      </View>
    </Card>
  )
}

export default function ScheduleScreen() {
  const t = useTheme()
  const care = useCare()
  const pendingMoves = useMemo(() => new Set(care.myRequests.map((r) => `${r.schedule_id}|${String(r.visit_date).slice(0, 10)}`)), [care.myRequests])
  const byDate = useMemo(() => {
    const m: Record<string, Visit[]> = {}
    for (const v of care.visits) (m[v.date] ||= []).push(v)
    return m
  }, [care.visits])
  const week = Array.from({ length: 7 }, (_, i) => addDaysYmd(care.today, i))
  const weekHours = week.reduce((s, d) => s + totalHours(byDate[d] || []), 0)
  const dates = Object.keys(byDate).sort()

  if (care.loading && !care.visits.length) return <View style={{ flex: 1, backgroundColor: t.background }}><SkeletonList count={4} /></View>

  return (
    <CareScreen refreshing={care.refreshing} onRefresh={() => care.reload()}>
      {care.loadFailed && <Banner tone="warning" icon="cloud-offline-outline" onPress={() => care.reload()}>Showing the schedule saved on this phone. Tap to try again.</Banner>}
      <SectionTitle right={<Text style={[styles.meta, { color: t.textSecondary }]}>{weekHours.toFixed(1)} h scheduled</Text>}>Next 7 days</SectionTitle>
      <View style={styles.week}>
        {week.map((d, i) => {
          const n = (byDate[d] || []).length
          const today = i === 0
          return (
            <View key={d} style={[styles.day, { backgroundColor: today ? t.primaryLight : t.surface, borderColor: today ? t.primary : t.border }]}>
              <Text style={[styles.dayName, { color: t.textSecondary }]}>{DAY[dowOfYmd(d)]}</Text>
              <Text style={[styles.dayNum, { color: t.text }]}>{Number(d.slice(8, 10))}</Text>
              <Text style={[styles.dayHours, { color: n ? t.text : t.textSecondary }]}>{n ? `${totalHours(byDate[d]).toFixed(1)}h` : 'off'}</Text>
            </View>
          )
        })}
      </View>

      {dates.length === 0 && <EmptyState icon="calendar-outline" title="No upcoming visits" subtitle="Open shifts are under More." />}
      {dates.map((d) => (
        <View key={d}>
          <SectionTitle>{d === care.today ? `Today — ${formatYmdLong(d)}` : formatYmdLong(d)}</SectionTitle>
          {byDate[d].map((v) => <VisitCard key={v.key} v={v} movePending={pendingMoves.has(`${v.scheduleId}|${v.date}`)} />)}
        </View>
      ))}
    </CareScreen>
  )
}

const styles = StyleSheet.create({
  week: { flexDirection: 'row', gap: 4, marginBottom: 8 },
  day: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 8, alignItems: 'center' },
  dayName: { fontSize: 11, fontWeight: '700' },
  dayNum: { fontSize: 17, fontWeight: '800', marginTop: 2 },
  dayHours: { fontSize: 11, marginTop: 2, fontWeight: '600' },
  time: { fontSize: 15, fontWeight: '800' },
  client: { fontSize: 17, fontWeight: '700', marginTop: 2 },
  meta: { fontSize: 13, marginTop: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  pending: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, justifyContent: 'center', minHeight: 40 },
  pendingText: { fontSize: 14, fontWeight: '700' },
})
