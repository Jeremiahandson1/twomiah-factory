// Every home-care write route a caregiver may not use is refused at the server — read from the app's own route table,
// called as a caregiver. The template suite's write-gates.test.ts held this by parsing the template's route sources for
// requireAdmin; that walk reads code the unified app does not ship. This one asks the real server (2026-10-19).
//
// A route a caregiver legitimately uses (their own clock-in, their own time off, a note on a visit for a client they
// serve) is named below with why; such a route narrows itself to the caregiver (core/selfService.ts, caregiverAccess.ts),
// which the group tests hold behaviourally. Every other write route must answer 403 — before it reads the body, so a
// caregiver can't learn anything from a validation message either.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { FEATURE_REGISTRY } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

/** The writes a caregiver may make, each narrowed to themselves (or to a client they serve). */
const SELF: Record<string, string> = {
  'PUT /api/care-tasks/time-entry/:timeEntryId/:taskId': 'a checklist task on my own visit, for a client I serve',
  'PUT /api/visit-items/visit/:timeEntryId/:itemId': 'a form, intervention, goal or task on my own visit, for a client I serve (care_visit_items)',
  'POST /api/visit-items/visit/:timeEntryId/:itemId/form': 'a form filled in on my own visit, for a client I serve (care_visit_items)',
  'PUT /api/visit-signature/visit/:timeEntryId': 'the client\'s signature on my own visit, for a client I serve (care_visit_signature)',
  'POST /api/medications/log': 'a MAR dose for a client I serve (careWriteRefusal)',
  'POST /api/medications/vitals': 'vitals for a client I serve',
  'POST /api/adl/log': 'an ADL for a client I serve',
  'POST /api/forms/submissions': 'a form for a client I serve, or about myself',
  'PUT /api/forms/submissions/:id': 'my own form submission',
  'POST /api/documents/:id/sign': 'I sign a document addressed to me',
  'POST /api/emergency/miss-report': 'I report I will miss my own shift',
  'POST /api/emergency/client-unavailable': 'I cancel only my own visit (client refused / not home)',
  'POST /api/scheduling/time-off': 'I file my own time-off request, always pending',
  'POST /api/open-shifts/:id/claim': 'I claim an offered shift for myself',
  'POST /api/shift-swaps': 'I ask to swap my own shift',
  'PUT /api/shift-swaps/:id/respond': 'only the caregiver asked answers',
  'PUT /api/shift-swaps/:id/cancel': 'only the caregiver who asked withdraws',
  'POST /api/absences': 'I report my own absence (another caregiverId is a 403)',
  'POST /api/blackout-dates': 'my own blackout date',
  'DELETE /api/blackout-dates/:id': 'only my own blackout date',
  'POST /api/route-optimizer/geofence/check': 'a read via POST: am I inside this client\'s fence — a client I serve',
  'POST /api/optimizer/geofence/check': 'the same check, at its other address',
  'POST /api/time-tracking/check-warnings': 'a read via POST: warnings for my own clock-in',
  'POST /api/time-tracking/clock-in': 'I clock in (an unscheduled punch is flagged, never refused)',
  'POST /api/time-tracking/clock-out': 'I clock out of my own entry',
  'POST /api/time-tracking/:id/clock-out': 'I clock out of my own entry',
  'POST /api/time-tracking/:id/late-location': 'the GPS fix for my own punch',
  'POST /api/time-tracking/gps-failure': 'my phone could not get GPS',
  'POST /api/time-tracking/gps': 'breadcrumbs for my own visit',
  'POST /api/time-tracking/:id/gps': 'breadcrumbs for my own visit',
  'POST /api/time-tracking/:id/photos': 'a photo on my own visit',
  'POST /api/time-entries/check-warnings': 'the same punch routes, at their other address',
  'POST /api/time-entries/clock-in': 'the same',
  'POST /api/time-entries/clock-out': 'the same',
  'POST /api/time-entries/:id/clock-out': 'the same',
  'POST /api/time-entries/:id/late-location': 'the same',
  'POST /api/time-entries/gps-failure': 'the same',
  'POST /api/time-entries/gps': 'the same',
  'POST /api/time-entries/:id/gps': 'the same',
  'POST /api/time-entries/:id/photos': 'the same',
  'POST /api/visit-change-requests/reschedule-request': 'I ask the office to move my own visit',
  'PUT /api/visit-change-requests/:id/resolve': 'I answer only a request about my own visit',
  'POST /api/payroll-verification/me/verify': 'I confirm or dispute my own pay period',
  'POST /api/mileage': 'I log my own trip, at the agency\'s rate',
  'POST /api/pto': 'I request my own time off',
  'POST /api/messages/thread/:id/reply': 'I reply as myself in a thread I am part of',
  'POST /api/messages/send': 'a message sent as myself',
  'PATCH /api/notifications/mark-read': 'my notifications',
  'POST /api/notifications/bulk-status': 'my notifications',
  'PUT /api/notifications/preferences': 'my notification preferences',
  'PATCH /api/notifications/:id/read': 'my notifications',
  'PATCH /api/notifications/:id/status': 'my notifications',
  'DELETE /api/notifications/:id': 'my notifications',
  'PUT /api/notification-settings': 'my notification settings',
  'POST /api/push/mark-read': 'my notifications',
  'POST /api/push/subscribe': 'this device\'s push subscription, mine',
  'POST /api/push/expo-token': 'this phone\'s push token, mine',
  'DELETE /api/push/expo-token': 'this phone\'s push token, mine',
  'POST /api/push/unsubscribe': 'my push subscription',
  'POST /api/incidents/caregiver-report': 'I file an incident as myself, for a client I serve',
}

