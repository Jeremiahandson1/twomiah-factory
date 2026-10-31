// Blocked-time types and repeat rules (salon parity row 2; server/crm/salon/bookBlocks.ts, bookRepeat.ts; feature `book_grid`).
// Types: the preset kinds the owner keeps (name, colour, usual length, paid/unpaid). A block made from one keeps its name, colour and
// paid mark, so deleting the type never changes blocks already made. Repeat: daily, every N weeks, chosen weekdays, until/count.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { addDays, tzParts, zonedWallTimeToUtc } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

const TZ = 'America/Chicago'
const today = () => tzParts(new Date(), TZ).date
const weekdayOf = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay()
function next(dow: number, ahead = 3) { let d = addDays(today(), ahead); while (weekdayOf(d) !== dow) d = addDays(d, 1); return d }
const FEATURES = ['contacts', 'client_profiles', 'service_menu', 'salon_booking', 'online_booking', 'invoices']
const PASSWORD = 'BlockTypes-1031-x'

describe('salon: blocked-time types and repeat rules', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = '', ana = ''
  const tokens: Record<string, string> = {}
  let ip = 0
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}`, 'x-forwarded-for': `10.3.0.${++ip}` } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html */ }
    return { status: r.status, body }
  }
  const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, co)); t.services.features.forgetFeatures() }
  const wall = (d: string, hm: string) => zonedWallTimeToUtc(d, hm, TZ).toISOString()
  const localDates = (rows: any[]) => rows.map((b) => tzParts(new Date(b.startTime), TZ).date).sort()
  const day = next(1, 6)   // a Monday a week out

  beforeAll(async () => {
    t = await bootTenant({ vertical: 'salon' })
    const s = await seedOwner(t)
    co = s.company.id
    await t.db.update(t.schema.company).set({ timezone: TZ } as any).where(eq(t.schema.company.id, co))
    await features([...FEATURES, 'book_grid'])
    tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    for (const [key, role] of Object.entries({ ana: 'field', desk: 'viewer' })) {
      const u = await ins(t.schema.user, { email: `${key}@test.example`, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: key, lastName: 'Tester', role, companyId: co })
      if (key === 'ana') ana = u.id
      tokens[key] = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: `${key}@test.example`, password: PASSWORD } })).json()) as any).accessToken
    }
  }, 120_000)

  test('types: made, listed, renamed; refused in words; only a seat that edits company settings may keep them', async () => {
    const lunch = await as('owner', '/api/book-blocks/types', 'POST', { name: 'Lunch', color: '#f59e0b', defaultMin: 45, paid: false })
    expect([lunch.status, lunch.body.name, lunch.body.defaultMin, lunch.body.paid]).toEqual([201, 'Lunch', 45, false])
    const training = await as('owner', '/api/book-blocks/types', 'POST', { name: 'Training', color: '#3b82f6', defaultMin: 120, paid: true })
    expect(training.status).toBe(201)
    const list = await as('owner', '/api/book-blocks/types')
    expect(list.body.data.map((x: any) => x.name)).toEqual(['Lunch', 'Training'])
    const dupe = await as('owner', '/api/book-blocks/types', 'POST', { name: 'Lunch' })
    expect([dupe.status, dupe.body.code]).toEqual([409, 'BLOCK_TYPE_EXISTS'])
    const noName = await as('owner', '/api/book-blocks/types', 'POST', { name: '  ' })
    expect([noName.status, noName.body.code, typeof noName.body.fields?.name]).toEqual([400, 'BAD_BLOCK_TYPE', 'string'])
    expect((await as('owner', '/api/book-blocks/types', 'POST', { name: 'Odd', color: 'red' })).status).toBe(400)
    expect((await as('owner', '/api/book-blocks/types', 'POST', { name: 'Odd', defaultMin: 2 })).status).toBe(400)
    const renamed = await as('owner', `/api/book-blocks/types/${lunch.body.id}`, 'PUT', { name: 'Lunch break' })
    expect([renamed.status, renamed.body.name, renamed.body.defaultMin]).toEqual([200, 'Lunch break', 45])
    // the front desk can read the types to choose one, but not keep them
    expect((await as('desk', '/api/book-blocks/types')).status).toBe(200)
    expect((await as('desk', '/api/book-blocks/types', 'POST', { name: 'Nope' })).status).toBe(403)
    expect((await as('ana', `/api/book-blocks/types/${lunch.body.id}`, 'DELETE')).status).toBe(403)
  })

  test('a block made from a type keeps its name, colour and paid mark, takes the usual length, and survives the type being deleted', async () => {
    const types = (await as('owner', '/api/book-blocks/types')).body.data
    const training = types.find((x: any) => x.name === 'Training')
    const made = await as('owner', '/api/book-blocks', 'POST', { stylistId: ana, startTime: wall(day, '09:00'), typeId: training.id })
    expect(made.status).toBe(201)
    expect([made.body.typeName, made.body.typeColor, made.body.paid]).toEqual(['Training', '#3b82f6', true])
    expect(new Date(made.body.endTime).getTime() - new Date(made.body.startTime).getTime()).toBe(120 * 60_000)
    // a free reason still works, and carries no type
    const free = await as('owner', '/api/book-blocks', 'POST', { stylistId: ana, startTime: wall(day, '15:00'), endTime: wall(day, '16:00'), reason: 'Dentist' })
    expect([free.status, free.body.typeName, free.body.paid]).toEqual([201, null, null])
    expect((await as('owner', '/api/book-blocks', 'POST', { stylistId: ana, startTime: wall(day, '15:00'), typeId: 'nope' })).status).toBe(404)
    // delete the type: the block stays exactly as it was
    expect((await as('owner', `/api/book-blocks/types/${training.id}`, 'DELETE')).status).toBe(200)
    const after = (await as('owner', `/api/book-blocks?from=${encodeURIComponent(wall(day, '00:00'))}&to=${encodeURIComponent(wall(day, '23:59'))}`)).body.data
    const kept = after.find((b: any) => b.id === made.body.id)
    expect([kept.typeName, kept.typeColor, kept.paid, kept.typeId]).toEqual(['Training', '#3b82f6', true, null])
  })

  test('repeat rules over the API: daily for a count, every 2 weeks, chosen weekdays until a date', async () => {
    const d = next(1, 30)
    const daily = await as('owner', '/api/book-blocks', 'POST', { stylistId: ana, startTime: wall(d, '12:00'), endTime: wall(d, '13:00'), reason: 'Daily', repeat: { every: 'day', interval: 1, count: 4 } })
    expect([daily.status, daily.body.created]).toEqual([201, 4])
    const all = (await as('owner', `/api/book-blocks?from=${encodeURIComponent(wall(d, '00:00'))}&to=${encodeURIComponent(wall(addDays(d, 40), '00:00'))}`)).body.data
    expect(localDates(all.filter((b: any) => b.reason === 'Daily'))).toEqual([d, addDays(d, 1), addDays(d, 2), addDays(d, 3)])
    expect(new Set(all.filter((b: any) => b.reason === 'Daily').map((b: any) => b.seriesId)).size).toBe(1)

    const d2 = next(1, 50)
    const fortnight = await as('owner', '/api/book-blocks', 'POST', { stylistId: ana, startTime: wall(d2, '12:00'), endTime: wall(d2, '13:00'), reason: 'Fortnightly', repeat: { every: 'week', interval: 2, count: 3 } })
    expect([fortnight.status, fortnight.body.created]).toEqual([201, 3])

    const d3 = next(1, 80)
    const days = await as('owner', '/api/book-blocks', 'POST', { stylistId: ana, startTime: wall(d3, '12:00'), endTime: wall(d3, '13:00'), reason: 'MonThu', repeat: { every: 'week', interval: 1, weekdays: [1, 4], until: addDays(d3, 14) } })
    expect([days.status, days.body.created]).toEqual([201, 5])   // Mon, Thu, Mon, Thu, Mon
    const got = (await as('owner', `/api/book-blocks?from=${encodeURIComponent(wall(d3, '00:00'))}&to=${encodeURIComponent(wall(addDays(d3, 30), '00:00'))}`)).body.data.filter((b: any) => b.reason === 'MonThu')
    expect(localDates(got)).toEqual([d3, addDays(d3, 3), addDays(d3, 7), addDays(d3, 10), addDays(d3, 14)])
  })

  test('a repeat that cannot be made is refused in words and makes nothing', async () => {
    const d = next(1, 120)
    const before = (await t.db.select().from(t.schema.bookBlock)).length
    for (const repeat of [{ every: 'day', interval: 1 }, { every: 'day', interval: 0, count: 2 }, { every: 'day', interval: 1, count: 2, until: addDays(d, 5) }, { every: 'day', interval: 1, count: 9999 }]) {
      const r = await as('owner', '/api/book-blocks', 'POST', { stylistId: ana, startTime: wall(d, '12:00'), endTime: wall(d, '13:00'), repeat })
      expect([r.status, r.body.code]).toEqual([400, 'BAD_REPEAT'])
      expect(typeof r.body.error).toBe('string')
    }
    expect((await t.db.select().from(t.schema.bookBlock)).length).toBe(before)
  })

  test('removing one block, or this and every later block of its series', async () => {
    const d = next(1, 150)
    const made = await as('owner', '/api/book-blocks', 'POST', { stylistId: ana, startTime: wall(d, '12:00'), endTime: wall(d, '13:00'), reason: 'Series', repeat: { every: 'day', interval: 1, count: 5 } })
    const rows = (await as('owner', `/api/book-blocks?from=${encodeURIComponent(wall(d, '00:00'))}&to=${encodeURIComponent(wall(addDays(d, 10), '00:00'))}`)).body.data.filter((b: any) => b.reason === 'Series')
    expect(rows).toHaveLength(5)
    const third = rows[2]
    const one = await as('owner', `/api/book-blocks/${rows[0].id}`, 'DELETE')
    expect([one.status, one.body.removed]).toEqual([200, 1])
    const tail = await as('owner', `/api/book-blocks/${third.id}?scope=following`, 'DELETE')
    expect([tail.status, tail.body.removed]).toEqual([200, 3])
    const left = (await t.db.select().from(t.schema.bookBlock)).filter((b: any) => b.reason === 'Series')
    expect(left).toHaveLength(1)
    expect(made.status).toBe(201)
  })

  test('off by default: with the feature off the types are closed too', async () => {
    await features(FEATURES)
    expect((await as('owner', '/api/book-blocks/types')).status).not.toBe(200)
    await features([...FEATURES, 'book_grid'])
  })
})
