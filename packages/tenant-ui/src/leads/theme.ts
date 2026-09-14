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
  infoBg: string      // setup-instructions box (#f8f9ff in light)
  infoBorder: string  // (#e8ecff in light)
  infoHead: string    // (#333 in light)
  infoBody: string    // (#555 in light)
}

const LIGHT: LeadPalette = {
  text: '#111827', muted: '#666', faint: '#999',
  surface: '#fff', hover: '#fafafa', border: '#e5e7eb', divider: '#f0f0f0',
  inputBorder: '#ddd', activeBtn: '#f0f0f0', mutedBtnBg: '#f5f5f5', codeBg: '#f5f5f5',
  errBg: '#fdecea', errText: '#b71c1c',
  infoBg: '#f8f9ff', infoBorder: '#e8ecff', infoHead: '#333', infoBody: '#555',
}

const DARK: LeadPalette = {
  text: '#e2e8f0', muted: '#94a3b8', faint: '#64748b',
  surface: '#1e293b', hover: '#0f172a', border: '#334155', divider: '#334155',
  inputBorder: '#475569', activeBtn: '#334155', mutedBtnBg: '#334155', codeBg: '#0f172a',
  errBg: '#3b1f1f', errText: '#fca5a5',
  infoBg: '#1e2a44', infoBorder: '#334155', infoHead: '#cbd5e1', infoBody: '#94a3b8',
}

/** Structural colour palette for the lead pages, resolved from the live (class-strategy) theme. */
export function useLeadPalette(): LeadPalette {
  return useIsDark() ? DARK : LIGHT
}
