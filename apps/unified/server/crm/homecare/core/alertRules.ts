// Alert rules the agency writes itself (care_family_comms, row 7 extras; AxisCare's "customizable alerts for caregivers, administrators and
// clients"): WHEN something happens on a visit — the caregiver arrives, finishes, or arrives N minutes after the scheduled start —
// tell WHO (the visit's relatives, the office, or the visit's caregiver) by WHICH channels (text, email, app push), in the
// agency's own words. The built-in arrival and finish notices to relatives keep working as they did; a rule is on top of them.
//
// A relative is only ever reached on a channel they agreed to (the text yes, the email yes, a phone or browser that took push);
// the office always gets the in-app notice as well; the caregiver's own notification settings still apply to the caregiver.
// Sending is core/familyTexts.ts (one claim per rule, visit, person and channel, so a replayed punch never alerts twice).
import { and, asc, eq } from 'drizzle-orm'
import { familyAlertRule } from '../../../db/schema/index.ts'
import type { CrmDeps } from '../../deps.ts'

export const RULE_TRIGGERS = ['clock_in', 'clock_out', 'late_clock_in'] as const
export const RULE_AUDIENCES = ['relatives', 'office', 'caregiver'] as const
/** The channels each audience can be reached on. The caregiver has no email in the app. */
export const AUDIENCE_CHANNELS: Record<(typeof RULE_AUDIENCES)[number], readonly ('sms' | 'email' | 'push')[]> = {
  relatives: ['sms', 'email', 'push'], office: ['sms', 'email', 'push'], caregiver: ['sms', 'push'],
}
export const TRIGGER_LABELS: Record<string, string> = { clock_in: 'The caregiver arrives', clock_out: 'The caregiver finishes the visit', late_clock_in: 'The caregiver arrives late' }
export const AUDIENCE_LABELS: Record<string, string> = { relatives: 'The client\'s relatives', office: 'The office', caregiver: 'The visit\'s caregiver' }
const MAX_RULES = 50
/** The words a rule's message may fill in (a late-arrival rule may also use {minutes}). */
export const RULE_TOKENS = ['caregiver', 'client', 'time', 'agency'] as const

export interface AlertRule {
  id: string; name: string; trigger: (typeof RULE_TRIGGERS)[number]; minutes: number | null
  audience: (typeof RULE_AUDIENCES)[number]; channels: ('sms' | 'email' | 'push')[]; message: string | null; isActive: boolean
}

const shape = (r: any): AlertRule => ({
  id: r.id, name: r.name, trigger: r.trigger, minutes: r.minutes ?? null, audience: r.audience,
  channels: (Array.isArray(r.channels) ? r.channels : []) as AlertRule['channels'], message: r.message ?? null, isActive: r.isActive !== false,
})

/** The rules in force for one trigger. */
export async function activeRulesFor(db: any, companyId: string, trigger: string): Promise<AlertRule[]> {
  return (await db.select().from(familyAlertRule)
    .where(and(eq(familyAlertRule.companyId, companyId), eq(familyAlertRule.trigger, trigger), eq(familyAlertRule.isActive, true)))
    .orderBy(asc(familyAlertRule.createdAt))).map(shape)
}

/** Read a rule from a request body: the fields it is allowed to set, or the first problem in plain words. */
export function readRule(b: any, wordingProblem: (t: unknown, allowed: readonly string[], max: number, what: string) => string | null): { problem: string; field: string } | { rule: Omit<AlertRule, 'id'> } {
  const name = typeof b?.name === 'string' ? b.name.trim() : ''
  if (!name) return { problem: 'Give the rule a name.', field: 'name' }
  if (name.length > 80) return { problem: 'Keep the name under 80 characters.', field: 'name' }
  if (!(RULE_TRIGGERS as readonly string[]).includes(b?.trigger)) return { problem: 'Choose when it should happen.', field: 'trigger' }
  if (!(RULE_AUDIENCES as readonly string[]).includes(b?.audience)) return { problem: 'Choose who is told.', field: 'audience' }
  const audience = b.audience as AlertRule['audience']
  let minutes: number | null = null
  if (b.trigger === 'late_clock_in') {
    minutes = Math.floor(Number(b.minutes))
    if (!(minutes >= 1 && minutes <= 240)) return { problem: 'Say how many minutes after the scheduled start counts as late, from 1 to 240.', field: 'minutes' }
  }
  const asked: string[] = Array.isArray(b?.channels) ? [...new Set(b.channels.map(String))] as string[] : []
  if (!asked.length) return { problem: 'Choose at least one way to tell them.', field: 'channels' }
  const bad = asked.find((c) => !AUDIENCE_CHANNELS[audience].includes(c as any))
  if (bad) return { problem: `${audience === 'caregiver' ? 'The caregiver' : 'This group'} cannot be told by ${bad === 'sms' ? 'text' : bad === 'email' ? 'email' : 'app notice'}.`, field: 'channels' }
  let message: string | null = null
  if (typeof b?.message === 'string' && b.message.trim()) {
    const problem = wordingProblem(b.message, b.trigger === 'late_clock_in' ? [...RULE_TOKENS, 'minutes'] : RULE_TOKENS, 300, 'the message')
    if (problem) return { problem, field: 'message' }
    message = b.message.trim()
  }
  return { rule: { name, trigger: b.trigger, minutes, audience, channels: asked as AlertRule['channels'], message, isActive: b.isActive !== false } }
}

export function createAlertRules(d: CrmDeps, deps: { wordingProblem: (t: unknown, allowed: readonly string[], max: number, what: string) => string | null }) {
  async function list(companyId: string): Promise<AlertRule[]> {
    return (await d.db.select().from(familyAlertRule).where(eq(familyAlertRule.companyId, companyId)).orderBy(asc(familyAlertRule.createdAt))).map(shape)
  }
  async function create(companyId: string, userId: string, b: unknown): Promise<{ problem: string; field: string } | AlertRule> {
    const read = readRule(b, deps.wordingProblem)
    if ('problem' in read) return read
    if ((await list(companyId)).length >= MAX_RULES) return { problem: `An agency can have up to ${MAX_RULES} rules. Remove one you no longer use.`, field: 'name' }
    const [row] = await d.db.insert(familyAlertRule).values({ companyId, createdById: userId, ...read.rule } as any).returning()
    return shape(row)
  }
  async function update(companyId: string, id: string, b: unknown): Promise<{ problem: string; field: string } | AlertRule | null> {
    const [found] = await d.db.select().from(familyAlertRule).where(and(eq(familyAlertRule.id, id), eq(familyAlertRule.companyId, companyId))).limit(1)
    if (!found) return null
    const read = readRule({ ...shape(found), ...(b as object) }, deps.wordingProblem)
    if ('problem' in read) return read
    const [row] = await d.db.update(familyAlertRule).set({ ...read.rule, updatedAt: new Date() } as any)
      .where(and(eq(familyAlertRule.id, id), eq(familyAlertRule.companyId, companyId))).returning()
    return shape(row)
  }
  async function remove(companyId: string, id: string): Promise<boolean> {
    const gone = await d.db.delete(familyAlertRule).where(and(eq(familyAlertRule.id, id), eq(familyAlertRule.companyId, companyId))).returning({ id: familyAlertRule.id })
    return gone.length > 0
  }
  return { list, create, update, remove }
}
