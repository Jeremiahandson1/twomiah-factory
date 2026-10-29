import React from 'react'
import { View, useWindowDimensions } from 'react-native'
import { Screen, SearchField, ChipRow, Chip, Card, Group, ListRow, DText, Badge, Button, Icon, Avatar, SectionHeader, StatTile, TextField, BottomBar, space, radius, layout, useDesign, type BarItem } from '..'
import { statCardWidth } from '../../theme/insets'

/**
 * DEV-ONLY mock-ups for the design round: salon, restaurant, bar, store and vet. None of these trades is served by the phone yet
 * (they open the "use the website" screen); nothing here is reachable outside __DEV__. Every name, number and address is made up.
 * The homes follow each trade's own desktop dashboard (docs/mobile/PARITY.md); the decisions are in docs/mobile/DESIGN.md.
 */
export type DTrade = 'salon' | 'restaurant' | 'bar' | 'store' | 'vet'
export const DESIGN_BRAND: Record<DTrade, string> = { salon: '#9d174d', restaurant: '#9a3412', bar: '#b45309', store: '#6d28d9', vet: '#0e7490' }
const noop = () => {}

// ── bottom bars: five slots, More last, alerts in the header bell ─────────────────────────────────────────────────────
const b = (key: string, label: string, icon: string, badge?: number): BarItem => ({ key, label, icon: `${icon}-outline`, activeIcon: icon, badge })
const MORE = { key: 'more', label: 'More', icon: 'ellipsis-horizontal-outline', activeIcon: 'ellipsis-horizontal' } as BarItem
export const DESIGN_BAR: Record<DTrade, { office: BarItem[]; front: BarItem[]; frontName: string }> = {
  salon: { frontName: 'Stylist', office: [b('home', 'Home', 'home'), b('book', 'Book', 'calendar'), b('clients', 'Clients', 'people'), b('rebook', 'Rebook', 'repeat', 15), MORE], front: [b('home', 'Home', 'home'), b('book', 'My day', 'calendar'), b('clients', 'Clients', 'people'), b('messages', 'Messages', 'chatbubbles', 2), MORE] },
  restaurant: { frontName: 'Staff (captain)', office: [b('home', 'Home', 'home'), b('events', 'Events', 'calendar'), b('messages', 'Messages', 'chatbubbles', 3), b('invoices', 'Invoices', 'receipt'), MORE], front: [b('home', 'Home', 'home'), b('events', 'Events', 'calendar'), b('tonight', 'Tonight', 'flame'), b('menu', '86 board', 'restaurant'), MORE] },
  bar: { frontName: 'Staff (bartender)', office: [b('home', 'Home', 'home'), b('tonight', 'Tonight', 'flame'), b('parties', 'Parties', 'calendar'), b('stock', 'Stock', 'cube'), MORE], front: [b('home', 'Home', 'home'), b('tonight', 'Tonight', 'flame'), b('shifts', 'Shifts', 'time'), b('count', 'Count', 'clipboard'), MORE] },
  store: { frontName: 'Staff (packer)', office: [b('home', 'Home', 'home'), b('orders', 'Orders', 'bag-handle', 7), b('stock', 'Stock', 'cube'), b('reviews', 'Reviews', 'chatbubble-ellipses'), MORE], front: [b('home', 'Home', 'home'), b('orders', 'Orders', 'bag-handle', 7), b('stock', 'Stock', 'cube'), b('reviews', 'Reviews', 'chatbubble-ellipses'), MORE] },
  vet: { frontName: 'Staff (clinical)', office: [b('home', 'Home', 'home'), b('today', 'Today', 'calendar'), b('patients', 'Patients', 'paw'), b('messages', 'Messages', 'chatbubbles'), MORE], front: [b('home', 'Home', 'home'), b('today', 'Today', 'calendar'), b('patients', 'Patients', 'paw'), b('recall', 'Recall', 'notifications', 13), MORE] },
}
const bar = (t: DTrade, front: boolean, active: string) => <BottomBar items={front ? DESIGN_BAR[t].front : DESIGN_BAR[t].office} active={active} />

// ── small pieces ─────────────────────────────────────────────────────────────────────────────────────────────────────
type Tone = 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'
function Banner({ text, icon = 'funnel', tone = 'accent' }: { text: string; icon?: string; tone?: Tone }) {
  const { c } = useDesign()
  const t = c.tones[tone]
  return <View style={{ flexDirection: 'row', gap: space[2], alignItems: 'center', backgroundColor: t.soft, borderRadius: radius.md, padding: space[3] }}><Icon name={icon} size={18} tone={tone} /><DText variant="callout" style={{ flex: 1 }}>{text}</DText></View>
}
function Alert({ title, body, tone = 'danger', icon = 'alert-circle' }: { title: string; body: string; tone?: Tone; icon?: string }) {
  const { c } = useDesign()
  const t = c.tones[tone]
  return <View accessible accessibilityLabel={`${title}. ${body}`} style={{ flexDirection: 'row', gap: space[2], backgroundColor: t.soft, borderRadius: radius.md, padding: space[3], borderLeftWidth: 4, borderLeftColor: t.fill }}><Icon name={icon} size={22} tone={tone} /><View style={{ flex: 1 }}><DText variant="bodyStrong">{title}</DText><DText variant="callout">{body}</DText></View></View>
}
function Actions({ items }: { items: { icon: string; label: string }[] }) {
  const { c } = useDesign()
  return <View style={{ flexDirection: 'row', gap: space[2] }}>{items.map((a) => (
    <View key={a.label} style={{ flex: 1 }}><Card onPress={noop} padded={false} level={0} accessibilityLabel={a.label} style={{ minHeight: 68, alignItems: 'center', justifyContent: 'center', gap: space[1], backgroundColor: c.surface }}><Icon name={a.icon} size={22} tone="accent" /><DText variant="captionStrong" tone="accentText">{a.label}</DText></Card></View>))}</View>
}
const Filters = ({ items }: { items: [string, number?][] }) => <View style={{ marginHorizontal: -layout.gutter }}><ChipRow>{items.map(([l, n], i) => <Chip key={l} label={l} count={n} selected={i === 0} />)}</ChipRow></View>
const KV = ({ k, v, last }: { k: string; v: string; last?: boolean }) => <ListRow title={k} meta={v} divider={!last} />
interface Row { title: string; subtitle?: string; meta?: string; badge?: string; tone?: Tone; icon?: string; iconTone?: Tone }
const Rows = ({ rows }: { rows: Row[] }) => <Group>{rows.map((r, i) => <ListRow key={r.title + i} title={r.title} subtitle={r.subtitle} meta={r.meta} badge={r.badge} badgeTone={r.tone} icon={r.icon} iconTone={r.iconTone} onPress={noop} divider={i < rows.length - 1} />)}</Group>
const Foot = ({ primary, icon, secondary }: { primary: string; icon?: string; secondary?: string }) => <View style={{ flexDirection: 'row', gap: space[2] }}>{secondary ? <Button label={secondary} variant="secondary" size="lg" /> : null}<View style={{ flex: 1 }}><Button label={primary} icon={icon} size="lg" fullWidth /></View></View>

