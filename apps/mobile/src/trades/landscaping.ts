/**
 * LANDSCAPING — the crew's day on the phone (apps/unified/verticals/landscaping): "Today's route" and "Log snow visit".
 *
 * Today's route is the signed-in person's visits for today, in the order of the route's stops (the Route Board makes each stop a
 * dated job timed from the route's start, so start time IS the stop order). It calls the desktop's own routes:
 *   GET  /api/jobs/today               a crew seat reads only its own jobs (jobs:read)
 *   /api/crew-day/…                    the day's map and Finish Day recap, Couldn't do it, materials used, crew clocks (rows 11–15;
 *                                      app/(details)/route-day.tsx, visit-materials.tsx, visit-crew.tsx; server crm/landscaping/crewDay.ts)
 *   POST /api/jobs/:id/dispatch        "On my way" with the minutes away (`etaMinutes`, parity row 10) — the customer's text says them
 *   POST /api/jobs/:id/start|complete  jobs:update — the same buttons as the Schedule; finishing a visit tells the customer where the
 *                                      business turned the visit-done message on. Both work with no signal (parity row 8): kept on
 *                                      the phone under `job:<id>` (the shared job flow's key) with the moment they were TAPPED
 *                                      (`tappedAt`, which the server keeps — jobs.ts), sent once when signal returns
 *                                      (Idempotency-Key, server/http/savedOnce.ts), and shown as waiting until then.
 *   PUT  /api/visit-reports/job/:id    the crew's note for the customer (jobs:update, feature visit_reports)
 *   POST /api/visit-reports/job/:id/photos  an after-photo (screen app/(details)/visit-photo.tsx), where job photos are off
 *   POST /api/jobs/:id/photos/file|saved     before- and after-photos through the offline queue, drawn on with photo_markup
 *                                            (screen app/(details)/visit-photos.tsx; parity row 9)
 * Log snow visit is the same person's stops in a storm that is going (GET /api/snow/storms/mine/stops):
 *   POST /api/snow/storms/stops/:id/start|log   jobs:update, own stops only; logging twice never bills a push twice.
 *   POST /api/snow/storms/stops/:id/skip         the office's call (jobs:dispatch)
 * Money is the server's: a seat without invoices:read gets no figures, and these screens draw only what arrives.
 */
import { type ScreenSpec, type Row, words, hhmm, join } from './kit'
import { SKIP_REASONS, REBOOK, NO_REBOOK, skipRequest } from './crewDay'

