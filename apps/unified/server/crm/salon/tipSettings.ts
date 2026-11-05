// The salon's tip settings (salon parity row 11; Fresha "set up and manage tips", Stripe on-reader tipping): up to three percentage shortcuts the
// owner chooses (used at the desk and on the card reader's own screen), whether sales are emailed a receipt, whether it carries an "add a tip" link, and the tip-eligible
// amount — a percentage tip is worked on the services of a sale, not on the retail or gift cards on it. Pure: the routes and the reader read it.

export const TIP_PRESET_DEFAULTS = [15, 18, 20] as const
export const TIP_SETTINGS_KEY = 'salonTips'
/** Where the Stripe Terminal configuration made for each location is kept, so the next change replaces it instead of piling up. */
export const TIP_CONFIGS_KEY = 'salonTipTerminalConfigs'

export type TipSettings = { presets: number[]; lateTipLink: boolean; sendReceipts: boolean }

const wholePercent = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 100 ? n : null
}

export function readTipSettings(settings: unknown): TipSettings {
  const raw = ((settings as any)?.[TIP_SETTINGS_KEY] ?? {}) as Record<string, unknown>
  const list = Array.isArray(raw.presets) ? raw.presets.map(wholePercent) : []
  const ok = list.length >= 1 && list.length <= 3 && list.every((x) => x != null)
  return { presets: ok ? [...new Set(list as number[])].sort((a, b) => a - b) : [...TIP_PRESET_DEFAULTS], lateTipLink: raw.lateTipLink === false ? false : true, sendReceipts: raw.sendReceipts === false ? false : true }
}

/** A body to store: one to three whole percents (1–100, no repeats), and the late-tip switch; or the sentence for the box that is wrong. */
export function parseTipSettings(body: unknown): { values: TipSettings } | { fields: Record<string, string> } {
  const b = (body ?? {}) as Record<string, unknown>
  const fields: Record<string, string> = {}
  let presets: number[] = []
  if (!Array.isArray(b.presets) || b.presets.length < 1 || b.presets.length > 3) fields.presets = 'Choose one to three tip percentages.'
  else {
    const got = b.presets.map(wholePercent)
    if (got.some((x) => x == null)) fields.presets = 'Each tip is a whole percent from 1 to 100.'
    else if (new Set(got).size !== got.length) fields.presets = 'Each percentage can appear once.'
    else presets = (got as number[]).slice().sort((a, c) => a - c)
  }
  if (b.lateTipLink !== undefined && typeof b.lateTipLink !== 'boolean') fields.lateTipLink = 'Choose on or off.'
  if (b.sendReceipts !== undefined && typeof b.sendReceipts !== 'boolean') fields.sendReceipts = 'Choose on or off.'
  return Object.keys(fields).length ? { fields } : { values: { presets, lateTipLink: b.lateTipLink === false ? false : true, sendReceipts: b.sendReceipts === false ? false : true } }
}

/** Line types a tip is not worked on: retail and gift cards. */
export const NOT_TIPPABLE = new Set(['retail', 'gift_card'])

/**
 * The part of `amountCents` (what is being charged against the sale) a percentage tip is worked on: the share of the sale's lines that are services,
 * applied to the amount (so tax and a split bill follow the same share). A sale with no lines, or only services, is all eligible.
 */
export function eligibleCents(lines: Array<{ type?: string | null; total: unknown }>, amountCents: number): number {
  const cents = lines.map((l) => ({ type: l.type ?? null, c: Math.max(0, Math.round(Number(l.total || 0) * 100)) }))
  const all = cents.reduce((t, l) => t + l.c, 0)
  if (all <= 0 || amountCents <= 0) return Math.max(0, amountCents)
  const eligible = cents.filter((l) => !(l.type && NOT_TIPPABLE.has(l.type))).reduce((t, l) => t + l.c, 0)
  return Math.min(amountCents, Math.max(0, Math.round((amountCents * eligible) / all)))
}

/** The suggested tips on an eligible amount: each percentage in whole cents. */
export const suggestTips = (presets: number[], eligible: number) => presets.map((percent) => ({ percent, cents: Math.round((eligible * percent) / 100) }))