// ── homes ────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Tile { label: string; value: string; icon: string; tone: Tone; opens: string; hint?: string }
interface HomeCfg { trade: DTrade; front?: boolean; greeting: string; company: string; alert?: { title: string; body: string; tone?: Tone; icon?: string }; tiles: Tile[]; money?: Row[]; quick?: { icon: string; label: string }[]; sections: { title: string; action?: string; rows: Row[] }[] }
function Home(cfg: HomeCfg) {
  const { width } = useWindowDimensions()
  const w = statCardWidth(Math.min(width, 390))
  return (
    <Screen title={cfg.greeting} subtitle={cfg.company} actions={[{ icon: 'notifications-outline', label: 'Alerts' }]} bottomBar={bar(cfg.trade, !!cfg.front, 'home')}>
      <View style={{ gap: layout.sectionGap }}>
        {cfg.alert ? <Alert {...cfg.alert} /> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: layout.tileGap }}>
          {cfg.tiles.map((t) => <StatTile key={t.label} width={w} label={t.label} value={t.value} icon={t.icon} tone={t.tone} opens={t.opens} hint={t.hint} onPress={noop} />)}
        </View>
        {cfg.money ? <View><SectionHeader title="Money (your seat can see it)" /><Rows rows={cfg.money} /></View> : null}
        {cfg.quick ? <Actions items={cfg.quick} /> : null}
        {cfg.sections.map((s) => <View key={s.title}><SectionHeader title={s.title} action={s.action} onAction={noop} /><Rows rows={s.rows} /></View>)}
      </View>
    </Screen>
  )
}

export const SalonHomeOwner = () => <Home trade="salon" greeting="Hi, Sam" company="Sample Salon & Barber" alert={{ title: 'Due to rebook: 6 overdue · 9 due soon', body: 'Tap to text the clients who are due.', tone: 'warning', icon: 'repeat' }}
  tiles={[{ label: 'Appointments today', value: '11', icon: 'calendar', tone: 'accent', opens: 'the 11 appointments today', hint: '63 in the next 7 days' }, { label: 'Clients', value: '214', icon: 'people', tone: 'info', opens: 'the client list' }, { label: 'Members', value: '17', icon: 'ribbon', tone: 'success', opens: 'the memberships page on the website' }]}
  money={[{ title: 'Services this month', subtitle: 'No list behind it on the desktop, so it is a line, not a tile', meta: '142 · $9,870' }]}
  quick={[{ icon: 'add-circle', label: 'New booking' }, { icon: 'chatbubble', label: 'Text a client' }, { icon: 'search', label: 'Find client' }]}
  sections={[{ title: 'Up next', action: 'The Book', rows: [{ title: 'Jordan Sample', subtitle: 'Cut and colour · with Riley', meta: '10:30', badge: 'Checked in', tone: 'accent' }, { title: 'Casey Example', subtitle: 'Beard trim · with Riley', meta: '11:15', badge: 'Booked', tone: 'neutral' }] }]} />
export const SalonHomeStylist = () => <Home trade="salon" front greeting="Hi, Riley" company="Sample Salon & Barber · Stylist"
  tiles={[{ label: 'Appointments today', value: '5', icon: 'calendar', tone: 'accent', opens: 'your 5 appointments today' }, { label: 'Due to rebook', value: '15', icon: 'repeat', tone: 'warning', opens: 'the 15 clients due to rebook', hint: '6 overdue' }, { label: 'Clients', value: '214', icon: 'people', tone: 'info', opens: 'the client list' }]}
  quick={[{ icon: 'checkmark-circle', label: 'Check in' }, { icon: 'create', label: 'Log a service' }, { icon: 'chatbubble', label: 'Text a client' }]}
  sections={[{ title: 'My day', action: 'See all', rows: [{ title: 'Jordan Sample', subtitle: 'Cut and colour', meta: '10:30', badge: 'Checked in', tone: 'accent' }, { title: 'Avery Placeholder', subtitle: 'Gloss and blow-dry', meta: '12:00', badge: 'Booked', tone: 'neutral' }, { title: 'Sky Example', subtitle: 'Cut', meta: '1:30', badge: 'Booked', tone: 'neutral' }] }]} />

export const RestaurantHomeOwner = () => <Home trade="restaurant" greeting="Hi, Sam" company="Example Events Kitchen" alert={{ title: 'Payments overdue: 3 invoices', body: '$6,200 outstanding', tone: 'danger', icon: 'alert-circle' }}
  tiles={[{ label: "Today's events", value: '2', icon: 'today', tone: 'accent', opens: 'the 2 events today' }, { label: 'Open inquiries', value: '5', icon: 'mail-unread', tone: 'info', opens: 'the 5 inquiries waiting on you' }, { label: 'Next 30 days', value: '9', icon: 'calendar', tone: 'success', opens: 'the 9 held events in the next 30 days', hint: '14 this month' }, { label: 'Confirmed', value: '12', icon: 'checkmark-done', tone: 'neutral', opens: 'the 12 confirmed events', hint: '3 tentative' }, { label: 'New leads', value: '4', icon: 'person-add', tone: 'warning', opens: 'the 4 new leads in the Lead Inbox' }]}
  money={[{ title: 'Menu value ahead', subtitle: 'Includes room hire. No list behind it.', meta: '$48,900' }]}
  quick={[{ icon: 'add-circle', label: 'New inquiry' }, { icon: 'chatbubble', label: 'Text a client' }, { icon: 'mail-unread', label: 'Lead Inbox' }]}
  sections={[{ title: 'Coming up', action: 'Events', rows: [{ title: 'Sample–Example wedding', subtitle: 'Sat Nov 7 · Garden Room · 80 guests', badge: 'Confirmed', tone: 'success' }, { title: 'Placeholder Co. dinner', subtitle: 'Thu Nov 12 · Cellar · 24 guests', badge: 'Tentative', tone: 'warning' }] }, { title: 'Payments due', rows: [{ title: 'Sample–Example wedding', subtitle: 'Balance · due Nov 1', meta: '$4,200', badge: 'Due', tone: 'warning' }] }]} />
