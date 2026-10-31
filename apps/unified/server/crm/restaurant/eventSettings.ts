// What a venue sets once for its private events (company.settings.events): the guarantee cutoff, when the money reminders
// go, how the minimum shortfall is taxed, the proposal's terms and how long it stays open. Read by the guarantee rule
// (eventGuarantee.ts), the minimums (eventMinimums.ts), the payment reminders (eventPayments.ts) and the proposals
// (eventProposals.ts); changed on /api/event-settings.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { company } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'

export interface EventSettings {
  /** Days before the event the guest count is locked (the guarantee cutoff). 0 = no cutoff. */
  guaranteeDays: number
  /** Days before the cutoff the client is reminded to confirm their count. 0 = no reminder. */
  guaranteeReminderDays: number
  /** Whether a food-and-beverage minimum shortfall is taxed like the rest of the invoice. */
  shortfallTaxed: boolean
  /** Days before an instalment is due that the client is reminded. 0 = no reminder before. */
  payRemindBeforeDays: number
  /** A reminder on the day it is due. */
  payRemindOnDue: boolean
  /** Days after it was due that the client is reminded again. 0 = none. */
  payRemindOverdueDays: number
  /** Days a proposal stays open to accept after it is sent. */
  proposalValidDays: number
  /** The terms printed on every proposal and above the signature. */
  proposalTerms: string
  /** After the client signs, the same page takes the first payment (and offers to keep the card for the rest). */
  payAtSigning: boolean
}

export const EVENT_SETTINGS_DEFAULTS: EventSettings = {
  guaranteeDays: 7, guaranteeReminderDays: 3, shortfallTaxed: true,
  payRemindBeforeDays: 7, payRemindOnDue: true, payRemindOverdueDays: 3,
  proposalValidDays: 14, proposalTerms: '', payAtSigning: true,
}

const WHOLE: Array<[keyof EventSettings, string, number]> = [
  ['guaranteeDays', 'Guarantee cutoff', 90], ['guaranteeReminderDays', 'Guarantee reminder', 60],
  ['payRemindBeforeDays', 'Reminder before a payment is due', 60], ['payRemindOverdueDays', 'Reminder after a payment is due', 60],
  ['proposalValidDays', 'Proposal validity', 365],
]

/** The venue's event settings, with defaults for anything it has not set. */
export async function getEventSettings(db: any, companyId: string): Promise<EventSettings> {
  const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
  const saved = (co?.settings as any)?.events
  return { ...EVENT_SETTINGS_DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) }
}

/** What a body may change, checked; returns the first problem as a sentence. */
export function eventSettingsRefusal(body: Record<string, unknown>): string | null {
  for (const [k, label, max] of WHOLE) {
    if (!(k in body)) continue
    const v = Number(body[k])
    if (!Number.isInteger(v) || v < 0 || v > max) return `${label} must be a whole number of days from 0 to ${max}.`
  }
  for (const k of ['shortfallTaxed', 'payRemindOnDue', 'payAtSigning'] as const) if (k in body && typeof body[k] !== 'boolean') return `${k} must be true or false.`
  if ('proposalTerms' in body && (typeof body.proposalTerms !== 'string' || body.proposalTerms.length > 8000)) return 'Proposal terms must be text of 8,000 characters or fewer.'
  return null
}

export function createEventSettingsRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  app.get('/', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    return one(c, await getEventSettings(db, u.companyId))
  })

  app.put('/', requirePermission('settings:update'), async (c) => {
    const u = c.get('user') as any
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    const problem = eventSettingsRefusal(body)
    if (problem) return fail(c, 400, problem)
    const before = await getEventSettings(db, u.companyId)
    const next: EventSettings = { ...before }
    for (const k of Object.keys(EVENT_SETTINGS_DEFAULTS) as Array<keyof EventSettings>) if (k in body) (next as any)[k] = k === 'proposalTerms' ? String(body[k]).trim() : body[k]
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, u.companyId)).limit(1)
    await db.update(company).set({ settings: { ...((co?.settings as any) || {}), events: next }, updatedAt: new Date() }).where(eq(company.id, u.companyId))
    await audit.log({ action: 'update', entity: 'event_settings', entityId: u.companyId, entityName: 'Event settings', changes: audit.diff(before, next), req: { user: u } })
    return one(c, next)
  })

  return app
}

/** Is a feature on for this business — read from the company row, for code that runs inside a transaction or a job. */
export async function featureOn(exec: any, companyId: string, id: string): Promise<boolean> {
  const [co] = await exec.select({ f: company.enabledFeatures }).from(company).where(eq(company.id, companyId)).limit(1)
  return Array.isArray(co?.f) && co.f.includes(id)
}
