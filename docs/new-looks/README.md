# Three new looks for a contractor site (2026-10-27)

Three whole looks, built from scratch on the shared section library. Nothing from the old standard or premium looks was
reused. No section file was added or changed. Pick one (or none) and say what to change; nothing else is built yet.

Renders: `<design>-<sample>-<width>-<mode>.png`. Samples are the premium contractor's `composition-a` (full-bleed hero,
alternating services, split CTA) and `composition-b` (centred hero + stat band, split hero, card-grid services, banner CTA),
photos from images.unsplash.com. Widths: 1440 desktop; 390 is iPhone 13 device emulation (touch, mobile user agent).
Light and dark are the visitor's device setting (`prefers-color-scheme`). All 24 are full page, and each was opened and
looked at.

## Foundry — `foundry`
**Suits** a contractor who works with their hands: remodellers, framers, roofers, concrete and site work, anyone whose
customer wants to see a crew that shows up. **Type:** Barlow Condensed (stamped capitals for headings), Barlow (text),
IBM Plex Mono (labels and numerals). **What makes it different:** poured-concrete grounds on a blueprint grid, a steel-black
header with a brand-colour rule, hard square plates with offset block shadows that press down when clicked, 150px
service numerals, a hazard-stripe signature (hero foot, CTA, footer), spec-sheet checklists. The owner's colour is every fill,
the stripe and the offsets, and in dark mode the numerals and stat figures use its light form.

## Heritage — `heritage`
**Suits** a builder who sells permanence: custom homes, restoration, high-end renovation, finish carpentry, family firms
with decades behind them. **Type:** Instrument Serif (display, with italics) and Hanken Grotesk (text). **What makes it
different:** warm paper and a serif that reads like a book; a centred masthead; arched windows for every picture and the
hero; hairline rules instead of boxes; services as numbered "chapters" ("No. 01"); pull-quote testimonials; a colophon
footer. The dark bands are the owner's colour mixed into near-black, so a green brand gives a green-black footer and a
rust brand a brown one.

## Studio — `studio`
**Suits** a design-build or modern remodelling firm that sells to people who found it online: ADUs, additions, kitchens and
baths, new-build specialists. **Type:** Plus Jakarta Sans (tight, heavy headings) and DM Mono (numerals, labels).
**What makes it different:** a floating glass header pill, an inset rounded hero photograph with a frosted text card,
services as a bento (the first card double-size), each alternating service one rounded panel with a brand-colour index
chip, stats as cards, dark rounded panels with a faint glow of the owner's colour for the CTA, stats and footer, pill-shaped
footer links.

## Readability — measured in the browser
- **Text on its own background:** each page was rendered in a headless Chromium, with the text hidden to capture the actual
  pixels behind every text element; the real text colour is then compared to the 2nd-percentile (worst) contrast of those
  pixels. A long page with every section the contractor looks restyle (hero ×3, story, services ×2, projects, gallery, team,
  testimonials, stats, FAQ, financing, booking card, trust, areas, contact, CTA ×2), per look × light/dark × 1440/390,
  ~180 text elements each. **Nothing under 4.5:1**, except 2 footer links
  (`Privacy`, `Terms`, Foundry at 390 only) measured at 4.49:1 — 0.01 short on 14px mono text, left as is, listed here.
  Large text is held to 3:1; none of it needed that.
- **Hover / press / focus:** buttons, nav, links, cards, area chips, FAQ rows, footer links were rested, hovered, pressed
  and focused (68 control states per look and mode) and measured the same way. **Nothing under 4.5:1** in any look, light or
  dark. (An early sweep flagged FAQ rows: that was my sampling box including the `+` badge's fill, not the question text;
  re-measured with the badge excluded.)