export const RestaurantHomeStaff = () => <Home trade="restaurant" front greeting="Hi, Taylor" company="Example Events Kitchen · Staff"
  tiles={[{ label: "Today's events", value: '2', icon: 'today', tone: 'accent', opens: 'the 2 events today' }, { label: 'Next 30 days', value: '9', icon: 'calendar', tone: 'success', opens: 'the 9 held events in the next 30 days' }]}
  sections={[{ title: 'Tonight', action: 'Open', rows: [{ title: 'Kitchen', subtitle: 'Open until 10:00 PM', icon: 'flame', iconTone: 'success' }, { title: 'How busy', subtitle: 'Filling up', icon: 'people' }, { title: "Tonight's special", subtitle: 'Sample braised short rib', icon: 'restaurant' }] }, { title: 'Coming up', action: 'Events', rows: [{ title: 'Sample–Example wedding', subtitle: 'Sat Nov 7 · Garden Room · 80 guests (guaranteed)', badge: 'Confirmed', tone: 'success' }] }]} />

export const BarHomeManager = () => <Home trade="bar" greeting="Hi, Morgan" company="Placeholder Tap Room"
  alert={{ title: 'Tonight: kitchen open · Filling up', body: 'Special: Sample two-for-one wings. Resets at 4 AM.', tone: 'info', icon: 'flame' }}
  tiles={[{ label: 'Open inquiries', value: '3', icon: 'mail-unread', tone: 'info', opens: 'the 3 party inquiries waiting' }, { label: 'Next 30 days', value: '6', icon: 'calendar', tone: 'success', opens: 'the 6 held parties in the next 30 days' }, { label: 'Payments overdue', value: '1', icon: 'alert-circle', tone: 'danger', opens: 'the 1 overdue party invoice', hint: '$850' }, { label: 'Stock to count', value: '12', icon: 'cube', tone: 'neutral', opens: 'the 12 items on tonight\'s count' }]}
  sections={[{ title: 'Needs you', rows: [{ title: 'Time-off request', subtitle: 'Riley · Fri Nov 6', icon: 'time' }, { title: 'Delivery on the way', subtitle: 'Sample Beverage Co. · due today', icon: 'cube' }] }, { title: 'Coming up', action: 'Parties', rows: [{ title: 'Example 40th birthday', subtitle: 'Sat Nov 7 · Back Room · 35 guests', badge: 'Confirmed', tone: 'success' }] }]} />
export const BarHomeStaff = () => <Home trade="bar" front greeting="Hi, Jess" company="Placeholder Tap Room · Staff"
  alert={{ title: 'Tonight: kitchen open · Filling up', body: 'You can change this on the Tonight tab.', tone: 'info', icon: 'flame' }}
  tiles={[{ label: 'On the 86 board', value: '2', icon: 'close-circle', tone: 'warning', opens: 'the 2 items that are out' }, { label: 'Taps low or blown', value: '1', icon: 'beer', tone: 'danger', opens: 'the tap that is low' }]}
  sections={[{ title: 'My next shift', action: 'Shifts', rows: [{ title: 'Tonight 5:00 PM – 1:00 AM', subtitle: 'Bar · with Morgan', icon: 'time' }] }, { title: 'Parties tonight', rows: [{ title: 'Example 40th birthday', subtitle: 'Back Room · 35 guests (guaranteed)', badge: 'Confirmed', tone: 'success' }] }]} />

export const StoreHomeOwner = () => <Home trade="store" greeting="Hi, Sam" company="Example Goods Store"
  tiles={[{ label: 'To pack', value: '7', icon: 'cube', tone: 'warning', opens: 'the 7 paid orders waiting to be packed' }, { label: 'At supplier', value: '2', icon: 'airplane', tone: 'info', opens: 'the 2 orders placed with your supplier' }, { label: 'Reviews to approve', value: '4', icon: 'chatbubble-ellipses', tone: 'accent', opens: 'the 4 reviews waiting' }]}
  money={[{ title: 'Revenue (all time)', meta: '$31,480' }, { title: 'Refunded · 3 orders', meta: '$410' }, { title: 'Net sales', meta: '$31,070' }]}
  sections={[{ title: 'Latest orders', action: 'Orders', rows: [{ title: '#1048 · Sample Buyer', subtitle: 'Ship · Anytown, ST', badge: 'Paid', tone: 'warning' }, { title: '#1047 · Example Shopper', subtitle: 'Pickup', badge: 'Ready for pickup', tone: 'info' }, { title: '#1046 · Placeholder P.', subtitle: 'Ship · Sampleville, ST', badge: 'Shipped', tone: 'success' }] }]} />
export const StoreHomePacker = () => <Home trade="store" front greeting="Hi, Taylor" company="Example Goods Store · Staff"
  tiles={[{ label: 'To pack', value: '7', icon: 'cube', tone: 'warning', opens: 'the 7 paid orders waiting to be packed' }, { label: 'At supplier', value: '2', icon: 'airplane', tone: 'info', opens: 'the 2 orders placed with your supplier' }, { label: 'Reviews to approve', value: '4', icon: 'chatbubble-ellipses', tone: 'accent', opens: 'the 4 reviews waiting' }]}
  sections={[{ title: 'Latest orders', action: 'Orders', rows: [{ title: '#1048 · Sample Buyer', subtitle: 'Ship · 2 items', badge: 'Paid', tone: 'warning' }, { title: '#1047 · Example Shopper', subtitle: 'Pickup · 1 item', badge: 'Ready for pickup', tone: 'info' }] }]} />

export const VetHomeOwner = () => <Home trade="vet" greeting="Hi, Dr. Sample" company="Example Animal Clinic"
  tiles={[{ label: 'Appointments today', value: '9', icon: 'calendar', tone: 'accent', opens: 'the 9 appointments today', hint: '41 in the next 7 days' }, { label: 'Vaccines overdue', value: '13', icon: 'notifications', tone: 'danger', opens: 'the 13 pets with a vaccine past its due date' }, { label: 'Due in 30 days', value: '27', icon: 'time', tone: 'warning', opens: 'the 27 pets with a vaccine due within 30 days' }, { label: 'Active patients', value: '1,184', icon: 'paw', tone: 'info', opens: 'the list of living patients' }]}
  money={[{ title: 'Billed this month', meta: '$22,140' }, { title: 'Done, not yet invoiced', meta: '$1,860' }, { title: 'Still to come this month', meta: '$3,300' }]}
  quick={[{ icon: 'checkmark-circle', label: 'Check in' }, { icon: 'search', label: 'Find a pet' }, { icon: 'chatbubble', label: 'Text an owner' }]}
  sections={[{ title: 'Up next', action: 'Today', rows: [{ title: 'Biscuit', subtitle: 'Dog · wellness exam · Room 2', meta: '9:30', badge: 'Booked', tone: 'neutral' }, { title: 'Pixel', subtitle: 'Cat · recheck · Room 1', meta: '10:00', badge: 'Checked in', tone: 'accent' }] }]} />
