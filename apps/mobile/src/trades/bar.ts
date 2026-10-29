/**
 * BAR AND TAVERN — the live board and the back room: set tonight, 86 an item, flag a tap, a blind stock count, my shifts, and the
 * private-party book (the same event specs as the restaurant). Not a register: no open tabs, no close-out, no card reader — closing
 * the night stays on the desktop (owner, 2026-10-29), and the bartender's sales are not shown (the desktop hides them from that seat).
 *
 * Deviation from the design, on purpose: "Stock to count" is not a tile — the server has no such idea (nothing marks an item as due),
 * so a tile could not open exactly what it counts. The count itself is a tab screen.
 */
import type { TileDef } from '../home/tiles'
import { type ScreenSpec, type Row, words, calDay, hhmm, dayOnly, join } from './kit'
import { EVENT_TILES } from './restaurant'

const STATS = '/api/dashboard/stats'
const paged = (b: any): number => Number(b?.pagination?.total ?? (Array.isArray(b?.data) ? b.data.length : Array.isArray(b) ? b.length : 0))

const byId = (id: string) => EVENT_TILES.find((t) => t.id === id)!
export const BAR_TILES: TileDef[] = [
  { id: 'out-tonight', label: 'On the 86 board', icon: 'close-circle', tone: 'danger', any: ['bar:read'], feature: 'bar_menu', source: STATS, value: (s) => s?.tiles?.menu?.out,
    opens: 'the items that are out tonight', list: { path: '/api/bar/menu', query: { tile: 'out' } }, screen: 'trade', spec: 'bar-menu', total: (b) => flattenMenu(b).length, banner: 'On the 86 board' },
  { id: 'taps-trouble', label: 'Taps low or blown', icon: 'beer', tone: 'warning', any: ['bar:read'], feature: 'bar_menu', source: STATS, value: (s) => s?.tiles?.taps?.trouble,
    opens: 'the taps on their last keg or blown', list: { path: '/api/bar/taps', query: { tile: 'trouble' } }, screen: 'trade', spec: 'bar-taps', total: paged, banner: 'Taps low or blown' },
  byId('events-today'), byId('open-inquiries'), byId('next-30-days'), byId('payments-overdue'),
  { id: 'time-off', label: 'Time off to decide', icon: 'time', tone: 'warning', any: ['bar:update'], feature: 'bar_schedule', source: STATS, value: (s) => s?.tiles?.timeOff?.pending,
    opens: 'the time-off requests waiting on you', list: { path: '/api/schedule/time-off', query: { tile: 'pending' } }, screen: 'trade', spec: 'bar-time-off', total: (b) => (b?.requests || []).length, banner: 'Time off to decide' },
  { id: 'orders-on-the-way', label: 'Orders on the way', icon: 'cube', tone: 'info', any: ['bar:update'], feature: 'bar_stock', source: STATS, value: (s) => s?.tiles?.orders?.on_the_way,
    opens: 'the deliveries on the way', list: { path: '/api/stock/orders', query: { tile: 'on_the_way' } }, screen: 'trade', spec: 'bar-orders', total: (b) => (b?.orders || []).length, banner: 'Orders on the way' },
]

