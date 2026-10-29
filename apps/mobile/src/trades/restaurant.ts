/**
 * RESTAURANT, CATERER, EVENT VENUE — private events (enquiry → booking → deposit → banquet event order), not a POS.
 * Also the event book the BAR uses for its parties (bar.ts reuses these specs).
 *
 * Owner, 2026-10-29: the captain (Staff) is READ-ONLY this round — no guest-count edits, no run-of-show ticks. A manager MAY record
 * a deposit already received, behind a confirm, through the invoice's own record-payment route (a hand-entered record; it charges
 * nothing). The floor copy of the event order carries no prices, for anyone. Lost, Cancelled and delete stay on the website (they can
 * refuse after a deposit was collected). Nothing here takes a card.
 */
import type { TileDef } from '../home/tiles'
import { type ScreenSpec, type Row, words, money, calDay, hhmm, dayOnly, join } from './kit'

const STATS = '/api/dashboard/stats'
const paged = (b: any): number => Number(b?.pagination?.total ?? (Array.isArray(b?.data) ? b.data.length : Array.isArray(b) ? b.length : 0))
/** The floor (a captain, a bartender) reads today and the next 30 days; the inquiries and what is confirmed are the office's (a manager decides them, the read-only office seat reads them). */
const OFFICE_ONLY = ['contacts:update', 'invoices:read']
const eventTile = (id: string, label: string, icon: string, tone: TileDef['tone'], key: string, opens: string, any = ['contacts:read']): TileDef => ({
  id, label, icon, tone, any, feature: 'event_bookings', source: STATS, value: (s) => s?.tiles?.events?.[key],
  opens, list: { path: '/api/events', query: { tile: key } }, screen: 'trade', spec: 'events', total: paged, banner: label,
})

/** The private-events tiles, shared by the restaurant and the bar (the bar adds its own — bar.ts). */
export const EVENT_TILES: TileDef[] = [
  { id: 'payments-overdue', label: 'Payments overdue', icon: 'alert-circle', tone: 'danger', any: ['invoices:read'], feature: 'invoices', money: true, source: STATS, value: (s) => s?.tiles?.invoices?.overdue,
    opens: 'the overdue invoices', list: { path: '/api/invoices', query: { status: 'overdue' } }, screen: 'trade', spec: 'overdue-invoices', total: paged, banner: 'Payments overdue' },
  eventTile('events-today', "Today's events", 'today', 'accent', 'today', "today's events"),
  eventTile('open-inquiries', 'Open inquiries', 'mail-unread', 'warning', 'inquiries', 'the inquiries waiting on you', OFFICE_ONLY),
  eventTile('next-30-days', 'Next 30 days', 'calendar', 'info', 'next30', 'the events in the next 30 days'),
  eventTile('confirmed', 'Confirmed', 'checkmark-circle', 'success', 'confirmed', 'the confirmed events still to come', OFFICE_ONLY),
]

export const RESTAURANT_TILES: TileDef[] = EVENT_TILES

const STATUS_TONE: Record<string, Row['tone']> = { enquiry: 'warning', tentative: 'info', confirmed: 'success', completed: 'neutral', lost: 'danger', cancelled: 'danger' }
/** The server's event statuses, in its words ("enquiry" is the desktop's "Inquiry"). */
export const eventStatus = (s: string) => (s === 'enquiry' ? 'Inquiry' : words(s))
const eventRow = (e: any): Row & { id: string } => ({
  id: e.id, key: e.id, title: e.name || 'Event', subtitle: join(e.clientName, e.spaceName, e.guestCountFinal ? `${e.guestCountFinal} guests (guaranteed)` : e.guestCount ? `${e.guestCount} guests` : undefined),
  meta: join(calDay(e.eventDate), hhmm(e.startTime)), badge: eventStatus(e.status), tone: STATUS_TONE[e.status],
})

const INSTALLMENT: Record<string, string> = { unpaid: 'Due', part_paid: 'Part paid', paid: 'Paid', refunded: 'Refunded', void: 'Void' }
const DEPT: Record<string, string> = { floor: 'Floor', kitchen: 'Kitchen', bar: 'Bar', av: 'AV', setup: 'Setup' }

