// A roofing company's money rules (roofing parity, rows 1-5): one row per company in roof_money_setting, read by the commission
// engine (./commissions.ts) and the job-costing worksheet, and changed ONLY here — /api/roof-money/settings — by a seat that may
// change a commission plan (commissions:update), never through the general company settings blob.
//
//   minProfit   the floor under which no commission plan pays: { kind: 'percent', value } is a share of the contract the job
//               must have kept as gross profit; { kind: 'amount', value } is dollars of gross profit. Null: no floor.
//
//   commissionViewerRoles   which roles below the owner and admin see EVERYONE's commissions and the pay structure (commissions:read).
//               The default is the manager, as it always was; field and viewer seats can be added and the manager taken off. Everyone
//               always sees their own earnings. Applied by ./commissionViewers.ts through the shared permissions.
//
//   commissionDisclaimer    the words a person who collects commissions accepts before seeing their own (./commissionDisclaimer.ts);
//               null = none. Changing the words raises commissionDisclaimerVersion, so a changed disclaimer is accepted again.
//   requireWorksheetApproval   a job's worksheet (its costing) must be approved (./worksheetApproval.ts) before its profit counts: in a
//               commission on profit, in the minimum profit, and in the job-costing roll-ups. Off by default.
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
/** The roles a company can choose to let see everyone's commissions. Owner and admin always do. */
export const COMMISSION_VIEWER_CHOICES = ['manager', 'field', 'viewer'] as const
export const DEFAULT_COMMISSION_VIEWERS: string[] = ['manager']
export interface RoofMoneySettings {
  minProfit: MinProfit | null
  commissionViewerRoles: string[]
  commissionDisclaimer: string | null
  commissionDisclaimerVersion: number
  requireWorksheetApproval: boolean
}
export const DEFAULT_MONEY_SETTINGS = (): RoofMoneySettings => ({ minProfit: null, commissionViewerRoles: [...DEFAULT_COMMISSION_VIEWERS], commissionDisclaimer: null, commissionDisclaimerVersion: 0, requireWorksheetApproval: false })

const minProfitSchema = z.object({
  kind: z.enum(['percent', 'amount'], { error: 'Choose percent or dollars for the minimum profit.' }),
  value: z.number({ error: 'The minimum profit is a number.' }).min(0, 'The minimum profit cannot be negative.').max(100000000, 'That minimum profit is too large.'),
}).refine((m) => m.kind !== 'percent' || m.value <= 100, { message: 'A minimum profit in percent cannot be more than 100.', path: ['value'] })

const settingsSchema = z.object({
  minProfit: minProfitSchema.nullable().optional(),
  commissionViewerRoles: z.array(z.enum(COMMISSION_VIEWER_CHOICES, { error: 'Choose roles from the list.' })).max(3).optional(),
  requireWorksheetApproval: z.boolean().optional(),
  commissionDisclaimer: z.string().max(5000, 'Keep the disclaimer under 5,000 characters.').nullable().optional(),
})

const num = (v: unknown) => Number(v || 0)

export function createRoofMoneySettings(d: CrmDeps) {
  const { db } = d

  async function read(companyId: string): Promise<RoofMoneySettings> {
    const [row] = await db.select().from(roofMoneySetting).where(eq(roofMoneySetting.companyId, companyId)).limit(1)
    const out = DEFAULT_MONEY_SETTINGS()
    if (!row) return out
    if (row.minProfitKind === 'percent' || row.minProfitKind === 'amount') out.minProfit = { kind: row.minProfitKind, value: num(row.minProfitValue) }
    if (Array.isArray(row.commissionViewerRoles)) out.commissionViewerRoles = (row.commissionViewerRoles as unknown[]).filter((r): r is string => (COMMISSION_VIEWER_CHOICES as readonly string[]).includes(String(r)))
    out.commissionDisclaimer = row.commissionDisclaimer || null
    out.commissionDisclaimerVersion = Number(row.commissionDisclaimerVersion || 0)
    out.requireWorksheetApproval = !!row.requireWorksheetApproval
    return out
  }

  /** Change only the keys that are present; an explicit null clears one. Returns the settings as they now stand. */
  async function write(companyId: string, patch: z.infer<typeof settingsSchema>): Promise<RoofMoneySettings> {
    const set: Record<string, unknown> = { updatedAt: new Date() }
    if (patch.minProfit !== undefined) {
      set.minProfitKind = patch.minProfit ? patch.minProfit.kind : null
      set.minProfitValue = patch.minProfit ? String(patch.minProfit.value) : null
    }
    if (patch.requireWorksheetApproval !== undefined) set.requireWorksheetApproval = patch.requireWorksheetApproval
    if (patch.commissionDisclaimer !== undefined) {
      const words = patch.commissionDisclaimer === null ? null : patch.commissionDisclaimer.trim() || null
      const now = await read(companyId)
      if (words !== now.commissionDisclaimer) { set.commissionDisclaimer = words; set.commissionDisclaimerVersion = now.commissionDisclaimerVersion + 1 }
    }
    if (patch.commissionViewerRoles !== undefined) set.commissionViewerRoles = [...new Set(patch.commissionViewerRoles)]
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
    const saved = await store.write(c.get('user').companyId, parsed.data)
    // Who sees commissions is read through the shared permissions, which keep each person's grants for a few seconds.
    if (parsed.data.commissionViewerRoles !== undefined) d.permissions.invalidateAllGrants?.()
    return one(c, saved)
  })

  return app
}