const GHOST = 'zzzzzzzzzzzzzzzzzzzzzzzz'
let t: Awaited<ReturnType<typeof bootTenant>>
const tokens: Record<string, string> = {}
let writes: string[] = []

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const s = await seedOwner(t)
  // Every feature on: a module switched off answers 403 FEATURE_NOT_ENABLED, which would pass for the gate.
  await t.db.update(t.schema.company).set({ enabledFeatures: [...new Set(FEATURE_REGISTRY.map((f) => f.id))] }).where(eq(t.schema.company.id, s.company.id))
  t.services.features.forgetFeatures()
  // Both stored spellings of the caregiver seat: a moved tenant's `caregiver`, a new one's `field`.
  for (const role of ['field', 'caregiver']) {
    await t.db.insert(t.schema.user).values({ email: `${role}@gates.example`, passwordHash: await Bun.password.hash('Pass-word-1', 'bcrypt'), firstName: role, lastName: 'Gates', role, companyId: s.company.id } as any)
    tokens[role] = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: `${role}@gates.example`, password: 'Pass-word-1' } })).json()).accessToken
  }
  const mounts = t.services.mounts.filter((m: any) => m.addon === 'homecare' && m.access === 'user')
  const ours = (p: string) => mounts.some((m: any) => p === m.path || p.startsWith(m.path + '/'))
  const seen = new Set<string>()
  for (const r of t.app.routes as { method: string; path: string }[]) {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method) || !r.path.startsWith('/api/') || r.path.includes('*') || !ours(r.path)) continue
    seen.add(`${r.method} ${r.path}`)
  }
  writes = [...seen]
}, 60_000)

const call = (who: string, key: string) => {
  const [method, path] = key.split(' ')
  return t.call(path.replace(/:(\w+)(\{[^}]*\})?/g, GHOST), { method, headers: { Authorization: `Bearer ${tokens[who]}` }, json: {} })
}

describe("a caregiver writes only what is theirs", () => {
  test("home care's write routes are read from the app itself", () => {
    expect(writes.length).toBeGreaterThan(350)
    // Office writes the walk must see.
    for (const k of ['POST /api/clients', 'PUT /api/schedules-all/:id', 'POST /api/payroll/calculate', 'DELETE /api/caregivers/:id/ivr-pin']) expect(writes).toContain(k)
  })

  for (const who of ['field', 'caregiver']) {
    test(`every other write is refused 403 for a caregiver stored as '${who}'`, async () => {
      const holes: string[] = []
      for (const k of writes) {
        if (SELF[k]) continue
        const r = await call(who, k)
        if (r.status !== 403) holes.push(`${k} → ${r.status} ${(await r.text()).slice(0, 80)}`)
      }
      expect(holes).toEqual([])
    }, 120_000)
  }

  test('every self-service entry names a real write route, and one a caregiver is not simply refused', async () => {
    const stale = Object.keys(SELF).filter((k) => !writes.includes(k))
    expect(stale).toEqual([])
    const refusedAnyway: string[] = []
    for (const k of Object.keys(SELF)) if ((await call('field', k)).status === 403) refusedAnyway.push(k)
    // A route on this list that refuses a caregiver outright does not need to be on it.
    expect(refusedAnyway).toEqual([])
  }, 60_000)
})
