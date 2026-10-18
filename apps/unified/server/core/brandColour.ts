// The company's colour, made readable where it meets white. Moved from apps/api/src/services/generator.ts
// (hexToRgb, relLuminance, rgbToHex, ensureDark), where it filled {{PRIMARY_COLOR_ON_WHITE}} into every CRM at
// build time. The unified app has no build step per tenant, so it computes the same value from the company row
// when it needs it. Same numbers, same result; the generator's copy is deleted at cutover (docs/CUTOVER_LEDGER.md).

function hexToRgb(hex: string): [number, number, number] | null {
  const s = hex.trim().replace(/^#/, '')
  const full = s.length === 3 ? s.split('').map((ch) => ch + ch).join('') : s
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)]
}

function relLuminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
}

/** A colour dark enough that white text on it clears the given luminance ceiling; scales toward black, keeping the hue. */
export function ensureDark(hex: string, maxLuminance = 0.16): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  if (relLuminance(rgb) <= maxLuminance) return hex
  let [r, g, b] = rgb
  for (let i = 0; i < 24 && relLuminance([r, g, b]) > maxLuminance; i++) {
    r *= 0.9; g *= 0.9; b *= 0.9
  }
  return rgbToHex([r, g, b])
}

/**
 * The brand colour measured against white, for the places that put the two together: an email's header, its
 * button and its amount line. White on the brand and the brand on white are the same condition; WCAG AA at 4.5:1
 * means luminance at most 1.05/4.5 - 0.05. A colour that already clears it comes back untouched.
 */
export const colourOnWhite = (hex: string): string => ensureDark(hex, 1.05 / 4.5 - 0.05)

/**
 * The accent as text on the websites' light grounds (eyebrows, service numbers, team roles), measured against the
 * darkest light ground the designs paint — foodtruck's #fdf8f0 paper, luminance 0.943 — so it reads on white and on
 * both papers. A dark accent comes back untouched. (generator.ts accentOnLight, {{ACCENT_COLOR_ON_LIGHT}}.)
 */
export const accentOnLight = (hex: string): string => ensureDark(hex, (0.943 + 0.05) / 4.5 - 0.05)

/** The websites' default accent when the owner hasn't chosen one (generator.ts). */
export const DEFAULT_ACCENT = '#f59e0b'
