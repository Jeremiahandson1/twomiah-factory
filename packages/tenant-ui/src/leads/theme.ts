// Lead Inbox / Lead Sources are inline-styled (not Tailwind class-based like the sibling pages),
// so they can't lean on `dark:` variants. This is the ONE place their structural colours live,
// resolved from the live theme via useIsDark(). Both pages read the same palette, and a CI guard
// (scripts/check-lead-inbox-theme.ts) asserts they keep doing so — so neither page can regress to a
// light-only look (the "Lead Inbox is unreadable in dark mode" QA finding).
//
// Only structural chrome lives here (surfaces, borders, text tiers, inputs, generic buttons).
// Semantic colours — platform hues, status/active green, error red, blue links — read on both
// themes and stay inline at their call sites.
import { useIsDark } from '../shell/hooks'

export interface LeadPalette {
  text: string        // default / primary text
  muted: string       // secondary text (#666/#555 in light)
  faint: string       // tertiary text + icons (#999 in light)
  surface: string     // cards, inputs, modals, buttons (#fff in light)
  hover: string       // expanded/active row wash (#fafafa in light)
  border: string      // card + control borders (#e5e7eb in light)
  divider: string     // hairline row dividers (#f0f0f0 in light)
  inputBorder: string // input/select/button borders (#ddd in light)
  activeBtn: string   // toggled-on button bg (#f0f0f0 in light)
  mutedBtnBg: string  // dismiss / paused chip bg (#f5f5f5 in light)
  codeBg: string      // <code> webhook fields (#f5f5f5 in light)
  errBg: string       // error banner bg (#fdecea in light)
  errText: string     // error banner text (#b71c1c in light)
  /**
   * The "Active" chip on Lead Sources. (T58d)
   *
   * Owner, on RV: "a light 'Active' pill on Lead Sources in dark mode." It was a hardcoded
   * `background: '#e8f5e9'` with `color: '#2e7d32'` written inline — correct on a white card and a
   * pale green lozenge on the dark one. Every contrast guard missed it for the reason recorded in
   * the notes: they read className, and an inline `style={{}}` is invisible to them.
   *
   * There was already `errBg`/`errText` for exactly this shape, and `statConverted` for green INK —
   * what was missing was a green chip PAIR, so the inline hex looked like the only option. Measured:
   * light 4.56:1, dark 9.65:1.
   */
  okBg: string        // "Active" chip bg (#e8f5e9 in light)
  okText: string      // "Active" chip text (#2e7d32 in light)
  /**
   * THE LEAD-STATUS CHIPS. (T58d)
   *
   * LeadInboxPage held these as a hardcoded `STATUS_COLORS` map — four pairs chosen for a white
   * card, so all four were pale lozenges on the dark one. That is the owner's "Lead Inbox text
   * contrast" item, and the sibling of the "light Active pill" on Lead Sources: one report named
   * the pill, and the same mistake was four rows away in a STATUS MAP, which is precisely the shape
   * a sweep does not read.
   *
   * Every pair is measured by check-contrast-measured in both themes, and the tiers are kept:
   * dismissed stays visibly dimmer than the rest rather than being lifted to match.
   */
  chip: Record<'new' | 'contacted' | 'converted' | 'dismissed', { bg: string; text: string }>
  infoBg: string      // setup-instructions box (#f8f9ff in light)
  infoBorder: string  // (#e8ecff in light)
  infoHead: string    // (#333 in light)
  infoBody: string    // (#555 in light)
  // The stat-line colours under each card total. These were inline hexes chosen for a white card, on
  // the assumption noted above that a semantic colour "reads on both themes". It does not: #1565c0 on
  // the dark surface (#1e293b) measures 2.55:1, and its two neighbours are no better at ~3.1 and ~3.4.
  // They are structural after all, because what they sit on changes. (Salon T20 M6)
  link: string          // (#2563eb in light) — "Set up your lead sources" was 2.83:1 on the dark card
  statNew: string       // (#1565c0 in light)
  statContacted: string // (#e65100 in light)
  statConverted: string // (#2e7d32 in light)
}

