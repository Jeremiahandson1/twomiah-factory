import React from 'react'
import { View, useWindowDimensions } from 'react-native'
import { Screen, StatTile, SectionHeader, Group, ListRow, Card, DText, Button, Badge, BottomBar, Icon, Avatar, layout, space, radius, useDesign, type BarItem } from '..'
import { statCardWidth } from '../../theme/insets'
import { COMPANY, PERSON, TILES, STAGES, JOBS_TODAY, VISITS, CARE_ATTENTION, type Trade, type Seat } from './sample'

const noop = () => {}

/** Bottom bar per trade and seat. Five slots; "More" is always last; alerts live in the header bell. No Leads tab (owner, 2026-10-28). */
const BAR: Record<Trade, Record<Seat, BarItem[]>> = {
  contractor: {
    owner: [home('Home'), jobs(), sched(), people('Contacts'), more()],
    manager: [home('Home'), jobs(), sched(), people('Contacts'), more()],
    staff: [home('Home'), jobs(), sched(), { key: 'time', label: 'Time', icon: 'time-outline', activeIcon: 'time' }, more()],
  },
  roofing: {
    owner: [{ key: 'home', label: 'Pipeline', icon: 'funnel-outline', activeIcon: 'funnel' }, jobs(), people('Contacts'), { key: 'canvass', label: 'Canvass', icon: 'walk-outline', activeIcon: 'walk' }, more()],
    manager: [{ key: 'home', label: 'Pipeline', icon: 'funnel-outline', activeIcon: 'funnel' }, jobs(), people('Contacts'), { key: 'canvass', label: 'Canvass', icon: 'walk-outline', activeIcon: 'walk' }, more()],
    staff: [{ key: 'home', label: 'Pipeline', icon: 'funnel-outline', activeIcon: 'funnel' }, jobs(), people('Contacts'), { key: 'canvass', label: 'Canvass', icon: 'walk-outline', activeIcon: 'walk' }, more()],
  },
  homecare: {
    owner: [home('Home'), sched(), people('Clients'), msgs(), more()],
    manager: [home('Home'), sched(), people('Clients'), msgs(), more()],
    staff: [home('Today'), sched(), { key: 'clock', label: 'Clock', icon: 'finger-print-outline', activeIcon: 'finger-print' }, msgs(), more()],
  },
}
function home(label: string): BarItem { return { key: 'home', label, icon: 'home-outline', activeIcon: 'home' } }
function jobs(): BarItem { return { key: 'jobs', label: 'Jobs', icon: 'hammer-outline', activeIcon: 'hammer' } }
function sched(): BarItem { return { key: 'schedule', label: 'Schedule', icon: 'calendar-outline', activeIcon: 'calendar' } }
function people(label: string): BarItem { return { key: 'people', label, icon: 'people-outline', activeIcon: 'people' } }
function msgs(): BarItem { return { key: 'messages', label: 'Messages', icon: 'chatbubbles-outline', activeIcon: 'chatbubbles', badge: 2 } }
function more(): BarItem { return { key: 'more', label: 'More', icon: 'ellipsis-horizontal-outline', activeIcon: 'ellipsis-horizontal' } }
export const barFor = (trade: Trade, seat: Seat) => BAR[trade][seat]

/** What each seat can start from the home screen — the permission the desktop asks, not the seat's name. */
const QUICK: Record<Trade, Record<Seat, { icon: string; label: string }[]>> = {
  contractor: {
    owner: [{ icon: 'add-circle', label: 'New lead' }, { icon: 'document-text', label: 'New quote' }, { icon: 'card', label: 'Take payment' }, { icon: 'camera', label: 'Add photo' }],
    manager: [{ icon: 'add-circle', label: 'New lead' }, { icon: 'document-text', label: 'New quote' }, { icon: 'hammer', label: 'New job' }, { icon: 'camera', label: 'Add photo' }],
    staff: [{ icon: 'camera', label: 'Add photo' }, { icon: 'create', label: 'Job note' }, { icon: 'chatbubble', label: 'Message office' }],
  },
  roofing: {
    owner: [{ icon: 'add-circle', label: 'New lead' }, { icon: 'document-text', label: 'New quote' }, { icon: 'walk', label: 'Canvass' }, { icon: 'camera', label: 'Add photo' }],
    manager: [{ icon: 'add-circle', label: 'New lead' }, { icon: 'document-text', label: 'New quote' }, { icon: 'walk', label: 'Canvass' }, { icon: 'camera', label: 'Add photo' }],
    staff: [{ icon: 'camera', label: 'Add photo' }, { icon: 'create', label: 'Job note' }, { icon: 'walk', label: 'Canvass' }],
  },
  homecare: {
    owner: [{ icon: 'person-add', label: 'New client' }, { icon: 'calendar', label: 'Schedule' }, { icon: 'alert-circle', label: 'Coverage' }, { icon: 'chatbubbles', label: 'Message' }],
    manager: [{ icon: 'person-add', label: 'New client' }, { icon: 'calendar', label: 'Schedule' }, { icon: 'alert-circle', label: 'Coverage' }, { icon: 'chatbubbles', label: 'Message' }],
    staff: [{ icon: 'swap-horizontal', label: 'Swap a shift' }, { icon: 'alert-circle', label: "Can't make it" }, { icon: 'document-text', label: 'Report' }],
  },
}

