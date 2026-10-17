// The brand palette: ONE implementation, used at build time AND at runtime.
//
// Every CRM's tailwind.config.js maps `orange`, `primary` and `brand` to this palette. It used to bake
// generatePalette(<the colour chosen at signup>) straight into the CSS, so a colour the owner changed later
// in Settings (company.primaryColor) never reached the CRM's own screens until the tenant was regenerated.
//
// Now the config maps each shade to a CSS variable — `rgb(var(--brand-500) / <alpha-value>)` — and writes
// the build-time palette as the variables' DEFAULT values on :root, so a CRM with no runtime colour paints
// exactly what it painted before. Once the company is loaded, the shell runs THIS SAME generatePalette over
// company.primaryColor and sets the variables on <html> (applyBrandPalette). One function, so the shade a
// tenant gets at runtime is byte-for-byte the shade the build would have given the same colour — including
// the contrast clamps below, which a pale colour picked in Settings needs just as much as one picked at signup.
//
// Plain JavaScript with no imports on purpose: tailwind.config.js loads it in Node at build time, and the
// React shell imports it in the browser. Vendored into each tenant as src/shared/brandPalette.js.

/** The shades the generator produces, in order. */
export const BRAND_SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950']

/** What a palette falls back to when it is given no usable colour (an unreplaced build token, a blank). */
export const DEFAULT_BRAND_HEX = '#f97316'

/**
 * '#rrggbb' (lower case) for a usable hex colour — '#rgb' is expanded, as the company API accepts it — or
 * null for anything else.
 * @param {unknown} hex
 * @returns {string | null}
 */
export function normalizeHex(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex == null ? '' : hex).trim())
  if (!m) return null
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
  return '#' + h.toLowerCase()
}

/**
 * Hue 0-360, saturation 0-100, lightness 0-100 (each rounded).
 * @param {string} hex '#rrggbb'
 * @returns {[number, number, number]}
 */
export function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
      case g: h = ((b - r) / d + 2) / 6; break
      case b: h = ((r - g) / d + 4) / 6; break
    }
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)]
}

/**
 * @param {number} h 0-360
 * @param {number} s 0-100
 * @param {number} l 0-100
 * @returns {string} '#rrggbb'
 */
export function hslToHex(h, s, l) {
  s /= 100; l /= 100
  const a = s * Math.min(l, 1 - l)
  const f = (n) => { const k = (n + h / 30) % 12; return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1) }
  return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')
}

/**
 * WCAG relative luminance of a #rrggbb colour.
 * @param {string} hex
 */