export const EVENTS: ScreenSpec[] = [
  {
    id: 'events', title: 'Events', any: ['contacts:read'], feature: 'event_bookings',
    list: { path: '/api/events' }, search: { param: 'search', placeholder: 'Search events or clients' },
    chips: [
      { id: 'today', label: 'Today', query: { tile: 'today' } }, { id: 'next30', label: 'Next 30 days', query: { tile: 'next30' } },
      { id: 'inquiries', label: 'Inquiries', query: { tile: 'inquiries' } }, { id: 'confirmed', label: 'Confirmed', query: { tile: 'confirmed' } },
    ],
    rows: eventRow, empty: { title: 'Nothing here', body: 'Events for this view show here.' },
    detail: {
      path: (id) => `/api/events/${id}`,
      title: (d) => d.event?.name || 'Event', subtitle: (d) => join(calDay(d.event?.eventDate), join(hhmm(d.event?.startTime), hhmm(d.event?.endTime) && `to ${hhmm(d.event?.endTime)}`)), badge: (d) => eventStatus(d.event?.status),
      sections: [
        // the banquet event order, in the floor's order: the allergy alert FIRST
        { title: 'Dietary requirements', fields: [{ label: 'Alert', get: (d) => d.event?.dietaryRequirements }] },
        { title: 'Event', fields: [
          { label: 'Space', get: (d) => d.space?.name }, { label: 'Type', get: (d) => words(d.event?.eventType) },
          { label: 'Guests', get: (d) => d.event?.guestCountFinal ? `${d.event.guestCountFinal} (guaranteed)` : d.event?.guestCount ? `${d.event.guestCount} (estimated)` : undefined },
          { label: 'Coordinator', get: (d) => join(d.event?.coordinatorFirstName, d.event?.coordinatorLastName) },
        ] },
        { title: 'Client', fields: [{ label: 'Name', get: (d) => d.client?.name }], links: (d) => [
          ...(d.client?.mobile || d.client?.phone ? [{ label: `Call ${d.client.mobile || d.client.phone}`, url: `tel:${String(d.client.mobile || d.client.phone).replace(/[^\d+]/g, '')}`, icon: 'call' }] : []),
          ...(d.client?.email ? [{ label: d.client.email, url: `mailto:${d.client.email}`, icon: 'mail' }] : []) ] },
        { title: 'Run of show', empty: 'No run of show recorded.', rows: (d) => [...(d.timeline || [])].sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.time).localeCompare(String(b.time)))
          .map((t: any) => ({ key: t.id, title: t.title || 'Step', subtitle: t.details || undefined, meta: hhmm(t.time), badge: DEPT[t.department] || words(t.department) })) },
        // no prices on the floor copy, for anyone
        { title: 'Food and beverage', empty: 'No menu lines recorded.', rows: (d) => (d.menu || []).map((m: any) => ({
          key: m.id, title: m.name || m.item || 'Item', subtitle: m.notes || undefined, meta: join(m.quantity != null && String(m.quantity), m.perPerson ? 'per person' : 'flat') })) },
        { title: 'Setup', fields: [{ label: 'Setup notes', get: (d) => d.event?.setupNotes }, { label: 'Notes', get: (d) => d.event?.notes }] },
        // money seats only: the server leaves these keys out for anyone else
        { title: 'Deposits and payments', rows: (d) => (d.payments || []).map((p: any) => ({ key: p.id, title: p.label || 'Payment', subtitle: p.dueDate && `Due ${dayOnly(`${p.dueDate}T12:00:00`)}`, meta: money(p.amount), badge: INSTALLMENT[p.state] || words(p.state), tone: p.state === 'paid' ? 'success' : 'warning' })) },
        { fields: [{ label: 'Still to pay', get: (d) => (d.totals ? money(d.totals.outstanding) : undefined), money: true }] },
        { fields: [{ label: 'Reminder', get: () => 'Confirm final guest numbers before service.' }] },
      ],
      actions: [{
        id: 'record-deposit', label: 'Record a deposit received', icon: 'cash', any: ['invoices:update'], when: (d) => !!d.invoice?.id && Number(d.totals?.outstanding ?? 0) > 0 && !['void', 'refunded'].includes(d.invoice.status),
        confirm: { title: 'Record a payment already received?', body: (d) => `This writes down money the venue already has. It does not charge anyone's card. It goes on invoice ${d.invoice?.number || ''}.`, button: 'Record payment' },
        inputs: [{ id: 'amount', label: 'Amount received ($)', kind: 'number', required: true }, { id: 'method', label: 'How it was paid', kind: 'choice', choices: ['cash', 'check', 'bank_transfer', 'other'], required: true }, { id: 'reference', label: 'Check number or note' }],
        request: (d, v) => ({ method: 'POST', path: `/api/invoices/${d.invoice.id}/payments`, body: { amount: Number(v.amount), method: v.method, ...(v.reference ? { reference: v.reference } : {}) } }), done: 'Payment recorded',
      }],
    },
  },
  {
    id: 'overdue-invoices', title: 'Payments overdue', any: ['invoices:read'], feature: 'invoices',
    list: { path: '/api/invoices', query: { status: 'overdue' } },
    rows: (i) => ({ id: i.eventId || i.id, key: i.id, title: i.number ? `Invoice ${i.number}` : 'Invoice', subtitle: join(i.contact?.name || i.contactName, i.dueDate && `due ${dayOnly(i.dueDate)}`), meta: money(i.balance), badge: 'Overdue', tone: 'danger',
      ...(i.eventId ? { open: { spec: 'events', id: i.eventId } } : {}) }),
    empty: { title: 'Nothing overdue', body: 'Invoices past their due date show here.' },
  },
]
