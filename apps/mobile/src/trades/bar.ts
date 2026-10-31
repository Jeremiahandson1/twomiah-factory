/**
 * BAR AND TAVERN — the live board and the back room: set tonight, 86 an item, flag a tap, a blind stock count, my shifts, and the
 * private-party book (the same event specs as the restaurant). Not a register: no open tabs, no close-out, nothing that takes a card — closing
 * the night stays on the desktop (owner, 2026-10-29), and the bartender's sales are not shown (the desktop hides them from that seat).
 *
 * Deviation from the design, on purpose: "Stock to count" is not a tile — the server has no such idea (nothing marks an item as due),
 * so a tile could not open exactly what it counts. The count itself is a tab screen.
 */
import type { TileDef } from '../home/tiles'
import { type ScreenSpec, type Row, words, calDay, hhmm, dayOnly, join } from './kit'
import { EVENT_TILES } from './restaurant'
import { DAY_NAMES, WEEK_CHOICES, DATE_CHOICES, STATUS, STATUS_TONE, weekAfter, windowWords, dateBody, dateWords, shiftWords, swapRows, mayTakeBack, swapChoices, choiceLabel, localDay } from './shiftRequests'

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
        // Open bottles by how full each is: sent only when one is filled in (the server takes it only where the venue has switched it on).
        inputs: [{ id: 'packs', label: 'Full packs', kind: 'number' }, { id: 'units', label: 'Loose units', kind: 'number' },
          { id: 'fill1', label: 'Open bottle 1, how full', kind: 'level' }, { id: 'fill2', label: 'Open bottle 2, how full', kind: 'level' }, { id: 'fill3', label: 'Open bottle 3, how full', kind: 'level' }],
        request: (d, v) => {
          const fills = ['fill1', 'fill2', 'fill3'].filter((k) => String(v[k] ?? '').trim() !== '').map((k) => Number(v[k]) / 100)
          return { method: 'POST', path: '/api/stock/count/item', body: { stockItemId: d.id, packs: Number(v.packs || 0), units: Number(v.units || 0), ...(fills.length ? { fills } : {}) } }
        }, done: 'Saved' }],
    },
  },
  {
    id: 'bar-shifts', title: 'Shifts', any: ['bar:read'], feature: 'bar_schedule',
    list: { path: '/api/schedule/published' },
    pick: (b) => (b?.weeks || []).flatMap((w: any) => (w.published ? w.shifts : []).map((s: any) => ({ ...s, weekStart: w.weekStart }))).sort((a: any, b: any) => String(a.day).localeCompare(String(b.day)) || String(a.start).localeCompare(String(b.start))),
    rows: (s, ctx) => ({ id: `${s.userId}-${s.day}-${s.start}`, key: `${s.userId}-${s.day}-${s.start}`, title: s.name || 'Shift', subtitle: join(s.position, s.note), meta: join(calDay(s.day), `${hhmm(s.start) || s.start}–${hhmm(s.end) || s.end}`), badge: ctx.userId && s.userId === ctx.userId ? 'Me' : undefined, tone: 'info' }),
    empty: { title: 'Not published yet', body: 'The schedule shows here once a manager publishes it.' },
    // Availability and swaps are the Schedule page's, on the phone (restaurant-bar parity #11): the same routes, each behind its own business switch.
    links: [
      { label: 'My availability', route: '/(details)/t/bar-availability/-', icon: 'calendar', any: ['bar:read'], feature: 'bar_availability' },
      { label: 'Swaps and pick-ups', route: '/(details)/t/bar-swaps', icon: 'swap-horizontal', any: ['bar:read'], feature: 'bar_shift_swaps' },
      { label: 'Swaps to decide', route: '/(details)/t/bar-swap-decide', icon: 'checkmark-done', any: ['bar:update'], feature: 'bar_shift_swaps' },
      { label: 'Availability to approve', route: '/(details)/t/bar-availability-ok', icon: 'checkmark-done', any: ['bar:update'], feature: 'bar_availability' },
      { label: 'One-day changes to approve', route: '/(details)/t/bar-dates-ok', icon: 'checkmark-done', any: ['bar:update'], feature: 'bar_availability' },
    ],
    detail: {
      path: () => null, title: (d) => d.name || 'Shift', subtitle: (d) => shiftWords(d), badge: (d) => (d._me && d.userId === d._me ? 'My shift' : undefined),
      sections: [{ fields: [{ label: 'Who', get: (d) => d.name }, { label: 'When', get: (d) => shiftWords(d) }, { label: 'Note', get: (d) => d.note }] }],
      actions: [
        { id: 'give-shift', label: 'Give this shift away', icon: 'gift', any: ['bar:read'], feature: 'bar_shift_swaps', when: (d) => !!d.id && !!d._me && d.userId === d._me,
          confirm: { title: 'Give this shift away?', body: (d) => `Your ${shiftWords(d)} goes on the list for the others to take. It stays yours until someone takes it, and a manager may need to approve.`, button: 'Give it away' },
          inputs: [{ id: 'note', label: 'Note for the others (optional)' }],
          offline: (d) => ({ key: `shift-offer:${d.id}`, label: `Give away · ${shiftWords(d)}` }),
          request: (d, v) => ({ method: 'POST', path: '/api/schedule/swaps', body: { kind: 'give', shiftId: d.id, note: v.note || undefined } }), done: 'Your shift is on offer' },
        { id: 'swap-shift', label: 'Swap this shift', icon: 'swap-horizontal', any: ['bar:read'], feature: 'bar_shift_swaps', when: (d) => !!d.id && !!d._me && d.userId === d._me,
          inputs: [{ id: 'with', label: 'The shift you would take instead', required: true,
            options: { path: () => '/api/schedule/published', pick: (b, row) => swapChoices(b, row, localDay()), label: choiceLabel, value: (x) => x.id, none: 'Nobody else has a coming shift on the published schedule.', loading: 'Getting the schedule…' } },
            { id: 'note', label: 'Note (optional)' }],
          offline: (d) => ({ key: `shift-offer:${d.id}`, label: `Swap · ${shiftWords(d)}` }),
          request: (d, v) => ({ method: 'POST', path: '/api/schedule/swaps', body: { kind: 'swap', shiftId: d.id, withShiftId: v.with, note: v.note || undefined } }), done: 'Swap asked. They have to say yes first' },
      ],
    },
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
  // ── Availability, swaps and pick-ups (restaurant-bar parity #11). Every write goes through the offline queue and is safe to send twice (the server
  //    honours the queue's Idempotency-Key); a refusal after the signal comes back (someone else took the shift) shows in the waiting list in the server's words.
  {
    id: 'bar-availability', title: 'My availability', any: ['bar:read'], feature: 'bar_availability', single: true,
    list: { path: '/api/schedule/availability/mine' }, rows: () => ({ id: 'mine', key: 'mine', title: 'My availability' }), empty: { title: 'Nothing set', body: 'Your availability shows here.' },
    detail: {
      path: () => '/api/schedule/availability/mine', also: { dates: () => '/api/schedule/availability/dates/mine' },
      title: () => 'My availability', subtitle: (d) => (d.pending != null ? 'A change is waiting for a manager' : 'When you can work'),
      sections: [
        { title: 'My usual week', fields: DAY_NAMES.map((n, i) => ({ label: n, get: (d: any) => windowWords(d.approved || [], i) ?? ((d.approved || []).length ? 'Cannot work' : 'Free any time') })) },
        { title: 'Waiting for a manager', fields: DAY_NAMES.map((n, i) => ({ label: n, get: (d: any) => (d.pending && d.pending.length ? windowWords(d.pending, i) ?? 'Cannot work' : undefined) }))
          .concat([{ label: 'Your ask', get: (d: any) => (d.pending && !d.pending.length ? 'Free any time, every day' : undefined) }]) },
        { title: 'One-day changes', links: () => [{ label: 'Change one day', url: '', icon: 'calendar', route: '/(details)/t/bar-my-dates' }],
          rows: (d: any) => [...(d._also?.dates?.pending || []), ...(d._also?.dates?.approved || [])].map((e: any): Row => ({ key: e.id, title: calDay(e.day) || e.day, subtitle: dateWords(e), badge: e.status === 'pending' ? 'Waiting' : 'Approved', tone: e.status === 'pending' ? 'warning' : 'success' })) },
      ],
      actions: [
        { id: 'set-weekday', label: 'Change a day of my week', icon: 'create', any: ['bar:read'], feature: 'bar_availability',
          confirm: { title: 'Change a day of my week', body: () => 'A manager approves the change before the schedule uses it.', button: 'Send for approval' },
          inputs: [{ id: 'dow', label: 'Which day', kind: 'choice', choices: DAY_NAMES, required: true }, { id: 'what', label: 'On that day', kind: 'choice', choices: Object.values(WEEK_CHOICES), required: true },
            { id: 'start', label: 'From (like 4 PM), only for between two times' }, { id: 'end', label: 'Until (like 11 PM)' }],
          offline: () => ({ key: 'availability:mine', label: 'My availability' }),
          request: (d, v) => ({ method: 'PUT', path: '/api/schedule/availability/mine', body: { windows: weekAfter((d.pending && d.pending.length ? d.pending : d.approved) || [], DAY_NAMES.indexOf(v.dow), v.what, v.start, v.end) } }), done: 'Sent to a manager' },
        { id: 'free-every-day', label: 'Free any time, every day', icon: 'infinite', any: ['bar:read'], feature: 'bar_availability',
          confirm: { title: 'Free any time, every day?', body: () => 'This clears your usual week. A manager approves it before the schedule uses it.', button: 'Send for approval' },
          offline: () => ({ key: 'availability:mine', label: 'My availability' }),
          request: () => ({ method: 'PUT', path: '/api/schedule/availability/mine', body: { windows: [] } }), done: 'Sent to a manager' },
      ],
    },
  },
  {
    id: 'bar-my-dates', title: 'My one-day changes', any: ['bar:read'], feature: 'bar_availability',
    list: { path: '/api/schedule/availability/dates/mine' }, pick: (b) => [...(b?.pending || []), ...(b?.approved || [])],
    rows: (e) => ({ id: e.id, key: e.id, title: calDay(e.day) || e.day, subtitle: join(dateWords(e), e.note), badge: e.status === 'pending' ? 'Waiting' : 'Approved', tone: e.status === 'pending' ? 'warning' : 'success' }),
    empty: { title: 'No one-day changes', body: 'Use "Change one day" when one date is different from your usual week.' },
    actions: [{ id: 'change-one-day', label: 'Change one day', icon: 'calendar', any: ['bar:read'], feature: 'bar_availability',
      confirm: { title: 'Change one day', body: () => 'For that date this replaces your usual week. A manager approves it first.', button: 'Send for approval' },
      inputs: [{ id: 'day', label: 'Day (YYYY-MM-DD)', required: true }, { id: 'mode', label: 'On that day', kind: 'choice', choices: Object.values(DATE_CHOICES), required: true },
        { id: 'start', label: 'From (like 4 PM), only for between two times' }, { id: 'end', label: 'Until (like 11 PM)' }, { id: 'note', label: 'Note (optional)' }],
      offline: () => ({ key: 'availability:dates', label: 'One-day availability' }),
      request: (_d, v) => ({ method: 'POST', path: '/api/schedule/availability/dates/mine', body: dateBody(v) }), done: 'Sent to a manager' }],
    detail: {
      path: () => null, title: (d) => calDay(d.day) || d.day, subtitle: (d) => dateWords(d), badge: (d) => (d.status === 'pending' ? 'Waiting for a manager' : 'Approved'),
      sections: [{ fields: [{ label: 'Day', get: (d) => calDay(d.day) }, { label: 'Then', get: (d) => dateWords(d) }, { label: 'Note', get: (d) => d.note }] }],
      actions: [{ id: 'take-back-day', label: 'Take this back', icon: 'close-circle', any: ['bar:read'], feature: 'bar_availability', when: (d) => d.status === 'pending',
        confirm: { title: 'Take this back?', body: () => 'It goes away before a manager sees it.', button: 'Take it back' },
        offline: (d) => ({ key: `availability:date:${d.id}`, label: `One-day availability · ${calDay(d.day) || d.day}` }),
        request: (d) => ({ method: 'DELETE', path: `/api/schedule/availability/dates/mine/${d.id}` }), done: 'Taken back' }],
    },
  },
  {
    id: 'bar-swaps', title: 'Swaps and pick-ups', any: ['bar:read'], feature: 'bar_shift_swaps',
    list: { path: '/api/schedule/swaps/mine' }, pick: swapRows,
    rows: (r) => r._group === 'for-me'
      ? { id: r.id, key: r.id, title: `${r.fromName} offers you a swap`, subtitle: `Their ${shiftWords(r.shift)} for your ${shiftWords(r.withShift)}`, badge: 'For you', tone: 'info' }
      : r._group === 'on-offer'
        ? { id: r.id, key: r.id, title: `${r.fromName} is giving a shift away`, subtitle: shiftWords(r.shift), badge: 'Open', tone: 'info' }
        : { id: r.id, key: r.id, title: r.kind === 'give' ? 'You are giving a shift away' : `Swap with ${r.toName || 'someone'}`, subtitle: shiftWords(r.shift), badge: STATUS[r.status] || words(r.status), tone: STATUS_TONE[r.status] },
    empty: { title: 'Nothing right now', body: 'Shifts others give away, swaps offered to you and your own requests show here.' },
    detail: {
      path: () => null, title: (d) => (d._group === 'on-offer' ? 'A shift to take' : d._group === 'for-me' ? 'A swap for you' : 'My request'), subtitle: (d) => shiftWords(d.shift),
      badge: (d) => (d._group === 'mine' ? STATUS[d.status] || words(d.status) : undefined),
      sections: [{ fields: [{ label: 'From', get: (d) => d.fromName }, { label: 'Shift', get: (d) => shiftWords(d.shift) }, { label: 'In return', get: (d) => (d.withShift ? shiftWords(d.withShift) : undefined) }, { label: 'Note', get: (d) => d.note },
        { label: 'Then', get: (d) => (d._group === 'on-offer' ? (d._pickupsNeedManager ? 'A manager approves before it is yours.' : 'It is yours as soon as you take it.') : d._group === 'for-me' ? (d._swapsNeedManager ? 'If you say yes, a manager approves before anything moves.' : 'If you say yes, the swap happens.') : undefined) }] }],
      actions: [
        { id: 'claim-shift', label: 'Take this shift', icon: 'hand-left', any: ['bar:read'], feature: 'bar_shift_swaps', when: (d) => d._group === 'on-offer',
          confirm: { title: 'Take this shift?', body: (d) => `${shiftWords(d.shift)}. ${d._pickupsNeedManager ? 'A manager approves before it is yours.' : 'It is yours as soon as you take it.'}`, button: 'Take it' },
          offline: (d) => ({ key: `swap:${d.id}`, label: `Take shift · ${shiftWords(d.shift)}` }),
          request: (d) => ({ method: 'POST', path: `/api/schedule/swaps/${d.id}/claim` }), done: 'Asked for. You will see it on the schedule once it is yours' },
        { id: 'accept-swap', label: 'Say yes', icon: 'checkmark-circle', any: ['bar:read'], feature: 'bar_shift_swaps', when: (d) => d._group === 'for-me',
          confirm: { title: 'Swap shifts?', body: (d) => `You take ${shiftWords(d.shift)} and ${d.fromName} takes ${shiftWords(d.withShift)}. ${d._swapsNeedManager ? 'A manager approves before anything moves.' : 'The schedule changes right away.'}`, button: 'Say yes' },
          offline: (d) => ({ key: `swap:${d.id}`, label: `Swap with ${d.fromName}` }),
          request: (d) => ({ method: 'POST', path: `/api/schedule/swaps/${d.id}/accept` }), done: 'You said yes' },
        { id: 'decline-swap', label: 'Say no', icon: 'close-circle', any: ['bar:read'], feature: 'bar_shift_swaps', when: (d) => d._group === 'for-me',
          confirm: { title: 'Say no to this swap?', body: (d) => `${d.fromName} will see that you said no.`, button: 'Say no' },
          offline: (d) => ({ key: `swap:${d.id}`, label: `Swap with ${d.fromName}` }),
          request: (d) => ({ method: 'POST', path: `/api/schedule/swaps/${d.id}/decline` }), done: 'You said no' },
        { id: 'cancel-request', label: 'Take it back', icon: 'arrow-undo', any: ['bar:read'], feature: 'bar_shift_swaps', when: mayTakeBack,
          confirm: { title: 'Take this request back?', body: () => 'The shift stays yours.', button: 'Take it back' },
          offline: (d) => ({ key: `swap:${d.id}`, label: `Take back · ${shiftWords(d.shift)}` }),
          request: (d) => ({ method: 'POST', path: `/api/schedule/swaps/${d.id}/cancel` }), done: 'Taken back' },
      ],
    },
  },
  {
    id: 'bar-swap-decide', title: 'Swaps to decide', any: ['bar:update'], feature: 'bar_shift_swaps',
    list: { path: '/api/schedule/swaps', query: { tile: 'pending' } }, pick: (b) => b?.pending || [],
    rows: (r) => ({ id: r.id, key: r.id, title: r.kind === 'give' ? `${r.fromName} gives a shift to ${r.toName || 'someone'}` : `${r.fromName} and ${r.toName || 'someone'} swap`, subtitle: shiftWords(r.shift), badge: 'Waiting', tone: 'warning' }),
    empty: { title: 'Nothing waiting', body: 'Swaps and pick-ups that need a manager show here.' },
    detail: {
      path: () => null, title: (d) => (d.kind === 'give' ? 'A shift changes hands' : 'A swap'), subtitle: (d) => shiftWords(d.shift),
      sections: [{ fields: [{ label: 'Giving up', get: (d) => `${d.fromName}: ${shiftWords(d.shift)}` }, { label: 'Taking it', get: (d) => d.toName }, { label: 'In return', get: (d) => (d.withShift ? shiftWords(d.withShift) : undefined) }, { label: 'Note', get: (d) => d.note }] }],
      actions: [
        { id: 'approve-swap', label: 'Approve', icon: 'checkmark-circle', any: ['bar:update'], feature: 'bar_shift_swaps',
          confirm: { title: 'Approve this?', body: (d) => `The schedule changes and ${d.fromName}${d.toName ? ` and ${d.toName}` : ''} are told.`, button: 'Approve' },
          offline: (d) => ({ key: `swap-decision:${d.id}`, label: `Approve swap · ${d.fromName}` }),
          request: (d) => ({ method: 'PUT', path: `/api/schedule/swaps/${d.id}`, body: { status: 'approved' } }), done: 'Approved' },
        { id: 'deny-swap', label: 'Deny', icon: 'close-circle', any: ['bar:update'], feature: 'bar_shift_swaps',
          confirm: { title: 'Deny this?', body: (d) => `Nothing changes on the schedule. ${d.fromName} is told.`, button: 'Deny' },
          offline: (d) => ({ key: `swap-decision:${d.id}`, label: `Deny swap · ${d.fromName}` }),
          request: (d) => ({ method: 'PUT', path: `/api/schedule/swaps/${d.id}`, body: { status: 'denied' } }), done: 'Denied' },
      ],
    },
  },
  {
    id: 'bar-availability-ok', title: 'Availability to approve', any: ['bar:update'], feature: 'bar_availability',
    list: { path: '/api/schedule/availability' }, pick: (b) => (b?.people || []).filter((p: any) => p.pending != null),
    rows: (p) => ({ id: p.userId, key: p.userId, title: p.name, subtitle: p.pending?.length ? `${p.pending.length} ${p.pending.length === 1 ? 'window' : 'windows'} asked for` : 'Free any time, every day', badge: 'Waiting', tone: 'warning' }),
    empty: { title: 'Nothing waiting', body: 'Changes to usual weeks that need a manager show here.' },
    detail: {
      path: () => null, title: (d) => d.name, subtitle: () => 'Wants to change their usual week',
      sections: [
        { title: 'Asked for', fields: DAY_NAMES.map((n, i) => ({ label: n, get: (d: any) => (d.pending?.length ? windowWords(d.pending, i) ?? 'Cannot work' : i === 0 ? 'Free any time, every day' : undefined) })) },
        { title: 'Now', fields: DAY_NAMES.map((n, i) => ({ label: n, get: (d: any) => windowWords(d.windows || [], i) ?? ((d.windows || []).length ? 'Cannot work' : 'Free any time') })) },
      ],
      actions: [
        { id: 'approve-week', label: 'Approve', icon: 'checkmark-circle', any: ['bar:update'], feature: 'bar_availability',
          confirm: { title: 'Approve this week?', body: (d) => `The schedule uses ${d.name}'s new week from now on.`, button: 'Approve' },
          offline: (d) => ({ key: `availability-decision:${d.userId}`, label: `Approve availability · ${d.name}` }),
          request: (d) => ({ method: 'POST', path: `/api/schedule/availability/${d.userId}/decision`, body: { status: 'approved' } }), done: 'Approved' },
        { id: 'deny-week', label: 'Deny', icon: 'close-circle', any: ['bar:update'], feature: 'bar_availability',
          confirm: { title: 'Deny this?', body: (d) => `${d.name}'s usual week stays as it is.`, button: 'Deny' },
          offline: (d) => ({ key: `availability-decision:${d.userId}`, label: `Deny availability · ${d.name}` }),
          request: (d) => ({ method: 'POST', path: `/api/schedule/availability/${d.userId}/decision`, body: { status: 'denied' } }), done: 'Denied' },
      ],
    },
  },
  {
    id: 'bar-dates-ok', title: 'One-day changes to approve', any: ['bar:update'], feature: 'bar_availability',
    list: { path: '/api/schedule/availability/dates' }, pick: (b) => b?.pending || [],
    rows: (e) => ({ id: e.id, key: e.id, title: e.name || 'Someone', subtitle: join(calDay(e.day), dateWords(e)), badge: 'Waiting', tone: 'warning' }),
    empty: { title: 'Nothing waiting', body: 'One-day changes that need a manager show here.' },
    detail: {
      path: () => null, title: (d) => d.name || 'One-day change', subtitle: (d) => calDay(d.day),
      sections: [{ fields: [{ label: 'Day', get: (d) => calDay(d.day) }, { label: 'Then', get: (d) => dateWords(d) }, { label: 'Note', get: (d) => d.note }] }],
      actions: [
        { id: 'approve-day', label: 'Approve', icon: 'checkmark-circle', any: ['bar:update'], feature: 'bar_availability',
          confirm: { title: 'Approve this day?', body: (d) => `The schedule uses it for ${calDay(d.day)}.`, button: 'Approve' },
          offline: (d) => ({ key: `availability-day-decision:${d.id}`, label: `Approve one day · ${d.name}` }),
          request: (d) => ({ method: 'POST', path: `/api/schedule/availability/dates/${d.id}/decision`, body: { status: 'approved' } }), done: 'Approved' },
        { id: 'deny-day', label: 'Deny', icon: 'close-circle', any: ['bar:update'], feature: 'bar_availability',
          confirm: { title: 'Deny this day?', body: () => 'Their usual week stays for that date.', button: 'Deny' },
          offline: (d) => ({ key: `availability-day-decision:${d.id}`, label: `Deny one day · ${d.name}` }),
          request: (d) => ({ method: 'POST', path: `/api/schedule/availability/dates/${d.id}/decision`, body: { status: 'denied' } }), done: 'Denied' },
      ],
    },
  },
]
