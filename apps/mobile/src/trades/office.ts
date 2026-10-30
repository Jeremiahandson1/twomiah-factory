/**
 * Tier 2 (owner 10/30, "option 3"): the office pages an owner opens away from the desk, as kit screens, in every trade that
 * has them — each read from its desktop page and the server route it calls:
 *   · Hours        tenant-ui people/TimePage.tsx         GET /api/time, POST /api/time/:id/approve (time:update; the server
 *                                                       allows owners, admins and managers, never on their own hours)
 *   · Bookings     web/src/booking/BookingsPage.tsx      GET /api/booking/bookings?from&to, GET /:id, PATCH /:id { status }
 *   · Waitlist     web/src/booking/BookingExtrasPages    GET /api/booking/waitlist, DELETE /api/booking/waitlist/:id
 *   · Google       tenant-ui settings/GbpReviewsPage     GET /api/gbp/reviews, POST /api/gbp/reviews/reply { reviewName, comment }
 *                                                       (owner and admin; connecting Google stays on the desktop)
 *   · Requests     tenant-ui reviews/ReviewsPage.tsx     GET /api/reviews (the review REQUESTS sent), POST /follow-up/:id
 * Moving a booking, connecting Google and the review settings stay on the desktop.
 */
import { type ScreenSpec, words, money, dayOnly, dayTime, clock, join } from './kit'

const person = (u: any) => (u ? [u.firstName, u.lastName].filter(Boolean).join(' ') : '') || undefined
const hours = (v: unknown) => (v == null || v === '' ? undefined : `${Number(v).toFixed(2).replace(/\.?0+$/, '')} h`)
const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }
const stars = (v: unknown) => { const n = STARS[String(v)] ?? Number(v); return n > 0 ? `${'★'.repeat(n)}${'☆'.repeat(5 - n)}` : undefined }
const callTextEmail = (phone?: string | null, email?: string | null) => [
  ...(phone ? [{ label: 'Call', url: `tel:${phone}`, icon: 'call' }, { label: 'Text', url: `sms:${phone}`, icon: 'chatbubble' }] : []),
  ...(email ? [{ label: 'Email', url: `mailto:${email}`, icon: 'mail' }] : []),
]
const BOOKING_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = { pending: 'warning', confirmed: 'info', completed: 'success', no_show: 'danger', cancelled: 'neutral' }
const setStatus = (status: string) => (d: any) => ({ method: 'PATCH' as const, path: `/api/booking/bookings/${d.id}`, body: { status } })
/** Done and no-show only once the visit has begun — the server's own rule (booking/engine.ts setStatus: a minute's grace). */
const hasBegun = (d: any) => new Date(d.startAt).getTime() <= Date.now() + 60_000

