import { z } from 'zod'

/**
 * The plain-English message for a field that is missing, the wrong type, or not one of the allowed values — written once,
 * honoured by every zod this code runs under.
 *
 * The shared code runs in two places with two zods: the unified app (zod 4) and the CRM templates, which vendor it and
 * install their own `zod ^3.22.4`. The message options differ and none is common to both:
 *   zod 3    { invalid_type_error, required_error } (type / missing) or { errorMap } (literal, enum) — these three are gone in 4
 *   zod 4    { error } — zod 3 ignores it, so a message written that way came out as "Required" / "Expected number, received nan"
 *   `message` works in 3.23+ and 4 but not on a literal in any 3.x, and not at all in the 3.22 the templates' range allows.
 * So this picks the form by the zod that is loaded. Only the three problems a person's typing causes are replaced
 * (invalid_type, invalid_literal / invalid_value, invalid_enum_value); a rule with its own message (`.min(1, '…')`) keeps it, and
 * a rule without one keeps zod's default, as under zod 3's `invalid_type_error`.
 *
 * A guard (tests/zod-message.test.ts in unified, and the templates' suites under zod 3) proves both forms.
 */
const IS_V4 = typeof (z as any).core === 'object'
const OURS = new Set(['invalid_type', 'invalid_literal', 'invalid_value', 'invalid_enum_value'])

export function zmsg(text: string): any {
  if (IS_V4) return { error: (iss: any) => (OURS.has(iss.code) ? text : undefined) }
  return { errorMap: (iss: any, ctx: any) => ({ message: OURS.has(iss.code) ? text : ctx.defaultError }) }
}
