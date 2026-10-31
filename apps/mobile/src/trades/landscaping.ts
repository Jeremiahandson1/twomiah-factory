/**
 * LANDSCAPING — the crew's day on the phone (apps/unified/verticals/landscaping): "Today's route" and "Log snow visit".
 *
 * Today's route is the signed-in person's visits for today, in the order of the route's stops (the Route Board makes each stop a
 * dated job timed from the route's start, so start time IS the stop order). It calls the desktop's own routes:
 *   GET  /api/jobs/today               a crew seat reads only its own jobs (jobs:read)
 *   POST /api/jobs/:id/start|complete  jobs:update — the same buttons as the Schedule; finishing a visit tells the customer where the
 *                                      business turned the visit-done message on
 *   PUT  /api/visit-reports/job/:id    the crew's note for the customer (jobs:update, feature visit_reports)
 *   POST /api/visit-reports/job/:id/photos  an after-photo (screen app/(details)/visit-photo.tsx)
 * Log snow visit is the same person's stops in a storm that is going (GET /api/snow/storms/mine/stops):
 *   POST /api/snow/storms/stops/:id/start|log   jobs:update, own stops only; logging twice never bills a push twice.
 *   POST /api/snow/storms/stops/:id/skip         the office's call (jobs:dispatch)
 * Money is the server's: a seat without invoices:read gets no figures, and these screens draw only what arrives.
 */
import { type ScreenSpec, type Row, words, hhmm, join } from './kit'

const maps = (address?: string | null) => (address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : '')
const OPEN_JOB = ['scheduled', 'pending', 'confirmed', 'dispatched']
const jobTone = (s: string): Row['tone'] => (s === 'completed' ? 'success' : s === 'in_progress' ? 'info' : s === 'cancelled' ? 'danger' : 'neutral')
const stopTone = (s: string): Row['tone'] => (s === 'done' ? 'success' : s === 'working' ? 'info' : s === 'skipped' ? 'danger' : 'neutral')
const num = (v: string | undefined) => (v == null || String(v).trim() === '' ? undefined : Number(v))

export const visitRow = (j: any): Row & { id: string } => ({
  id: j.id, key: j.id, title: j.contact?.name || j.title || 'Visit', subtitle: join(j.title !== j.contact?.name ? j.title : undefined, j.address),
  meta: hhmm(j.scheduledTime), badge: words(j.status === 'in_progress' ? 'in progress' : j.status), tone: jobTone(j.status),
})
export const stopRow = (s: any): Row & { id: string } => ({
  id: s.id, key: s.id, title: s.siteName || 'Snow stop', subtitle: join(s.stormName, s.address),
  badge: words(s.status === 'working' ? 'in progress' : s.status), tone: stopTone(s.status),
})

