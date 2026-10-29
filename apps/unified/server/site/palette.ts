// The site's colours as the owner sets them (Website settings › Look). Four are the owner's to choose:
//   brand   the main colour: buttons, links, rules. Absent: the company's own (Settings › Company).
//   accent  the second colour: headings' bar, small labels, link underlines, ticks. Absent: the design's amber.
//   band    the dark bands (call to action, stats, footer). Always kept dark, so the white text on them reads.
//   page    the page's own ground. Absent: the design's. The text, cards and lines are worked out from it, so they read.
// They live on the website (website.palette, website.accent_color), not the company: changing how the site looks never
// recolours an invoice or an email. A palette PRESET is just these four filled in at once.
//
// Every design names its colours its own way (SITE_DESIGN_SPECS.tokens), so this file is the one place that knows how:
// paletteCss() returns the rules that go after the design's stylesheet and say the owner's choices in that design's words.
import { accentOnLight, contrastRatio, DEFAULT_ACCENT, ensureDark, ensureLight, inkOn, isDarkColour, mixHex } from '../core/brandColour.ts'
import type { SiteDesignSpec } from '../core/vertical.ts'

export interface Palette {
  brand?: string
  band?: string
  page?: string
  /** The preset these came from (for the picker to show as chosen); never read by the site. */
  preset?: string
}

export interface Preset {
  id: string
  label: string
  /** The four colours, and the accent, that the preset fills in. `page` absent: the design's own page. */
  brand: string
  accent: string
  band: string
  page?: string
}

/** A colour as the stored #rrggbb, or null when it is not one (#rgb is widened). */
export function cleanHex(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim().toLowerCase()
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s)
  if (!m) return null
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
  return '#' + h
}

/**
 * Twelve palettes that read well on every design. A preset sets the whole set; the owner can then change any one colour.
 * Brands are mid-tones (the stylesheet darkens one where it is used as text on white, lightens it on near-black), bands are
 * dark, pages are light papers except Noir.
 */
export const PRESETS: Preset[] = [
  { id: 'forest-gold', label: 'Forest and gold', brand: '#1f6b46', accent: '#c89a4e', band: '#12301f' },
  { id: 'midnight', label: 'Midnight', brand: '#1d4ed8', accent: '#38bdf8', band: '#0b1f4a' },
  { id: 'brick-cream', label: 'Brick and cream', brand: '#b4442b', accent: '#e0a458', band: '#3a1a12', page: '#faf4ea' },
  { id: 'slate-copper', label: 'Slate and copper', brand: '#334155', accent: '#c2703d', band: '#1e293b' },
  { id: 'harbor', label: 'Harbor', brand: '#0e7490', accent: '#f59e0b', band: '#083344' },
  { id: 'plum-blush', label: 'Plum and blush', brand: '#7c2d6b', accent: '#e58fa8', band: '#2e1030', page: '#fbf5f7' },
  { id: 'sage-clay', label: 'Sage and clay', brand: '#587a5a', accent: '#c9825b', band: '#26362a', page: '#f6f3ec' },
  { id: 'charcoal-lime', label: 'Charcoal and lime', brand: '#1f2937', accent: '#84cc16', band: '#111827' },
  { id: 'sunrise', label: 'Sunrise', brand: '#c2410c', accent: '#fbbf24', band: '#431407' },
  { id: 'fire-steel', label: 'Fire and steel', brand: '#b91c1c', accent: '#f59e0b', band: '#1c1917' },
  { id: 'ocean-sand', label: 'Ocean and sand', brand: '#0f766e', accent: '#d9a441', band: '#10302d', page: '#f7f2e8' },
  { id: 'noir', label: 'Noir', brand: '#d4af37', accent: '#f1dfa3', band: '#0c0c0d', page: '#131313' },
]

/** A stored palette cleaned: known keys only, each a #rrggbb; null when nothing is left. */
export function cleanPalette(v: unknown): Palette | null {
  if (!v || typeof v !== 'object') return null
  const src = v as Record<string, unknown>
  const out: Palette = {}
  for (const k of ['brand', 'band', 'page'] as const) {
    const h = cleanHex(src[k])
    if (h) out[k] = h
  }
  if (typeof src.preset === 'string' && PRESETS.some((p) => p.id === src.preset)) out.preset = src.preset
  return Object.keys(out).length ? out : null
}

/** What the site is painted with, after the guards (the band kept dark). */
export interface SiteColours {
  primary: string
  accent: string | null
  /** The dark band: the owner's, else the company's secondary colour. */
  secondary: string | null
  /** The owner's page ground, or null: the design's own. */
  page: string | null
}

export function siteColours(company: { primaryColor: string; secondaryColor?: string | null }, accent: string | null | undefined, palette: unknown): SiteColours {
  const p = cleanPalette(palette)
  return {
    primary: p?.brand ?? company.primaryColor,
    accent: cleanHex(accent),
    secondary: p?.band ?? company.secondaryColor ?? null,
    page: p?.page ?? null,
  }
}

