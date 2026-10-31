// Book over a stylist clash (salon parity row 27; Fresha's confirmation window lets staff override a conflict). A clash is always refused —
// except by a MANAGER (a seat that sees the whole Book and can change the schedule) who types why: the reason is kept on the appointment's
// notes and in the audit log. A chair/station clash is still refused. (server/crm/salon/appointments.ts clashOverride)
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { addDays, tzParts, zonedWallTimeToUtc } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

const TZ = 'America/Chicago'
const today = () => tzParts(new Date(), TZ).date
const weekdayOf = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay()
function next(dow: number, ahead = 3) { let d = addDays(today(), ahead); while (weekdayOf(d) !== dow) d = addDays(d, 1); return d }
const FEATURES = ['contacts', 'client_profiles', 'service_menu', 'salon_booking', 'invoices']
const PASSWORD = 'Clash-1031-x'

describe('salon: book over a stylist clash', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = '', ana = '', bea = '', cut = '', client = ''
  const tokens: Record<string, string> = {}
  let ip = 0
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}`, 'x-forwarded-for': `10.5.0.${++ip}` } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html */ }
    return { status: r.status, body }
  }
  const wall = (d: string, hm: string) => zonedWallTimeToUtc(d, hm, TZ).toISOString()
  const day = next(2, 6)
  const book = (who: string, stylist: string, hm: string, extra: Record<string, unknown> = {}, d = day) =>
    as(who, '/api/appointments', 'POST', { contactId: client, serviceId: cut, stylistId: stylist, startTime: wall(d, hm), ...extra })
  const row = async (id: string) => (await t.db.select().from(t.schema.appointment).where(eq(t.schema.appointment.id, id)))[0] as any

  beforeAll(async () => {
    t = await bootTenant({ vertical: 'salon' })
    const s = await seedOwner(t)
    co = s.company.id
    await t.db.update(t.schema.company).set({ timezone: TZ, enabledFeatures: FEATURES } as any).where(eq(t.schema.company.id, co))
    t.services.features.forgetFeatures()
    tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    const ids: Record<string, string> = {}
    for (const [key, role] of Object.entries({ ana: 'field', bea: 'field', desk: 'viewer', mgr: 'manager' })) {
      const u = await ins(t.schema.user, { email: `${key}@test.example`, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: key, lastName: 'Tester', role, companyId: co })
      ids[key] = u.id
      tokens[key] = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: `${key}@test.example`, password: PASSWORD } })).json()) as any).accessToken
    }
    ;({ ana, bea } = ids as any)
    cut = (await as('owner', '/api/service-menu', 'POST', { name: 'Cut', category: 'hair', durationMin: 30, price: 40 })).body.id
    client = (await ins(t.schema.contact, { companyId: co, name: 'Clash Cleo', email: 'cleo@example.com', type: 'client' })).id
  }, 120_000)

  test('a clash is refused as before — the override is not on unless asked for', async () => {
    expect((await book('owner', ana, '10:00')).status).toBe(201)
    const clash = await book('owner', ana, '10:15')
    expect([clash.status, clash.body.code]).toEqual([409, 'APPOINTMENT_CONFLICT'])
  })

  test('only a manager: a stylist or the owner\'s asking without the seat for it is refused, and a manager must say why', async () => {
    const stylist = await book('ana', ana, '10:15', { overrideConflict: true, conflictReason: 'Regular client' })
    expect([stylist.status, stylist.body.code]).toEqual([403, 'MANAGER_ONLY'])
    const none = await book('mgr', ana, '10:15', { overrideConflict: true })
    expect([none.status, none.body.code, typeof none.body.fields?.conflictReason]).toEqual([400, 'CLASH_REASON_REQUIRED', 'string'])
    expect((await book('mgr', ana, '10:15', { overrideConflict: true, conflictReason: 'ab' })).status).toBe(400)
    // and nothing was booked by any of those
    expect((await t.db.select().from(t.schema.appointment)).length).toBe(1)
  })

  test('a manager books it anyway with a reason: it is booked, the reason is on the appointment and in the audit log, others still refuse', async () => {
    const made = await book('mgr', ana, '10:15', { overrideConflict: true, conflictReason: 'Emergency fix for a bride' })
    expect(made.status).toBe(201)
    expect((await row(made.body.id)).notes).toContain('Booked over a clash: Emergency fix for a bride')
    const logged = (await t.db.select().from(t.schema.auditLog).where(and(eq(t.schema.auditLog.entityId, made.body.id), eq(t.schema.auditLog.action, 'create'))))[0] as any
    expect(JSON.stringify(logged.metadata)).toContain('Emergency fix for a bride')
    // the owner holds every permission, so the owner may too
    expect((await book('owner', ana, '10:20', { overrideConflict: true, conflictReason: 'Owner call' })).status).toBe(201)
    // without the override the same time is still refused
    expect((await book('mgr', ana, '10:15')).status).toBe(409)
  })

  test('asking for the override where there is no clash books normally and writes no note', async () => {
    const free = await book('mgr', bea, '14:00', { overrideConflict: true, conflictReason: 'Just in case' })
    expect(free.status).toBe(201)
    expect((await row(free.body.id)).notes ?? '').not.toContain('Booked over a clash')
  })

  test('moving an appointment onto a clash: refused, then allowed for a manager with a reason (the note is added to what was there)', async () => {
    const mine = await book('owner', bea, '11:00', { notes: 'Wants a trim' })
    const refused = await as('mgr', `/api/appointments/${mine.body.id}`, 'PUT', { stylistId: ana, startTime: wall(day, '10:10') })
    expect([refused.status, refused.body.code]).toEqual([409, 'APPOINTMENT_CONFLICT'])
    const stylistTry = await as('ana', `/api/appointments/${mine.body.id}`, 'PUT', { stylistId: ana, startTime: wall(day, '10:10'), overrideConflict: true, conflictReason: 'Mine' })
    expect([stylistTry.status, stylistTry.body.code]).toEqual([403, 'MANAGER_ONLY'])
    const moved = await as('mgr', `/api/appointments/${mine.body.id}`, 'PUT', { stylistId: ana, startTime: wall(day, '10:10'), overrideConflict: true, conflictReason: 'Swap with Bea' })
    expect(moved.status).toBe(200)
    expect((await row(mine.body.id)).notes).toBe('Wants a trim — Booked over a clash: Swap with Bea')
  })

  test('a chair clash is NOT overridden: only the stylist clash is', async () => {
    const d2 = next(3, 6)
    expect((await book('owner', ana, '10:00', { station: 'Chair 1' }, d2)).status).toBe(201)
    const chair = await book('mgr', bea, '10:15', { station: 'Chair 1', overrideConflict: true, conflictReason: 'Busy day' }, d2)
    expect([chair.status, chair.body.code]).toEqual([409, 'APPOINTMENT_CONFLICT'])
  })
})
