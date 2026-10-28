/**
 * The ONE place the phone app decides how far things sit from the screen edges.
 *
 * Why this exists: since Expo SDK 54 the app targets Android 16 (API 36), and from API 35 on Android draws every app
 * edge-to-edge — behind the status bar and behind the navigation bar (the |||, O, < buttons or the gesture line).
 * Nothing is pushed out of the way for us any more, so every bar that sits at an edge must add the system inset
 * itself. These are plain functions so a test can run them (tests/mobile/edge-insets.test.ts).
 */

/** Height of the tab bar's own content (icon + label), without the system navigation bar under it. */
export const TAB_BAR_CONTENT_HEIGHT = 56
/** Space under the labels, inside the bar. */
export const TAB_BAR_LABEL_GAP = 4

const px = (n: number | null | undefined) => Math.max(0, Math.round(Number(n) || 0))

/**
 * Tab bar size for a phone whose bottom system inset is `bottomInset` (the navigation bar's height, 0 on a phone that
 * has none). The bar grows by the inset so its icons and labels sit ABOVE the system buttons, and its background
 * runs under them.
 */
export function tabBarMetrics(bottomInset: number | null | undefined) {
  const b = px(bottomInset)
  return { height: TAB_BAR_CONTENT_HEIGHT + b, paddingBottom: TAB_BAR_LABEL_GAP + b }
}

/** Gap between a floating button and the edge of what it floats over. */
export const FAB_MARGIN = 24

/**
 * Distance of a floating button from the bottom of its screen. On a tab screen the tab bar already sits between the
 * button and the system buttons, so only the margin is needed; on a screen with no tab bar the system inset is added.
 */
export function fabBottom(bottomInset: number | null | undefined, aboveTabBar = true) {
  return FAB_MARGIN + (aboveTabBar ? 0 : px(bottomInset))
}

/** Space between dashboard stat cards, and the screen's side padding (dashboard.tsx styles.scroll). */
/** The gap the home screen draws between tiles (design layout.tileGap = 12): the width maths must use the same number or two tiles do not fit a row. */
export const STAT_GRID_GAP = 12
export const STAT_GRID_SIDE_PADDING = 16
export const STAT_GRID_COLUMNS = 2

/**
 * Width in points of one dashboard stat card: `columns` per row across a screen `screenWidth` wide.
 * A real number, set on the animated wrapper that is the flex item of the wrapping row — a percentage on the card
 * inside it resolves against a wrapper that has no width of its own and collapses (see AnimatedCard).
 */
export function statCardWidth(
  screenWidth: number,
  columns = STAT_GRID_COLUMNS,
  gap = STAT_GRID_GAP,
  sidePadding = STAT_GRID_SIDE_PADDING,
) {
  const w = Number(screenWidth)
  const inner = Number.isFinite(w) ? Math.max(0, w - sidePadding * 2) : 0
  return Math.max(0, Math.floor((inner - gap * (columns - 1)) / columns))
}