/** The page's own tokens, worked out from its ground so the text, cards and lines always read. */
export function pageTokens(page: string) {
  const dark = isDarkColour(page)
  // Soft black or soft white, whichever reads better; on a mid-tone neither reaches 7:1, so the true black or white does.
  const soft = inkOn(page, '#15171a') === '#ffffff' ? '#f4f2ec' : '#15171a'
  const tx = contrastRatio(soft, page) >= 7 ? soft : contrastRatio('#000000', page) >= contrastRatio('#ffffff', page) ? '#000000' : '#ffffff'
  // The muted text must clear 4.5:1 on the page and on a darker leaf of it; step toward the text until it does.
  const sf2 = dark ? mixHex(page, '#ffffff', 0.12) : mixHex(page, '#000000', 0.06)
  let t3 = mixHex(tx, page, 0.32)
  for (let i = 0; i < 12 && Math.min(contrastRatio(t3, page), contrastRatio(t3, sf2)) < 4.6; i++) t3 = mixHex(t3, tx, 0.25)
  return {
    dark,
    bg: page,
    sf: dark ? mixHex(page, '#ffffff', 0.06) : mixHex(page, '#ffffff', 0.6),
    sf2,
    tx,
    tx2: mixHex(tx, page, 0.16),
    tx3: t3,
    ln: dark ? mixHex(page, '#ffffff', 0.2) : mixHex(page, '#000000', 0.16),
    ln2: dark ? mixHex(page, '#ffffff', 0.32) : mixHex(page, '#000000', 0.3),
  }
}

/**
 * The rules after the design's stylesheet that carry the owner's page and dark band into that design. Empty when the owner
 * chose neither. (The brand and the accent need no rules here: the design's own placeholders are filled with them.)
 */
export function paletteCss(colours: SiteColours, spec: SiteDesignSpec): { css: string; darkPage: boolean } {
  const kind = spec.tokens ?? 'base'
  const decl: string[] = []
  // The dark band: kept dark (white text sits on it), whatever was picked.
  if (colours.secondary && kind !== 'bar') {
    const band = ensureDark(colours.secondary)
    if (kind === 'look' && spec.band) decl.push(`${spec.band}: ${band}`)
    decl.push(`--brand-deep: ${band}`)
  }
  let dark = false
  if (colours.page && kind !== 'bar') {
    const t = pageTokens(colours.page)
    dark = t.dark
    if (kind === 'look') {
      decl.push(`--bg: ${t.bg}`, `--sf: ${t.sf}`, `--sf2: ${t.sf2}`, `--tx: ${t.tx}`, `--tx2: ${t.tx2}`, `--tx3: ${t.tx3}`, `--ln: ${t.ln}`, `--ln2: ${t.ln2}`, `--focus: ${t.tx}`, `--edge: ${t.tx}`)
      if (t.dark) decl.push('--grid: rgba(255, 255, 255, .06)', `--brand-ink: ${ensureLight(colours.primary)}`, `--brand-text: ${ensureLight(colours.primary)}`)
      else decl.push(`--brand-ink: ${ensureDark(colours.primary, 0.17)}`, `--brand-text: ${ensureDark(colours.primary, 0.17)}`)
    } else {
      decl.push(`--paper: ${t.bg}`, `--white: ${t.sf}`, `--ink: ${t.tx}`, `--ink-soft: ${t.tx2}`, `--muted: ${t.tx3}`, `--line: ${t.ln}`)
      if (t.dark) decl.push(`--brand: ${ensureLight(colours.primary)}`, `--accent-ink: ${ensureLight(colours.accent || DEFAULT_ACCENT)}`)
    }
    decl.push(`color-scheme: ${t.dark ? 'dark' : 'light'}`)
  }
  const css = decl.length ? `\n/* the owner's page and dark band (site/palette.ts) */\n:root { ${decl.join('; ')}; }\n` : ''
  return { css, darkPage: dark }
}

/**
 * Where the accent shows, the same on every design but the bar's own: the bar under a section's heading, the small
 * labels (a story's eyebrow, a team member's role, a service's number), the underline of a link in running text, the
 * tick of a checkbox, a question's mark in the FAQ and the footer's link on hover. Only when the owner has an accent:
 * a site that never chose one keeps the look it had.
 */
export function accentCss(colours: SiteColours, spec: SiteDesignSpec, darkPage: boolean): string {
  if (!colours.accent) return ''
  const kind = spec.tokens ?? 'base'
  const accent = colours.accent
  const onLight = accentOnLight(accent)
  const onDark = ensureLight(accent)
  const text = darkPage ? onDark : onLight
  const left = (spec.headAlign ?? 'center') === 'left'
  const lines: string[] = []
  lines.push(`:root { --accent-fill: ${accent}; --accent-text: ${text}; accent-color: ${accent}; }`)
  if (spec.schemes && !colours.page) lines.push(`@media (prefers-color-scheme: dark) { :root { --accent-text: ${onDark}; } }`)
  if (kind !== 'bar') {
    // The bar under a heading. Heritage draws a hairline there already: the same element, now the accent's and thicker.
    lines.push(`.section-head::after { content: ''; display: block; width: 56px; height: 4px; border-radius: 2px; background: var(--accent-fill); margin: 18px ${left ? '0' : 'auto'} 0; }`)
  }
  lines.push(
    `.story__eyebrow, .team__role, .service-row__index, .why-choose__mark { color: var(--accent-text); }`,
    `.story__body a, .blog-post__body a, .legal-page a { text-decoration-color: var(--accent-fill); text-decoration-thickness: 2px; text-underline-offset: 3px; }`,
    `.blog-post__body blockquote { border-left-color: var(--accent-fill); }`,
    `.faq-item__question::after { color: var(--accent-text); }`,
    `.site-footer a:hover, .footer-contact a:hover { color: ${onDark}; }`,
  )
  return '\n/* the owner\'s accent (site/palette.ts) */\n' + lines.join('\n') + '\n'
}
