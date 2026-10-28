/**
 * Phone design tokens — the scale every new screen is built from. Pure data (no React Native import) so a test can read it
 * under bun (tests/mobile/design-tokens.test.ts). Colours are in colors.ts; they are built on the theme's own grounds and the
 * business's colour, not a second theme.
 */

/** The smallest thing a finger must be able to hit, in points (Apple HIG 44, Material 48 — we hold the lower bar everywhere). */
export const MIN_TARGET = 44
/** Text grows with the phone's font-size setting up to 130% and stops there; every layout is checked at that size. */
export const MAX_FONT_SCALE = 1.3

/** Spacing on a 4-point grid. */
export const space = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48 } as const
/** The screen's side padding and the gap between stacked cards / grid tiles. */
export const layout = { gutter: 16, gap: 12, tileGap: 12, sectionGap: 24 } as const

export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const

export type TypeVariant = 'display' | 'title' | 'headline' | 'body' | 'bodyStrong' | 'callout' | 'caption' | 'captionStrong' | 'overline' | 'stat'
export interface TypeStyle { size: number; line: number; weight: '400' | '500' | '600' | '700'; letterSpacing?: number; uppercase?: boolean }
/**
 * The type scale. Nothing is smaller than 12 points (the uppercase overline) and body text is 16. Line height is at least
 * 1.25× the size, because text that scales to 130% must not clip or touch the line above.
 */
export const type: Record<TypeVariant, TypeStyle> = {
  display: { size: 28, line: 36, weight: '700' },
  title: { size: 22, line: 28, weight: '700' },
  headline: { size: 17, line: 24, weight: '600' },
  body: { size: 16, line: 22, weight: '400' },
  bodyStrong: { size: 16, line: 22, weight: '600' },
  callout: { size: 15, line: 21, weight: '400' },
  caption: { size: 13, line: 18, weight: '400' },
  captionStrong: { size: 13, line: 18, weight: '600' },
  overline: { size: 12, line: 16, weight: '700', letterSpacing: 0.6, uppercase: true },
  stat: { size: 30, line: 38, weight: '700' },
}

/**
 * Elevation, 0–3. On a light screen a soft shadow lifts a card; on a dark screen shadows are invisible, so the same level is
 * drawn with a lighter surface and a hairline border (see Card). Plain objects so a style array can take them.
 */
export const elevation = {
  0: { shadowOpacity: 0, shadowRadius: 0, shadowOffsetY: 0, elevation: 0 },
  1: { shadowOpacity: 0.06, shadowRadius: 3, shadowOffsetY: 1, elevation: 1 },
  2: { shadowOpacity: 0.1, shadowRadius: 8, shadowOffsetY: 3, elevation: 3 },
  3: { shadowOpacity: 0.16, shadowRadius: 16, shadowOffsetY: 8, elevation: 8 },
} as const
export type ElevationLevel = keyof typeof elevation
export function elevationStyle(level: ElevationLevel, dark: boolean) {
  const e = elevation[level]
  if (dark || level === 0) return { shadowColor: '#000000', shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 }, elevation: 0 }
  return { shadowColor: '#0f172a', shadowOpacity: e.shadowOpacity, shadowRadius: e.shadowRadius, shadowOffset: { width: 0, height: e.shadowOffsetY }, elevation: e.elevation }
}

/** Motion: short, purposeful, and off for a person who turned animations off (useReduceMotion). */
export const motion = {
  fast: 120,
  base: 200,
  slow: 320,
  /** Pressing a tile or row: it sinks a little. */
  pressScale: 0.98,
  /** Cubic-bezier control points for standard (decelerate) movement. */
  easing: [0.2, 0, 0, 1] as const,
} as const
