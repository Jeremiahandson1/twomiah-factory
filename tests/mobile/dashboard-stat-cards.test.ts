// The dashboard's stat cards keep a real width: two to a row, with room for their labels.
//
//   bun run tests/mobile/dashboard-stat-cards.test.ts
//
// The owner's phone (2026-10-28) drew the five cards ~45pt wide — three on one row, two on the next — with "Jobs Today"
// broken into "Jo / bs / To / da / y". Cause: StatCard had `width: '47%'`, but each card sits inside an <AnimatedCard>
// wrapper, which is the flex item of the wrapping row and has no width of its own, so the percentage resolved against a
// wrapper that shrank to its longest word. A type check cannot see that; this checks the rule that fixes it:
//   · statCardWidth() (src/theme/insets.ts) gives each card a number of points — two per row on every phone width;
//   · the dashboard puts that number on the AnimatedCard wrapper, and StatCard itself sets no width;
//   · a small flex-wrap model (what Yoga does with those widths) puts 5 cards in 3 rows of 2, not 3 + 2 narrow ones.
import fs from 'node:fs'
import path from 'node:path'
import { statCardWidth, STAT_GRID_GAP, STAT_GRID_SIDE_PADDING, STAT_GRID_COLUMNS } from '../../apps/mobile/src/theme/insets.ts'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail)) }
}
const root = path.resolve(import.meta.dir, '../../apps/mobile')
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// A wrapping row of fixed-width items with a gap: how many fit on a row, and so how many rows `n` items take.
const rowsFor = (n: number, itemWidth: number, container: number, gap = STAT_GRID_GAP) => {
  const perRow = Math.max(1, Math.floor((container + gap) / (itemWidth + gap)))
  return { perRow, rows: Math.ceil(n / perRow) }
}

// ── the number ──────────────────────────────────────────────────────────────
check('390 wide (the owner\'s phone): each card is 174 points', statCardWidth(390) === 174, statCardWidth(390))
for (const w of [320, 360, 375, 390, 393, 411, 430]) {
  const card = statCardWidth(w), inner = w - STAT_GRID_SIDE_PADDING * 2
  const { perRow, rows } = rowsFor(5, card, inner)
  check(`${w} wide: ${STAT_GRID_COLUMNS} cards per row, ${card} points each — 5 cards take ${rows} rows`, perRow === STAT_GRID_COLUMNS && rows === 3, { card, perRow, rows })
  check(`${w} wide: a card is wide enough to read a label (≥ 130)`, card >= 130, card)
  check(`${w} wide: the row never overflows the screen`, card * STAT_GRID_COLUMNS + STAT_GRID_GAP <= inner, { card, inner })
}
check('a zero or missing width never gives a negative card', statCardWidth(0) >= 0 && statCardWidth(NaN as any) >= 0)

// ── where the number goes ───────────────────────────────────────────────────
const dash = read('app/(tabs)/dashboard.tsx')
check('the dashboard asks for the screen width (useWindowDimensions) and computes statCardWidth', /useWindowDimensions\(\)/.test(dash) && /statCardWidth\(\s*screenWidth\s*\)/.test(dash))
check('the width goes on the AnimatedCard wrapper that is the flex item', /<AnimatedCard[^>]*style=\{\{\s*width:\s*cardWidth\s*\}\}[^>]*>\s*<StatCard/.test(dash))
check('the dashboard grid is a wrapping row (so the widths decide the columns)', /statsGrid:\s*\{[^}]*flexWrap:\s*'wrap'/.test(dash))
const stat = read('src/components/StatCard.tsx')
const cardStyle = /card:\s*\{([\s\S]*?)\}/.exec(stat)?.[1] ?? ''
check('StatCard.card was found', cardStyle.length > 10, cardStyle)
check('StatCard sets no width of its own (a percentage here collapses inside the wrapper)', !/\bwidth\s*:/.test(cardStyle) && !/flexGrow|flexBasis/.test(cardStyle), cardStyle)
const animated = read('src/components/AnimatedCard.tsx')
check('AnimatedCard passes its style to the animated wrapper (that is where a width must go)', /<Animated\.View[\s\S]*?style=\{style\}/.test(animated))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