const maps = (address?: string | null) => (address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : '')
const OPEN_JOB = ['scheduled', 'pending', 'confirmed', 'dispatched']
/** Where "On my way" can go from (jobs.ts JOB_MOVES_FROM.dispatched). */
const NOT_LEFT = ['scheduled', 'pending', 'confirmed', 'on_hold']
/** Jobber's ETA picker: how far away the crew is, for the customer's text. */
export const ETA_CHOICES = ['5 min', '10 min', '15 min', '20 min', '30 min', '45 min', '60 min']
export const etaMinutes = (choice: string | undefined) => { const n = parseInt(String(choice || ''), 10); return Number.isInteger(n) && n >= 1 && n <= 120 ? n : undefined }
const jobTone = (s: string): Row['tone'] => (s === 'completed' ? 'success' : s === 'in_progress' ? 'info' : s === 'cancelled' ? 'danger' : 'neutral')
const stopTone = (s: string): Row['tone'] => (s === 'done' ? 'success' : s === 'working' ? 'info' : s === 'skipped' ? 'danger' : 'neutral')
/** The moment of a tap, for a move kept on the phone: the server records it, not the time the save arrives (jobs.ts tappedAt). */
export const tapped = (at: Date = new Date()) => ({ tappedAt: at.toISOString() })
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
    waitingKey: (d) => `job:${d.id}`,
    list: { path: '/api/jobs/today' }, pick: (b) => (Array.isArray(b) ? b : Array.isArray(b?.data) ? b.data : []), rows: visitRow,
    empty: { title: 'No visits today', body: 'The visits on your route for today show here, in the order to do them.' },
    detail: {
      path: () => null, title: (d) => d.contact?.name || d.title || 'Visit', subtitle: (d) => join(hhmm(d.scheduledTime), d.title), badge: (d) => words(d.status === 'in_progress' ? 'in progress' : d.status),
      sections: [
        { links: (d) => [
          // In the crew's chosen maps app — Google Maps, Apple Maps or Waze, remembered on the phone (parity row 11; ./directions.ts).
          ...(d.address ? [{ label: `Directions to ${d.address}`, url: maps(d.address), icon: 'navigate', directions: d.address }] : []),
          ...(d.contact?.phone ? [{ label: `Call ${d.contact.name || 'the customer'}`, url: `tel:${d.contact.phone}`, icon: 'call' }] : []),
        ] },
        { fields: [
          { label: 'Customer', get: (d) => d.contact?.name }, { label: 'Address', get: (d) => d.address }, { label: 'Start', get: (d) => hhmm(d.scheduledTime) },
          { label: 'Time allowed', get: (d) => (d.estimatedHours ? `${d.estimatedHours} hours` : undefined) }, { label: 'Notes', get: (d) => d.description },
        ] },
        // The visit's checklists (the business's required forms: Finish is refused until they are done — server checklistRoutes.ts), the
        // materials used (row 13) and each crew member's clock (row 15), each where the business has it switched on.
        { feature: 'job_checklists', links: (d) => (d.status === 'cancelled' ? [] : [{ label: 'Checklists', url: '', icon: 'checkbox', route: `/(details)/job/checklist?id=${d.id}` }]) },
        { feature: 'visit_materials', links: (d) => (d.status === 'cancelled' ? [] : [{ label: 'Materials used', url: '', icon: 'cube', route: `/(details)/visit-materials?jobId=${d.id}` }]) },
        { feature: 'crew_timers', links: (d) => (d.status === 'cancelled' ? [] : [{ label: 'Crew clocks', url: '', icon: 'timer', route: `/(details)/visit-crew?jobId=${d.id}` }]) },
        // Before and after photos, kept on the phone with no signal and drawn on (parity row 9) — where the business has job photos.
        { feature: 'photo_capture', links: (d) => (d.status === 'cancelled' ? [] : [{ label: 'Photos — before and after', url: '', icon: 'camera', route: `/(details)/visit-photos?jobId=${d.id}` }]) },
        // Without job photos: the after-photo for the visit-done message, as before.
        { feature: 'visit_reports', unlessFeature: 'photo_capture', links: (d) => (d.status === 'completed' || d.status === 'in_progress' ? [{ label: 'Add an after photo', url: '', icon: 'camera', route: `/(details)/visit-photo?jobId=${d.id}` }] : []) },
      ],
      actions: [
        // "On my way" with how many minutes away (parity row 10, Jobber's 5–60 minute picker): the visit is marked on the way and, where
        // the business texts arrivals, the customer is told the minutes picked — through the shared sender (their opt-out kept). Kept
        // on the phone with no signal under the visit's key; one sent more than 30 minutes late is recorded but not texted (services.ts).
        { id: 'onmyway', label: 'On my way', icon: 'car', any: ['jobs:update'], when: (d) => NOT_LEFT.includes(d.status),
          confirm: { title: 'On your way?', body: (d) => `This marks the visit on the way. If your business texts customers when the crew is coming, ${d.contact?.name || 'the customer'} is told how many minutes away you are.`, button: 'On my way' },
          inputs: [{ id: 'eta', label: 'How far away are you?', kind: 'choice', choices: ETA_CHOICES, initial: () => '15 min' }],
          offline: (d) => ({ key: `job:${d.id}`, label: `${d.contact?.name || d.number || 'Visit'} · on my way` }),
          request: (d, v) => ({ method: 'POST', path: `/api/jobs/${d.id}/dispatch`, body: { ...tapped(), ...(etaMinutes(v.eta) ? { etaMinutes: etaMinutes(v.eta) } : {}) } }), done: 'On your way' },
        { id: 'start', label: 'Start this stop', icon: 'play', any: ['jobs:update'], when: (d) => OPEN_JOB.includes(d.status),
          offline: (d) => ({ key: `job:${d.id}`, label: `${d.contact?.name || d.number || 'Visit'} · started` }),
          request: (d) => ({ method: 'POST', path: `/api/jobs/${d.id}/start`, body: tapped() }), done: 'Started' },
        { id: 'done', label: 'Finish this stop', icon: 'checkmark-circle', any: ['jobs:update'], when: (d) => d.status === 'in_progress' || OPEN_JOB.includes(d.status),
          confirm: { title: 'Finish this stop?', body: () => 'This marks the visit done and records your time. If your office sends visit messages, the customer is told.', button: 'Finish' },
          offline: (d) => ({ key: `job:${d.id}`, label: `${d.contact?.name || d.number || 'Visit'} · finished` }),
          request: (d) => ({ method: 'POST', path: `/api/jobs/${d.id}/complete`, body: tapped() }), done: 'Stop finished' },
        // "Couldn't do it" (parity row 12; LMN crew lead): a reason from the list and whether to rebook. The visit goes on hold and the office
        // rebooks or closes it on the Route Board. Kept on the phone with no signal under the visit's key.
        { id: 'skip', label: "Couldn't do it", icon: 'close-circle', any: ['jobs:update'], feature: 'visit_skip', when: (d) => OPEN_JOB.includes(d.status) || d.status === 'in_progress',
          inputs: [
            { id: 'reason', label: 'Why not?', kind: 'choice', choices: SKIP_REASONS.map((r) => r.label), required: true },
            { id: 'rebook', label: 'Does it need rebooking?', kind: 'choice', choices: [REBOOK, NO_REBOOK], initial: () => REBOOK },
            { id: 'note', label: 'Note for the office (optional)', kind: 'multiline' },
          ],
          offline: (d) => ({ key: `job:${d.id}`, label: `${d.contact?.name || d.number || 'Visit'} · couldn't do it` }),
          request: (d, v) => skipRequest(d.id, v) ?? { method: 'POST', path: `/api/crew-day/visits/${d.id}/skip`, body: {} }, done: 'Marked as not done — the office will rebook it' },
        { id: 'note', label: 'Note for the customer', icon: 'chatbox-ellipses', any: ['jobs:update'], feature: 'visit_reports',
          inputs: [{ id: 'note', label: 'What did you do? (the customer reads this)', kind: 'multiline', required: true }],
          offline: (d) => ({ key: `visit:${d.id}`, label: `${d.number || 'Visit'} · note for the customer` }),
          request: (d, v) => ({ method: 'PUT', path: `/api/visit-reports/job/${d.id}`, body: { note: v.note } }), done: 'Note saved' },
      ],
    },
  },
  {
    id: 'landscaping-snow', title: 'Log snow visit', any: ['jobs:read'], feature: 'snow_billing',
    waitingKey: (d) => `storm-stop:${d.id}`,
    list: { path: '/api/snow/storms/mine/stops' }, pick: (b) => (Array.isArray(b) ? b : Array.isArray(b?.data) ? b.data : []), rows: stopRow,
    empty: { title: 'No snow stops for you', body: 'When your office starts a storm and sends your route, your stops show here.' },
    detail: {
      path: () => null, title: (d) => d.siteName || 'Snow stop', subtitle: (d) => join(d.stormName, d.address), badge: (d) => words(d.status === 'working' ? 'in progress' : d.status),
      sections: [
        { links: (d) => (d.address ? [{ label: `Directions to ${d.address}`, url: maps(join(d.address, d.city)), icon: 'navigate', directions: join(d.address, d.city) }] : []) },
        // Row 24: before and after photos of the site (a contract may require both before the visit is logged) — the stop's own job.
        { feature: 'photo_capture', links: (d) => (d.jobId && d.status !== 'skipped' ? [{ label: 'Photos — before and after', url: '', icon: 'camera', route: `/(details)/visit-photos?jobId=${d.jobId}` }] : []) },
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
            // Row 24 (snow_tools): salt by amount, in the contract's unit — billed per unit where the contract prices it so.
            { id: 'saltQuantity', label: 'Salt put down (amount: tons, bags…)', kind: 'number', feature: 'snow_tools' },
            { id: 'hours', label: 'Hours (leave empty to use your Start time)', kind: 'number' }, { id: 'notes', label: 'Note', kind: 'multiline' },
          ],
          offline: (d) => ({ key: `storm-stop:${d.id}`, label: `${d.siteName || 'Snow stop'} · logged` }),
          request: (d, v) => ({ method: 'POST', path: `/api/snow/storms/stops/${d.id}/log`, body: {
            pushes: num(v.pushes), snowfallInches: num(v.snowfall), saltApplied: v.salt === 'yes', ...(num(v.saltQuantity) !== undefined ? { saltQuantity: num(v.saltQuantity) } : {}), ...(num(v.hours) !== undefined ? { hours: num(v.hours) } : {}), ...(v.notes?.trim() ? { notes: v.notes.trim() } : {}),
          } }), done: 'Visit logged' },
        { id: 'skip', label: 'Skip this stop', icon: 'close-circle', any: ['jobs:dispatch'], when: (d) => d.status === 'open' || d.status === 'working',
          confirm: { title: 'Skip this stop?', body: () => 'It stays on the storm as not served and is not billed.', button: 'Skip' },
          request: (d) => ({ method: 'POST', path: `/api/snow/storms/stops/${d.id}/skip` }), done: 'Stop skipped' },
      ],
    },
  },
]