export const VetHomeTech = () => <Home trade="vet" front greeting="Hi, Taylor" company="Example Animal Clinic · Staff"
  tiles={[{ label: 'Appointments today', value: '9', icon: 'calendar', tone: 'accent', opens: 'the 9 appointments today' }, { label: 'Vaccines overdue', value: '13', icon: 'notifications', tone: 'danger', opens: 'the 13 pets with a vaccine past its due date' }, { label: 'Due in 30 days', value: '27', icon: 'time', tone: 'warning', opens: 'the 27 pets with a vaccine due within 30 days' }, { label: 'Active patients', value: '1,184', icon: 'paw', tone: 'info', opens: 'the list of living patients' }]}
  quick={[{ icon: 'checkmark-circle', label: 'Check in' }, { icon: 'search', label: 'Find a pet' }, { icon: 'chatbubble', label: 'Text an owner' }]}
  sections={[{ title: 'Up next', action: 'Today', rows: [{ title: 'Biscuit (Sample, dog)', subtitle: 'Wellness exam · Room 2', meta: '9:30', badge: 'Booked', tone: 'neutral' }, { title: 'Pixel', subtitle: 'Cat · recheck · Room 1', meta: '10:00', badge: 'Checked in', tone: 'accent' }] }]} />

// ── More: grouped and searchable; "On the website" rows open the private in-app browser ──────────────────────────────────
interface MoreGroup { title: string; items: [string, string, boolean][] }
const MORE_MENU: Record<DTrade, { office: MoreGroup[]; front: MoreGroup[] }> = {
  salon: {
    office: [{ title: 'Salon', items: [['Service Menu', 'list', false], ['Memberships', 'ribbon', false], ['Loyalty', 'gift', false]] }, { title: 'Business', items: [['Invoices', 'receipt', false], ['Time', 'time', false], ['Lead Inbox', 'mail-unread', false], ['Reports', 'stats-chart', false], ['Team', 'people-circle', false], ['Reviews', 'star', false]] }, { title: 'Online', items: [['Bookings', 'globe', false], ['Website', 'browsers', false], ['Marketing', 'megaphone', false]] }, { title: 'Help', items: [['Help', 'help-circle', false], ['Support', 'headset', false]] }],
    front: [{ title: 'Salon', items: [['Service Menu', 'list', false], ['Loyalty', 'gift', false]] }, { title: 'Business', items: [['Time', 'time', false], ['Reviews', 'star', false], ['Documents', 'folder', false]] }, { title: 'Help', items: [['Help', 'help-circle', false], ['Support', 'headset', false]] }],
  },
  restaurant: {
    office: [{ title: 'Events', items: [['Spaces', 'business', false], ['Catering Menus', 'restaurant', false]] }, { title: 'Customers', items: [['Lead Inbox', 'mail-unread', true], ['Contacts', 'people', false]] }, { title: 'Money & reports', items: [['Reports', 'stats-chart', false]] }, { title: 'Kitchen & counter', items: [['Tonight', 'flame', true], ['Menu', 'restaurant', true], ['Orders', 'bag-handle', false]] }, { title: 'Business & website', items: [['Documents', 'folder', false], ['Team', 'people-circle', false], ['Website', 'browsers', false]] }],
    front: [{ title: 'Events', items: [['Spaces', 'business', true]] }, { title: 'Kitchen & counter', items: [['Tonight', 'flame', true], ['Menu', 'restaurant', true]] }, { title: 'Help', items: [['Help', 'help-circle', false]] }],
  },
  bar: {
    office: [{ title: 'The Bar', items: [['Taps', 'beer', true], ['Menu', 'restaurant', true], ['Schedule', 'calendar', true], ['Regulars', 'heart', false], ['Orders', 'bag-handle', false]] }, { title: 'Parties', items: [['Spaces', 'business', false], ['Party Packages', 'cube', false]] }, { title: 'Business', items: [['Time', 'time', true], ['Invoices', 'receipt', false], ['Messages', 'chatbubbles', false], ['Reports', 'stats-chart', false], ['Guests', 'people', false]] }, { title: 'Online', items: [['Website', 'browsers', false], ['Lead Inbox', 'mail-unread', false]] }],
    front: [{ title: 'The Bar', items: [['Taps', 'beer', true], ['Menu', 'restaurant', true], ['Schedule', 'calendar', true]] }, { title: 'Business', items: [['Time', 'time', true], ['Documents', 'folder', false]] }, { title: 'Help', items: [['Help', 'help-circle', false]] }],
  },
  store: {
    office: [{ title: 'Sell', items: [['Customers', 'people', false], ['Discounts', 'pricetag', false], ['Gift cards', 'gift', false], ['Disputes', 'warning', false]] }, { title: 'Set-up (opens the website)', items: [['Shipping', 'airplane', false], ['Store Settings', 'settings', false]] }, { title: 'Business', items: [['Lead Inbox', 'mail-unread', false], ['Team', 'people-circle', false], ['Website', 'browsers', false]] }, { title: 'Help', items: [['Help', 'help-circle', false]] }],
    front: [{ title: 'Shop', items: [['Customers', 'people', false]] }, { title: 'Help', items: [['Help', 'help-circle', false], ['Contact Twomiah', 'headset', false]] }],
  },
  vet: {
    office: [{ title: 'Customers', items: [['Owners', 'person', true], ['Lead Inbox', 'mail-unread', false]] }, { title: 'Records', items: [['Documents', 'folder', false], ['Tasks', 'checkbox', false]] }, { title: 'Money & reports', items: [['Invoices', 'receipt', false], ['Reports', 'stats-chart', false], ['Wellness Plans', 'ribbon', false]] }, { title: 'Online', items: [['Bookings', 'globe', false], ['Website', 'browsers', false]] }, { title: 'Help', items: [['Help', 'help-circle', false]] }],
    front: [{ title: 'Customers', items: [['Owners', 'person', true]] }, { title: 'Records', items: [['Documents', 'folder', false], ['Tasks', 'checkbox', false], ['Wellness Plans', 'ribbon', false]] }, { title: 'Help', items: [['Help', 'help-circle', false]] }],
  },
}
export const MORE_LABELS = (t: DTrade) => [...MORE_MENU[t].office, ...MORE_MENU[t].front].flatMap((g) => g.items.map((i) => i[0]))
function More({ trade, front }: { trade: DTrade; front?: boolean }) {
  const groups = MORE_MENU[trade][front ? 'front' : 'office']
  return (
    <Screen title="More" subtitle={front ? DESIGN_BAR[trade].frontName : 'Owner · admin · manager'} bottomBar={bar(trade, !!front, 'more')}>
      <SearchField value="" placeholder="Search everything" onChangeText={noop} />
      {groups.map((g) => <View key={g.title}><SectionHeader title={g.title} /><Group>{g.items.map(([label, icon, native], i) => <ListRow key={label} title={label} icon={icon} subtitle={native ? undefined : 'Opens on the website'} meta={native ? undefined : '↗'} onPress={noop} divider={i < g.items.length - 1} />)}</Group></View>)}
    </Screen>
  )
}
export const SalonMore = () => <More trade="salon" />
export const SalonMoreStylist = () => <More trade="salon" front />
export const RestaurantMore = () => <More trade="restaurant" />
export const RestaurantMoreStaff = () => <More trade="restaurant" front />
export const BarMore = () => <More trade="bar" />
export const BarMoreStaff = () => <More trade="bar" front />
export const StoreMore = () => <More trade="store" />
export const StoreMoreStaff = () => <More trade="store" front />
export const VetMore = () => <More trade="vet" />
export const VetMoreTech = () => <More trade="vet" front />

