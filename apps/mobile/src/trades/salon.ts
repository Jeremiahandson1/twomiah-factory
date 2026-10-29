/**
 * SALON — hair, barber, nails, lash, spa (apps/unified/verticals/salon). The phone's tiles, screens and bars.
 *
 * Rules (owner, 2026-10-29): a Stylist is never shown a price (the server leaves the keys out; these screens draw only what arrives);
 * the Front Desk may check a client in (`schedule:check-in`) and nothing else in the book; owner, admin and manager share one home.
 * The home is the salon's own dashboard (/api/dashboard/stats → server/crm/salon/dashboard.ts), not the jobs one.
 * "Services this month" has no list on the desktop (the tile is not a link) and no endpoint lists a month's visits, so it is not a
 * phone tile: a tile opens exactly what it counts.
 */
import type { TileDef } from '../home/tiles'
import { type ScreenSpec, type Row, words, money, clock, dayTime, dayOnly, join } from './kit'

const STATS = '/api/dashboard/stats'
const paged = (b: any): number => Number(b?.pagination?.total ?? (Array.isArray(b?.data) ? b.data.length : Array.isArray(b) ? b.length : 0))

export const SALON_TILES: TileDef[] = [
  { id: 'rebook-due', label: 'Due to rebook', icon: 'repeat', tone: 'warning', any: ['contacts:read'], feature: 'rebooking_reminders', source: STATS,
    value: (s) => (s?.reminders ? Number(s.reminders.overdue || 0) + Number(s.reminders.dueSoon || 0) : undefined),
    opens: 'the clients due to rebook', list: { path: '/api/reminders/due' }, screen: 'trade', spec: 'salon-rebook', total: (b) => Number(b?.totalDue ?? paged(b)), banner: 'Due to rebook' },
  { id: 'appointments-today', label: 'Appointments today', icon: 'calendar', tone: 'accent', any: ['schedule:read'], feature: 'salon_booking', source: STATS,
    value: (s) => s?.appointments?.today,
    opens: "today's appointments", list: { path: '/api/appointments', query: { tile: 'today' } }, screen: 'trade', spec: 'salon-today', total: paged, banner: 'Appointments today' },
  { id: 'clients', label: 'Clients', icon: 'people', tone: 'info', any: ['contacts:read'], feature: 'client_profiles', source: STATS,
    value: (s) => s?.clients?.total,
    opens: 'your clients', list: { path: '/api/clients' }, screen: 'trade', spec: 'salon-clients', total: paged, banner: 'Clients' },
  { id: 'members', label: 'Members', icon: 'ribbon', tone: 'success', any: ['contacts:read'], feature: 'salon_memberships', source: STATS,
    value: (s) => s?.memberships?.activeEnrollments,
    opens: 'the active memberships', list: { path: '/api/memberships/enrollments', query: { tile: 'active' } }, screen: 'trade', spec: 'salon-members', total: paged, banner: 'Members' },
]

/** The server's own words for an appointment's status, only tidied (scheduled, confirmed, checked_in, in_chair, completed, no_show, cancelled). */
const apptTone = (s: string): Row['tone'] => (s === 'completed' ? 'success' : s === 'checked_in' || s === 'in_chair' ? 'info' : s === 'cancelled' || s === 'no_show' ? 'danger' : 'neutral')
const apptRow = (a: any): Row & { id: string } => ({
  id: a.id, key: a.id, title: a.clientName || 'Client',
  subtitle: join(clock(a.startTime) && `${clock(a.startTime)}${a.endTime ? '–' + clock(a.endTime) : ''}`, a.serviceName, a.stylistFirstName),
  meta: join(a.station, money(a.quotedPrice)), badge: words(a.status), tone: apptTone(a.status),
})
const steps = (f: any): string | undefined => {
  const a = Array.isArray(f) ? f : typeof f === 'string' ? (() => { try { return JSON.parse(f) } catch { return [] } })() : []
  return a.length ? a.map((x: any) => [x.product, x.shade, x.parts ? `${x.parts} parts` : ''].filter(Boolean).join(' ')).join(' + ') : undefined
}

