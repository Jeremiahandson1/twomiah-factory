// The customer's brand colour, made safe for the two jobs that have a contrast bar.
//
// The tenant's colour is a free `<input type="color">` with no validation, and it is used in two very
// different ways. Most uses are fine bright — the browser theme-color, a 1px accent rule, a 15% wash
// with dark text on it, an icon on a tint. Two are not:
//
//   · a SURFACE that white text sits on (the portal's avatar tile, an email header/button)
//   · the brand used AS INK on a light ground (an email's amount line)
//
// `tailwind.config.js` already clamps the 500/600 shades for the first case, but that only reaches
// code written as `bg-*-500`. Anything that paints `company.primaryColor` directly — an inline style,
// or CSS built at generation — bypasses Tailwind completely and keeps the raw, possibly unreadable
// hex. These helpers are that same clamp for those paths.
//
// They deliberately mirror `readableUnderWhite` in every template's tailwind.config.js, value for
// value, so the portal tile and the primary button land on the SAME shade rather than two different
// darkenings of the same brand. `scripts/check-contrast-measured.ts` asserts that agreement across
// all 360 hues, so the two cannot drift apart silently.
import { contrastRatio } from './leads/theme'

/** Hue 0-360, saturation 0-100, lightness 0-100. Matches hexToHsl in the Tailwind configs. */
function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
    else if (max === g) h = ((b - r) / d + 2) / 6
    else h = ((r - g) / d + 4) / 6
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)]
}

/** Matches hslToHex in the Tailwind configs. */
function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => { const k = (n + h / 30) % 12; return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1) }
  return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')
}

const HEX = /^#[0-9a-fA-F]{6}$/

/**
 * A version of `hex` dark enough that WHITE text on it clears `bar`:1.
 *
 * Hue and saturation are preserved — it is still recognisably the customer's colour — and only
 * lightness comes down, one step at a time, stopping at the first value that clears the bar. A colour
 * that already clears it is returned BYTE-IDENTICAL, so a tenant on a dark brand sees no change at all.
 *
 * `bar` defaults to 4.5 (WCAG AA for body text). Pass 3 for text that is genuinely large — 24px, or
 * 18.66px bold. Do NOT pass 3 for a 14px bold label: that is under the large-text threshold.
 */
export function brandSurfaceUnderWhite(hex: string, bar = 4.5): string {
  if (!HEX.test(hex || '')) return hex
  if (contrastRatio('#ffffff', hex) >= bar) return hex
  const [h, s, l] = hexToHsl(hex)
  for (let d = l - 1; d >= 0; d--) {
    const candidate = hslToHex(h, s, d)
    if (contrastRatio('#ffffff', candidate) >= bar) return candidate
  }
  return '#000000'
}

/**
 * A version of `hex` readable as INK on `ground` (default white).
 *
 * The mirror of the above: the brand used as text rather than as a surface. Same rule — keep the hue,
 * move the lightness, return untouched when it already passes.
 */
export function brandInkOn(hex: string, ground = '#ffffff', bar = 4.5): string {
  if (!HEX.test(hex || '')) return hex
  if (contrastRatio(hex, ground) >= bar) return hex
  const [h, s, l] = hexToHsl(hex)
  const groundIsDark = contrastRatio(ground, '#000000') < contrastRatio(ground, '#ffffff')
  // Move AWAY from the ground: darker ink on a light ground, lighter ink on a dark one.
  const steps = groundIsDark
    ? Array.from({ length: 100 - l }, (_, i) => l + 1 + i)
    : Array.from({ length: l }, (_, i) => l - 1 - i)
  for (const d of steps) {
    const candidate = hslToHex(h, s, d)
    if (contrastRatio(candidate, ground) >= bar) return candidate
  }
  return groundIsDark ? '#ffffff' : '#000000'
}