export const OFFICE: ScreenSpec[] = [
  {
    // tenant-ui people/ExpensesPage.tsx: GET /api/expenses (a seat below manager gets its own claims only), GET /:id,
    // POST /:id/approve (owners, admins, managers; never their own). Adding one, with its receipt photo: expenses/new.tsx.
    id: 'office-expenses', title: 'Expenses', any: ['expenses:read'], feature: 'expense_tracking',
    list: { path: '/api/expenses' },
    create: { label: 'Add an expense', route: '/(details)/expenses/new', any: ['expenses:create'] },
    rows: (e) => ({ id: e.id, key: e.id, title: e.description || e.vendor || 'Expense', subtitle: join(dayOnly(e.date), words(e.category), e.submittedByName), meta: money(e.amount),
      badge: e.approved ? 'Approved' : 'Waiting', tone: e.approved ? 'success' : 'warning' }),
    empty: { title: 'No expenses yet', body: 'Add one with the + above — a photo of the receipt goes with it.' },
    detail: {
      path: (id) => `/api/expenses/${id}`,
      title: (d) => d.description || 'Expense', subtitle: (d) => join(money(d.amount), dayOnly(d.date)), badge: (d) => (d.approved ? 'Approved' : 'Waiting approval'),
      sections: [{ fields: [
        { label: 'Category', get: (d) => words(d.category) }, { label: 'Vendor', get: (d) => d.vendor }, { label: 'Spent by', get: (d) => d.submittedByName },
        { label: 'Job', get: (d) => d.job?.title }, { label: 'Receipt', get: (d) => (d.receiptUrl ? 'Kept (open it on the desktop)' : 'None') },
        { label: 'Billable', get: (d) => (d.billable ? 'Yes' : 'No') }, { label: 'To pay back', get: (d) => (d.reimbursable ? (d.reimbursed ? 'Paid back' : 'Yes') : undefined) },
      ] }],
      actions: [{
        id: 'approve', label: 'Approve', icon: 'checkmark-circle', any: ['expenses:update'], when: (d) => !d.approved,
        request: (d) => ({ method: 'POST', path: `/api/expenses/${d.id}/approve` }), done: 'Approved',
      }],
    },
  },
  {
    id: 'office-time', title: 'Hours', any: ['time:read'], feature: 'time_tracking',
    list: { path: '/api/time' },
    chips: [{ id: 'waiting', label: 'Waiting approval', query: { approved: 'false' } }, { id: 'all', label: 'All', query: {} }],
    rows: (e) => ({ id: e.id, key: e.id, title: person(e.user) || 'Someone', subtitle: join(dayOnly(e.date), e.job?.title || e.project?.name), meta: hours(e.hours),
      badge: e.approved ? 'Approved' : 'Waiting', tone: e.approved ? 'success' : 'warning' }),
    empty: { title: 'No hours here', body: 'Hours logged by the team show here, newest first.' },
    detail: {
      path: () => null,
      title: (d) => person(d.user) || 'Hours', subtitle: (d) => dayOnly(d.date), badge: (d) => (d.approved ? 'Approved' : 'Waiting approval'),
      sections: [{ fields: [
        { label: 'Hours', get: (d) => hours(d.hours) }, { label: 'Job', get: (d) => d.job?.title }, { label: 'Project', get: (d) => d.project?.name },
        { label: 'Notes', get: (d) => d.description }, { label: 'Billable', get: (d) => (d.billable ? 'Yes' : d.billable === false ? 'No' : undefined) },
      ] }],
      actions: [{
        id: 'approve', label: 'Approve', icon: 'checkmark-circle', any: ['time:update'], when: (d) => !d.approved,
        request: (d) => ({ method: 'POST', path: `/api/time/${d.id}/approve` }), done: 'Approved',
      }],
    },
  },
  {
    id: 'office-bookings', title: 'Bookings', any: ['bookings:read'], feature: 'online_booking',
    list: { path: '/api/booking/bookings' },
    chips: [
      { id: 'today', label: 'Today', query: { from: '{dayStart}', to: '{dayEnd}' } },
      { id: 'week', label: 'Next 7 days', query: { from: '{dayStart}', to: '{weekEnd}' } },
      { id: 'all', label: 'All', query: {} },
    ],
    rows: (b) => ({ id: b.id, key: b.id, title: b.customerName || 'Booking', subtitle: join(b.serviceName, b.assignedName), meta: dayTime(b.startAt),
      badge: words(b.status), tone: BOOKING_TONE[b.status] }),
    empty: { title: 'No bookings here', body: 'Bookings made online or by the team show here.' },
    detail: {
      path: (id) => `/api/booking/bookings/${id}`,
      title: (d) => d.customerName || 'Booking', subtitle: (d) => join(dayTime(d.startAt), d.endAt ? `to ${clock(d.endAt)}` : undefined), badge: (d) => words(d.status),
      sections: [
        { links: (d) => callTextEmail(d.customerPhone, d.customerEmail) },
        { fields: [
          { label: 'Service', get: (d) => d.serviceName }, { label: 'With', get: (d) => d.assignedName }, { label: 'Address', get: (d) => d.customerAddress },
          { label: 'Notes', get: (d) => d.customerNotes }, { label: 'Filed under', get: (d) => (d.contactName && d.contactName !== d.customerName ? d.contactName : undefined) },
          { label: 'Job', get: (d) => d.job?.number },
        ] },
      ],
      actions: [
        { id: 'confirm', label: 'Confirm', icon: 'checkmark', any: ['bookings:update'], when: (d) => d.status === 'pending', request: setStatus('confirmed'), done: 'Confirmed' },
        { id: 'complete', label: 'Mark done', icon: 'checkmark-done', any: ['bookings:update'], when: (d) => d.status === 'confirmed' && hasBegun(d), request: setStatus('completed'), done: 'Marked done' },
        { id: 'no-show', label: 'No-show', icon: 'person-remove', any: ['bookings:update'], when: (d) => d.status === 'confirmed' && hasBegun(d),
          confirm: { title: 'Mark as a no-show?', body: (d) => `${d.customerName || 'The customer'} did not come.`, button: 'Mark no-show' }, request: setStatus('no_show'), done: 'Marked as a no-show' },
        { id: 'cancel', label: 'Cancel booking', icon: 'close-circle', any: ['bookings:update'], when: (d) => d.status === 'pending' || d.status === 'confirmed',
          confirm: { title: 'Cancel this booking?', body: (d) => `${d.customerName || 'The customer'}'s booking is cancelled, as on the desktop.`, button: 'Cancel booking' }, request: setStatus('cancelled'), done: 'Booking cancelled' },
      ],
    },
  },
  {
    id: 'office-waitlist', title: 'Waitlist', any: ['bookings:read'], feature: 'online_booking',
    list: { path: '/api/booking/waitlist' },
    rows: (w) => ({ id: w.id, key: w.id, title: w.customerName || 'Someone', subtitle: join(w.serviceName, w.preferredFrom && `from ${w.preferredFrom}`, w.preferredTo && `to ${w.preferredTo}`),
      badge: words(w.status), tone: w.status === 'open' ? 'info' : 'neutral' }),
    empty: { title: 'Nobody is waiting', body: 'People who ask to be told when a time opens show here.' },
    detail: {
      path: () => null,
      title: (d) => d.customerName || 'Waitlist', subtitle: (d) => d.serviceName, badge: (d) => words(d.status),
      sections: [
        { links: (d) => callTextEmail(d.customerPhone, d.customerEmail) },
        { fields: [{ label: 'From', get: (d) => d.preferredFrom }, { label: 'To', get: (d) => d.preferredTo }, { label: 'Notes', get: (d) => d.notes }] },
      ],
      actions: [{
        id: 'remove', label: 'Take off the waitlist', icon: 'trash', any: ['bookings:update'],
        confirm: { title: 'Take them off the waitlist?', body: (d) => `${d.customerName || 'They'} will not be told when a time opens.`, button: 'Take off' },
        request: (d) => ({ method: 'DELETE', path: `/api/booking/waitlist/${d.id}` }), done: 'Taken off the waitlist',
      }],
    },
  },
  {
    // Owner and admin, as the server (signedInAdmin) and the menu row (admin) say: company:update is theirs alone.
    id: 'office-google-reviews', title: 'Google reviews', any: ['company:update'], feature: 'google_business',
    list: { path: '/api/gbp/reviews' }, pick: (b) => (Array.isArray(b?.reviews) ? b.reviews : []),
    rows: (r) => ({ id: r.name, key: r.name, title: r.reviewer || 'A reviewer', subtitle: r.comment ? String(r.comment).slice(0, 90) : undefined, meta: stars(r.starRating),
      badge: r.reply ? 'Replied' : 'No reply', tone: r.reply ? 'success' : 'warning' }),
    empty: { title: 'No reviews yet', body: 'Your Google reviews show here once Google is connected (Settings on the website).' },
    detail: {
      path: () => null,
      title: (d) => d.reviewer || 'Review', subtitle: (d) => join(stars(d.starRating), dayOnly(d.createTime)),
      sections: [{ fields: [{ label: 'Review', get: (d) => d.comment || '(rating only)' }, { label: 'Your reply', get: (d) => d.reply }] }],
      actions: [{
        id: 'reply', label: 'Reply', icon: 'chatbubble-ellipses', any: ['company:update'],
        inputs: [{ id: 'comment', label: 'Your reply (public on Google)', kind: 'multiline', required: true, initial: (d) => d.reply || '' }],
        request: (d, v) => ({ method: 'POST', path: '/api/gbp/reviews/reply', body: { reviewName: d.name, comment: v.comment } }), done: 'Reply posted to Google',
      }],
    },
  },
  {
    id: 'office-review-requests', title: 'Review requests', any: ['contacts:read'], feature: 'google_reviews',
    list: { path: '/api/reviews' },
    rows: (r) => ({ id: r.id, key: r.id, title: r.contact?.name || 'A customer', subtitle: join(r.job?.title, dayOnly(r.createdAt)), badge: words(r.status) }),
    empty: { title: 'No review requests yet', body: 'Requests sent to customers after a job show here.' },
    detail: {
      path: () => null,
      title: (d) => d.contact?.name || 'Review request', subtitle: (d) => d.job?.title, badge: (d) => words(d.status),
      sections: [
        { links: (d) => callTextEmail(d.contact?.phone, d.contact?.email) },
        { fields: [{ label: 'Sent', get: (d) => dayTime(d.sentAt || d.createdAt) }, { label: 'Opened the link', get: (d) => dayTime(d.clickedAt) }, { label: 'Followed up', get: (d) => dayTime(d.followUpSentAt) }] },
      ],
      actions: [{
        id: 'follow-up', label: 'Send a reminder', icon: 'send', any: ['marketing:create'],
        confirm: { title: 'Send a reminder?', body: (d) => `${d.contact?.name || 'The customer'} gets the review request again.`, button: 'Send it' },
        request: (d) => ({ method: 'POST', path: `/api/reviews/follow-up/${d.id}` }), done: 'Reminder sent',
      }],
    },
  },
]
