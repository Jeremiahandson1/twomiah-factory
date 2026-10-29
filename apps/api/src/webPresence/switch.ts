// The one switch for the $19 "Web presence" plan (owner's rules, 2026-10-29: an untested feature stays OFF on every path,
// and nothing is advertised until it is tested end to end).
//
// WEB_PRESENCE_ON is the only setting. Unset, empty, "0", "false", a typo: OFF. Only 1 / true / on / yes turn it on.
// Off means:
//   - no signup option (the public plan list leaves the plan out: planListFor),
//   - no page mentions it (nothing in the public catalogue; the platform and twomiah.com read the same list),
//   - the API refuses to create one, to sign one in, to render for one, to take a form for one (requireWebPresence).
// A site that already exists keeps SERVING while the switch is off (it is static, on Netlify): the switch gates what the
// Factory does, never what a customer's live site shows.

export const WEB_PRESENCE_PLAN_ID = 'webpresence'
export const WEB_PRESENCE_PRICE_USD = 19

const ON = new Set(['1', 'true', 'on', 'yes'])

/** Whether the Web presence plan is switched on. Anything but an explicit yes is off. */
export function webPresenceOn(env: Record<string, string | undefined> = process.env): boolean {
  return ON.has(String(env.WEB_PRESENCE_ON ?? '').trim().toLowerCase())
}

/** Thrown by every Factory path of the plan while the switch is off. The route layer answers it 404 — as if it did not exist. */
export class WebPresenceOffError extends Error {
  readonly status = 404
  constructor() {
    super('Not found')
    this.name = 'WebPresenceOffError'
  }
}

/** The guard every path of the plan starts with. */
export function requireWebPresence(env: Record<string, string | undefined> = process.env): void {
  if (!webPresenceOn(env)) throw new WebPresenceOffError()
}

/**
 * The public plan list (what the signup shows): the catalogue without the Web presence plan while the switch is off.
 * Takes any list of { id } so the platform's, the signup's and the tests' lists all go through the one rule.
 */
export function planListFor<T extends { id: string }>(plans: readonly T[], env: Record<string, string | undefined> = process.env): T[] {
  return webPresenceOn(env) ? [...plans] : plans.filter((p) => p.id !== WEB_PRESENCE_PLAN_ID)
}

/** Whether a signup naming this plan id is accepted: every plan but Web presence always, Web presence only while on. */
export function planAccepted(planId: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  return planId === WEB_PRESENCE_PLAN_ID ? webPresenceOn(env) : true
}
