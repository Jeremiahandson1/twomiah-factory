# Looks fixes — foundry, heritage, studio (2026-10-27)

Branch `cloud/looks-fixes`, from `cloud/looks-per-trade`. 246 renders in this folder, named
`<page>-<look>-<width>-<mode>.png` (1440 desktop; 390 is iPhone 13 device emulation; light and dark are the visitor's
device setting). No section file was added or changed.

## What was fixed, and where it lives

| # | Defect | Where it lived | Fix |
|---|---|---|---|
| 1 | Menu, week strip, deals strip and catering form had **0px padding** (measured in a real browser first) and ran into each other and the header | **Base** — every design | `main.css:857` gives `.menu--cards, .schedule--strip, .deals--strip, .catering--inquiry` the standard section padding |
| 2 | Text-size buttons sat top-right, over the header button | **Base** | `main.css:933` moves them to bottom-right (phone: smaller, tucked in). Measured: they overlap no header control in any of the 12 homecare-home renders |
| 3 | Dark mode: storm banner, emergency/urgent bars, before/after slider unreadable; brand-coloured prices, dates, chips, check marks and buttons unreadable for some owner colours | **The three looks** (they flip surfaces for dark) | New shared sheet `site/designs/_whole.css`, laid in by `siteStylesheet` for the frameless whole looks only. Brand-as-text uses `--brand-text` (built from `_ON_LIGHT` / `_ON_DARK`); text on a brand fill uses `INK_ON_PRIMARY` / `INK_ON_ACCENT`; the fixed dark bars use `#ffffff`; the before/after chips and caption colours use the look's tokens (doubled class, because the section's own `<style>` comes later) |
| 4a | Foundry: number tab covered the first letter of a title-only service card | Foundry | `foundry.css:139` — the tab is in the flow above the title, not absolutely positioned |
| 4b | Before/after amber label 2.04:1 | Looks | `.ba-meta__material` → `--brand-text` (now ≥ 4.5:1 in both modes) |
| — | Studio: a title-only first service card became a huge empty bento tile | Studio | `studio.css:139-142` bento only when the card has a picture |

Found while rendering the new pages, and fixed:

- **ZIP check button ran off a 390px phone** (`service_area/zip-check`): the flex input had no `min-width: 0`. Base: `main.css:644`.
- **Care finder pushed the page to 446–461px wide on a phone** (all three looks): its 5-step progress row was wider than the card. Base: `main.css:676`; on a phone only the current step keeps its label. Page is now 390 wide in all six homecare-sections renders.
- **Financing slider thumb vanished in dark mode** (a look flips `--white` to dark; the card stays dark): `_whole.css` pins the thumb white and brightens the track.
- **Heritage booking list**: duration/price line stayed left under centred cards: `heritage.css:141`.
- **Estimator widget** (Shadow DOM, `estimator.ts`): in dark mode the browser painted its inputs dark inside a white card; the card is now `color-scheme: light` with explicit input colours. Its detail and disclaimer text was 4.31:1; now `#4b5563`.
- Booking `Cancel`/danger button (white on red), the "you're booked" tick (white on #22c55e, 2.3:1) and the `Book →` link in dark.

## Pages nobody had rendered, and how

All through the **real server** (`apps/unified`, in-memory PGlite, `tests/harness.ts` boot plus a seeded roofer with services, hours, a booking and blog posts), not mocked pages:

- Booking: `/book` (list), `/book/<slug>` (picker, with and without the tips step), `/book/done?token=` and `/booking/<token>` (manage).
- Blog: `/blog` and `/blog/<slug>`.
- Roof estimator section (`tools/estimator.ejs` + `/estimator.js`). It needs Google geocoding and the Solar API, which need keys that do not exist here, so those two calls were **stubbed** to return a fixed roof, and outbound email ran in dev mode. The page, widget, form and result are real; the *numbers* in the result are from the stub.
- Open phone menu (390 only, the hamburger clicked).
- The other pages (`*-sections`, `*-home`, `bars`) are the hand-built section pages from the earlier tasks, re-rendered from the final CSS.

Nothing could not be rendered. Sample-data note: the landscaping packages show `$$189` because my sample JSON contained the `$` and the view adds its own. That is the sample, not the look.

## Contrast (measured in the browser)

Method: page rendered, all text made transparent (Shadow DOM too), pixels behind every text element captured, real text colour compared to the worst (2nd-percentile) pixel; large text held to 3:1. Controls (buttons, links, chips, cards, form fields) measured at rest, hover and focus the same way.

- Text: **0 elements under 4.5:1** on all 246 renders (about 14,500 elements), in the final CSS.
- Controls: **0 under 4.5:1 at hover or focus.** Five rest-state readings stay under, and I checked them one by one — all are the measuring box, not the text:
  - `.service-card` "Haircuts" 2.97 (salon-home foundry, 1440 and 390 light): the box is the whole card, and its number tab is a pink fill; the title itself is `#15171a` on white, far above 4.5.
  - `.btn--ghost` "How we match caregivers" 1.0 (homecare-home foundry and studio, 390 light) and `.btn--primary` "Schedule a free consultation" 1.07 (heritage 390 light): the button sits over the hero photograph; the sampled box includes the picture, not the button face. Looked at in the render: white text on a solid fill / dark glass.
  - Earlier `.service-card` flags in the phone-menu and booking-list renders: same cause, whole card including its photo.
- Before the fixes, from the survey: before/after amber label 2.04, storm/emergency headings and before/after captions 1.0–2.3, estimator detail 4.31.

## Looked at

Every image was opened. The tall 390 pages and the large 1440 section pages were looked at as sliced columns of the full-page image (so the detail was legible), and the full set of 12 for each page type was also checked on one overview sheet each. One thing seen and **not** changed: on the first phone screen of homecare the text-size pill sits low-right, over the lower edge of the hero buttons (not over the header, as asked). It is a floating control by design; say if you want it elsewhere.

## Files changed

- `apps/unified/site/public/styles/main.css` (base)
- `apps/unified/tests/site-parity.test.ts` — **changed on purpose**: `.text-size-toggle` is added to `CHANGED` (its position is a deliberate base change, item 2). Nothing weakened; every other rule is still compared.
- `apps/unified/site/designs/_whole.css` (new)
- `apps/unified/site/designs/foundry.css`, `heritage.css`, `studio.css`
- `apps/unified/server/site/routes.ts` (`siteStylesheet` lays `_whole` in, line 95)
- `apps/unified/site/public/scripts/estimator.ts`
- `apps/unified/tests/site-whole-looks.test.ts` (new guard block: section padding, toggle position, shared sheet only in the frameless looks, readable brand-as-text for four brand colours, ZIP box/slider, care-finder steps)
- `docs/looks-fixes/` (this report and 246 PNGs)

## Checks before the push

- `site-whole-looks`, `site-parity`, `site-hero-label`, `site-phone-width`, `site-ink-on-brand`: 70 pass, 0 fail.
- All site, bar and booking tests (23 files): 393 pass, 0 fail (run with `--timeout 120000`).
- All 11 `scripts/check-unified-*.ts` pass (the types check is slow, about 3 minutes; the fence check needs `origin/main`, fetched read-only).
- `bun run build:web` in `apps/unified`: built.
- Sandbox notes (not from these changes): pglite `beforeEach` hooks time out at the 5 s default here, so site tests run with `--timeout 120000` (same on untouched `engine`). `admin-host.test.ts` fails in a combined run because `booking-deposits.test.ts` sets `SITE_URL` globally; it passes alone.