export const flattenMenu = (b: any): any[] => [...(b?.sections || []).flatMap((s: any) => (s.items || []).map((i: any) => ({ ...i, sectionName: s.name }))), ...(b?.unsectioned || [])]
const TAP_WORDS: Record<string, string> = { pouring: 'Pouring', just_tapped: 'Just tapped', last_keg: 'Last keg', blown: 'Blown / off' }
const TAP_TONE: Record<string, Row['tone']> = { pouring: 'success', just_tapped: 'info', last_keg: 'warning', blown: 'danger' }
const OPEN: Record<string, boolean | null> = { 'Open now': true, 'Closed now': false, 'Follow my hours': null }
const BUSY: Record<string, string> = { 'Plenty of seats': 'quiet', 'Filling up': 'filling', Packed: 'packed' }
const BUSY_WORDS: Record<string, string> = { quiet: 'Plenty of seats', filling: 'Filling up', packed: 'Packed' }
const LASTS = 'It lasts until 4 AM, then goes back to your hours.'
const tonightAction = (id: string, label: string, key: string, kitchen = false) => ({
  id, label, icon: kitchen ? 'restaurant' : 'wine', any: ['bar:console'],
  confirm: { title: label, body: () => LASTS, button: 'Save' },
  inputs: [{ id: 'v', label: 'Now', kind: 'choice' as const, choices: Object.keys(OPEN), required: true }],
  request: (_d: any, v: Record<string, string>) => ({ method: 'PUT' as const, path: '/api/bar/tonight', body: { [key]: OPEN[v.v] } }), done: 'Tonight updated',
})

