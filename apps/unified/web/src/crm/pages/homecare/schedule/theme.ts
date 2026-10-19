// The schedule group's colours, as theme pairs. Every ground and ink here has a light and a dark value (the frame's
// tokens in ../lib/homecare.css, the tints in ./schedule.css), so the Schedule Hub, the grid and the optimizers read in
// both themes; the template drew them with raw light-only hex values.
import type { CSSProperties } from 'react'
import './schedule.css'

/** The frame's neutrals and status inks. */
export const C = {
  surface: 'var(--hc-surface)',
  ground: 'var(--hc-ground)',
  subtle: 'var(--hc-subtle)',
  hover: 'var(--sc-hover-bg)',
  line: 'var(--hc-line)',
  ink: 'var(--hc-ink)',
  inkSoft: 'var(--hc-ink-soft)',
  /** Secondary text on the plain surface only (4.8:1); on a tint use inkSoft. */
  muted: 'var(--hc-muted)',
  /** The company's brand as ink (readable on the surface in both themes), as a line, and as a ground for white text. */
  brandInk: 'var(--color-teal-dark)',
  brandLine: 'var(--hc-primary)',
  brandFill: 'var(--hc-brand-deep)',
  todayBg: 'var(--sc-today-bg)',
  todayInk: 'var(--sc-today-ink)',
  dropBg: 'var(--sc-drop-bg)',
  dropRing: 'var(--sc-drop-ring)',
  shadow: 'var(--sc-shadow)',
  overlay: 'rgba(0, 0, 0, 0.5)',
} as const

export type Tone = 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'orange'

/** A tint's ground, ink and line (./schedule.css). */
export const tint = (t: Tone) => ({ bg: `var(--sc-${t}-bg)`, ink: `var(--sc-${t}-ink)`, line: `var(--sc-${t}-line)` })

/** Fixed fills for white text: each at 4.8:1 or better against white, the same in both themes. */
export const FILL = {
  blue: '#2563EB',
  green: '#047857',
  red: '#DC2626',
  amber: '#B45309',
  orange: '#C2410C',
  violet: '#7C3AED',
  grey: '#6B7280',
} as const

/** A small rounded label (the template's `bge(bg, color)`), as a tint pair or a solid fill with white text. */
export function pill(t: Tone | 'neutral' | { fill: string }): CSSProperties {
  const base: CSSProperties = { display: 'inline-block', padding: '0.15rem 0.5rem', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 700 }
  if (t === 'neutral') return { ...base, background: C.subtle, color: C.inkSoft }
  if (typeof t === 'object') return { ...base, background: t.fill, color: '#fff' }
  const x = tint(t)
  return { ...base, background: x.bg, color: x.ink }
}

/** A text input / select / textarea: the app's field ground (index.css) with the frame's line. */
export const field: CSSProperties = { width: '100%', padding: '0.5rem', borderRadius: '6px', border: `1px solid ${C.line}` }

/** A pop-up's card. */
export const dialog: CSSProperties = {
  background: C.surface, color: C.ink, borderRadius: '12px', width: '100%', maxHeight: '90vh', overflowY: 'auto',
  boxShadow: `0 20px 60px ${C.shadow}`,
}

/** The dimmed layer under a pop-up. */
export const overlay = (z = 1000): CSSProperties => ({
  position: 'fixed', inset: 0, background: C.overlay, zIndex: z, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
})

/** The optimizers' weekday buttons (Sun…Sat): a fixed fill with white text when picked, the frame's neutral when not. */
const DAY_FILLS = [FILL.violet, FILL.blue, FILL.green, FILL.amber, FILL.red, '#BE185D', '#0E7490']
export function dayButton(on: boolean, i: number, small = false): CSSProperties {
  return {
    padding: small ? '0.15rem 0.35rem' : '0.2rem 0.45rem', borderRadius: small ? '4px' : '5px', fontSize: small ? '0.68rem' : '0.72rem',
    fontWeight: 700, cursor: 'pointer', border: 'none', background: on ? DAY_FILLS[i] : C.subtle, color: on ? '#fff' : C.inkSoft,
  }
}

/**
 * An "already scheduled" weekday: the day's ink on its own 12% tint (each 4.5:1 or better on it in the light theme;
 * amber is the 800 shade, the 700 read 4.3:1); in the dark theme the frame's ink (--sc-day-ink) on the dark tint.
 */
const DAY_INKS = ['#6D28D9', '#1D4ED8', '#047857', '#92400E', '#B91C1C', '#BE185D', '#0E7490']
export function dayChip(d: number, small = false): CSSProperties {
  return {
    fontSize: small ? '0.65rem' : '0.72rem', padding: small ? '0.1rem 0.3rem' : '0.1rem 0.4rem', borderRadius: small ? '3px' : '4px',
    fontWeight: small ? 700 : 600,
    background: `color-mix(in srgb, ${DAY_INKS[d]} 12%, var(--hc-surface))`,
    color: `var(--sc-day-ink, ${DAY_INKS[d]})`,
  }
}

/**
 * Caregiver / client colours for dots, bars and left borders (marks, not text). Where white text sits on one (the
 * grid's shift chips) the 700 shades are used: the template's 500 shades put white text at 2:1 on amber and teal.
 */
export const MARKS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1']
export const CHIP_FILLS = ['#1D4ED8', '#047857', '#B45309', '#B91C1C', '#6D28D9', '#0E7490', '#C2410C', '#BE185D', '#0F766E', '#4338CA']