- **Brand colours tried:** `#b45309` (the sample's), `#facc15` (a bright yellow), `#0b3d2e` (a very dark green), `#e11d48`
  (red), light and dark, on the full page. Zero text under 4.5:1 in each. `foundry` with yellow and `heritage` with dark
  green were rendered and looked at too (not committed).
- Text over a photograph (hero titles, gallery captions) sits on a dark scrim or a solid dark chip, never on the picture alone.

## Files changed, and why
| File | Why |
|---|---|
| `apps/unified/server/core/vertical.ts` | **Separates the two ideas.** `COVER_DESIGNS` (a name list meaning both "whole look" and "the bar's leather-book frame") is replaced by `SITE_DESIGN_SPECS`, one row per design: `build: 'overrides' \| 'whole'` (is the stylesheet laid over the base as a CSS layer?), `frame?: 'book'` (does the page wear the bar's cover?), `fonts?`, `schemes?`. The bar is `whole` + `book`; the new looks are `whole` with no frame. `SITE_DESIGNS`, `SITE_DESIGN_LABELS` come from it. |
| `apps/unified/server/site/context.ts` | Reads the spec: `options.cover` is now "the book frame" only; adds `options.fonts` and `options.schemes`. |
| `apps/unified/server/site/routes.ts` | `siteStylesheet` layers the base under any `whole` look (not only the bar) and fills more of the owner's colour: `{{PRIMARY_COLOR_ON_LIGHT}}`, `{{PRIMARY_COLOR_ON_DARK}}`, `{{ACCENT_COLOR_ON_DARK}}` (a look may use the brand as text on light or dark). The existing tokens are unchanged. |
| `apps/unified/server/core/brandColour.ts` | `ensureLight`: the mirror of `ensureDark`, for brand colour as text on near-black. |
| `apps/unified/site/views/base.ejs` | A whole look with no frame takes the standard page and brings only its own Google Fonts stylesheet (in place of Inter + Fraunces) and `color-scheme: light dark`. The book frame code is unchanged and still runs only for `frame: 'book'`. |
| `apps/unified/site/designs/{foundry,heritage,studio}.css` | The three looks. ~330 / ~290 / ~300 lines. |
| `apps/unified/tests/site-whole-looks.test.ts` | **New guard.** Only the bar has the book frame; no server code chooses by a design's name; a frameless whole look has no leather book, no self-hosted bar fonts, its own fonts; every colour token is filled for four brand colours; each look restyles for dark, uses the owner's colour as text only through its readable forms, and pairs every brand fill with the ink that reads on it. |
| `apps/unified/tests/site-admin.test.ts` | One expectation updated on purpose: the designs the settings offer now include the three new ids. |
| `docs/new-looks/` | This README and the 24 renders. |

`site-parity.test.ts` was not edited and passes (42/42). The bar renders the same as before (its tests pass; the leather
book is still drawn from the same rows).

How the separation works: nothing in the app branches on a design's name; `context.ts` reads the row, `routes.ts` reads
`build`, `base.ejs` reads `siteOptions.cover` (frame), `siteOptions.fonts` and `siteOptions.schemes`. The guard test fails
if someone writes `design === 'foundry'` anywhere in `server/`.

The three looks are in `SITE_DESIGNS`, so they already appear in the owner's website settings (`/api/site/designs`) and are
accepted by `site.design` and by provisioning. Nothing sets them as a default for any trade yet.

## Checks run before the push
- `tests/site-parity.test.ts` 42/42; `site-whole-looks` 7/7; `site-hero-label`, `site-phone-width`, `site-ink-on-brand`
  pass for all 11 designs; `site-admin` 19/19.
- Site tests (`site-*`, `bar-*`, `restaurant-live-1025`, …): 151/152 on a rerun with `--timeout 120000`; the one failure was
  the designs-list expectation above, fixed. Without the longer timeout, four files (`site-admin`, `site-routes`,
  `site-drafts`, one `site-section-fields` block) stop at their `beforeEach` (database setup, 5 s) in this sandbox. The same
  files stop the same way on the untouched `engine` (checked), so that is the environment, not these changes.
- All eleven `scripts/check-unified-*.ts` pass (the fence check needed `origin/main`, fetched read-only).
- `bun run build:web` in `apps/unified`: built.

## Known, and anything that didn't render
- **Fonts are loaded from Google Fonts**, like the base's Inter and Fraunces; the sandbox could reach them. A visitor with
  fonts blocked sees the fallback stacks (Arial Narrow/Impact, Georgia, system sans); layouts still hold.
- **Not exercised:** sections that need live data (the instant estimator widget, the Visualizer, the live inventory, the
  store and menu pages), the booking pages, and the blog post page. The three looks restyle the base's classes for them but
  I did not render those pages. The estimator/visualizer sections carry their own inline styles that the looks do not touch.
- **Unsplash sample photos** are the premium template's; one (a monitor with code) is not a building, which is the sample's.
- **Phone nav:** the hamburger opens the existing menu script; the open menu itself was not photographed.
- **Dark mode is the device setting.** There is no per-site Light/Dark switch; the bar's `settings.theme` applies only to the book frame.