// ── SALON phase A ──────────────────────────────────────────────────────────────────────────────────────────────────────
export const SalonBook = () => (
  <Screen title="The Book" subtitle="Wednesday, October 28" actions={[{ icon: 'calendar-outline', label: 'Pick a date' }, { icon: 'add', label: 'New booking' }]} bottomBar={bar('salon', false, 'book')}>
    <Filters items={[['Today', 11], ['Riley', 5], ['Jamie', 4], ['Sam', 2]]} />
    <Rows rows={[
      { title: 'Jordan Sample', subtitle: 'Cut and colour · Riley · 10:30 – 12:30', badge: 'Checked in', tone: 'accent', icon: 'person-circle' },
      { title: 'Casey Example', subtitle: 'Beard trim · Riley · 11:15', badge: 'Booked', tone: 'neutral', icon: 'person-circle' },
      { title: 'Avery Placeholder', subtitle: 'Gloss and blow-dry · Jamie · 12:00', badge: 'Booked', tone: 'neutral', icon: 'person-circle' },
      { title: 'Sky Example', subtitle: 'Cut · Riley · 1:30', badge: 'Booked', tone: 'neutral', icon: 'person-circle' },
      { title: 'Robin Sample', subtitle: 'Manicure · Sam · 9:00', badge: 'Done', tone: 'success', icon: 'person-circle' },
    ]} />
    <DText variant="caption" tone="textSubtle">Statuses are the server's: booked, checked in, done, no-show, cancelled. Complete, cancel and no-show each ask first.</DText>
  </Screen>
)
export const SalonClient = () => (
  <Screen title="Jordan Sample" subtitle="Client since 2023 · 14 visits" onBack={noop} actions={[{ icon: 'create-outline', label: 'Edit' }]}
    footer={<Foot primary="Log a service" icon="create" secondary="Book" />}>
    <View style={{ alignItems: 'center', gap: space[2] }}><Avatar name="Jordan Sample" size={72} /><Badge label="Member" tone="success" /></View>
    <Alert title="Allergy and patch test" body="Reaction to PPD dye noted Mar 2025. Patch test recorded Oct 2 by Riley. This is the salon's own note, not advice." tone="warning" icon="alert-circle" />
    <Actions items={[{ icon: 'call', label: 'Call' }, { icon: 'chatbubble', label: 'Text' }, { icon: 'calendar', label: 'Rebook' }]} />
    <View><SectionHeader title="Last formula" /><Group><KV k="Root" v="6N + 20 vol, 1:1, 35 min" /><KV k="Gloss" v="8V, 10 min" last /></Group></View>
    <View><SectionHeader title="Visits" action="All" onAction={noop} /><Rows rows={[{ title: 'Cut and colour', subtitle: 'Oct 2 · Riley', icon: 'cut' }, { title: 'Cut', subtitle: 'Aug 14 · Riley', icon: 'cut' }]} /></View>
  </Screen>
)
export const SalonLogService = () => (
  <Screen title="Log a service" subtitle="Jordan Sample · today" onBack={noop} footer={<Foot primary="Save to the chart" icon="checkmark-circle" />}>
    <Group><KV k="Service" v="Cut and colour" /><KV k="Stylist" v="Riley" last /></Group>
    <TextField label="Formula" value="" placeholder="Colour, developer, ratio, time" multiline />
    <TextField label="Notes for next time" value="" placeholder="Anything to remember" multiline />
    <Button label="Add a photo" icon="camera" variant="tonal" fullWidth />
    <DText variant="caption" tone="textSubtle">Saved to the client's chart the same way as on the desktop. The price is not shown to this seat.</DText>
  </Screen>
)
export const SalonRebook = () => (
  <Screen title="Rebooking" subtitle="Due to rebook · 15" onBack={noop} actions={[{ icon: 'funnel-outline', label: 'Filter' }]} footer={<Foot primary="Text 3 clients" icon="send" />}>
    <Banner text="Due to rebook · overdue 6" />
    <Filters items={[['Overdue', 6], ['Due soon', 9]]} />
    <Rows rows={[
      { title: 'Jordan Sample', subtitle: 'Last visit Aug 14 · due Oct 9 · Riley', icon: 'checkmark-circle', iconTone: 'success', badge: 'Overdue', tone: 'danger' },
      { title: 'Casey Example', subtitle: 'Last visit Aug 20 · due Oct 15 · Riley', icon: 'checkmark-circle', iconTone: 'success', badge: 'Overdue', tone: 'danger' },
      { title: 'Avery Placeholder', subtitle: 'Last visit Sep 1 · due Oct 20 · Jamie', icon: 'checkmark-circle', iconTone: 'success', badge: 'Overdue', tone: 'danger' },
      { title: 'Sky Example', subtitle: 'Last visit Sep 9 · due Oct 28 · Riley', icon: 'ellipse-outline', iconTone: 'neutral', badge: 'Overdue', tone: 'danger' },
    ]} />
  </Screen>
)

