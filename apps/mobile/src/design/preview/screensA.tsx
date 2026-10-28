import React from 'react'
import { View } from 'react-native'
import { Screen, SearchField, ChipRow, Chip, Card, Group, ListRow, DText, Badge, Button, Icon, Avatar, SectionHeader, BottomSheet, TextField, BottomBar, space, radius, layout, useDesign } from '..'
import { LEADS, JOBS_TODAY, VISITS } from './sample'
import { barFor } from './homes'

const noop = () => {}
const bar = (active: string) => <BottomBar items={barFor('contractor', 'owner')} active={active} />

function Banner({ text }: { text: string }) {
  const { c } = useDesign()
  return <View style={{ flexDirection: 'row', gap: space[2], alignItems: 'center', backgroundColor: c.accentSoft, borderRadius: radius.md, padding: space[3] }}><Icon name="funnel" size={18} tone="accent" /><DText variant="callout" tone="accentText" style={{ flex: 1 }}>{text}</DText></View>
}
function Money({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return <View style={{ flex: 1 }}><DText variant="caption" tone="textSubtle">{label}</DText><DText variant="title" tone={tone === 'danger' ? 'danger' : 'text'}>{value}</DText></View>
}
function KV({ k, v, last }: { k: string; v: string; last?: boolean }) { return <ListRow title={k} meta={v} divider={!last} /> }
function Actions4({ items }: { items: { icon: string; label: string }[] }) {
  const { c } = useDesign()
  return (
    <View style={{ flexDirection: 'row', gap: space[2] }}>
      {items.map((a) => (
        <View key={a.label} style={{ flex: 1 }}>
          <Card onPress={noop} padded={false} level={0} accessibilityLabel={a.label} style={{ minHeight: 68, alignItems: 'center', justifyContent: 'center', gap: space[1], backgroundColor: c.surface }}>
            <Icon name={a.icon} size={22} tone="accent" /><DText variant="captionStrong" tone="accentText">{a.label}</DText>
          </Card>
        </View>
      ))}
    </View>
  )
}

export function LeadsList() {
  return (
    <Screen title="Leads" subtitle="4 waiting for an answer" actions={[{ icon: 'add', label: 'New lead' }]} bottomBar={bar('more')}>
      <Banner text="From the New leads tile: 4 leads that nobody has answered yet." />
      <SearchField value="" onChangeText={noop} placeholder="Search leads" />
      <View style={{ marginHorizontal: -layout.gutter }}><ChipRow><Chip label="New" count={4} selected /><Chip label="Contacted" count={6} /><Chip label="Quoted" count={3} /><Chip label="Won" count={12} /><Chip label="Lost" count={2} /></ChipRow></View>
      {LEADS.map((l) => (
        <Card key={l.id} onPress={noop} accessibilityLabel={`${l.name}, ${l.what}, ${l.source}, ${l.age}`}>
          <View style={{ flexDirection: 'row', gap: space[3], alignItems: 'center' }}>
            <Avatar name={l.name} size={44} />
            <View style={{ flex: 1 }}><DText variant="bodyStrong">{l.name}</DText><DText variant="callout" tone="textSecondary">{l.what}</DText></View>
            <Badge label={l.age} tone={l.tone} icon={l.tone === 'danger' ? 'time' : undefined} />
          </View>
          <View style={{ height: space[3] }} />
          <View style={{ flexDirection: 'row', gap: space[2], alignItems: 'center' }}>
            <Icon name="link" size={16} tone="subtle" /><DText variant="caption" tone="textSubtle" style={{ flex: 1 }}>{l.source}</DText>
            <Button label="Call" variant="tonal" icon="call" /><Button label="Text" variant="tonal" icon="chatbubble" />
          </View>
        </Card>
      ))}
    </Screen>
  )
}

export function LeadDetail() {
  return (
    <Screen title="Alex Example" subtitle="Lead · Website form · Today" onBack={noop} actions={[{ icon: 'ellipsis-horizontal', label: 'More options' }]}
      footer={<View style={{ flexDirection: 'row', gap: space[2] }}><View style={{ flex: 1 }}><Button label="Create quote" icon="document-text" size="lg" fullWidth /></View></View>}>
      <View style={{ flexDirection: 'row', gap: space[2], alignItems: 'center' }}><Badge label="New" tone="info" /><DText variant="caption" tone="textSubtle">Nobody has answered yet</DText></View>
      <Actions4 items={[{ icon: 'call', label: 'Call' }, { icon: 'chatbubble', label: 'Text' }, { icon: 'mail', label: 'Email' }, { icon: 'navigate', label: 'Directions' }]} />
      <Group><KV k="Phone" v="(555) 010-0142" /><KV k="Email" v="alex@example.test" /><KV k="Address" v="100 Example St" last /></Group>
      <View><SectionHeader title="What they asked for" /><Card><DText variant="body">Looking for an estimate to redo a small kitchen: new counters, sink and a backsplash. Would like someone to visit this week.</DText></Card></View>
      <View><SectionHeader title="Status" /><View style={{ marginHorizontal: -layout.gutter }}><ChipRow><Chip label="New" selected /><Chip label="Contacted" /><Chip label="Quoted" /><Chip label="Won" /><Chip label="Lost" /></ChipRow></View></View>
      <TextField label="Add a note" value="" placeholder="Spoke with them, visit set for Friday…" multiline />
    </Screen>
  )
}

export function JobsFiltered() {
  return (
    <Screen title="Jobs" subtitle="6 jobs today" actions={[{ icon: 'add', label: 'New job' }]} bottomBar={<BottomBar items={barFor('contractor', 'owner')} active="jobs" />}>
      <Banner text="From the Jobs today tile: exactly the 6 jobs it counts." />
      <View style={{ marginHorizontal: -layout.gutter }}><ChipRow><Chip label="Today" count={6} selected /><Chip label="This week" count={21} /><Chip label="Unscheduled" count={4} /><Chip label="Done" count={58} /></ChipRow></View>
      <Group>{JOBS_TODAY.map((j, i) => <ListRow key={j.id} title={j.title} subtitle={`${j.number} · ${j.customer}`} meta={j.time} badge={j.status} badgeTone={j.tone} onPress={noop} divider={i < JOBS_TODAY.length - 1} />)}</Group>
    </Screen>
  )
}

export function JobDetail() {
  const { c } = useDesign()
  return (
    <Screen title="J-1042" subtitle="Replace kitchen faucet" onBack={noop} actions={[{ icon: 'ellipsis-horizontal', label: 'More options' }]}
      footer={<View style={{ flexDirection: 'row', gap: space[2] }}><Button label="Add photo" variant="secondary" icon="camera" size="lg" /><View style={{ flex: 1 }}><Button label="Mark complete" icon="checkmark-circle" size="lg" fullWidth /></View></View>}>
      <View style={{ flexDirection: 'row', gap: space[2], alignItems: 'center' }}><Badge label="In progress" tone="accent" icon="play" /><DText variant="caption" tone="textSubtle">Started 8:05 AM</DText></View>
      <Card>
        <View style={{ flexDirection: 'row', gap: space[3], alignItems: 'center' }}><Avatar name="Alex Example" size={44} /><View style={{ flex: 1 }}><DText variant="bodyStrong">Alex Example</DText><DText variant="callout" tone="textSecondary">100 Example St</DText></View></View>
        <View style={{ height: space[3] }} /><View style={{ flexDirection: 'row', gap: space[2] }}><Button label="Directions" variant="tonal" icon="navigate" /><Button label="Call" variant="tonal" icon="call" /></View>
      </Card>
      <View><SectionHeader title="Tasks  ·  2 of 4 done" /><Group>
        <ListRow title="Shut off water at the valve" icon="checkmark-circle" iconTone="success" divider />
        <ListRow title="Remove the old faucet" icon="checkmark-circle" iconTone="success" divider />
        <ListRow title="Fit and seal the new faucet" icon="ellipse-outline" iconTone="neutral" onPress={noop} divider />
        <ListRow title="Test for leaks" icon="ellipse-outline" iconTone="neutral" onPress={noop} divider={false} /></Group></View>
      <View><SectionHeader title="Photos  ·  3" action="Add" onAction={noop} />
        <View style={{ flexDirection: 'row', gap: space[2] }}>{['Before', 'During', 'Part'].map((p) => <View key={p} accessible accessibilityLabel={`${p} photo`} style={{ flex: 1, aspectRatio: 1, borderRadius: radius.md, backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center', gap: 4 }}><Icon name="image" size={26} tone="subtle" /><DText variant="caption" tone="textSubtle">{p}</DText></View>)}</View></View>
      <Group><KV k="Scheduled" v="Today, 8:00 AM" /><KV k="Crew" v="Taylor Tech" /><KV k="Time on job" v="1 h 12 min" last /></Group>
    </Screen>
  )
}

export function ScheduleDay() {
  const { c } = useDesign()
  const days = [['M', '26'], ['T', '27'], ['W', '28'], ['T', '29'], ['F', '30'], ['S', '31'], ['S', '1']]
  return (
    <Screen title="Schedule" subtitle="Wednesday, October 28" actions={[{ icon: 'calendar-outline', label: 'Pick a date' }, { icon: 'add', label: 'New job' }]} bottomBar={<BottomBar items={barFor('contractor', 'owner')} active="schedule" />}>
      <View style={{ flexDirection: 'row', gap: space[1] }}>{days.map(([d, n], i) => (
        <View key={i} accessible accessibilityRole="button" accessibilityLabel={`${d} ${n}${i === 2 ? ', selected' : ''}`} style={{ flex: 1, minHeight: 56, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: i === 2 ? c.accentFill : c.surface, borderWidth: 1, borderColor: i === 2 ? c.accentFill : c.border }}>
          <DText variant="caption" style={{ color: i === 2 ? c.onAccent : c.textSecondary }}>{d}</DText><DText variant="bodyStrong" style={{ color: i === 2 ? c.onAccent : c.text }}>{n}</DText></View>))}</View>
      {JOBS_TODAY.slice(0, 5).map((j, i) => (
        <View key={j.id} style={{ flexDirection: 'row', gap: space[3] }}>
          <View style={{ width: 64, paddingTop: space[3] }}><DText variant="captionStrong" tone="textSecondary">{j.time}</DText></View>
          <View style={{ flex: 1 }}>
            <Card onPress={noop} accessibilityLabel={`${j.time}, ${j.title}, ${j.customer}, ${j.status}`} style={{ borderLeftWidth: 4, borderLeftColor: c.tones[j.tone].fill }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space[2] }}><DText variant="bodyStrong" style={{ flex: 1 }}>{j.title}</DText><Badge label={j.status} tone={j.tone} /></View>
              <DText variant="callout" tone="textSecondary">{j.customer} · {j.address}</DText>
            </Card>
            {i === 2 ? <View style={{ marginTop: space[2], borderRadius: radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.borderStrong, padding: space[3] }}><DText variant="callout" tone="textSubtle">Free: 12:00 – 1:00 PM</DText></View> : null}
          </View>
        </View>))}
    </Screen>
  )
}

export function ContactDetail() {
  return (
    <Screen title="Alex Example" subtitle="Customer since 2024" onBack={noop} actions={[{ icon: 'create-outline', label: 'Edit' }]}>
      <View style={{ alignItems: 'center', gap: space[2] }}><Avatar name="Alex Example" size={72} /><Badge label="Customer" tone="success" /></View>
      <Actions4 items={[{ icon: 'call', label: 'Call' }, { icon: 'chatbubble', label: 'Text' }, { icon: 'mail', label: 'Email' }, { icon: 'navigate', label: 'Directions' }]} />
      <Group><KV k="Phone" v="(555) 010-0142" /><KV k="Email" v="alex@example.test" /><KV k="Address" v="100 Example St" last /></Group>
      <View style={{ marginHorizontal: -layout.gutter }}><ChipRow><Chip label="Jobs" count={3} selected /><Chip label="Quotes" count={2} /><Chip label="Invoices" count={2} /><Chip label="Notes" count={5} /></ChipRow></View>
      <Group>
        <ListRow title="Replace kitchen faucet" subtitle="J-1042 · Today" badge="In progress" badgeTone="accent" icon="hammer" onPress={noop} />
        <ListRow title="Bathroom fan install" subtitle="J-0988 · Sep 14" badge="Done" badgeTone="success" icon="hammer" onPress={noop} />
        <ListRow title="Deck board replacement" subtitle="J-0870 · Jun 3" badge="Done" badgeTone="success" icon="hammer" onPress={noop} divider={false} />
      </Group>
      <Button label="New job for Alex" icon="add" variant="tonal" fullWidth />
    </Screen>
  )
}

function LineItems({ rows, total }: { rows: [string, string][]; total: [string, string][] }) {
  return <Group>{rows.map(([a, b]) => <ListRow key={a} title={a} meta={b} />)}{total.map(([a, b], i) => <ListRow key={a} title={a} meta={b} divider={i < total.length - 1} />)}</Group>
}

export function QuoteDetail() {
  return (
    <Screen title="Q-2031" subtitle="Kitchen remodel · Alex Example" onBack={noop} actions={[{ icon: 'share-outline', label: 'Share' }]}
      footer={<View style={{ flexDirection: 'row', gap: space[2] }}><Button label="Send again" variant="secondary" icon="send" size="lg" /><View style={{ flex: 1 }}><Button label="Mark approved" icon="checkmark-circle" size="lg" fullWidth /></View></View>}>
      <Card><View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Badge label="Sent Oct 26" tone="info" icon="send" /><DText variant="caption" tone="textSubtle">Valid until Nov 25</DText></View>
        <DText variant="stat" style={{ marginTop: space[2] }}>$4,280.00</DText><DText variant="callout" tone="textSecondary">Not yet opened by the customer</DText></Card>
      <LineItems rows={[['Countertop supply and install', '$2,400.00'], ['Sink and faucet', '$680.00'], ['Backsplash tile, 28 sq ft', '$740.00']]} total={[['Subtotal', '$3,820.00'], ['Tax', '$460.00'], ['Total', '$4,280.00']]} />
      <Group><KV k="Customer" v="Alex Example" /><KV k="Prepared by" v="Morgan Manager" last /></Group>
    </Screen>
  )
}

const INV = [
  { n: 'INV-5107', c: 'Jordan Sample', a: '$2,150.00', s: 'Overdue', tone: 'danger' as const, d: 'Due Oct 12' },
  { n: 'INV-5106', c: 'Riley Placeholder', a: '$640.00', s: 'Sent', tone: 'info' as const, d: 'Due Nov 8' },
  { n: 'INV-5104', c: 'Casey Demo', a: '$3,050.00', s: 'Overdue', tone: 'danger' as const, d: 'Due Oct 20' },
  { n: 'INV-5101', c: 'Quinn Sample', a: '$1,280.00', s: 'Sent', tone: 'info' as const, d: 'Due Nov 15' },
  { n: 'INV-5099', c: 'Avery Example', a: '$905.00', s: 'Partly paid', tone: 'warning' as const, d: 'Due Nov 2' },
]
export function InvoicesList() {
  return (
    <Screen title="Invoices" subtitle="7 unpaid · $18,430 outstanding" actions={[{ icon: 'add', label: 'New invoice' }]} bottomBar={bar('more')}>
      <Banner text="From the Open invoices tile: the 7 unpaid invoices." />
      <Card><View style={{ flexDirection: 'row' }}><Money label="Outstanding" value="$18,430" /><Money label="Overdue" value="$5,200" tone="danger" /></View></Card>
      <View style={{ marginHorizontal: -layout.gutter }}><ChipRow><Chip label="Unpaid" count={7} selected /><Chip label="Overdue" count={2} /><Chip label="Paid" count={41} /><Chip label="Draft" count={1} /></ChipRow></View>
      <Group>{INV.map((r, i) => <ListRow key={r.n} title={r.c} subtitle={`${r.n} · ${r.d}`} meta={r.a} badge={r.s} badgeTone={r.tone} onPress={noop} divider={i < INV.length - 1} />)}</Group>
    </Screen>
  )
}

export function InvoiceDetail({ paying }: { paying?: boolean }) {
  const { c } = useDesign()
  const [m, setM] = React.useState('card')
  return (
    <View style={{ flex: 1 }}>
      <Screen title="INV-5107" subtitle="Water heater · Jordan Sample" onBack={noop} actions={[{ icon: 'share-outline', label: 'Share' }]}
        footer={<Button label="Take payment" icon="card" size="lg" fullWidth />}>
        <Card><View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Badge label="Overdue 16 days" tone="danger" icon="time" /><DText variant="caption" tone="textSubtle">Due Oct 12</DText></View>
          <DText variant="caption" tone="textSubtle" style={{ marginTop: space[2] }}>Balance due</DText><DText variant="stat">$2,150.00</DText></Card>
        <LineItems rows={[['Water heater, 40 gal', '$1,450.00'], ['Install and haul-away', '$520.00']]} total={[['Subtotal', '$1,970.00'], ['Tax', '$180.00'], ['Total', '$2,150.00'], ['Paid so far', '$0.00']]} />
        <Group><KV k="Customer" v="Jordan Sample" /><KV k="Job" v="J-1043" last /></Group>
      </Screen>
      <BottomSheet visible={!!paying} inline title="Take payment" onClose={noop}>
        <TextField label="Amount" value="2,150.00" prefix="$" keyboardType="decimal-pad" helper="Balance due. Change it to take a part payment." />
        <Group>
          {[['card', 'Card reader', 'Tap, insert or swipe', 'card'], ['cash', 'Cash', 'Record cash received', 'cash'], ['check', 'Check', 'Record a check', 'create'], ['link', 'Send payment link', 'Text or email a secure link', 'link']].map(([k, t, s, ic], i) => (
            <ListRow key={k} title={t} subtitle={s} icon={ic} iconTone={m === k ? 'accent' : 'neutral'} badge={m === k ? 'Selected' : undefined} badgeTone="accent" onPress={() => setM(k)} divider={i < 3} />))}
        </Group>
        <Button label="Charge $2,150.00" icon="lock-closed" size="lg" fullWidth />
      </BottomSheet>
    </View>
  )
}

export function TimeClock() {
  const { c } = useDesign()
  return (
    <Screen title="Time" subtitle="Taylor Tech · this week 24 h 30 min" bottomBar={<BottomBar items={barFor('contractor', 'staff')} active="time" />}>
      <Card style={{ alignItems: 'center', gap: space[2] }}>
        <Badge label="Clocked in" tone="success" icon="radio-button-on" />
        <DText variant="display" accessibilityLabel="3 hours 42 minutes on the clock" style={{ fontSize: 44, lineHeight: 52 }}>3:42:10</DText>
        <DText variant="callout" tone="textSecondary">Since 8:05 AM · J-1042 Replace kitchen faucet</DText>
        <View style={{ height: space[2] }} />
        <View style={{ flexDirection: 'row', gap: space[2], alignSelf: 'stretch' }}><View style={{ flex: 1 }}><Button label="Start break" variant="secondary" icon="cafe" size="lg" fullWidth /></View><View style={{ flex: 1 }}><Button label="Clock out" variant="danger" icon="stop-circle" size="lg" fullWidth /></View></View>
      </Card>
      <Group><ListRow title="Working on" subtitle="J-1042 Replace kitchen faucet" icon="hammer" onPress={noop} divider={false} /></Group>
      <View><SectionHeader title="This week" action="Timesheet" onAction={noop} /><Group>
        <ListRow title="Tuesday" subtitle="7:58 AM – 4:30 PM" meta="8 h 02" divider /><ListRow title="Monday" subtitle="8:01 AM – 4:45 PM" meta="8 h 14" divider /><ListRow title="Friday" subtitle="8:10 AM – 4:15 PM" meta="7 h 35" divider={false} /></Group></View>
    </Screen>
  )
}

export function CareVisit() {
  return (
    <Screen title="Quinn Sample" subtitle="Today, 11:00 AM – 1:00 PM" onBack={noop} actions={[{ icon: 'chatbubble-outline', label: 'Message the office' }]}
      footer={<View style={{ flexDirection: 'row', gap: space[2] }}><Button label="Can't make it" variant="secondary" size="lg" /><View style={{ flex: 1 }}><Button label="Clock out" icon="finger-print" size="lg" fullWidth /></View></View>}>
      <Card><View style={{ flexDirection: 'row', gap: space[2], alignItems: 'center' }}><Badge label="Visit in progress" tone="success" icon="radio-button-on" /></View>
        <DText variant="stat" style={{ marginTop: space[2] }}>0:48</DText><DText variant="callout" tone="textSecondary">Clocked in at 11:02 AM</DText>
        <View style={{ height: space[2] }} /><View style={{ flexDirection: 'row', gap: space[2], alignItems: 'center' }}><Icon name="location" size={18} tone="success" /><DText variant="callout" tone="success" style={{ flex: 1 }}>You are at the visit address</DText></View></Card>
      <Group><ListRow title="42 Example Street" subtitle="Tap for directions" icon="navigate" onPress={noop} /><ListRow title="Call Quinn" subtitle="(555) 010-0177" icon="call" onPress={noop} divider={false} /></Group>
      <View><SectionHeader title="Tasks  ·  1 of 3 done" /><Group>
        <ListRow title="Prepare lunch" icon="checkmark-circle" iconTone="success" onPress={noop} />
        <ListRow title="Light tidying of the kitchen" icon="ellipse-outline" iconTone="neutral" onPress={noop} />
        <ListRow title="Pick up groceries" icon="ellipse-outline" iconTone="neutral" onPress={noop} divider={false} /></Group></View>
      <TextField label="Visit notes" value="" placeholder="Anything the office should know" multiline helper="Visible to the office only." />
    </Screen>
  )
}