/**
 * EVERY INK IS MEASURED AGAINST THE WORST GROUND IT SITS ON, NOT AGAINST `surface`. (T58k)
 *
 *   owner: "Vet Lead Inbox contrast is not fixed on the live build. #767676 sits on off-white
 *          #FAFAFA and #F5F5F5, which gives 4.35:1 and 4.17:1. In dark mode, Dismiss is 3.28:1.
 *          That grey passes only on pure white, which is probably what the test checked against."
 *
 * Exactly right, including the diagnosis of the test. Every shade in this file was chosen against
 * `surface` — #fff in light, #1e293b in dark — and this palette has FIVE other grounds: `hover`
 * (#fafafa), `activeBtn` and `mutedBtnBg` (#f0f0f0 / #f5f5f5), `codeBg`, `infoBg`. The notes above
 * each colour quote a ratio on white and present it as the answer.
 *
 * Measured across every ink × every ground, six were below AA, not the two reported:
 *
 *   light  faint         #767676 on #f0f0f0   3.99:1
 *   light  statConverted #2e7d32 on #f0f0f0   4.50:1   (okText the same pair)
 *   dark   muted         #94a3b8 on #334155   4.04:1   (infoBody the same)
 *   dark   faint         #8193a6 on #334155   3.28:1   ← the owner's Dismiss button
 *
 * The replacements below are the nearest shade that clears 4.5:1 on the WORST ground, so a colour
 * cannot be made unreadable by moving the element onto a hover row or a muted button. The tiers are
 * preserved deliberately — text brighter than muted, muted brighter than faint — and asserted by
 * scripts/check-lead-palette-every-ground.ts, which replaces "it measures 4.54 on white".
 */
export const LIGHT: LeadPalette = {
  // faint was #999 (2.85:1 on white), then #767676 — which is 4.54 on white and 3.99 on the
  // activeBtn ground it also sits on. #6d6d6d clears 4.5 on all five grounds and stays the dimmest
  // of the three tiers. (FS T28 L8, corrected T58k)
  text: '#111827', muted: '#666', faint: '#6d6d6d',
  surface: '#fff', hover: '#fafafa', border: '#e5e7eb', divider: '#f0f0f0',
  inputBorder: '#ddd', activeBtn: '#f0f0f0', mutedBtnBg: '#f5f5f5', codeBg: '#f5f5f5',
  errBg: '#fdecea', errText: '#b71c1c',
  // 4.56:1 on its own chip ground. #2e7d32 measured 4.50 on the activeBtn ground this ink also lands
  // on as `statConverted`, so both move to #2c7830 (4.80 worst). (T58k)
  okBg: '#e8f5e9', okText: '#2c7830',
  chip: {
    new: { bg: '#e3f2fd', text: '#1565c0' },
    // #e65100 measured 4.0:1 on this wash — under AA. #c2410c is the shade statContacted already
    // moved to for the same reason.
    contacted: { bg: '#fff3e0', text: '#c2410c' },
    converted: { bg: '#e8f5e9', text: '#2e7d32' },
    // #9e9e9e on #f5f5f5 was 2.6:1 — "dismissed" was the least readable chip on the page. My first
    // replacement, #6b7280, measured 4.43 and the guard refused it, which is the guard being worth
    // having: I had estimated 4.8 by eye.
    dismissed: { bg: '#f5f5f5', text: '#5b6471' },
  },
  infoBg: '#f8f9ff', infoBorder: '#e8ecff', infoHead: '#333', infoBody: '#555',
  link: '#2563eb',
  statNew: '#1565c0', statContacted: '#c2410c', statConverted: '#2c7830',
}

