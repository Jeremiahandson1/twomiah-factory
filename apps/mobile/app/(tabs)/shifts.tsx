/**
 * Today — the caregiver's home screen (Twomiah Care, home care vertical).
 *
 * What to do right now (the visit in progress, or the next one, with directions), then anything
 * waiting on the caregiver: punches saved on the phone, the Sandata check-in reminder, unread
 * messages, a coworker's swap request, documents to sign, client requests, payday verification —
 * then today's visits and the quick actions. All data from src/care/CareContext.tsx.
 */
import React, { useEffect, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../src/theme/ThemeContext'
import { useAuth } from '../../src/auth/AuthContext'
import { usePushNotifications } from '../../src/hooks/usePushNotifications'
import { useCare } from '../../src/care/CareContext'
import { nextUp, type Visit } from '../../src/care/schedule'
import { formatDuration, formatTime12, formatYmdLong, formatYmdShort } from '../../src/care/time'
import { CareScreen, openDirections } from '../../src/care/screen'
import { Banner, BannerText, Button, Card, SectionTitle, useTone, usePrimaryInk } from '../../src/care/ui'
import { SandataNotice, SandataPromptCard } from '../../src/care/components/Sandata'
import { SkeletonList } from '../../src/components/SkeletonLoader'
import { EmptyState } from '../../src/components/EmptyState'

function nowMinutes() { const d = new Date(); return d.getHours() * 60 + d.getMinutes() }

function VisitRow({ v, active }: { v: Visit; active: boolean }) {
  const t = useTheme()
  const okTone = useTone('success')
  const link = usePrimaryInk()
  const router = useRouter()
  const addr = [v.clientAddress, v.clientCity].filter(Boolean).join(', ')
  return (
    <Card style={active ? { borderColor: t.primary, borderWidth: 2 } : undefined} onPress={() => router.push(`/(care)/client/${v.clientId}` as any)}>
      <View style={styles.rowTop}>
        <View style={[styles.timePill, { backgroundColor: t.primaryLight }]}>
          <Text style={[styles.timePillText, { color: t.text }]}>{formatTime12(v.startTime)}</Text>
          <Text style={[styles.timePillSub, { color: t.textSecondary }]}>{formatTime12(v.endTime)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.client, { color: t.text }]} numberOfLines={1}>{v.clientName}</Text>
          {active && <Text style={[styles.meta, { color: okTone.text, fontWeight: '700' }]}>On this visit now</Text>}
          {v.movedIn && <Text style={[styles.meta, { color: t.textSecondary }]}>Covering this visit</Text>}
          {v.careType ? <Text style={[styles.meta, { color: t.textSecondary }]}>{v.careType}</Text> : null}
          {addr ? (
            <TouchableOpacity onPress={() => openDirections(addr)} accessibilityRole="link" style={styles.addrRow}>
              <Ionicons name="navigate" size={14} color={t.primary} />
              <Text style={[styles.addr, { color: link }]} numberOfLines={1}>{addr}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={18} color={t.textSecondary} />
      </View>
      {v.notes ? <Text style={[styles.notes, { color: t.textSecondary }]} numberOfLines={3}>{v.notes}</Text> : null}
    </Card>
  )
}

function Hero() {
  const t = useTheme()
  const router = useRouter()
  const care = useCare()
  const n = nextUp(care.todayVisits, nowMinutes(), care.active?.clientId)
  const success = useTone('success'), danger = useTone('danger'), warning = useTone('warning'), neutral = useTone('neutral')

  if (care.active && n.state !== 'in_progress' && n.state !== 'overdue') {
    // Clocked in to a visit that isn't on today's schedule.
    return (
      <Banner tone="success" icon="time" title={`On a visit with ${care.active.clientName || care.clientName(care.active.clientId)}`} onPress={() => router.push('/(tabs)/time-clock' as any)}>
        <BannerText tone="success">Tap to open the visit — tasks, notes, photos, clock out.</BannerText>
      </Banner>
    )
  }
  if (n.state === 'none') {
    return <Banner tone="neutral" icon="sunny-outline" title="No visits on your schedule today">Pick up an open shift from More, or pull down to refresh.</Banner>
  }
  if (n.state === 'done') {
    return <Banner tone="success" icon="checkmark-done" title="All visits done for today">Nice work — check your schedule for tomorrow.</Banner>
  }
  const v = n.visit
  const addr = [v.clientAddress, v.clientCity].filter(Boolean).join(', ')
  const c = n.state === 'overdue' ? danger : n.state === 'in_progress' ? success : n.state === 'starting_soon' || n.state === 'due_now' ? warning : neutral
  const until = 'minutesUntilStart' in n ? n.minutesUntilStart : 0
  const label = n.state === 'overdue' ? 'ON A VISIT — PAST THE SCHEDULED END'
    : n.state === 'in_progress' ? 'ON A VISIT NOW'
      : n.state === 'due_now' ? 'DUE NOW'
        : n.state === 'starting_soon' ? `STARTING IN ${until} MIN`
          : `NEXT UP · IN ${formatDuration(until).toUpperCase()}`
  return (
    <View style={[styles.hero, { backgroundColor: c.bg, borderColor: c.border }]}>
      <Text style={[styles.heroLabel, { color: c.text }]}>{label}</Text>
      <Text style={[styles.heroName, { color: c.text }]}>{v.clientName}</Text>
      <Text style={[styles.heroMeta, { color: c.text }]}>{formatTime12(v.startTime)} – {formatTime12(v.endTime)}</Text>
      {addr ? <Text style={[styles.heroMeta, { color: c.text }]}>{addr}</Text> : null}
      <View style={styles.heroActions}>
        {n.state === 'in_progress' || n.state === 'overdue' ? (
          <Button style={{ flex: 1 }} label="Open visit" icon="time" onPress={() => router.push('/(tabs)/time-clock' as any)} />
        ) : (
          <Button style={{ flex: 1 }} label="Start visit" icon="play-circle" onPress={() => router.push({ pathname: '/(tabs)/time-clock', params: { clientId: v.clientId } } as any)} />
        )}
        {addr ? <Button variant="secondary" label="Directions" icon="navigate" onPress={() => openDirections(addr)} /> : null}
      </View>
    </View>
  )
}

export default function TodayScreen() {
  const t = useTheme()
  const router = useRouter()
  const { user } = useAuth()
  const care = useCare()
  const [sending, setSending] = useState(false)
  const warnTone = useTone('warning')
  // Registers this phone's Expo token: POST /api/push/expo-token { token, platform }
  // (apps/unified/server/crm/homecare/portals/notifications.ts), so shift reminders reach the caregiver.
  usePushNotifications({ registerWithServer: true, fallbackRoute: '/(care)/notifications' })

  // Re-render each minute so "next up" and "starting soon" stay true.
  const [, tick] = useState(0)
  useEffect(() => { const iv = setInterval(() => tick((x) => x + 1), 60000); return () => clearInterval(iv) }, [])

  if (care.loading && !care.todayVisits.length) return <View style={{ flex: 1, backgroundColor: t.background }}><SkeletonList count={4} /></View>

  const p = care.payday
  return (
    <CareScreen refreshing={care.refreshing} onRefresh={() => care.reload()}>
      <SandataNotice />
      <Text style={[styles.greeting, { color: t.text }]}>Hi {user?.firstName || 'there'}</Text>
      <Text style={[styles.date, { color: t.textSecondary }]}>{formatYmdLong(care.today)}</Text>

      {!care.isCaregiver && (
        <Banner tone="info" icon="information-circle">This app is built for caregivers. Signed in as office staff, it shows only your own visits — the office dashboard is on the web.</Banner>
      )}
      {care.loadFailed && (
        <Banner tone="warning" icon="cloud-offline-outline" title="Couldn't reach your agency" onPress={() => care.reload()}>
          <BannerText tone="warning">Showing what's saved on this phone. You can still clock in — tap to try again.</BannerText>
        </Banner>
      )}
      {care.pendingPunches > 0 && (
        <Banner tone="warning" icon="cloud-upload-outline" title={`${care.pendingPunches} punch${care.pendingPunches === 1 ? '' : 'es'} saved on this phone`}>
          <BannerText tone="warning">They send by themselves, with the time you tapped, when you have signal.</BannerText>
          <Button small variant="secondary" style={{ marginTop: 8, alignSelf: 'flex-start' }} label="Send now" icon="refresh" loading={sending}
            onPress={async () => { setSending(true); try { await care.sendSavedPunches() } finally { setSending(false) } }} />
        </Banner>
      )}

      <SandataPromptCard />
      <Hero />

      {care.unreadMessages > 0 && (
        <Banner tone="info" icon="chatbubbles" title={`${care.unreadMessages} new message${care.unreadMessages === 1 ? '' : 's'}`} onPress={() => router.push('/(tabs)/messages' as any)}>
          Tap to read — updates from your office.
        </Banner>
      )}
      {care.incomingSwaps.length > 0 && (
        <Banner tone="info" icon="swap-horizontal" title={`${care.incomingSwaps.length} shift swap request${care.incomingSwaps.length === 1 ? '' : 's'} for you`} onPress={() => router.push('/(care)/swaps' as any)}>
          A coworker is asking you to take a shift.
        </Banner>
      )}
      {care.unsignedDocs.length > 0 && (
        <Banner tone="danger" icon="create" title={`${care.unsignedDocs.length} document${care.unsignedDocs.length === 1 ? '' : 's'} need your signature`} onPress={() => router.push('/(care)/documents' as any)}>
          Tap to read and sign.
        </Banner>
      )}
      {care.clientRequests.length > 0 && (
        <Banner tone="warning" icon="mail-unread" title={`${care.clientRequests.length} client request${care.clientRequests.length === 1 ? '' : 's'}`} onPress={() => router.push('/(care)/requests' as any)}>
          A client asked to cancel or move a visit.
        </Banner>
      )}
      {care.myRequests.length > 0 && (
        <Banner tone="neutral" icon="hourglass-outline" title={`Waiting on the office (${care.myRequests.length})`} onPress={() => router.push('/(care)/requests' as any)}>
          Your request to move a visit. Work the original time until it is approved.
        </Banner>
      )}
      {care.paydayVisible && p && (
        <Banner tone="info" icon="cash-outline" title="Please confirm your hours">
          <BannerText tone="info">Pay period {formatYmdShort(p.payPeriodStart)} – {formatYmdShort(p.payPeriodEnd)}{p.totalHours != null ? ` · ${Number(p.totalHours).toFixed(2)} h` : ''}</BannerText>
          <View style={styles.inlineActions}>
            <Button small label="Review" onPress={() => router.push('/(care)/payday' as any)} />
            <Button small variant="secondary" label="Remind me later" onPress={care.snoozePaydayNow} />
          </View>
        </Banner>
      )}

      {care.hoursThisWeek != null && (
        <Card>
          <View style={styles.rowTop}>
            <Ionicons name="stats-chart" size={22} color={t.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.meta, { color: t.textSecondary }]}>Scheduled this week</Text>
              <Text style={[styles.hours, { color: t.text }]}>{care.hoursThisWeek.toFixed(2)} h</Text>
            </View>
          </View>
          {care.hoursThisWeek > 35 && <Text style={[styles.meta, { color: warnTone.text, fontWeight: '700', marginTop: 6 }]}>Close to 40 hours this week.</Text>}
        </Card>
      )}

      <SectionTitle right={<Button small variant="ghost" label="Full schedule" onPress={() => router.push('/(tabs)/care-schedule' as any)} />}>Today's visits</SectionTitle>
      {care.todayVisits.length === 0
        ? <EmptyState icon="calendar-outline" title="Nothing scheduled today" />
        : care.todayVisits.map((v) => <VisitRow key={v.key} v={v} active={care.active?.clientId === v.clientId} />)}

      <SectionTitle>Quick actions</SectionTitle>
      <View style={styles.grid}>
        {[
          { icon: 'briefcase-outline', label: 'Open shifts', to: '/(care)/open-shifts' },
          { icon: 'alert-circle-outline', label: "Can't make a shift", to: '/(care)/shift-action?kind=miss' },
          { icon: 'warning-outline', label: 'Report incident', to: '/(care)/incident' },
          { icon: 'document-text-outline', label: 'Documents', to: '/(care)/documents' },
          { icon: 'car-outline', label: 'Mileage', to: '/(care)/mileage' },
          { icon: 'people-outline', label: 'My clients', to: '/(care)/clients' },
        ].map((a) => (
          <TouchableOpacity key={a.label} style={[styles.tile, { backgroundColor: t.surface, borderColor: t.border }]} onPress={() => router.push(a.to as any)} accessibilityRole="button">
            <Ionicons name={a.icon as any} size={24} color={t.primary} />
            <Text style={[styles.tileText, { color: t.text }]}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </CareScreen>
  )
}

const styles = StyleSheet.create({
  greeting: { fontSize: 24, fontWeight: '800' },
  date: { fontSize: 15, marginBottom: 14 },
  hero: { borderWidth: 1.5, borderRadius: 16, padding: 16, marginBottom: 12 },
  heroLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  heroName: { fontSize: 22, fontWeight: '800', marginTop: 4 },
  heroMeta: { fontSize: 15, marginTop: 2 },
  heroActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  timePill: { width: 76, borderRadius: 10, paddingVertical: 8, alignItems: 'center' },
  timePillText: { fontSize: 14, fontWeight: '800' },
  timePillSub: { fontSize: 12, marginTop: 2 },
  client: { fontSize: 17, fontWeight: '700' },
  meta: { fontSize: 13, marginTop: 2 },
  addrRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  addr: { fontSize: 14, fontWeight: '600', flexShrink: 1 },
  notes: { fontSize: 13, marginTop: 10, lineHeight: 18 },
  hours: { fontSize: 22, fontWeight: '800' },
  inlineActions: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '31%', flexGrow: 1, borderWidth: 1, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 8, alignItems: 'center', gap: 8 },
  tileText: { fontSize: 13, fontWeight: '700', textAlign: 'center' },
})
