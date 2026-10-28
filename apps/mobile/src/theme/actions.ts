/**
 * The fixed colours of status buttons (Start, Send, Complete, Decline, Schedule…), one set for the whole app.
 *
 * Their words and icons are white, so every colour here is a shade that reaches 4.5:1 against white — the lighter
 * shades these buttons used (#22c55e green 2.3:1, #0ea5e9 sky 2.8:1, #3b82f6 blue 3.7:1, #ef4444 red 3.8:1,
 * #8b5cf6 violet 4.2:1) could not be read. tests/mobile/theme-contrast.test.ts measures each one.
 * A button in the BUSINESS's colour is not here: it uses t.primary with t.onPrimary (inkOn of that colour).
 */
export const ACTION = {
  green: '#15803d',
  blue: '#1d4ed8',
  violet: '#6d28d9',
  sky: '#0369a1',
  red: '#b91c1c',
  slate: '#475569',
} as const

/** The ink on every ACTION colour. */
export const ACTION_INK = '#ffffff'

/** White on a dark see-through layer over a photo (rgba black ≥ 0.6, or the full-screen viewer's black). */
export const OVERLAY_INK = '#ffffff'
