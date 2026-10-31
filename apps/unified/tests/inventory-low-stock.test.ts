// The shared inventory module's low-stock email (owner, 2026-10-30): the SAME rule as the store's, from the SAME code
// (server/crm/lowStockDigest.ts) — it used to email every admin on EVERY stock movement. Run on the contractor and the
// landscaping apps (field service and basic share the module; the dealership's parts too), on the real server:
//   · moving stock — adjust, use on a job — sends no email at all;
//   · from 8am the SHOP's time, ONE email per person who runs the business lists everything at or under its reorder point,
//     fewest left first (sold out included; an item with no reorder point, an inactive one and a staff seat are not);
//   · a day with nothing low sends nothing and does not use the day up; the same day again, and two passes at once, send
//     nothing more; the next day sends again;
//   · a send that fails gives the day back (the next pass tries again);
//   · it needs the inventory switch; the store's digest and this one are one implementation.
import { describe, test, expect, beforeAll } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { crmTemplates } from '../server/crm/messages.ts'

/** 9am in Chicago (CDT, UTC−5) on the given October day; 6am for `early`. */
const at = (day: number, early = false) => new Date(Date.UTC(2026, 9, day, early ? 11 : 14, 0, 0))

for (const vertical of ['contractor', 'landscaping'] as const) {
  describe(`${vertical}: the inventory low-stock email`, () => {
    let t: Awaited<ReturnType<typeof bootTenant>>
    let co = ''
    let token = ''
    let locationId = ''
    const mails: Array<{ to: string; template: string; data: any }> = []
    const digests = () => mails.filter((m) => m.template === 'inventoryLowStockDigest')
    const sweep = (now: Date) => (t.services.crm as any).inventoryLowStock.sweep(now) as Promise<string>
    const api = async (method: string, p: string, json?: unknown) => {
      const r = await t.call(p, { method, json, headers: { Authorization: `Bearer ${token}` } })
      const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch {}
      return { status: r.status, body }
    }
    const item = async (name: string, sku: string, reorderPoint: number, startingQuantity: number) => {
      const r = await api('POST', '/api/inventory/items', { name, sku, reorderPoint, startingQuantity })
      expect(r.status).toBe(201)
      return r.body.id as string
    }
    const move = async (itemId: string, quantity: number) => expect((await api('POST', '/api/inventory/adjust', { itemId, locationId, quantity, reason: 'test' })).status).toBe(200)
    const features = async (list: string[]) => {
      await (t.db as any).update(t.schema.company).set({ enabledFeatures: list }).where(eq(t.schema.company.id, co))
      t.services.features.forgetFeatures()
    }
    const ON = ['dashboard', 'contacts', 'jobs', 'inventory']
    let ids: Record<string, string> = {}

    beforeAll(async () => {
      t = await bootTenant({ vertical })
      const s = await seedOwner(t)
      co = s.company.id
      await (t.db as any).update(t.schema.company).set({ timezone: 'America/Chicago' }).where(eq(t.schema.company.id, co))
      await features(ON)
      token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: s.owner.email, password: s.password } })).json() as any).accessToken
      for (const [email, role, isActive] of [['manager@test.example', 'manager', true], ['crew@test.example', 'field', true], ['gone@test.example', 'admin', false]] as const) {
        await (t.db as any).insert(t.schema.user).values({ email, passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: role, lastName: 'Seat', role, companyId: co, isActive })
      }
      ;(t.services.crm.emailService as any).send = async (to: string, template: string, data: any) => { mails.push({ to, template, data }); return { success: true } }
      ;(t.services.email as any).send = (t.services.crm.emailService as any).send
      ids.blade = await item('Mower blade', 'BLD-1', 5, 12)
      ids.line = await item('Trimmer line', 'LIN-1', 5, 9)
      ids.plug = await item('Spark plug', 'PLG-1', 3, 20)
      ids.free = await item('Gloves', 'GLV-1', 0, 4) // no reorder point: no level
      ids.old = await item('Old gadget', 'OLD-1', 5, 1)
      locationId = (await api('GET', '/api/inventory/locations')).body[0]?.id ?? (await api('GET', '/api/inventory/locations')).body.data?.[0]?.id
      expect(locationId).toBeTruthy()
      await (t.db as any).update(t.schema.inventoryItem).set({ active: false }).where(eq(t.schema.inventoryItem.id, ids.old))
      mails.length = 0
    }, 120_000)

    test('moving stock — down past the reorder point, to nothing, again — sends no email', async () => {
      await move(ids.blade, -9) // 12 → 3, under its 5
      await move(ids.line, -9)  // 9 → 0, sold out
      await move(ids.blade, -1) // 3 → 2: another movement while already low
      await move(ids.plug, -1)  // 20 → 19, not low
      expect(mails.map((m) => m.template)).toEqual([])
    })

    test('before 8am the shop\'s time nothing is sent; at 9am each person who runs the business gets ONE email, fewest left first', async () => {
      expect(await sweep(at(30, true))).toBe('too_early')
      expect(mails).toHaveLength(0)
      expect(await sweep(at(30))).toBe('sent')
      expect(digests().map((m) => m.to).sort()).toEqual(['manager@test.example', 'owner@test.example'])
      // Sold-out Trimmer line (0) then Mower blade (2); Spark plug (19 vs 3), Gloves (no reorder point) and the inactive Old gadget are not listed.
      for (const m of digests()) expect(m.data.items.map((i: any) => [i.sku, i.quantity, i.reorderPoint])).toEqual([['LIN-1', 0, 5], ['BLD-1', 2, 5]])
      expect(mails.filter((m) => m.template !== 'inventoryLowStockDigest')).toHaveLength(0)
    })

    // 10/30 merge (store PR #174 follow-up): the Low Stock screen and its filter counted a sold-out item with no reorder point as
    // low; the email does not (it is not watched). One rule now (tenant-backend inventory.ts isLowStock): all three agree.
    test('the Low Stock screen, the list filter and the email name the same items', async () => {
      const empty = await item('Spare bin', 'BIN-1', 0, 0) // sold out, but no reorder point: not watched
      const screen = (await api('GET', '/api/inventory/low-stock')).body
      const filtered = (await api('GET', '/api/inventory/items?lowStock=true')).body
      const skus = (rows: any) => ((rows?.data ?? rows) as any[]).map((r: any) => r.sku).filter((s: string) => s !== 'OLD-1').sort()
      expect(skus(screen)).toEqual(['BLD-1', 'LIN-1'])
      expect(skus(filtered)).toEqual(['BLD-1', 'LIN-1'])
      expect(skus(screen)).toEqual(digests()[0].data.items.map((i: any) => i.sku).sort())
      await (t.db as any).update(t.schema.inventoryItem).set({ active: false }).where(eq(t.schema.inventoryItem.id, empty))
    })

    test('the email says what is low in words a person reads, and links to the inventory', async () => {
      const tpl = crmTemplates.inventoryLowStockDigest as any
      const out = tpl(digests()[0].data, { companyName: 'Test Builders' }, 'https://app.test')
      expect(out.subject).toBe('Low stock: 2 items to reorder')
      expect(out.text).toContain('Trimmer line (LIN-1): none left')
      expect(out.text).toContain('Mower blade (BLD-1): 2 left')
      expect(out.html).toContain('https://app.test/crm/inventory')
    })

    test('once a day: the same day again, later the same day, and two passes at once send nothing more; the next day sends again', async () => {
      const before = digests().length
      expect(await sweep(at(30))).toBe('already_sent')
      await move(ids.plug, -17) // Spark plug is low now too — it waits for tomorrow's email
      expect(await sweep(new Date(at(30).getTime() + 5 * 3600_000))).toBe('already_sent')
      expect(digests()).toHaveLength(before)
      const both = await Promise.all([sweep(at(31)), sweep(at(31))])
      expect(both.sort()).toEqual(['already_sent', 'sent'])
      expect(digests()).toHaveLength(before + 2) // one email to each of the two people
      expect(digests().at(-1)!.data.items.map((i: any) => i.sku)).toEqual(['LIN-1', 'BLD-1', 'PLG-1'])
    })

    test('a day with nothing low sends nothing — and the day is not used up: it sends the moment something is low', async () => {
      for (const id of [ids.blade, ids.line, ids.plug]) await move(id, 20)
      const before = digests().length
      expect(await sweep(new Date(Date.UTC(2026, 10, 1, 14)))).toBe('nothing_low')
      expect(digests()).toHaveLength(before)
      await move(ids.line, -20) // sold out during the day
      expect(await sweep(new Date(Date.UTC(2026, 10, 1, 20)))).toBe('sent')
      expect(digests()).toHaveLength(before + 2)
      expect(digests().at(-1)!.data.items.map((i: any) => [i.sku, i.quantity])).toEqual([['LIN-1', 0]])
    })

    test('a send that fails gives the day back: the next pass tries again, and then it is sent once', async () => {
      const real = (t.services.crm.emailService as any).send
      ;(t.services.crm.emailService as any).send = async () => { throw new Error('mail is down') }
      const before = digests().length
      expect(await sweep(new Date(Date.UTC(2026, 10, 2, 15)))).toBe('failed')
      ;(t.services.crm.emailService as any).send = real
      expect(await sweep(new Date(Date.UTC(2026, 10, 2, 16)))).toBe('sent')
      expect(await sweep(new Date(Date.UTC(2026, 10, 2, 17)))).toBe('already_sent')
      expect(digests()).toHaveLength(before + 2)
    })

    test('it needs the inventory switch', async () => {
      await features(['dashboard', 'contacts', 'jobs'])
      const before = digests().length
      expect(await sweep(new Date(Date.UTC(2026, 10, 3, 14)))).toBe('off')
      expect(digests()).toHaveLength(before)
      await features(ON)
    })
  })
}

describe('one implementation for the store and the inventory', () => {
  const read = (p: string) => fs.readFileSync(path.join(import.meta.dir, '..', p), 'utf8')
  test('both digests are built on server/crm/lowStockDigest.ts; neither carries its own clock, claim or per-movement email', () => {
    for (const file of ['server/crm/store/lowStock.ts', 'server/crm/inventory/lowStock.ts']) {
      const src = read(file)
      expect(src).toContain("lowStockDigest.ts'")
      expect(src).not.toMatch(/Intl\.DateTimeFormat|reminderLog|\.insert\(|\.update\(/)
    }
    expect(read('../../packages/tenant-backend/src/inventory/inventory.ts')).not.toMatch(/lowStockAlert|'lowStockAlert'/)
    expect(read('server/crm/messages.ts')).not.toContain('lowStockAlert')
  })
})