export const DARK: LeadPalette = {
  // faint was #64748b (3.07:1 on the dark card), then #8193a6 — 4.64 on `surface` and 3.28 on the
  // #334155 button ground, which is the "Dismiss" the owner measured. #a0aebc clears 4.5 on all four
  // dark grounds; `muted` is lifted to #b3c0d1 so the tier between them stays VISIBLE rather than
  // just technically ordered — at the minimum passing shade the two were 0.4155 vs 0.4138 luminance,
  // which is the same grey to the eye. (FS T20 M4, corrected T58k)
  text: '#e2e8f0', muted: '#b3c0d1', faint: '#a0aebc',
  surface: '#1e293b', hover: '#0f172a', border: '#334155', divider: '#334155',
  inputBorder: '#475569', activeBtn: '#334155', mutedBtnBg: '#334155', codeBg: '#0f172a',
  errBg: '#3b1f1f', errText: '#fca5a5',
  // The green chip, lifted the same way errBg/errText are: a dark wash with light ink. 9.65:1,
  // against the 1.5:1-ish the hardcoded light-mode pair gave on this surface.
  okBg: '#1b3326', okText: '#86efac',
  // Dark washes with light ink, same construction. Dismissed is deliberately the dimmest — a tier,
  // not a failure to clear AA: 5.7:1 against 8–9:1 for the other three.
  chip: {
    new: { bg: '#17293f', text: '#93c5fd' },
    contacted: { bg: '#3a2310', text: '#ffb74d' },
    converted: { bg: '#1b3326', text: '#86efac' },
    dismissed: { bg: '#1f2937', text: '#94a3b8' },
  },
  // infoBody was #94a3b8 — 4.04:1 on the #334155 ground. Same lift as `muted`. (T58k)
  infoBg: '#1e2a44', infoBorder: '#334155', infoHead: '#cbd5e1', infoBody: '#b3c0d1',
  // lifted onto the dark card: ~9:1 each, against 2.55/3.1/3.4 for the light-mode hexes
  link: '#90caf9',
  statNew: '#90caf9', statContacted: '#ffb74d', statConverted: '#81c784',
}

/** Structural colour palette for the lead pages, resolved from the live (class-strategy) theme. */
export function useLeadPalette(): LeadPalette {
  return useIsDark() ? DARK : LIGHT
}

// ---------------------------------------------------------------- the source chip
//
// A platform keeps its brand colour, on a 12% wash of itself, on whichever card it happens to sit on.
// That wash is TRANSPARENT, so the colour behind it decides everything — which is what the first attempt
// at this got wrong: it darkened the ink for a wash composited over white, and in dark mode the chip
// went dark too (1.99:1, worse than the 2.56:1 it was meant to fix). (Salon T29 M1)
//
// So the surface is an argument, the wash is composited for real, and the ink moves in whichever
// direction actually gains contrast against the result. Pure, so it can be measured rather than argued
// about — scripts/check-contrast-measured.ts runs it over every platform colour and both palettes.

// Three-digit hex counts: the LIGHT palette's surface is "#fff", and a parser that only accepted six
// digits read it as BLACK — so the "light" chip was being composited over near-black and the ink moved
// the wrong way. Caught by check-contrast-measured before it shipped, which is the whole point of it.
const toRgb = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || ''))
  if (!m) return [0, 0, 0]
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
const toHex = (rgb: number[]) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
const luminance = (rgb: number[]) => {
  const [r, g, b] = rgb.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** WCAG contrast ratio between two opaque colours. */
export const contrastRatio = (a: string, b: string): number => {
  const [hi, lo] = [luminance(toRgb(a)), luminance(toRgb(b))].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
/** `fg` at `alpha` over `bg` — what the eye actually receives from a translucent wash. */
export const composite = (fg: string, alpha: number, bg: string): string => {
  const f = toRgb(fg), b = toRgb(bg)
  return toHex(f.map((v, i) => v * alpha + b[i] * (1 - alpha)))
}

/** The 12% wash the chip is painted with. Exported so the measurement uses the same number the UI does. */
export const CHIP_TINT_ALPHA = 0.12

/**
 * A readable chip for a platform's brand colour on this card. Returns an opaque background (already
 * composited) and an ink that clears AA against it.
 */
export function chipColors(brand: string, surface: string): { bg: string; text: string } {
  const bg = composite(brand, CHIP_TINT_ALPHA, surface)
  if (contrastRatio(brand, bg) >= 4.5) return { bg, text: brand }
  // Move AWAY from the background: darker ink on a light chip, lighter ink on a dark one.
  const towardsWhite = luminance(toRgb(bg)) < 0.5
  let ink: number[] = toRgb(brand)
  for (let i = 0; i < 24; i++) {
    ink = towardsWhite ? ink.map((v) => v + (255 - v) * 0.18) : ink.map((v) => v * 0.85)
    if (contrastRatio(toHex(ink), bg) >= 4.5) return { bg, text: toHex(ink) }
  }
  // Nothing in the brand's own range works — fall back to plain black or white, whichever reads.
  return { bg, text: contrastRatio('#ffffff', bg) >= contrastRatio('#000000', bg) ? '#ffffff' : '#000000' }
}