// ── RESTAURANT phase A ─────────────────────────────────────────────────────────────────────────────────────────────────
export const RestaurantEvents = () => (
  <Screen title="Events" subtitle="Next 30 days · 9" actions={[{ icon: 'add', label: 'New inquiry' }]} bottomBar={bar('restaurant', false, 'events')}>
    <Banner text="Next 30 days · 9 held events" />
    <Filters items={[['Next 30 days', 9], ['Today', 2], ['Inquiries', 5], ['Confirmed', 12]]} />
    <Rows rows={[
      { title: 'Sample–Example wedding', subtitle: 'Sat Nov 7 · Garden Room · 80 guests', badge: 'Confirmed', tone: 'success' },
      { title: 'Placeholder Co. dinner', subtitle: 'Thu Nov 12 · 6:30 PM · Cellar · 24 guests', badge: 'Tentative', tone: 'warning' },
      { title: 'Example retirement party', subtitle: 'Sat Nov 14 · 1:00 PM · Patio · 50 guests', badge: 'Confirmed', tone: 'success' },
    ]} />
    <DText variant="caption" tone="textSubtle">"Tentative" means the room is held. Lost and cancelled events stay behind a chip.</DText>
  </Screen>
)
export const RestaurantEvent = () => (
  <Screen title="Sample–Example wedding" subtitle="Sat Nov 7 · Garden Room" onBack={noop} actions={[{ icon: 'ellipsis-horizontal', label: 'More options' }]} footer={<Foot primary="Banquet order" icon="document-text" secondary="Text client" />}>
    <View style={{ flexDirection: 'row', gap: space[2] }}><Badge label="Confirmed" tone="success" /><Badge label="Wedding" tone="neutral" /></View>
    <Alert title="Dietary requirements" body="Two guests with a nut allergy. One vegan. As entered by the coordinator." tone="danger" />
    <Group><KV k="Guests" v="80 (guaranteed)" /><KV k="Time" v="4:00 – 11:00 PM" /><KV k="Room" v="Garden Room" /><KV k="Coordinator" v="Morgan Manager" last /></Group>
    <Card><View style={{ flexDirection: 'row', gap: space[3], alignItems: 'center' }}><Avatar name="Sample Example" size={44} /><View style={{ flex: 1 }}><DText variant="bodyStrong">Sample Example</DText><DText variant="callout" tone="textSecondary">(555) 010-0191</DText></View><Button label="Call" variant="tonal" icon="call" /></View></Card>
    <View><SectionHeader title="Money" /><Rows rows={[{ title: 'Deposit', subtitle: 'Due Sep 1', badge: 'Paid', tone: 'success' }, { title: 'Balance', subtitle: 'Due Nov 1', meta: '$4,200', badge: 'Due', tone: 'warning' }]} /><DText variant="caption" tone="textSubtle">Only a seat that can see invoices sees this block. Nothing here charges a card.</DText></View>
  </Screen>
)
export const RestaurantBeo = () => (
  <Screen title="Banquet event order" subtitle="Sample–Example wedding · floor copy" onBack={noop} actions={[{ icon: 'share-outline', label: 'Share' }]}>
    <Alert title="Allergy and dietary alert" body="Two guests with a nut allergy. One vegan." tone="danger" />
    <Group><KV k="Date" v="Saturday, November 7" /><KV k="Time" v="4:00 – 11:00 PM" /><KV k="Room" v="Garden Room" /><KV k="Guests" v="80 (guaranteed)" last /></Group>
    <Filters items={[['All'], ['Floor'], ['Kitchen'], ['Bar'], ['AV'], ['Setup']]} />
    <View><SectionHeader title="Run of show" /><Rows rows={[{ title: 'Setup complete', subtitle: 'Chairs, centrepieces, bar', meta: '2:30', badge: 'Setup', tone: 'neutral' }, { title: 'Doors, welcome drink', subtitle: 'Sparkling on trays', meta: '4:00', badge: 'Bar', tone: 'info' }, { title: 'First course out', subtitle: 'Nut-free plates marked', meta: '6:15', badge: 'Kitchen', tone: 'warning' }]} /></View>
    <View><SectionHeader title="Food & beverage" /><Group><KV k="Sample salad" v="80 · per person" /><KV k="Sample roast chicken" v="64 · per person" /><KV k="Sample vegan plate" v="1 · flat" last /></Group></View>
    <DText variant="caption" tone="textSubtle">No prices on this copy, for anyone. Confirm final guest numbers before service.</DText>
  </Screen>
)
export const RestaurantInvoices = () => (
  <Screen title="Invoices" subtitle="Payments overdue · 3" bottomBar={bar('restaurant', false, 'invoices')}>
    <Banner text="Payments overdue · 3" />
    <Filters items={[['Overdue', 3], ['Billed', 4], ['Part paid', 2]]} />
    <Rows rows={[{ title: 'INV-0212', subtitle: 'Sample–Example wedding · balance, due Oct 15', meta: '$4,200', badge: 'Overdue', tone: 'danger' }, { title: 'INV-0207', subtitle: 'Placeholder Co. · deposit, due Oct 20', meta: '$1,500', badge: 'Overdue', tone: 'danger' }]} />
    <DText variant="caption" tone="textSubtle">A text or a call, not a card tap. Recording money already received is a manager's, behind a confirm.</DText>
  </Screen>
)
export const RestaurantTonight = () => (
  <Screen title="Tonight" subtitle="Changes the live website · resets at 4 AM" bottomBar={bar('restaurant', true, 'tonight')}>
    <Card><DText variant="bodyStrong">Kitchen</DText><View style={{ height: space[2] }} /><View style={{ flexDirection: 'row', gap: space[2] }}><View style={{ flex: 1 }}><Button label="Open" size="lg" fullWidth /></View><View style={{ flex: 1 }}><Button label="Closed" variant="secondary" size="lg" fullWidth /></View></View></Card>
    <View><SectionHeader title="How busy" /><Filters items={[['Plenty of seats'], ['Filling up'], ['Packed']]} /></View>
    <TextField label="Note on the website" value="" placeholder="Up to 200 characters" />
    <Foot primary="Save" icon="checkmark" />
  </Screen>
)

