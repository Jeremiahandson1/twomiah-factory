// A roofing company's money rules (roofing parity, rows 1-5): one row per company in roof_money_setting, read by the commission
// engine (./commissions.ts) and the job-costing worksheet, and changed ONLY here — /api/roof-money/settings — by a seat that may
// change a commission plan (commissions:update), never through the general company settings blob.
//
//   minProfit   the floor under which no commission plan pays: { kind: 'percent', value } is a share of the contract the job
//               must have kept as gross profit; { kind: 'amount', value } is dollars of gross profit. Null: no floor.
//
// GET is commissions:read (a manager reads the rules; nobody below that does). The registry gates the feature
// (commission_tracking, an existing id: nothing new is advertised).
import { Hono } from 'hono'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { roofMoneySetting } from '../../db/schema/index.ts'
import { invalid } from '../../http/errors.ts'
import type { AppEnv } from '../../http/env.ts'
import { one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'

export interface MinProfit { kind: 'percent' | 'amount'; value: number }
export interface RoofMoneySettings {
  minProfit: MinProfit | null
}
export const DEFAULT_MONEY_SETTINGS = (): RoofMoneySettings => ({ minProfit: null })

const minProfitSchema = z.object({
  kind: z.enum(['percent', 'amount'], { error: 'Choose percent or dollars for the minimum profit.' }),
  value: z.number({ error: 'The minimum profit is a number.' }).min(0, 'The minimum profit cannot be negative.').max(100000000, 'That minimum profit is too large.'),
}).refine((m) => m.kind !== 'percent' || m.value <= 100, { message: 'A minimum profit in percent cannot be more than 100.', path: ['value'] })

const settingsSchema = z.object({
  minProfit: minProfitSchema.nullable().optional(),
})

const num = (v: unknown) => Number(v || 0)

export function createRoofMoneySettings(d: CrmDeps) {
  const { db } = d

  async function read(companyId: string): Promise<RoofMoneySettings> {
    const [row] = await db.select().from(roofMoneySetting).where(eq(roofMoneySetting.companyId, companyId)).limit(1)
    const out = DEFAULT_MONEY_SETTINGS()
    if (!row) return out
    if (row.minProfitKind === 'percent' || row.minProfitKind === 'amount') out.minProfit = { kind: row.minProfitKind, value: num(row.minProfitValue) }
    return out
  }

  /** Change only the keys that are present; an explicit null clears one. Returns the settings as they now stand. */
  async function write(companyId: string, patch: z.infer<typeof settingsSchema>): Promise<RoofMoneySettings> {
    const set: Record<string, unknown> = { updatedAt: new Date() }
    if (patch.minProfit !== undefined) {
      set.minProfitKind = patch.minProfit ? patch.minProfit.kind : null
      set.minProfitValue = patch.minProfit ? String(patch.minProfit.value) : null
    }
    await db.insert(roofMoneySetting).values({ companyId, ...set } as any)
      .onConflictDoUpdate({ target: roofMoneySetting.companyId, set: set as any })
    return read(companyId)
  }

  return { read, write }
}
export type RoofMoneySettingsStore = ReturnType<typeof createRoofMoneySettings>

export function createRoofMoneyRoutes(d: CrmDeps) {
  const { requirePermission } = d.permissions
  const store = createRoofMoneySettings(d)
  const app = new Hono<AppEnv>()

  app.get('/settings', requirePermission('commissions:read'), async (c) => one(c, await store.read(c.get('user').companyId)))

  app.put('/settings', requirePermission('commissions:update'), async (c) => {
    const parsed = settingsSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    return one(c, await store.write(c.get('user').companyId, parsed.data))
  })

  return app
}
