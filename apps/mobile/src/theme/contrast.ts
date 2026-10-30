/**
 * A readable ink for text on a colour the BUSINESS chose (company.primaryColor — a yellow and a navy are both possible): white or
 * near-black, whichever has the higher WCAG contrast with it. Pure, so tests/mobile checks it under bun.
 */
const channel = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }

export function luminance(hex: string): number {
  const h = /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1]
  if (!h) return 0
  return 0.2126 * channel(parseInt(h.slice(0, 2), 16)) + 0.7152 * channel(parseInt(h.slice(2, 4), 16)) + 0.0722 * channel(parseInt(h.slice(4, 6), 16))
}

export const contrastRatio = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }

export const inkOn = (background: string): '#ffffff' | '#0f172a' => (contrastRatio('#ffffff', background) >= contrastRatio('#0f172a', background) ? '#ffffff' : '#0f172a')

const toHex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')
const mix = (hex: string, towards: '#ffffff' | '#000000', amount: number) => {
  const h = /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1] || '000000'
  const t = towards === '#ffffff' ? 255 : 0
  const c = (i: number) => parseInt(h.slice(i, i + 2), 16) + (t - parseInt(h.slice(i, i + 2), 16)) * amount
  return `#${toHex(c(0))}${toHex(c(2))}${toHex(c(4))}`
}

/** Hue 0-360, saturation and lightness 0-1. */
export function hsl(hex: string): [number, number, number] {
  const h = /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1] || '000000'
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min
  if (!d) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  const hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [(hue * 60 + 360) % 360, s, l]
}
const fromHsl = (h: number, s: number, l: number) => {
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return `#${toHex(f(0) * 255)}${toHex(f(8) * 255)}${toHex(f(4) * 255)}`
}

/**
 * The business's colour made readable AS TEXT: `accent` itself when it already has `min` contrast (WCAG AA, 4.5) with
 * every background it will sit on, otherwise the same hue lightened (on a dark screen) or darkened (on a light one) just
 * far enough. Buttons keep the exact business colour (with inkOn() text); this is for coloured words and tab labels,
 * where a crimson on the dark surface is only ~2.7:1.
 * Lightening keeps the hue and brings a colour's saturation up, rather than mixing in white: white washes a red out to
 * pink (Higgs's #B22234 came out #d17a85 on every icon, 10/30). A grey stays grey.
 */
export function readableAccent(accent: string, backgrounds: string[], min = 4.5): string {
  const worst = (c: string) => Math.min(...backgrounds.map(b => contrastRatio(c, b)))
  if (worst(accent) >= min) return accent
  const towards = backgrounds.reduce((n, b) => n + luminance(b), 0) / backgrounds.length < 0.4 ? '#ffffff' : '#000000'
  const [h, s, l] = hsl(accent)
  for (let i = 1; i <= 20; i++) {
    const c = towards === '#ffffff' ? fromHsl(h, s >= 0.25 ? 1 : s, l + (1 - l) * (i / 20)) : mix(accent, towards, i / 20)
    if (worst(c) >= min) return c
  }
  return towards
}