// ── BAR phase A ───────────────────────────────────────────────────────────────────────────────────────────────────────
export const BarTonight = () => (
  <Screen title="Tonight" subtitle="Changes the live website · resets at 4 AM" bottomBar={bar('bar', true, 'tonight')}>
    <Card><DText variant="bodyStrong">Kitchen</DText><View style={{ height: space[2] }} /><View style={{ flexDirection: 'row', gap: space[2] }}><View style={{ flex: 1 }}><Button label="Open" size="lg" fullWidth /></View><View style={{ flex: 1 }}><Button label="Closed" variant="secondary" size="lg" fullWidth /></View></View></Card>
    <View><SectionHeader title="How busy" /><Filters items={[['Plenty of seats'], ['Filling up'], ['Packed']]} /></View>
    <TextField label="Note" value="" placeholder="Up to 200 characters" />
    <Foot primary="Save" icon="checkmark" />
  </Screen>
)
export const Bar86 = () => (
  <Screen title="86 board and taps" subtitle="2 items out · 1 tap low" bottomBar={bar('bar', true, 'tonight')}>
    <Filters items={[['Food', 2], ['Taps', 1]]} />
    <Rows rows={[
      { title: 'Sample wings', subtitle: 'Tap to put back on', badge: '86\'d', tone: 'danger', icon: 'close-circle' },
      { title: 'Example nachos', subtitle: 'Available', badge: 'On', tone: 'success', icon: 'checkmark-circle' },
      { title: 'Placeholder Pale Ale', subtitle: 'Tap 3 · last keg', badge: 'Last keg', tone: 'warning', icon: 'beer' },
      { title: 'Sample Lager', subtitle: 'Tap 1 · pouring', badge: 'Pouring', tone: 'success', icon: 'beer' },
    ]} />
    <DText variant="caption" tone="textSubtle">Tap states are the server's: pouring, just tapped, last keg, blown.</DText>
  </Screen>
)
export const BarCount = () => (
  <Screen title="Count" subtitle="Blind count · walk-in cooler · 12 items" bottomBar={bar('bar', true, 'count')} footer={<Foot primary="Submit count" icon="checkmark-circle" />}>
    <Banner text="You count what is on the shelf. The system's number is not shown until you submit." icon="eye-off" tone="info" />
    <Group>
      <ListRow title="Sample Lager 1/2 keg" meta="__" divider />
      <ListRow title="Placeholder Pale Ale 1/6 keg" meta="__" divider />
      <ListRow title="Example Vodka 1 L" meta="__" divider />
      <ListRow title="Sample Lime juice 1 qt" meta="__" divider={false} />
    </Group>
  </Screen>
)
export const BarShifts = () => (
  <Screen title="Shifts" subtitle="Jess · this week" bottomBar={bar('bar', true, 'shifts')}>
    <Card style={{ alignItems: 'center', gap: space[2] }}><Badge label="Not clocked in" tone="neutral" /><DText variant="callout" tone="textSecondary">Tonight 5:00 PM – 1:00 AM · Bar</DText><Button label="Clock in" icon="finger-print" size="lg" fullWidth /></Card>
    <View><SectionHeader title="My shifts" /><Rows rows={[{ title: 'Tonight', subtitle: '5:00 PM – 1:00 AM · Bar', icon: 'time' }, { title: 'Friday', subtitle: '5:00 PM – 2:00 AM · Bar', icon: 'time' }]} /></View>
    <Button label="Ask for time off" variant="tonal" icon="calendar" fullWidth />
  </Screen>
)
export const BarParties = () => (
  <Screen title="Parties" subtitle="Next 30 days · 6" bottomBar={bar('bar', false, 'parties')}>
    <Banner text="Next 30 days · 6 held parties" />
    <Filters items={[['Next 30 days', 6], ['Inquiries', 3], ['Confirmed', 8]]} />
    <Rows rows={[{ title: 'Example 40th birthday', subtitle: 'Sat Nov 7 · Back Room · 35 guests', badge: 'Confirmed', tone: 'success' }, { title: 'Sample trivia league', subtitle: 'Tue Nov 10 · Patio · 20 guests', badge: 'Tentative', tone: 'warning' }]} />
  </Screen>
)

// ── STORE phase A ──────────────────────────────────────────────────────────────────────────────────────────────────────
export const StorePack = () => (
  <Screen title="Orders" subtitle="To pack · 7" bottomBar={bar('store', true, 'orders')}>
    <Banner text="To fulfill · 7 paid orders" />
    <Filters items={[['To pack', 7], ['Ready for pickup', 1], ['Shipped'], ['All']]} />
    <Rows rows={[
      { title: '#1048 · Sample Buyer', subtitle: 'Ship · Anytown, ST · 2 items', badge: 'Paid', tone: 'warning', icon: 'cube' },
      { title: '#1049 · Example Shopper', subtitle: 'Pickup · 1 item', badge: 'Paid', tone: 'warning', icon: 'storefront' },
      { title: '#1050 · Placeholder P.', subtitle: 'Ship · Sampleville, ST · 1 item', badge: 'Paid', tone: 'warning', icon: 'cube' },
    ]} />
    <DText variant="caption" tone="textSubtle">The list holds exactly the orders the tile counts. Unfinished checkouts are never shown as sales.</DText>
  </Screen>
)
export const StoreOrder = () => (
  <Screen title="#1048" subtitle="Sample Buyer · Ship" onBack={noop} footer={<Foot primary="Mark packed" icon="cube" secondary="Shipped…" />}>
    <View style={{ flexDirection: 'row', gap: space[2] }}><Badge label="Paid" tone="warning" /><Badge label="Ship" tone="neutral" /></View>
    <View><SectionHeader title="Items to pack" /><Rows rows={[{ title: 'Sample canvas tote, natural', subtitle: 'SKU TOTE-NAT · shelf photo', meta: '× 1', icon: 'image' }, { title: 'Example mug, blue', subtitle: 'SKU MUG-BLU · shelf photo', meta: '× 2', icon: 'image' }]} /></View>
    <Group><KV k="Ship to" v="Sample Buyer" /><KV k="Address" v="100 Example Rd, Anytown, ST" /><KV k="Phone" v="(555) 010-0155" last /></Group>
    <Card><DText variant="bodyStrong">When it ships</DText><DText variant="callout" tone="textSecondary">Add the carrier and tracking number. The buyer is emailed, and it can't be undone.</DText></Card>
    <DText variant="caption" tone="textSubtle">No totals or prices on the packer's screen. No cancel, no refund: those are a manager's, on the website.</DText>
  </Screen>
)
export const StoreStock = () => (
  <Screen title="Stock" subtitle="Find a product, correct a count" bottomBar={bar('store', true, 'stock')}>
    <SearchField value="mug" placeholder="Name or SKU" onChangeText={noop} />
    <Rows rows={[{ title: 'Example mug', subtitle: '3 options', meta: '41 in stock' }]} />
    <View><SectionHeader title="Example mug" /><Group>
      <ListRow title="Blue" subtitle="SKU MUG-BLU" meta="18" onPress={noop} divider />
      <ListRow title="Green" subtitle="SKU MUG-GRN" meta="23" onPress={noop} divider />
      <ListRow title="Natural" subtitle="Stock not tracked" divider={false} />
    </Group></View>
    <Card><DText variant="bodyStrong">Count Blue</DText><DText variant="callout" tone="textSecondary">The screen shows 18. If a sale lands while you count, nothing is saved and you are told.</DText><View style={{ height: space[2] }} /><Button label="Save count" icon="checkmark" fullWidth /></Card>
  </Screen>
)
export const StoreReviews = () => (
  <Screen title="Reviews" subtitle="Waiting for you · 4" bottomBar={bar('store', true, 'reviews')}>
    <Banner text="Reviews to approve · 4" />
    <Card><View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><DText variant="bodyStrong">Example mug</DText><DText variant="callout">★★★★★</DText></View><DText variant="callout" tone="textSecondary">Sample Buyer · verified purchase</DText><DText variant="body">Placeholder review text for the mock-up.</DText><View style={{ height: space[2] }} /><View style={{ flexDirection: 'row', gap: space[2] }}><View style={{ flex: 1 }}><Button label="Approve" icon="checkmark" fullWidth /></View><View style={{ flex: 1 }}><Button label="Reject" variant="secondary" fullWidth /></View></View></Card>
  </Screen>
)

