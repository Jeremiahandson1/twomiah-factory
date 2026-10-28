// Nothing in the phone app sits under Android's own buttons, and nothing is padded for the status bar twice.
//
//   bun run tests/mobile/edge-insets.test.ts
//
// Since Expo SDK 54 the app targets Android 16 (API 36), which draws every app edge-to-edge: behind the status bar and behind
// the navigation bar (the |||, O, < buttons). The owner's phone (2026-10-28) showed the tab bar drawn UNDER those buttons —
// the tab bar had a fixed height of 56 — and a gap under every header, because each screen added the status-bar inset a
// second time (the navigator's header already did). A type check cannot see either, so this reads the source:
//   · the inset rule is one pure function (src/theme/insets.ts) and the tab bar uses it — no fixed height or bottom padding;
//   · a floating button and the offline banner take their position from the insets, and no bar-like element anywhere
//     uses a fixed `bottom:` (the only ones left are inside a card: a signature pad and thumbnail badges);
//   · every pushed screen (details, care) clears the navigation bar through one `screenLayout` rule on its stack;
//   · no screen under a navigator header wraps itself in a top-inset SafeAreaView;
//   · a horizontal ScrollView that sits in a column does not grow to the height of the list beside it.
import fs from 'node:fs'
import path from 'node:path'
import { tabBarMetrics, fabBottom, TAB_BAR_CONTENT_HEIGHT, TAB_BAR_LABEL_GAP, FAB_MARGIN } from '../../apps/mobile/src/theme/insets.ts'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail)) }
}
const root = path.resolve(import.meta.dir, '../../apps/mobile')
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')
const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')

// ── the rule itself ─────────────────────────────────────────────────────────
check('no navigation bar: the tab bar is its own 56 + 4', tabBarMetrics(0).height === TAB_BAR_CONTENT_HEIGHT && tabBarMetrics(0).paddingBottom === TAB_BAR_LABEL_GAP)
check('a 48 navigation bar: the tab bar grows by 48, label gap included', tabBarMetrics(48).height === 104 && tabBarMetrics(48).paddingBottom === 52, tabBarMetrics(48))
check('a gesture-bar phone (24): grows by 24', tabBarMetrics(24).height === 80 && tabBarMetrics(24).paddingBottom === 28)
check('a missing, negative or NaN inset is 0, never a smaller bar', [undefined, null, -10, NaN].every((v) => tabBarMetrics(v as any).height === TAB_BAR_CONTENT_HEIGHT))
check('the icons stay above the system buttons: content height does not shrink as the inset grows', [0, 16, 34, 48, 64].every((b) => tabBarMetrics(b).height - tabBarMetrics(b).paddingBottom === TAB_BAR_CONTENT_HEIGHT - TAB_BAR_LABEL_GAP))
check('a floating button over a tab screen needs only its margin', fabBottom(48, true) === FAB_MARGIN && fabBottom(0) === FAB_MARGIN)
check('a floating button on a screen with no tab bar clears the system inset', fabBottom(48, false) === FAB_MARGIN + 48)

// ── the tab bar uses it ─────────────────────────────────────────────────────
const tabsLayout = noComments(read('app/(tabs)/_layout.tsx'))
const tabBarStyle = /tabBarStyle:\s*\{([\s\S]*?)\n\s{8}\}/.exec(tabsLayout)?.[1] ?? ''
check('the tab layout reads the bottom inset (useSafeAreaInsets)', /useSafeAreaInsets\(\)/.test(tabsLayout) && /insets\.bottom/.test(tabsLayout))
check('the tab bar size comes from tabBarMetrics', /tabBarMetrics\(\s*insets\.bottom\s*\)/.test(tabsLayout))
check('tabBarStyle was found', tabBarStyle.length > 20, tabBarStyle)
check('tabBarStyle height is the inset-aware value, not a number', /height:\s*bar\.height/.test(tabBarStyle) && !/height:\s*\d/.test(tabBarStyle), tabBarStyle)
check('tabBarStyle paddingBottom is the inset-aware value, not a number', /paddingBottom:\s*bar\.paddingBottom/.test(tabBarStyle) && !/paddingBottom:\s*\d/.test(tabBarStyle), tabBarStyle)