export const SALON: ScreenSpec[] = [
  {
    id: 'salon-today', title: "Today's book", any: ['schedule:read'], feature: 'salon_booking',
    list: { path: '/api/appointments', query: { tile: 'today' } }, rows: apptRow,
    empty: { title: 'Nothing booked today', body: 'Appointments for today show here.' },
    detail: {
      path: () => null, title: (d) => d.clientName || 'Appointment', subtitle: (d) => join(dayTime(d.startTime), d.serviceName), badge: (d) => words(d.status),
      sections: [
        { fields: [
          { label: 'Service', get: (d) => d.serviceName }, { label: 'Stylist', get: (d) => join(d.stylistFirstName, d.stylistLastName) },
          { label: 'Chair', get: (d) => d.station }, { label: 'Price', get: (d) => money(d.quotedPrice) }, { label: 'Notes', get: (d) => d.notes },
        ] },
        { title: 'Client', rows: (d) => (d.contactId ? [{ key: 'chart', title: d.clientName || 'Client chart', subtitle: 'Allergies, formulas and past visits', open: { spec: 'salon-clients', id: d.contactId } }] : []) },
      ],
      actions: [{
        id: 'check-in', label: 'Check in', icon: 'checkmark-circle', any: ['schedule:update', 'schedule:check-in'], when: (d) => d.status === 'scheduled' || d.status === 'confirmed',
        request: (d) => ({ method: 'POST', path: `/api/appointments/${d.id}/check-in` }), done: 'Checked in',
      }],
    },
  },
  {
    id: 'salon-clients', title: 'Clients', any: ['contacts:read'], feature: 'client_profiles',
    list: { path: '/api/clients' }, search: { param: 'search', placeholder: 'Search clients' },
    rows: (c) => ({ id: c.id, key: c.id, title: c.name || 'Client', subtitle: join(c.phone || c.mobile, c.hairType), meta: c.stylistFirstName }),
    empty: { title: 'No clients yet', body: 'Clients show here once they are added.' },
    detail: {
      path: (id) => `/api/clients/${id}`, also: { formulas: (id) => `/api/clients/${id}/formulas` },
      title: (d) => d.contact?.name || 'Client', subtitle: (d) => join(d.contact?.mobile || d.contact?.phone, d.profile?.pronouns),
      sections: [
        { title: 'Before they sit', fields: [
          { label: 'Allergy or sensitivity', get: (d) => d.profile?.allergies }, { label: 'Last patch test', get: (d) => dayOnly(d.profile?.patchTestAt) },
          { label: 'Hair type', get: (d) => d.profile?.hairType }, { label: 'Scalp notes', get: (d) => d.profile?.scalpNotes }, { label: 'Preferences', get: (d) => d.profile?.preferences },
        ] },
        { title: 'Kept formulas', empty: 'No formula kept yet.', rows: (d) => (d._also?.formulas?.formulas || []).map((f: any) => ({
          key: f.id, title: f.label || 'Formula', subtitle: join(steps(f.formula), f.developerVolume && `${f.developerVolume} vol`, f.processingMin && `${f.processingMin} min`), meta: dayOnly(f.savedAt) })) },
        { title: 'Coming up', rows: (d) => (d.appointments || []).filter((a: any) => new Date(a.startTime) > new Date() && !['cancelled', 'no_show'].includes(a.status)).slice(0, 5)
          .map((a: any) => ({ key: a.id, title: a.serviceName || 'Appointment', meta: dayTime(a.startTime), badge: words(a.status) })) },
        { title: 'Past visits', empty: 'No visits yet.', rows: (d) => (d.serviceRecords || []).slice(0, 10).map((r: any) => ({
          key: r.id, title: r.serviceName || 'Visit', subtitle: join(steps(r.formula), r.result), meta: join(dayOnly(r.performedAt), money(r.priceCharged)) })) },
        { title: 'Memberships', rows: (d) => (d.memberships || []).map((m: any) => ({ key: m.id, title: m.planName || 'Membership', meta: m.creditsRemaining != null ? `${m.creditsRemaining} credits` : undefined, badge: words(m.status) })) },
        { fields: [{ label: 'Due back', get: (d) => dayOnly(d.stats?.dueBackAt) }, { label: 'On account', get: (d) => d.stats?.accountBalanceLabel }, { label: 'Lifetime', get: (d) => money(d.stats?.lifetimeValue) }] },
      ],
      actions: [{
        id: 'rebook-text', label: 'Text a rebooking reminder', icon: 'chatbubble', any: ['contacts:update'], when: (d) => !!d.stats?.dueBackAt,
        confirm: { title: 'Send a text?', body: (d) => `This sends a real text to ${d.contact?.name || 'this client'}.`, button: 'Send text' },
        inputs: [{ id: 'message', label: 'Message', kind: 'multiline', required: true, initial: (d) => `Hi ${String(d.contact?.name || '').split(' ')[0] || 'there'}, it's time to book your next visit. Reply here and we'll find you a time.` }],
        request: (d, v) => ({ method: 'POST', path: '/api/reminders/send', body: { contactIds: [d.contact.id], message: v.message } }), done: 'Text sent',
      }],
    },
  },
  {
    id: 'salon-rebook', title: 'Due to rebook', any: ['contacts:read'], feature: 'rebooking_reminders',
    list: { path: '/api/reminders/due' },
    rows: (r) => ({ id: r.contactId, key: `${r.contactId}-${r.recordId}`, title: r.clientName || 'Client', subtitle: join(r.serviceName, r.intervalNote), meta: r.dueDate && dayOnly(`${r.dueDate}T12:00:00`),
      badge: r.overdue ? 'Overdue' : 'Due soon', tone: r.overdue ? 'danger' : 'warning', open: { spec: 'salon-clients', id: r.contactId } }),
    empty: { title: 'Nobody is due', body: 'Clients due back show here.' },
  },
  {
    id: 'salon-members', title: 'Members', any: ['contacts:read'], feature: 'salon_memberships',
    list: { path: '/api/memberships/enrollments', query: { tile: 'active' } },
    rows: (m) => ({ id: m.contactId, key: m.id, title: m.clientName || 'Member', subtitle: join(m.planName, m.billingCycle), meta: join(m.creditsRemaining != null && `${m.creditsRemaining} credits`, money(m.planPrice)), badge: words(m.status),
      open: { spec: 'salon-clients', id: m.contactId } }),
    empty: { title: 'No active members', body: 'Active memberships show here.' },
  },
]