export const BAR: ScreenSpec[] = [
  {
    id: 'bar-tonight', title: 'Tonight', any: ['bar:read'], feature: 'bar_tonight', single: true,
    list: { path: '/api/bar/tonight' }, rows: () => ({ id: 'tonight', key: 'tonight', title: 'Tonight' }), empty: { title: 'Nothing set', body: 'Tonight shows here.' },
    detail: {
      path: () => '/api/bar/tonight', title: () => 'Tonight', subtitle: (d) => d.status?.updatedByName && `Last set by ${d.status.updatedByName}`,
      sections: [
        { title: 'Right now', fields: [
          { label: 'Bar', get: (d) => d.live?.bar?.short || (d.live?.bar?.isOpen ? 'Open' : d.live?.bar ? 'Closed' : undefined) },
          { label: 'Kitchen', get: (d) => d.live?.kitchen?.short || (d.live?.kitchen ? (d.live.kitchen.isOpen ? 'Open' : 'Closed') : undefined) },
          { label: 'How busy', get: (d) => d.live?.room?.label || BUSY_WORDS[d.status?.roomStatus] },
          { label: 'Special', get: (d) => d.live?.special?.title }, { label: 'Note', get: (d) => d.live?.note || d.status?.note },
        ] },
        { fields: [{ label: 'Good to know', get: () => 'Changes made here last until 4 AM, then go back to your hours.' }] },
      ],
      actions: [
        tonightAction('bar-open', 'Bar: open or closed', 'barOpen'), tonightAction('kitchen-open', 'Kitchen: open or closed', 'kitchenOpen', true),
        { id: 'how-busy', label: 'How busy', icon: 'people', any: ['bar:console'], confirm: { title: 'How busy is it?', body: () => LASTS, button: 'Save' },
          inputs: [{ id: 'v', label: 'Right now', kind: 'choice', choices: Object.keys(BUSY), required: true }],
          request: (_d, v) => ({ method: 'PUT', path: '/api/bar/tonight', body: { roomStatus: BUSY[v.v] } }), done: 'Tonight updated' },
        { id: 'note', label: 'Change the note', icon: 'create', any: ['bar:console'], confirm: { title: 'Tonight\'s note', body: () => LASTS, button: 'Save' },
          inputs: [{ id: 'note', label: 'Note', kind: 'multiline', initial: (d) => d.status?.note || '' }],
          request: (_d, v) => ({ method: 'PUT', path: '/api/bar/tonight', body: { note: v.note } }), done: 'Note saved' },
      ],
    },
  },
  {
    id: 'bar-menu', title: '86 board', any: ['bar:read'], feature: 'bar_menu',
    list: { path: '/api/bar/menu' }, pick: flattenMenu, search: undefined,
    chips: [{ id: 'all', label: 'Everything', query: {} }, { id: 'out', label: 'Out (86)', query: { tile: 'out' } }],
    rows: (i) => ({ id: i.id, key: i.id, title: i.name || 'Item', subtitle: i.sectionName, badge: i.is86ed ? 'Out (86)' : 'On', tone: i.is86ed ? 'danger' : 'success' }),
    empty: { title: 'Nothing here', body: 'Menu items show here. A manager adds them on the desktop.' },
    detail: {
      path: () => null, title: (d) => d.name, subtitle: (d) => d.sectionName, badge: (d) => (d.is86ed ? 'Out (86)' : 'On'),
      sections: [{ fields: [{ label: 'Status', get: (d) => (d.is86ed ? 'Out (86)' : 'On the menu') }] }],
      actions: [
        { id: 'put-86', label: 'Put on the 86 board', icon: 'close-circle', any: ['bar:console'], when: (d) => !d.is86ed, request: (d) => ({ method: 'PUT', path: `/api/bar/menu/items/${d.id}/86`, body: { is86ed: true } }), done: 'On the 86 board' },
        { id: 'back-on', label: 'Back on the menu', icon: 'checkmark-circle', any: ['bar:console'], when: (d) => !!d.is86ed, request: (d) => ({ method: 'PUT', path: `/api/bar/menu/items/${d.id}/86`, body: { is86ed: false } }), done: 'Back on the menu' },
      ],
    },
  },
  {
    id: 'bar-taps', title: 'Taps', any: ['bar:read'], feature: 'bar_menu',
    list: { path: '/api/bar/taps' }, chips: [{ id: 'all', label: 'All taps', query: {} }, { id: 'trouble', label: 'Low or blown', query: { tile: 'trouble' } }],
    rows: (t) => ({ id: t.id, key: t.id, title: t.beerName || 'Tap', subtitle: t.lineNumber != null ? `Line ${t.lineNumber}` : undefined, badge: TAP_WORDS[t.status] || words(t.status), tone: TAP_TONE[t.status] }),
    empty: { title: 'No taps', body: 'Taps show here when the tap list is on.' },
    detail: {
      path: () => null, title: (d) => d.beerName || 'Tap', badge: (d) => TAP_WORDS[d.status] || words(d.status), sections: [{ fields: [{ label: 'Status', get: (d) => TAP_WORDS[d.status] || words(d.status) }] }],
      actions: [{ id: 'tap-status', label: 'Change the tap', icon: 'beer', any: ['bar:console'], inputs: [{ id: 'status', label: 'Now', kind: 'choice', choices: Object.keys(TAP_WORDS), required: true }],
        request: (d, v) => ({ method: 'PUT', path: `/api/bar/taps/${d.id}/status`, body: { status: v.status } }), done: 'Tap updated' }],
    },
  },
  {
    id: 'bar-count', title: 'Count', any: ['bar:register'], feature: 'bar_stock',
    list: { path: '/api/stock/count' }, pick: (b) => b?.stock || [],
    rows: (i) => ({ id: i.id, key: i.id, title: i.name, subtitle: join(words(i.category), i.packName && i.packSize ? `${i.packName} of ${i.packSize}` : i.packName) }),
    empty: { title: 'No stock items', body: 'A manager adds stock items on the desktop.' },
    actions: [{ id: 'finish-count', label: 'Finish the count', icon: 'checkmark-done', any: ['bar:register'],
      confirm: { title: 'Finish this count?', body: () => 'This closes the count. A new one starts the next time someone counts.', button: 'Finish count' }, request: () => ({ method: 'POST', path: '/api/stock/count/finish' }), done: 'Count finished' }],
    detail: {
      path: () => null, title: (d) => d.name, subtitle: (d) => d.packName && d.packSize ? `${d.packName} of ${d.packSize}` : undefined,
      sections: [{ fields: [{ label: 'Counting', get: () => 'Count what is on the shelf. The system\'s number stays hidden until you finish.' }] }],
      actions: [{ id: 'save-count', label: 'Save this count', icon: 'create', any: ['bar:register'],
        inputs: [{ id: 'packs', label: 'Full packs', kind: 'number' }, { id: 'units', label: 'Loose units', kind: 'number' }],
        request: (d, v) => ({ method: 'POST', path: '/api/stock/count/item', body: { stockItemId: d.id, packs: Number(v.packs || 0), units: Number(v.units || 0) } }), done: 'Saved' }],
    },
  },
  {
    id: 'bar-shifts', title: 'Shifts', any: ['bar:read'], feature: 'bar_schedule',
    list: { path: '/api/schedule/published' },
    pick: (b) => (b?.weeks || []).flatMap((w: any) => (w.published ? w.shifts : []).map((s: any) => ({ ...s, weekStart: w.weekStart }))).sort((a: any, b: any) => String(a.day).localeCompare(String(b.day)) || String(a.start).localeCompare(String(b.start))),
    rows: (s, ctx) => ({ id: `${s.userId}-${s.day}-${s.start}`, key: `${s.userId}-${s.day}-${s.start}`, title: s.name || 'Shift', subtitle: join(s.position, s.note), meta: join(calDay(s.day), `${hhmm(s.start) || s.start}–${hhmm(s.end) || s.end}`), badge: ctx.userId && s.userId === ctx.userId ? 'Me' : undefined, tone: 'info' }),
    empty: { title: 'Not published yet', body: 'The schedule shows here once a manager publishes it.' },
    actions: [{ id: 'ask-time-off', label: 'Ask for a day off', icon: 'calendar', any: ['bar:read'],
      confirm: { title: 'Ask for a day off', body: () => 'A manager will approve or deny it.', button: 'Send request' },
      inputs: [{ id: 'day', label: 'Day (YYYY-MM-DD)', required: true }, { id: 'note', label: 'Note' }], request: (_d, v) => ({ method: 'POST', path: '/api/schedule/time-off', body: { day: v.day, note: v.note } }), done: 'Request sent' }],
  },
  {
    id: 'bar-time-off', title: 'Time off to decide', any: ['bar:update'], feature: 'bar_schedule',
    list: { path: '/api/schedule/time-off', query: { tile: 'pending' } }, pick: (b) => b?.requests || [],
    rows: (r) => ({ id: r.id, key: r.id, title: r.name || 'Request', subtitle: r.note, meta: calDay(r.day), badge: 'Waiting', tone: 'warning' }),
    empty: { title: 'Nothing waiting', body: 'Time-off requests show here.' },
    detail: {
      path: () => null, title: (d) => d.name || 'Request', subtitle: (d) => calDay(d.day), sections: [{ fields: [{ label: 'Day', get: (d) => calDay(d.day) }, { label: 'Note', get: (d) => d.note }] }],
      actions: [
        { id: 'approve', label: 'Approve', icon: 'checkmark-circle', any: ['bar:update'], request: (d) => ({ method: 'PUT', path: `/api/schedule/time-off/${d.id}`, body: { status: 'approved' } }), done: 'Approved' },
        { id: 'deny', label: 'Deny', icon: 'close-circle', any: ['bar:update'], confirm: { title: 'Deny this request?', body: (d) => `${d.name || 'They'} will see it was denied.`, button: 'Deny' }, request: (d) => ({ method: 'PUT', path: `/api/schedule/time-off/${d.id}`, body: { status: 'denied' } }), done: 'Denied' },
      ],
    },
  },
  {
    id: 'bar-orders', title: 'Orders on the way', any: ['bar:update'], feature: 'bar_stock',
    list: { path: '/api/stock/orders', query: { tile: 'on_the_way' } }, pick: (b) => b?.orders || [],
    rows: (o) => ({ id: o.id, key: o.id, title: o.vendor?.name || 'Order', subtitle: `${(o.lines || []).length} items`, meta: dayOnly(o.sentAt || o.createdAt), badge: 'Sent', tone: 'info' }),
    empty: { title: 'Nothing on the way', body: 'Deliveries you have sent show here.' },
  },
]
