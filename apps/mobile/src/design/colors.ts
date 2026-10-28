/**
 * Colour roles for light and dark, built on the business's colour. Pure functions over contrast.ts (inkOn, readableAccent),
 * so tests/mobile/design-tokens.test.ts can measure every role on every ground for any business colour.
 *
 * The grounds are the theme's own (src/theme/ThemeContext.tsx) — the test reads that file and refuses a difference, so this is
 * not a second theme. What this adds is the roles the theme lacks: a muted text colour that really reads (the theme's textMuted
 * is 2.6:1 on white), status colours that read as TEXT and as FILLS, and soft tints for badges and icon discs.
 */
import { contrastRatio, inkOn, luminance, readableAccent } from '../theme/contrast'

export const GROUNDS = {
  dark: { background: '#0f1117', surface: '#1a1d2e', surfaceAlt: '#242838', text: '#f1f5f9', border: '#334155' },
  light: { background: '#f8fafc', surface: '#ffffff', surfaceAlt: '#f1f5f9', text: '#0f172a', border: '#e2e8f0' },
} as const

const toHex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')
/** `base` with `amount` (0–1) of `tint` mixed in. */
export function mixHex(base: string, tint: string, amount: number): string {
  const p = (h: string, i: number) => parseInt(h.replace('#', '').slice(i, i + 2), 16)
  const c = (i: number) => p(base, i) + (p(tint, i) - p(base, i)) * amount
  return `#${toHex(c(0))}${toHex(c(2))}${toHex(c(4))}`
}

/**
 * The fill for a button in the business's colour. The exact colour whenever white or near-black reads on it at 4.5:1 — which
 * is every colour but a narrow band of mid-tones (olive #808000 reaches only 4.26 with either) — and for that band the same hue
 * darkened just far enough that white reads. Never a different colour: only the shade.
 */
export function accentFill(primary: string): string {
  const best = (c: string) => Math.max(contrastRatio('#ffffff', c), contrastRatio('#0f172a', c))
  if (best(primary) >= 4.5) return primary
  for (let i = 1; i <= 20; i++) { const c = mixHex(primary, '#000000', i / 20); if (contrastRatio('#ffffff', c) >= 4.5) return c }
  return '#000000'
}

export type ToneName = 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'
export interface Tone {
  /** The tone as TEXT or an icon: ≥ 4.5:1 on every ground and on its own soft tint. */
  fg: string
  /** A soft tint for a badge, icon disc or banner (the tone over the surface). */
  soft: string
  /** A solid fill (a button, a bar) and the ink on it (≥ 4.5:1). */
  fill: string
  onFill: string
}

export interface Roles {
  dark: boolean
  background: string
  surface: string
  surfaceAlt: string
  /** Hairline between rows and around cards — decoration, not a control edge. */
  border: string
  /** The edge of a control (input, outlined button, unchecked box): ≥ 3:1 on every ground. */
  borderStrong: string
  text: string
  textSecondary: string
  /** The quietest text there is — captions, timestamps — and still ≥ 4.5:1 on every ground. */
  textSubtle: string
  /** The business colour itself, exactly: bars, dots, the active-tab indicator (no words on it). */
  accent: string
  /** The business colour as a button/chip FILL (accentFill: the exact colour unless no ink can read on it) and the ink on it. */
  accentFill: string
  onAccent: string
  /** The business colour as text/icon on the grounds and on its soft tint. */
  accentText: string
  accentSoft: string
  /** The keyboard/switch-access focus ring: ≥ 3:1 on every ground. */
  focusRing: string
  scrim: string
  tones: Record<ToneName, Tone>
  /** Shorthand for tones.success/warning/danger/info.fg — a coloured word. */
  success: string
  warning: string
  danger: string
  info: string
}