export const LANDSCAPING: ScreenSpec[] = [
  {
    id: 'landscaping-route', title: "Today's route", any: ['jobs:read'], feature: 'recurring_routes',
    list: { path: '/api/jobs/today' }, pick: (b) => (Array.isArray(b) ? b : Array.isArray(b?.data) ? b.data : []), rows: visitRow,
    empty: { title: 'No visits today', body: 'The visits on your route for today show here, in the order to do them.' },
    detail: {
      path: () => null, title: (d) => d.contact?.name || d.title || 'Visit', subtitle: (d) => join(hhmm(d.scheduledTime), d.title), badge: (d) => words(d.status === 'in_progress' ? 'in progress' : d.status),
      sections: [
        { links: (d) => [
          ...(d.address ? [{ label: `Directions to ${d.address}`, url: maps(d.address), icon: 'navigate' }] : []),
          ...(d.contact?.phone ? [{ label: `Call ${d.contact.name || 'the customer'}`, url: `tel:${d.contact.phone}`, icon: 'call' }] : []),
        ] },
        { fields: [
          { label: 'Customer', get: (d) => d.contact?.name }, { label: 'Address', get: (d) => d.address }, { label: 'Start', get: (d) => hhmm(d.scheduledTime) },
          { label: 'Time allowed', get: (d) => (d.estimatedHours ? `${d.estimatedHours} hours` : undefined) }, { label: 'Notes', get: (d) => d.description },
        ] },
        { feature: 'visit_reports', links: (d) => (d.status === 'completed' || d.status === 'in_progress' ? [{ label: 'Add an after photo', url: '', icon: 'camera', route: `/(details)/visit-photo?jobId=${d.id}` }] : []) },
      ],
      actions: [
        { id: 'start', label: 'Start this stop', icon: 'play', any: ['jobs:update'], when: (d) => OPEN_JOB.includes(d.status),
          request: (d) => ({ method: 'POST', path: `/api/jobs/${d.id}/start` }), done: 'Started' },
        { id: 'done', label: 'Finish this stop', icon: 'checkmark-circle', any: ['jobs:update'], when: (d) => d.status === 'in_progress' || OPEN_JOB.includes(d.status),
          confirm: { title: 'Finish this stop?', body: () => 'This marks the visit done and records your time. If your office sends visit messages, the customer is told.', button: 'Finish' },
          request: (d) => ({ method: 'POST', path: `/api/jobs/${d.id}/complete` }), done: 'Stop finished' },
        { id: 'note', label: 'Note for the customer', icon: 'chatbox-ellipses', any: ['jobs:update'], feature: 'visit_reports',
          inputs: [{ id: 'note', label: 'What did you do? (the customer reads this)', kind: 'multiline', required: true }],
          offline: (d) => ({ key: `visit:${d.id}`, label: `${d.number || 'Visit'} · note for the customer` }),
          request: (d, v) => ({ method: 'PUT', path: `/api/visit-reports/job/${d.id}`, body: { note: v.note } }), done: 'Note saved' },
      ],
    },
  },
  {
    id: 'landscaping-snow', title: 'Log snow visit', any: ['jobs:read'], feature: 'snow_billing',
    list: { path: '/api/snow/storms/mine/stops' }, pick: (b) => (Array.isArray(b) ? b : Array.isArray(b?.data) ? b.data : []), rows: stopRow,
    empty: { title: 'No snow stops for you', body: 'When your office starts a storm and sends your route, your stops show here.' },
    detail: {
      path: () => null, title: (d) => d.siteName || 'Snow stop', subtitle: (d) => join(d.stormName, d.address), badge: (d) => words(d.status === 'working' ? 'in progress' : d.status),
      sections: [
        { links: (d) => (d.address ? [{ label: `Directions to ${d.address}`, url: maps(join(d.address, d.city)), icon: 'navigate' }] : []) },
        { fields: [
          { label: 'Site', get: (d) => d.siteName }, { label: 'Address', get: (d) => join(d.address, d.city) }, { label: 'Storm', get: (d) => d.stormName },
          { label: 'Plow at', get: (d) => (d.triggerDepthInches ? `${d.triggerDepthInches} inches` : undefined) }, { label: 'Billed', get: (d) => (d.billingMode ? words(d.billingMode) : undefined) },
          { label: 'Pushes', get: (d) => (d.event ? String(d.event.pushes) : undefined) }, { label: 'Snowfall', get: (d) => (d.event ? `${d.event.snowfallInches} inches` : undefined) },
          { label: 'Salt', get: (d) => (d.event ? (d.event.saltApplied ? 'Yes' : 'No') : undefined) }, { label: 'Hours', get: (d) => (d.event && Number(d.event.hours) > 0 ? String(Number(d.event.hours)) : undefined) },
          { label: 'Note', get: (d) => d.event?.notes || d.note },
        ] },
      ],
      actions: [
        { id: 'start', label: 'Start this stop', icon: 'play', any: ['jobs:update'], when: (d) => d.status === 'open',
          offline: (d) => ({ key: `storm-stop:${d.id}`, label: `${d.siteName || 'Snow stop'} · started` }),
          request: (d) => ({ method: 'POST', path: `/api/snow/storms/stops/${d.id}/start` }), done: 'Started' },
        { id: 'log', label: 'Log this visit', icon: 'checkmark-circle', any: ['jobs:update'], when: (d) => d.status === 'open' || d.status === 'working',
          inputs: [
            { id: 'pushes', label: 'Pushes', kind: 'number', initial: () => '1' }, { id: 'snowfall', label: 'Snowfall (inches)', kind: 'number' },
            { id: 'salt', label: 'Salt put down?', kind: 'choice', choices: ['no', 'yes'], initial: () => 'no' },
            { id: 'hours', label: 'Hours (leave empty to use your Start time)', kind: 'number' }, { id: 'notes', label: 'Note', kind: 'multiline' },
          ],
          offline: (d) => ({ key: `storm-stop:${d.id}`, label: `${d.siteName || 'Snow stop'} · logged` }),
          request: (d, v) => ({ method: 'POST', path: `/api/snow/storms/stops/${d.id}/log`, body: {
            pushes: num(v.pushes), snowfallInches: num(v.snowfall), saltApplied: v.salt === 'yes', ...(num(v.hours) !== undefined ? { hours: num(v.hours) } : {}), ...(v.notes?.trim() ? { notes: v.notes.trim() } : {}),
          } }), done: 'Visit logged' },
        { id: 'skip', label: 'Skip this stop', icon: 'close-circle', any: ['jobs:dispatch'], when: (d) => d.status === 'open' || d.status === 'working',
          confirm: { title: 'Skip this stop?', body: () => 'It stays on the storm as not served and is not billed.', button: 'Skip' },
          request: (d) => ({ method: 'POST', path: `/api/snow/storms/stops/${d.id}/skip` }), done: 'Stop skipped' },
      ],
    },
  },
]