function QuickActions({ trade, seat }: { trade: Trade; seat: Seat }) {
  const { c } = useDesign()
  return (
    <View accessibilityRole="toolbar" style={{ flexDirection: 'row', gap: space[2] }}>
      {QUICK[trade][seat].map((q) => (
        <View key={q.label} style={{ flex: 1 }}>
          <Card onPress={noop} padded={false} accessibilityLabel={q.label} style={{ minHeight: 72, alignItems: 'center', justifyContent: 'center', gap: space[1], paddingHorizontal: space[1], backgroundColor: c.accentSoft, borderColor: 'transparent' }} level={0}>
            <Icon name={q.icon} size={24} tone="accent" />
            <DText variant="captionStrong" tone="accentText" style={{ textAlign: 'center' }} numberOfLines={2}>{q.label}</DText>
          </Card>
        </View>
      ))}
    </View>
  )
}

function Grid({ trade, seat }: { trade: Trade; seat: Seat }) {
  const { width } = useWindowDimensions()
  const w = statCardWidth(width, 2, layout.tileGap, layout.gutter)
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: layout.tileGap }}>
      {TILES[trade][seat].map((t, i, a) => <StatTile key={t.label} {...t} width={i === a.length - 1 && a.length % 2 === 1 ? w * 2 + layout.tileGap : w} onPress={noop} />)}
    </View>
  )
}

function ClockCard({ label = 'You are clocked out', action = 'Clock in', sub = 'Start the day when you reach your first job.' }: { label?: string; action?: string; sub?: string }) {
  const { c } = useDesign()
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
        <View style={{ width: 44, height: 44, borderRadius: radius.pill, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}><Icon name="time" size={24} tone="accent" /></View>
        <View style={{ flex: 1 }}><DText variant="bodyStrong">{label}</DText><DText variant="callout" tone="textSecondary">{sub}</DText></View>
      </View>
      <View style={{ height: space[3] }} />
      <Button label={action} icon="finger-print" size="lg" fullWidth />
    </Card>
  )
}

function JobsToday({ count, title = "Today's jobs" }: { count: number; title?: string }) {
  const list = JOBS_TODAY.slice(0, count)
  return (
    <View>
      <SectionHeader title={title} action="See all" onAction={noop} />
      <Group>{list.map((j, i) => <ListRow key={j.id} title={j.title} subtitle={`${j.customer} · ${j.address}`} meta={j.time} icon="hammer" onPress={noop} divider={i < list.length - 1} />)}</Group>
    </View>
  )
}

function Recent({ kind }: { kind: 'quotes' | 'invoices' }) {
  const rows = kind === 'quotes'
    ? [{ t: 'Q-2031 · Kitchen remodel', s: 'Alex Example', m: '$4,280', b: 'Sent', tone: 'info' as const }, { t: 'Q-2030 · Fence replacement', s: 'Casey Demo', m: '$2,950', b: 'Draft', tone: 'neutral' as const }]
    : [{ t: 'INV-5107 · Water heater', s: 'Jordan Sample', m: '$2,150', b: 'Overdue', tone: 'danger' as const }, { t: 'INV-5106 · Bathroom fan', s: 'Riley Placeholder', m: '$640', b: 'Sent', tone: 'info' as const }]
  return (
    <View>
      <SectionHeader title={kind === 'quotes' ? 'Recent quotes' : 'Recent invoices'} action="View all" onAction={noop} />
      <Group>{rows.map((r, i) => <ListRow key={r.t} title={r.t} subtitle={r.s} meta={r.m} badge={r.b} badgeTone={r.tone} onPress={noop} divider={i < rows.length - 1} />)}</Group>
    </View>
  )
}

