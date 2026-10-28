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