export function relLuminance(hex) {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

/**
 * The 500 and 600 shades are what the UI paints UNDER WHITE TEXT (primary buttons and their hover).
 * The shades below fix LIGHTNESS, which is not luminance: at the same HSL lightness a yellow is far
 * brighter than a blue, so white on a yellow/lime/green/teal/cyan brand — or on the fallback orange —
 * landed between 1.5:1 and 3.3:1, under the 4.5:1 that WCAG AA requires for this text size.
 *
 * Take the lightness down until white is readable, keeping hue and saturation so it is still the
 * customer's colour. A colour that already clears AA is returned untouched, so a tenant on a dark
 * brand sees no change whatsoever.
 */
const WHITE_TEXT_MAX_LUM = 1.05 / 4.5 - 0.05
function readableUnderWhite(h, s, l, exactHex) {
  const start = exactHex || hslToHex(h, s, l)
  if (relLuminance(start) <= WHITE_TEXT_MAX_LUM) return start
  for (let d = l - 1; d >= 0; d--) {
    const candidate = hslToHex(h, s, d)
    if (relLuminance(candidate) <= WHITE_TEXT_MAX_LUM) return candidate
  }
  return '#000000'
}

/**
 * The 700 shade is what the UI paints AS INK on the 50 and 100 shades (every status badge and chip:
 * `bg-orange-100 text-orange-700`). readableUnderWhite covers the opposite case — white on the
 * colour — and nothing covered this one, so a green or yellow brand's 700 sat at about 3.3:1 on its
 * own 100 while a navy brand's cleared easily. Same cause as the white-text clamp: these shades fix
 * LIGHTNESS, and lightness is not luminance.
 *
 * Darken until the ink clears AA against the 100 shade, which is the harder of the two tints.
 * Monotonically safe — darker ink on a light tint is strictly more readable, and bg-*-700 only ever
 * carries white text, which improves too. A brand that already clears is returned untouched.
 */
function readableAsInkOn(h, s, l, tintHex) {
  const tintLum = relLuminance(tintHex)
  const clears = (hex) => (tintLum + 0.05) / (relLuminance(hex) + 0.05) >= 4.5
  const start = hslToHex(h, s, l)
  if (clears(start)) return start
  for (let d = l - 1; d >= 0; d--) {
    const candidate = hslToHex(h, s, d)
    if (clears(candidate)) return candidate
  }
  return '#000000'
}

/**
 * The whole 50–950 scale for a brand colour, contrast-clamped.
 *
 * `fallback` is used when `hex` is not a usable colour — at build time that is an unreplaced
 * '{{…}}' token; a template whose signup default differs passes its own.
 * @param {string | null | undefined} hex
 * @param {string} [fallback]
 * @returns {Record<string, string>} shade → '#rrggbb'
 */
export function generatePalette(hex, fallback = DEFAULT_BRAND_HEX) {
  const base = normalizeHex(hex) || normalizeHex(fallback) || DEFAULT_BRAND_HEX
  const [h, s, l] = hexToHsl(base)
  const tint100 = hslToHex(h, Math.min(s, 100), 90)
  return {
    50: hslToHex(h, Math.min(s, 100), 96),
    100: tint100,
    200: hslToHex(h, Math.min(s, 100), 80),
    300: hslToHex(h, Math.min(s, 95), 65),
    400: hslToHex(h, Math.min(s, 95), 55),
    500: readableUnderWhite(h, s, l, base),
    600: readableAsInkOn(h, Math.min(s + 5, 100), 40, '#f9fafb'),
    700: readableAsInkOn(h, Math.min(s + 5, 100), 33, tint100),
    800: hslToHex(h, Math.min(s + 5, 100), 26),
    900: hslToHex(h, Math.min(s + 5, 100), 20),
    950: hslToHex(h, Math.min(s + 5, 100), 12),
  }
}

/** The CSS variable that carries one shade. */
export const brandVar = (shade) => `--brand-${shade}`

/**
 * What tailwind.config.js maps `orange`, `primary` and `brand` to: each shade read from its variable,
 * in the space-separated channel form Tailwind needs for opacity modifiers (`bg-brand-500/10`).
 * @returns {Record<string, string>}
 */
export function brandVarScale() {
  const out = {}
  for (const shade of BRAND_SHADES) out[shade] = `rgb(var(${brandVar(shade)}) / <alpha-value>)`
  return out
}

/** '#rrggbb' → 'r g b', the value a --brand-* variable holds. */
export function hexToChannels(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(' ')
}

/**
 * A palette as variable declarations: { '--brand-500': '249 115 22', … }. The build writes these on
 * :root as the defaults; the runtime writes the same declarations on <html>.
 * @param {Record<string, string>} palette
 */
export function paletteToCssVars(palette) {
  const out = {}
  for (const shade of BRAND_SHADES) out[brandVar(shade)] = hexToChannels(palette[shade])
  return out
}

/**
 * The Tailwind plugin that declares the defaults: the build-time palette on :root. Without it every
 * mapped class would read an unset variable and paint nothing.
 * @param {Record<string, string>} palette
 */
export function brandVarsPlugin(palette) {
  const vars = paletteToCssVars(palette)
  return function brandVars({ addBase }) { addBase({ ':root': vars }) }
}

/**
 * Point the CRM at the company's own colour, now. Sets every --brand-* variable on <html> from the
 * same generator the build used. Anything that is not a usable colour — blank, which Settings offers as
 * "use the default", or a stored value that is not a hex — REMOVES the overrides, so the build-time
 * defaults on :root show through again rather than the screens going colourless.
 *
 * Returns the palette applied, or null when it fell back to the defaults.
 * @param {string | null | undefined} hex
 * @param {{ style: { setProperty(n: string, v: string): void, removeProperty(n: string): unknown } }} [root]
 */
export function applyBrandPalette(hex, root) {
  const el = root || (typeof document !== 'undefined' ? document.documentElement : null)
  if (!el) return null
  const base = normalizeHex(hex)
  if (!base) {
    for (const shade of BRAND_SHADES) el.style.removeProperty(brandVar(shade))
    return null
  }
  const palette = generatePalette(base)
  const vars = paletteToCssVars(palette)
  for (const name of Object.keys(vars)) el.style.setProperty(name, vars[name])
  return palette
}
