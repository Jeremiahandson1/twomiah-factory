// The shifts group's colour pairs. The template's screens were light-only and wrote raw colours inline; here each
// colour that carries meaning is a Tailwind light/dark pair (or a frame token, var(--hc-…), in a style), so a screen
// reads in both themes. Each pair below is measured: the ink reads at 4.5:1 or better on its own ground, and the
// "ink" pairs on var(--hc-surface) / var(--hc-subtle), in both themes.
import type { CSSProperties } from 'react'

export type Tone = 'blue' | 'violet' | 'indigo' | 'green' | 'amber' | 'orange' | 'red' | 'teal' | 'cyan' | 'gray'

/** A tinted chip: its ground and its ink, light and dark. */
export const CHIP: Record<Tone, string> = {
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200',
  violet: 'bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200',
  indigo: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-200',
  green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
  orange: 'bg-[#ffedd5] text-[#9a3412] dark:bg-[#431407] dark:text-[#fed7aa]',
  red: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200',
  teal: 'bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-200',
  cyan: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/50 dark:text-cyan-200',
  gray: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300',
}

/** An ink on the page's surface (a figure, a time, a link-coloured word). */
export const INK: Record<Tone, string> = {
  blue: 'text-blue-700 dark:text-blue-300',
  violet: 'text-violet-700 dark:text-violet-300',
  indigo: 'text-indigo-700 dark:text-indigo-300',
  green: 'text-emerald-700 dark:text-emerald-300',
  amber: 'text-amber-700 dark:text-amber-300',
  // Tailwind's orange-* is the company's brand colour in this app (tailwind.config.ts), so orange is written out.
  orange: 'text-[#c2410c] dark:text-[#fdba74]',
  red: 'text-red-700 dark:text-red-300',
  teal: 'text-teal-700 dark:text-teal-300',
  cyan: 'text-cyan-700 dark:text-cyan-300',
  gray: 'text-gray-600 dark:text-slate-300',
}

/** A coloured edge (a status card's border, a tile's accent) that shows on both grounds. */
export const EDGE: Record<Tone, string> = {
  blue: 'border-blue-600 dark:border-blue-400',
  violet: 'border-violet-600 dark:border-violet-400',
  indigo: 'border-indigo-500 dark:border-indigo-400',
  green: 'border-emerald-500 dark:border-emerald-400',
  amber: 'border-amber-500 dark:border-amber-400',
  orange: 'border-[#ea580c] dark:border-[#fb923c]',
  red: 'border-red-500 dark:border-red-400',
  teal: 'border-teal-600 dark:border-teal-400',
  cyan: 'border-cyan-600 dark:border-cyan-400',
  gray: 'border-gray-300 dark:border-slate-600',
}

/** The outline of a selected tile. */
export const RING: Record<Tone, string> = {
  blue: 'ring-2 ring-blue-600 dark:ring-blue-400',
  violet: 'ring-2 ring-violet-600 dark:ring-violet-400',
  indigo: 'ring-2 ring-indigo-500 dark:ring-indigo-400',
  green: 'ring-2 ring-emerald-500 dark:ring-emerald-400',
  amber: 'ring-2 ring-amber-500 dark:ring-amber-400',
  orange: 'ring-2 ring-[#ea580c] dark:ring-[#fb923c]',
  red: 'ring-2 ring-red-500 dark:ring-red-400',
  teal: 'ring-2 ring-teal-600 dark:ring-teal-400',
  cyan: 'ring-2 ring-cyan-600 dark:ring-cyan-400',
  gray: 'ring-2 ring-gray-400 dark:ring-slate-500',
}

/** A filled bar (a utilisation meter). */
export const FILL: Record<Tone, string> = {
  blue: 'bg-blue-600 dark:bg-blue-400',
  violet: 'bg-violet-600 dark:bg-violet-400',
  indigo: 'bg-indigo-600 dark:bg-indigo-400',
  green: 'bg-emerald-600 dark:bg-emerald-400',
  amber: 'bg-amber-600 dark:bg-amber-400',
  orange: 'bg-[#ea580c] dark:bg-[#fb923c]',
  red: 'bg-red-600 dark:bg-red-400',
  teal: 'bg-teal-600 dark:bg-teal-400',
  cyan: 'bg-cyan-600 dark:bg-cyan-400',
  gray: 'bg-gray-300 dark:bg-slate-600',
}

/**
 * A solid button with white ink. Each ground is dark enough for white in both themes (≥ 4.5:1); the template's
 * lighter ones (#16a34a, #ea580c, #d97706, #10b981, #3b82f6, #888) are taken to the next shade that is.
 */
export const SOLID = {
  blue: '#1d4ed8',
  violet: '#6d28d9',
  indigo: '#4f46e5',
  green: '#047857',
  amber: '#b45309',
  orange: '#c2410c',
  red: '#b91c1c',
  gray: '#4b5563',
  teal: '#0f766e',
  /** The company's brand, at its deep end: the frame's token white text sits on (the template's {{PRIMARY_COLOR}}). */
  brand: 'var(--hc-brand-deep)',
} as const

/** A text box, select or textarea on the frame's surface (the template's #fff / #ddd boxes). */
export const field: CSSProperties = {
  width: '100%',
  padding: '0.5rem',
  border: '1px solid var(--hc-line)',
  borderRadius: 6,
  fontSize: '0.9rem',
  background: 'var(--hc-surface)',
  color: 'var(--hc-ink)',
  boxSizing: 'border-box',
}

/** The pop-up's dimmed backdrop and its panel. */
export const backdrop: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center',
  justifyContent: 'center', zIndex: 2000, padding: 20,
}
export const panel: CSSProperties = { background: 'var(--hc-surface)', color: 'var(--hc-ink)', borderRadius: 10 }
