// AI receptionist rule + settings bodies — ONE schema for every template that carries the AI receptionist
// (crm, basic, fieldservice, homecare, landscaping, roof, rv, salon, vet), whose services all share one shape.
//
// Without it a create with no name / trigger / channel / message reached the INSERT and came back a NOT NULL 500,
// a trigger outside the list was stored and never fired, and junk hours were saved. roof had this schema first
// (T-series M1) and home care copied it (10/16); the other seven read the raw body. Unknown keys are dropped here,
// and each service keeps only RULE_FIELDS / SETTINGS_FIELDS on top, so a body cannot move a row either way.
import { z } from 'zod'

export const AI_RULE_TRIGGERS = ['after_hours', 'missed_call', 'voicemail', 'new_lead', 'booking_request', 'keyword'] as const
export const AI_RULE_CHANNELS = ['sms', 'email', 'both'] as const

/** A rule's fields. An edit may send any one of them (the on/off toggle sends { isActive }). */
export const aiRuleFields = z.object({
  name: z.string().trim().min(1),
  trigger: z.enum(AI_RULE_TRIGGERS),
  channel: z.enum(AI_RULE_CHANNELS),
  messageTemplate: z.string().trim().min(1),
  delayMinutes: z.number().int().min(0).max(10080).optional(),
  isActive: z.boolean().optional(),
  // null or '' for a rule that is not a keyword rule
  keywordMatch: z.string().nullable().optional(),
})

/** A whole rule (create): a keyword rule must name its keyword — one with none matches nothing. */
// Kept apart from aiRuleFields: superRefine returns a ZodEffects, which has no .partial().
export const aiRuleCreateSchema = aiRuleFields.superRefine((r, ctx) => {
  if (r.trigger === 'keyword' && !r.keywordMatch?.trim())
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['keywordMatch'], message: 'a keyword trigger needs a keyword to match' })
})

/** An edit: any subset of the fields. */
export const aiRuleUpdateSchema = aiRuleFields.partial()

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
export const aiSettingsSchema = z.object({
  isEnabled: z.boolean().optional(),
  businessHoursStart: z.string().regex(HHMM, 'office hours are HH:MM').optional(),
  businessHoursEnd: z.string().regex(HHMM, 'office hours are HH:MM').optional(),
  timezone: z.string().min(1).max(64).optional(),
  greetingText: z.string().max(2000).nullable().optional(),
  forwardingNumber: z.string().max(40).nullable().optional(),
})