// ── floating buttons and bars ───────────────────────────────────────────────
const fab = noComments(read('src/components/FAB.tsx'))
check('the floating button gets its bottom from fabBottom(insets.bottom)', /fabBottom\(\s*insets\.bottom/.test(fab) && /useSafeAreaInsets/.test(fab))
check('the floating button has no fixed bottom of its own', !/bottom:\s*\d/.test(fab))
const banner = noComments(read('src/components/OfflineBanner.tsx'))
check('the offline banner starts below the status bar (insets.top)', /insets\.top/.test(banner) && /useSafeAreaInsets/.test(banner))
const gallery = noComments(read('src/components/PhotoGallery.tsx'))
check('the photo viewer\'s close button clears the status bar (no fixed top)', /insets\.top/.test(gallery) && !/modalClose:\s*\{[^}]*top:\s*\d/.test(gallery))

// Anything in the app or src that is placed at a fixed `bottom:` is either inside a card or must use an inset. These two files
// place small badges inside a signature pad / photo thumbnail; nothing else may.
const INSIDE_A_CARD = ['src/care/components/SignaturePad.tsx', 'src/care/components/VisitParts.tsx']
const files: string[] = []
const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.tsx?$/.test(e.name)) files.push(p) } }
walk(path.join(root, 'app')); walk(path.join(root, 'src'))
check('the scan found the app\'s screens and components', files.length > 60, files.length)
const fixedBottom = files.map((f) => ({ rel: path.relative(root, f).split(path.sep).join('/'), src: noComments(fs.readFileSync(f, 'utf8')) }))
  .filter(({ rel, src }) => /\bbottom:\s*\d/.test(src) && !INSIDE_A_CARD.includes(rel)).map(({ rel }) => rel)
check('no bar, button or banner is placed at a fixed bottom (only badges inside a card)', fixedBottom.length === 0, fixedBottom)

// ── pushed screens clear the navigation bar through one rule ────────────────
for (const rel of ['app/(details)/_layout.tsx', 'app/(care)/_layout.tsx']) {
  const s = noComments(read(rel))
  check(`${rel}: every screen in the stack is padded by the bottom inset (screenLayout)`, /screenLayout=/.test(s) && /paddingBottom:\s*insets\.bottom/.test(s) && /useSafeAreaInsets\(\)/.test(s))
}

// ── no second top inset under a navigator header ────────────────────────────
// (tabs), (details) and (care) are all drawn under a header that already clears the status bar. Their screens must not
// wrap themselves in a SafeAreaView, which added the status-bar height again and left a gap under every header.
const underHeader = files.map((f) => ({ rel: path.relative(root, f).split(path.sep).join('/'), src: noComments(fs.readFileSync(f, 'utf8')) }))
  .filter(({ rel }) => /^app\/\((tabs|details|care)\)\//.test(rel) && !/_layout\.tsx$/.test(rel))
check('there are screens under a navigator header to check', underHeader.length > 30, underHeader.length)
check('none of them wraps itself in a SafeAreaView', underHeader.every(({ src }) => !/\bSafeAreaView\b/.test(src)), underHeader.filter(({ src }) => /\bSafeAreaView\b/.test(src)).map((x) => x.rel))
// The screens that have NO header (sign-in, the not-available and wrong-app screens) must keep their own insets.
check('sign-in keeps its own SafeAreaView (it has no header)', /\bSafeAreaView\b/.test(read('app/(auth)/login.tsx')))
check('the not-available and wrong-app screens keep their own SafeAreaView', (read('src/vertical/WrongAppGate.tsx').match(/<SafeAreaView/g) || []).length === 2)

// ── a horizontal scroller in a column does not take the list's height ───────
const chips = noComments(read('src/components/FilterChips.tsx'))
check('the filter chips\' horizontal ScrollView has flexGrow 0', /<ScrollView[\s\S]*?style=\{styles\.scroller\}/.test(chips) && /scroller:\s*\{\s*flexGrow:\s*0\s*\}/.test(chips))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
