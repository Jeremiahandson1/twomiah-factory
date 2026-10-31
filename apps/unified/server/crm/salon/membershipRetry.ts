// How a declined membership charge is chased (salon parity row 6): how many tries in all, and how long between them. The salon's own
// numbers, in its settings; the defaults are what the app always did (3 tries, 3 days apart). Pure — the routes and the billing read it.

export const RETRY_DEFAULTS = { tries: 3, intervalDays: 3 } as const
export const RETRY_LIMITS = { tries: { min: 1, max: 6 }, intervalDays: { min: 1, max: 14 } } as const
export const MEMBERSHIP_RETRY_KEY = 'membershipRetry'

export type RetrySettings = { tries: number; intervalDays: number }

const whole = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max ? n : null
}

/** The settings as stored (company.settings.membershipRetry), with the defaults where nothing valid is kept. */
export function readRetry(settings: unknown): RetrySettings {
  const raw = ((settings as any)?.[MEMBERSHIP_RETRY_KEY] ?? {}) as Record<string, unknown>
  return {
    tries: whole(raw.tries, RETRY_LIMITS.tries.min, RETRY_LIMITS.tries.max) ?? RETRY_DEFAULTS.tries,
    intervalDays: whole(raw.intervalDays, RETRY_LIMITS.intervalDays.min, RETRY_LIMITS.intervalDays.max) ?? RETRY_DEFAULTS.intervalDays,
  }
}

/** A body to store: the two numbers, or the sentence for each box that is wrong. */
export function parseRetry(body: unknown): { values: RetrySettings } | { fields: Record<string, string> } {
  const b = (body ?? {}) as Record<string, unknown>
  const tries = whole(b.tries, RETRY_LIMITS.tries.min, RETRY_LIMITS.tries.max)
  const intervalDays = whole(b.intervalDays, RETRY_LIMITS.intervalDays.min, RETRY_LIMITS.intervalDays.max)
  const fields: Record<string, string> = {}
  if (tries == null) fields.tries = `Tries must be a whole number from ${RETRY_LIMITS.tries.min} to ${RETRY_LIMITS.tries.max} (the first charge counts as one).`
  if (intervalDays == null) fields.intervalDays = `Days between tries must be a whole number from ${RETRY_LIMITS.intervalDays.min} to ${RETRY_LIMITS.intervalDays.max}.`
  return Object.keys(fields).length ? { fields } : { values: { tries: tries!, intervalDays: intervalDays! } }
}

/** When the next automatic try is due, from the last try's time. */
export const nextTryAt = (lastTryAt: Date, intervalDays: number) => new Date(lastTryAt.getTime() + intervalDays * 86_400_000)
