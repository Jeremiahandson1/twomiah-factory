# The store's website design (2026-10-27)

Branch `cloud/store-looks`, from `engine` (26fc980). A store chooses a look like any business, the shop pages look right in
every look, and there is one new look made for shops: **Market**.

## What was wrong (seen in the renders before any change)

`store.css` (the shop's styles) was added to the stylesheet *after* the design and *unlayered*, so on a store it beat the
whole look. In the three looks, before: the shop page was a flat white sheet whatever the look; in dark mode the page
heading and product names were cream-on-white (unreadable), prices likewise; the header cart icon was dark-on-dark in
Foundry (1.05:1). (Seen in renders on the real server before any change; those first renders are not committed.)

## What changed, and why

- **The fix is at the rule, not per look** (`apps/unified/server/site/routes.ts`, `siteStylesheet`): for a whole look
  the shop's styles go inside the same `@layer base` as the base `main.css`, after it, so the look's own rules win over
  them as they do over every other base rule. A design that is not whole keeps the shop after it, as before.
- **The shop's surfaces are tokens** (`site/public/styles/store.css`, 60-odd hard-coded greys/whites → `--store-page`,
  `--store-card`, `--store-tint`, `--store-line`, `--store-edge`, `--store-danger`, `--store-ok`…). Defaults are the old
  colours, so `classic` renders as before. `site/designs/_whole.css` points them at each look's own surfaces (light and
  dark), gives the owner's colour its ink on the cart count, featured badge and chosen option, and the look's readable form
  for words. New: a size for the review form's button (it drew as a thin bar).
- **The shop gets each look's character** (a section at the end of `foundry.css`, `heritage.css`, `studio.css`): Foundry
  hard plates with offset shadows and uppercase stock names; Heritage arched windows for each product, serif names, round
  buttons; Studio soft rounded panels, mono prices, glow. Foundry's header cart now uses the steel header's own ink.
- **New look `market`** (`site/designs/market.css`, a row in `SITE_DESIGN_SPECS`, `choosable: true`, so it is offered at
  signup and in the preview). Product-first and photography-led: edge-to-edge, tall 4:5 frames on a warm grey ground, no
  boxes or shadows around a card, prices in Bricolage Grotesque you can read across the room, a full-width **+ Add to cart**
  in the owner's colour, a vertical thumbnail strip on the product page, uppercase small-caps labels, a black header
  with a black "Get in touch". Type Bricolage Grotesque + Albert Sans. It styles every section the other three do, so it
  works for other trades (rendered on the contractor samples). It looks like a different company: no arches, no
  hard plates, no glass pill; square photographs and one strong button.
- **A store starts in Market** (`verticals/store/settings.ts`, was `classic`); the owner can pick any look in website
  settings.

## Rendered (88 images, all opened) — `docs/store-looks/<page>-<look>-<width>-<mode>.png`

A real unified server (store vertical, in-memory database) with 8 made-up products (Camp Mug, Field Watch…) with photos
from images.unsplash.com, variants (the tee has four options, one sold out), a composed home (hero + the live products +
a call to action), and an order. Pages: `home`, `shop`, `product`, `cart` (two items, put into the browser's cart),
`receipt` (an order); looks foundry, heritage, studio, market; 1440 and 390 (iPhone 13 emulation); light and dark = 80.
Plus the **contractor sample** `composition-a` and `composition-b` in market at 1440/390, light/dark = 8
(`contractor-a-market-…`, `contractor-b-market-…`).

Contrast, measured in the browser (text hidden, pixels behind each element, worst 2nd percentile; controls at rest, hover,
focus): **no text under 4.5:1 on any of the 88**. Controls: the only readings under 4.5 are `.service-card` on the
contractor sample in market (1.0–1.2): the measured box is the whole card including its photograph; the card's title is
`#121212` on white (or its dark equivalent). Everything else, including the cart icon, "Add to cart", variant options,
quantity buttons, Apply, Checkout: 4.5 or better in every state. Defects found and fixed during this: Foundry's header
cart (1.05), Market's hero title over a photo (1.8 → fixed with a darker scrim), Market's hero label (the repo's
hero-label guard caught it: own dark ground, white text), Market's split hero cut its stats off, Market's three-card
services row left a gap.

Not rendered / not exercised: the order pages (`order/page`, `order/done`, a bar's) in the new look — they share the
base styles under the look but I did not render them; a store with a logo image in the header; a store whose
subscription has ended (the unavailable page); sold-out *product cards* in the grid (one option is sold out on the tee's
page; no whole product is). The ZIP/pickup/gift-card cart panels were not opened beyond what the cart shows by default.
The sample pictures are the stock photos named above, not a real catalogue.

## Tests

- `tests/site-whole-looks.test.ts`, new block "a store's shop pages sit under a whole look, not over it": the shop's
  styles are inside the base layer for every whole look (and none of them is left unlayered after the look); a design
  that is not whole keeps the shop after it; no shop → no shop styles; every surface the shop paints is a token and
  `_whole.css` points each token at the look's surfaces; any brand colour gives the shop its ink; market is choosable and
  the store vertical starts in it.
- `site-parity.test.ts` unchanged and passing (42/42): it compares the base `main.css`, which was not edited.
- Updated on purpose: the list of designs the settings offer (`site-admin.test.ts`), and the choosable list
  (`signup-look.test.ts`), both now include `market`.

## Files changed

`apps/unified/server/site/routes.ts`, `apps/unified/server/core/vertical.ts`, `apps/unified/verticals/store/settings.ts`,
`apps/unified/site/public/styles/store.css`, `apps/unified/site/designs/{_whole,foundry,heritage,studio}.css`,
`apps/unified/site/designs/market.css` (new), tests `site-whole-looks`, `site-admin`, `signup-look`, `docs/store-looks/`.

Not this repo's job: the Factory refuses store signups until `store` is added to `UNIFIED_LIVE_VERTICALS`. Also: the
free preview offers whatever is `choosable`, so **Market now appears there too** — twomiah.com decides whether to show it.