/** Status hues: [text hue on light, text hue on dark, fill]. The fills are shades that carry white at ≥ 4.5:1 (as theme/actions.ts). */
const STATUS = {
  success: { light: '#166534', dark: '#4ade80', fill: '#15803d' },
  warning: { light: '#92400e', dark: '#fbbf24', fill: '#b45309' },
  danger: { light: '#b91c1c', dark: '#f87171', fill: '#b91c1c' },
  info: { light: '#1d4ed8', dark: '#60a5fa', fill: '#1d4ed8' },
} as const

export function colorRoles(primary: string, dark: boolean): Roles {
  const g = dark ? GROUNDS.dark : GROUNDS.light
  const grounds = [g.background, g.surface, g.surfaceAlt]
  const soften = (hue: string) => mixHex(g.surface, hue, dark ? 0.2 : 0.12)

  const accentSoft = soften(primary)
  const accentText = readableAccent(primary, [...grounds, accentSoft])
  const textSecondary = readableAccent(dark ? '#cbd5e1' : '#334155', grounds)
  const textSubtle = readableAccent(dark ? '#94a3b8' : '#64748b', grounds)
  const borderStrong = readableAccent(dark ? '#64748b' : '#64748b', grounds, 3)

  const status = (name: keyof typeof STATUS): Tone => {
    const s = STATUS[name]
    const soft = soften(dark ? s.dark : s.light)
    return { fg: readableAccent(dark ? s.dark : s.light, [...grounds, soft]), soft, fill: s.fill, onFill: '#ffffff' }
  }
  const tones: Record<ToneName, Tone> = {
    accent: { fg: accentText, soft: accentSoft, fill: accentFill(primary), onFill: inkOn(accentFill(primary)) },
    success: status('success'),
    warning: status('warning'),
    danger: status('danger'),
    info: status('info'),
    neutral: { fg: textSecondary, soft: g.surfaceAlt, fill: dark ? '#475569' : '#475569', onFill: '#ffffff' },
  }

  return {
    dark,
    background: g.background, surface: g.surface, surfaceAlt: g.surfaceAlt, border: g.border, borderStrong,
    text: g.text, textSecondary, textSubtle,
    accent: primary, accentFill: accentFill(primary), onAccent: inkOn(accentFill(primary)), accentText, accentSoft,
    focusRing: readableAccent(primary, grounds, 3),
    scrim: 'rgba(0,0,0,0.5)',
    tones,
    success: tones.success.fg, warning: tones.warning.fg, danger: tones.danger.fg, info: tones.info.fg,
  }
}

/** For tests and tools: every (text, ground) pair the roles promise to keep readable. */
export function readablePairs(r: Roles): { name: string; fg: string; bg: string; min: number }[] {
  const grounds: [string, string][] = [['background', r.background], ['surface', r.surface], ['surfaceAlt', r.surfaceAlt]]
  const out: { name: string; fg: string; bg: string; min: number }[] = []
  for (const [gn, gv] of grounds) {
    for (const k of ['text', 'textSecondary', 'textSubtle', 'accentText', 'success', 'warning', 'danger', 'info'] as const) out.push({ name: `${k} on ${gn}`, fg: r[k], bg: gv, min: 4.5 })
    out.push({ name: `borderStrong on ${gn}`, fg: r.borderStrong, bg: gv, min: 3 }, { name: `focusRing on ${gn}`, fg: r.focusRing, bg: gv, min: 3 })
  }
  out.push({ name: 'accentText on accentSoft', fg: r.accentText, bg: r.accentSoft, min: 4.5 }, { name: 'onAccent on accentFill', fg: r.onAccent, bg: r.accentFill, min: 4.5 })
  for (const [n, t] of Object.entries(r.tones)) out.push({ name: `${n} fg on its soft tint`, fg: t.fg, bg: t.soft, min: 4.5 }, { name: `${n} onFill on fill`, fg: t.onFill, bg: t.fill, min: 4.5 })
  return out
}
export { contrastRatio, luminance }