function Pipeline({ money }: { money: boolean }) {
  return (
    <View>
      <SectionHeader title="Pipeline" action="Board" onAction={noop} />
      <Group>
        {STAGES.map((s, i) => (
          <ListRow key={s.label} title={s.label} subtitle={money ? s.value : undefined} meta={String(s.count)} onPress={noop} divider={i < STAGES.length - 1}
            icon={i < 3 ? 'search' : i < 6 ? 'document-text' : i < 8 ? 'hammer' : 'cash'} iconTone={i === STAGES.length - 1 ? 'success' : 'accent'} />
        ))}
      </Group>
    </View>
  )
}

export function HomePreview({ trade, seat }: { trade: Trade; seat: Seat }) {
  const { c } = useDesign()
  const first = PERSON[seat].split(' ')[0]
  const office = seat !== 'staff'
  return (
    <Screen title={trade === 'roofing' ? 'Pipeline' : `Hi, ${first}`} subtitle={`${COMPANY[trade]} · ${seat === 'staff' ? (trade === 'homecare' ? 'Caregiver' : 'Staff') : seat === 'owner' ? 'Owner' : 'Manager'}`}
      actions={[{ icon: 'search', label: 'Search' }, { icon: 'notifications-outline', label: 'Alerts', badge: 3 }]}
      bottomBar={<BottomBar items={barFor(trade, seat)} active="home" />}>
      {trade === 'contractor' && office && <>
        <Grid trade={trade} seat={seat} />
        <QuickActions trade={trade} seat={seat} />
        <JobsToday count={3} />
        <Recent kind="quotes" />
        <Recent kind="invoices" />
      </>}
      {trade === 'contractor' && !office && <>
        <ClockCard />
        <Grid trade={trade} seat={seat} />
        <QuickActions trade={trade} seat={seat} />
        <JobsToday count={2} title="Your day" />
      </>}
      {trade === 'roofing' && <>
        <View style={{ flexDirection: 'row', gap: layout.tileGap }}>
          <View style={{ flex: 1 }}><StatTile label="Inspections today" value="3" icon="search" tone="info" opens="today's 3 inspections" onPress={noop} /></View>
          <View style={{ flex: 1 }}><StatTile label="Installs today" value="1" icon="hammer" tone="success" opens="today's install" onPress={noop} /></View>
        </View>
        {seat === 'staff' && <ClockCard sub="Clock in when your crew arrives on site." />}
        <QuickActions trade={trade} seat={seat} />
        <Pipeline money={office} />
      </>}
      {trade === 'homecare' && office && <>
        <Group>{CARE_ATTENTION.map((a, i) => <ListRow key={a.label} title={a.label} subtitle={`Opens ${a.opens}`} icon={a.tone === 'danger' ? 'alert-circle' : 'notifications'} iconTone={a.tone} onPress={noop} divider={i < CARE_ATTENTION.length - 1} />)}</Group>
        <Grid trade={trade} seat={seat} />
        <QuickActions trade={trade} seat={seat} />
        <View><SectionHeader title="Today's visits" action="Schedule" onAction={noop} />
          <Group>{VISITS.map((v, i) => <ListRow key={v.id} title={v.who} subtitle={v.when} badge={v.status} badgeTone={v.tone} leading={<Avatar name={v.who} />} onPress={noop} divider={i < VISITS.length - 1} />)}</Group></View>
      </>}
      {trade === 'homecare' && !office && <>
        <Card>
          <DText variant="overline" tone="accentText">Next visit · 11:00 AM</DText>
          <DText variant="title" style={{ marginTop: space[1] }}>Quinn Sample</DText>
          <DText variant="callout" tone="textSecondary">42 Example Street · 2 hours</DText>
          <View style={{ height: space[3] }} />
          <View style={{ flexDirection: 'row', gap: space[2], flexWrap: 'wrap' }}><Button label="Directions" variant="secondary" icon="navigate" /><Button label="Clock in" icon="finger-print" /></View>
        </Card>
        <Grid trade={trade} seat={seat} />
        <QuickActions trade={trade} seat={seat} />
        <View><SectionHeader title="Today's visits" action="Schedule" onAction={noop} />
          <Group>{VISITS.map((v, i) => <ListRow key={v.id} title={v.who} subtitle={`${v.when} · ${v.what}`} badge={v.status} badgeTone={v.tone} leading={<Avatar name={v.who} />} onPress={noop} divider={i < VISITS.length - 1} />)}</Group></View>
      </>}
    </Screen>
  )
}