// ── VET phase A ───────────────────────────────────────────────────────────────────────────────────────────────────────
export const VetToday = () => (
  <Screen title="Today" subtitle="Wednesday, October 28 · 9" actions={[{ icon: 'search', label: 'Find a pet' }]} bottomBar={bar('vet', true, 'today')}>
    <Banner text="Appointments today · 9" />
    <Filters items={[['Today', 9], ['Checked in', 2], ['Done', 3]]} />
    <Rows rows={[
      { title: 'Pixel', subtitle: 'Cat · recheck · Room 1', meta: '10:00', badge: 'Checked in', tone: 'accent', icon: 'paw' },
      { title: 'Biscuit', subtitle: 'Dog · wellness exam · Room 2', meta: '9:30', badge: 'Booked', tone: 'neutral', icon: 'paw' },
      { title: 'Mochi', subtitle: 'Rabbit · sick visit · Room 3', meta: '8:30', badge: 'Done', tone: 'success', icon: 'paw' },
    ]} />
    <DText variant="caption" tone="textSubtle">Cancelled and no-show are behind a toggle so the count matches the tile. Cancelling does not tell the owner.</DText>
  </Screen>
)
export const VetPatient = () => (
  <Screen title="Biscuit" subtitle="Dog · Sample Retriever · 6 yr · 31 lb" onBack={noop} footer={<Foot primary="Check in" icon="checkmark-circle" secondary="Record vaccine" />}>
    <Alert title="Medical alert" body="Bites when handled at the back legs. Entered by Dr. Sample, Oct 3." tone="danger" />
    <Alert title="Allergies" body="Reaction to a chicken-flavoured treat, as recorded by the owner. A note, not a check." tone="warning" icon="warning" />
    <Card><View style={{ flexDirection: 'row', gap: space[3], alignItems: 'center' }}><Avatar name="Jo Example" size={44} /><View style={{ flex: 1 }}><DText variant="bodyStrong">Jo Example</DText><DText variant="callout" tone="textSecondary">(555) 010-0166</DText></View></View><View style={{ height: space[2] }} /><View style={{ flexDirection: 'row', gap: space[2] }}><Button label="Call" variant="tonal" icon="call" /><Button label="Text" variant="tonal" icon="chatbubble" /></View></Card>
    <View><SectionHeader title="Vaccines" /><Rows rows={[{ title: 'Rabies', subtitle: 'Given Oct 2, 2025 · due Oct 2, 2026', badge: 'Overdue', tone: 'danger' }, { title: 'DHPP', subtitle: 'Given Nov 20, 2025 · due Nov 20, 2026', badge: 'Due soon', tone: 'warning' }]} /><DText variant="caption" tone="textSubtle">These words describe the due date the practice typed. They are not advice.</DText></View>
    <Group><KV k="Last visit" v="Sep 4 · wellness exam" last /></Group>
  </Screen>
)
export const VetVaccine = () => (
  <Screen title="Record a vaccine" subtitle="Biscuit · given today" onBack={noop} footer={<Foot primary="Save" icon="checkmark-circle" />}>
    <TextField label="Vaccine" value="" placeholder="Name as the practice writes it" />
    <Group><KV k="Given" v="Today, Oct 28" /><KV k="Next due (you choose)" v="Choose a date" last /></Group>
    <TextField label="Lot number" value="" placeholder="From the vial" />
    <Banner text="A due date is required. The phone never fills one in for you." icon="information-circle" tone="info" />
  </Screen>
)
export const VetRecall = () => (
  <Screen title="Recall" subtitle="Vaccines overdue · 13" bottomBar={bar('vet', true, 'recall')} footer={<Foot primary="Text 4 owners" icon="send" />}>
    <Banner text="Vaccines overdue · 13 pets" />
    <Filters items={[['Overdue', 13], ['Due in 30 days', 27]]} />
    <Rows rows={[
      { title: 'Biscuit', subtitle: 'Jo Example · rabies due Oct 2', icon: 'checkmark-circle', iconTone: 'success', badge: 'Overdue', tone: 'danger' },
      { title: 'Pixel', subtitle: 'Sam Sample · FVRCP due Oct 9', icon: 'checkmark-circle', iconTone: 'success', badge: 'Overdue', tone: 'danger' },
      { title: 'Mochi', subtitle: 'Alex Placeholder · rabies due Oct 15 · texted 3 days ago', icon: 'ellipse-outline', iconTone: 'neutral', badge: 'Overdue', tone: 'danger' },
    ]} />
    <DText variant="caption" tone="textSubtle">Sends a real text. You see the message and the count first.</DText>
  </Screen>
)
