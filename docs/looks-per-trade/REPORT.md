# Do the three new looks suit the other open trades? (2026-10-27)

Render and report only. Nothing outside `docs/looks-per-trade/` was changed (no CSS, no looks, no sections). Branch
`cloud/looks-per-trade`, started from `cloud/new-looks-contractor` (9920e6a).

## What was rendered

- **Files:** `<trade>-<look>-1440.png` (desktop, light), `<trade>-<look>-390.png` (iPhone 13 device emulation, light),
  `<trade>-sheet.png` (the three looks side by side, desktop). 8 trades × 3 looks = 48 pages + 8 sheets.
- **Sources of content.** roofing, fieldservice, landscaping, homecare, foodtruck, showcase: the premium template's
  `data/samples/composition-a.json`, through `renderSections` with the design set to each look. salon and basic
  ("Other"): `composeInstant` (`apps/api/src/services/instantComposer.ts:200`), made-up businesses "Maple & Thread Hair Studio,
  Eau Claire" and "Lakeside Print & Copy, Duluth", services listed.
- **Extra files, not asked for: `<trade>-<look>-sections-1440.png` (24).** `composition-a` has only three sections (hero,
  services, CTA), so it cannot show how a look styles the trade's own sections (menu, hours, care, packages…). So I
  also rendered one long page per trade-and-look with the sections the trade's page plan uses, filled with made-up content
  (`sectionComposer.ts` `pageRecipesFor`, `TRADE_SECTION_VERTICALS` in `server/site/tradeSections.ts`). Section problems
  (b) below point to these. Desktop only.
- **Contrast** was measured the same way as the contractor survey: each page rendered, text hidden to capture the pixels
  behind every text element, the real text colour compared with the 2nd-percentile contrast of those pixels; light and dark;
  desktop for all, plus phone for the `composition-a`/instant pages (120 page-modes). Under 4.5:1 is listed (3:1 for text
  24px+ or 18.66px+ bold). Dark mode was measured, not photographed (the deliverable images are light only).
- **I opened every committed image.** Several reads of the roofing, fieldservice, landscaping and homecare images
  returned only their size at first; I re-opened those four sheets afterwards and saw them. The per-look 390 and 1440 files of
  those four trades I judged from the sheets plus their measurements, not each one at full size.

## Things that are the sample's, not the looks'

- **Broken sample photos.** Many `images.unsplash.com` ids in the premium samples return 404 today (roofing 4 of 5, landscaping
  4 of 5, homecare 3 of 6, fieldservice 1 of 6; foodtruck and showcase fine). They show as empty grey/cream boxes
  (landscaping and roofing service rows, the split CTA), and a hero with no picture is a plain gradient. This is the same in
  all three looks. On the hand-built section pages I replaced dead ids with live ones; a roof and a house stand in for "before
  and after", which looks odd but is only stand-in content.
- **`showcase` = `foodtruck`.** `templates/website-premium-showcase` and `-foodtruck` share the same sample (a dinner house),
  so those two trades' pages are identical except the name. They are reported once below.
- **salon and basic have no hero picture.** `composeInstant` falls back to a library photo only when `TWOMIAH_FACTORY_URL`
  (or `FACTORY_PUBLIC_URL`) is set (`apps/api/src/config/heroLibrary.ts:141-143`); here it isn't, so the home is the
  centred hero with no photo and one title-only card per service. Not worked around, as asked. It is also what a signup
  with no photos gets today.

## One problem in all three looks, before the trades

**Foodtruck/showcase/salon/basic sections run into each other, and into the header.** `menu/cards`, `schedule/week-strip`,
`deals/strip` and `catering/inquiry-form` have no padding of their own: their wrappers are `<section class="menu menu--cards">`
(`menu/cards.ejs:18`), `schedule schedule--strip` (`schedule/week-strip.ejs:20`), `deals deals--strip` (`deals/strip.ejs:11`),
`catering catering--inquiry` (`catering/inquiry-form.ejs:19`), and `site/public/styles/main.css` has no `.menu`, `.schedule`,
`.deals` or `.catering` rule (only `.menu--cards .section-head`, `main.css:851`). The old premium CSS carried them. Result
in every look: a section's heading sits right under the grid above it ("Where we are this week" touching the menu cards)
and the first section's heading sits against the header. Screenshots: `foodtruck-*-sections-1440.png`,
`showcase-*-sections-1440.png`, `basic-*-sections-1440.png`. Roofing, fieldservice, landscaping, homecare and salon
use sections that do have padding, so they look right.

Also in every look: **homecare's Aa / Aa+ / Aa++ toggle sits on top of the header's button** (`.text-size-toggle`
is `position: fixed; top: 16px; right: 16px; z-index: 100`, `main.css:926`; the looks' headers put their button in that corner).
It measures 1.0:1 where it covers "Get in touch" (`homecare-foundry-1440` header button; `homecare-foundry-390` brand name on phone).

## Per trade

### roofing — `roofing-*-sheet.png`
a. **foundry: yes.** Dark steel, stripes and big stamped capitals read as storm crew; the "Storm damage? Don't wait" CTA is
the strongest of the three. **heritage: no.** The arched window and soft serif suit a premium builder, not a 48-hour storm-response
roofer. **studio: partly.** Clean and modern, reads as a tech-forward roofer; less urgent.
b. Sections (`roofing-*-sections-1440.png`): `banner/storm-alert` is the only section that breaks, in dark mode (see c).
`quote/instant-address`, `before_after/slider`, `financing/calculator`, `trust/badges` and `faq` all render cleanly in the three
looks. Before/after slider is a fixed light panel (`before_after/slider.ejs:62`, `.ba-section { background: var(--surface, #faf9f6) }`)
in every look, so on Foundry's concrete it is a cream block that does not match.
c. Under 4.5:1: dark mode only. `storm-alert__heading` "Storm damage?" 1.11 (dark text on the dark banner: base
`.storm-alert__heading { color: var(--white) }`, `main.css:781`, and the looks re-point `--white` to the card colour);
`ba-section__title` 1.09, `ba-meta__caption` 1.0, `ba-meta__sub` 2.3, `ba-section__intro` 2.3 (`before_after/slider.ejs:64,86-87`: the
panel stays light, the text colour follows the dark theme); `quote__estimate-amount` 2.31 (brand-coloured). Light mode:
none on the composition-a page.

### fieldservice — `fieldservice-*-sheet.png`
a. **foundry: yes.** Blue-on-black with a hazard stripe and "Call 608-555-4477" reads as a working crew. **heritage: no** for the
same reason as roofing (a serif colophon for a 2 a.m. plumber). **studio: yes.** Reads as a modern HVAC/plumbing company.
b. `emergency/bar`, `service_area/zip-check`, `pricing/flat-rate-menu` (price cards look good in all three), `trust`, `faq`
render cleanly; the emergency bar is the base's dark gradient in every look (fine in light).
c. Light: `ba-meta__material` ("Architectural shingle") 2.04:1 in all three looks (`before_after/slider.ejs:88`:
`color: var(--accent, #c89a4e)`, the amber accent on the light panel). Dark: `emergency-bar__heading` "No heat? No water?"
1.1–1.2 (`main.css:615`, `color: var(--white)`, same cause as the storm alert), plus the before/after rows as above.

### landscaping — `landscaping-*-sheet.png`
a. **foundry: no.** Concrete grey and hazard stripes are wrong for lawns and gardens. **heritage: yes.** Cream paper, arches and a
green-black footer feel like a design-led garden firm. **studio: yes.** Fresh and clean.
b. `packages/seasonal` renders cleanly in all three (cards, "In season now" chip, "Most popular"); `quote/instant-address`
needs a Mapbox token for its map and shows a dark empty map box; `gallery`, `testimonials` fine.
c. Light: none on composition-a. Dark: `package-card__badge` "In season now" 3.37 (11px white-ish on brand green,
`main.css:759`, `color: var(--white)`); the before/after rows as above.

### homecare — `homecare-*-sheet.png`
a. **foundry: no.** Black bands, hazard stripes and condensed capitals are not a warm, reassuring tone for families choosing care.
**heritage: yes.** The warmest of the three. **studio: yes.** Calm and modern. (The brief says home-care imagery never implies
medical/skilled nursing; the sample's own stock photos include a white-coat figure and a stethoscope. Those are the sample's.)
b. Sections (`homecare-*-sections-1440.png`): `care/finder` (the wizard card), `caregivers/grid` (filter chips and profile cards)
and `coverage/insurance-guide` all render and read well in all three. In Foundry the card's rounded white boxes are the only soft
shape on the page; in Heritage, `.cov-card` / `.cg-card` do not get the arched/hairline treatment, so these three sections look like
the base's cards rather than the look's. **The text-size toggle overlaps the header button** (above).
c. Light: the toggle overlap only (`header-cta` 1.0, `brand` 1.12 at 390). Dark: `cg-card__years` 3.1–3.4, `cf-progress__step is-current`
3.1–3.4, `cg-chip is-active` 3.1–3.4, `cov-card__row-label` "Our role" 3.4–3.6, `is-active` "Aa" 3.1–3.4: text coloured `var(--brand)` /
white on the brand colour that is dark (`main.css:714,673,702,731`).

### foodtruck and showcase — `foodtruck-*-sheet.png` (showcase's is the same page with a different name)
a. **foundry: yes for a food truck** (street-poster energy, numbered courses), **but** the sample is a dinner house, where it feels
loud. **heritage: yes**, the best fit for the sample's dinner house, and good for a café or restaurant. **studio: yes**, a polished
modern restaurant.
b. `menu/cards`, `schedule/week-strip`, `deals/strip`, `catering/inquiry-form`, `reservation/widget` all render and are legible, **but**
section spacing is missing (above), and the menu grid leaves a half-empty last row (`menu__grid`, `main.css:854`, cards of unequal
height: "Charred corn cup" is a tall empty card next to two photo cards). In Foundry and Studio the reservation widget card is a plain white box
(Foundry gets the offset shadow). In Heritage the diet chips and day tags (`menu__chip`, `schedule-strip__tag`) keep the base's pastel colours.
c. Light: `deals__expires-label` "Ends Sunday" 4.34 on Foundry (11px, brand colour on concrete). Dark: `menu-item__price`,
`schedule-strip__date`, `deals-card__title`, `deals-card__badge`, `catering__sidebar-num` 2.9–3.6 on Foundry/Heritage/Studio; 1.8 on
showcase (a dark brown brand, `#7c2d12`, as text on the dark card: `main.css:607,861`, `color: var(--brand)`). So dark mode fails more
the darker the owner's colour is.

### salon — `salon-*-sheet.png`
a. **foundry: no.** Industrial for a hair studio. **heritage: yes**, elegant and boutique. **studio: yes**, fresh and current.
b. Instant site: every look shows title-only cards (the stand-in service names). Foundry's number tag lands on the first letter ("01"
over "HAIRCUTS" so it reads "AIRCUTS"): `foundry.css:139` `.service-card::before` is absolutely positioned at top-left and, without a
photo, the title starts there. Studio's first-card-double-size rule (`studio.css:139`) makes a big empty "Haircuts" card.
Heritage has no card at all (plain centred names) which looks bare. Sections (`salon-*-sections-1440.png`): `pricing/flat-rate-menu`,
`team/grid`, `reservation/cta`, `testimonials` fine; `before_after/slider` as above (a cream panel).
c. Light: foundry `service-card__title` 1.0 on the instant page for the four service names (the tag covering them), 2.97 on
"Colour & Highlights". Dark: `pr-card__price` 2.8, before/after as above.

### basic ("Other") — `basic-*-sheet.png`
a. A neutral business with no trade tone: **studio: yes**, the best neutral. **heritage: yes**, for any boutique or professional
shop. **foundry: yes only for hands-on trades** (a print shop looks fine; a law office or café would not).
b. Instant site: same title-only-card problems as salon (Foundry tag over the first letter: `foundry.css:139`; Studio big empty first
card: `studio.css:139`). Sections (`basic-*-sections-1440.png`): the section-spacing problem hits `menu/cards`, `deals/strip`,
`schedule/week-strip` here (headings against the card above); `team/grid` with one person leaves a lone card on the left in all three.
c. Light: foundry instant `service-card__title` 1.0 (tag overlap) for "Banners", "Copies", "Custom Signs"; foundry sections page
`section-title` "What we print" 1.05 (heading against the header, see above). Dark: `menu-item__price`, `deals-card__title`,
`schedule-strip__date` 2.85–3.1.

## Summary

| Trade | Look that fits | Others | Needs its own look? |
|---|---|---|---|
| roofing | **Foundry** | Studio partly; Heritage no | No. Fix: storm alert in dark mode |
| fieldservice | **Foundry**, **Studio** | Heritage no | No. Fix: emergency bar heading in dark mode |
| landscaping | **Heritage**, **Studio** | Foundry no | Not required. A green, natural look would suit it better than any of the three (my judgement; none of the three is wrong) |
| homecare | **Heritage**, **Studio** | Foundry no | No, but fix the Aa toggle overlap first |
| foodtruck | **Heritage** (dinner house), **Foundry** (truck), Studio | | No. Fix: section spacing |
| showcase | same page as foodtruck | | No. Fix: section spacing |
| salon | **Heritage**, **Studio** | Foundry no | Probably: none of the three is beauty-led and no photo-less version is strong (my judgement) |
| basic | **Studio**, Heritage | Foundry for hands-on trades only | No. Studio as the neutral default |

## Fixes the looks and base need regardless of the pick (nothing done here)

1. Section padding for `menu`, `schedule`, `deals`, `catering` (base `main.css`, or each look).
2. Home-care text-size toggle vs the header button (`main.css:926`, and the looks' header corner).
3. `before_after/slider.ejs:62,86-88` hard-codes a light panel and the accent as text; in dark mode the text follows the theme and
disappears, and the amber accent is 2.0:1 on the panel even in light.
4. In dark mode, text coloured `var(--brand)` and white-on-`--white` use in the base (`main.css:607,614-615,673,702,714,731,759,781,861`)
fail for dark brand colours; the looks re-point `--white` to the card colour, which is what turns white-on-dark text dark.
5. Title-only service cards in Foundry (number tag over the first letter, `foundry.css:139`) and Studio (empty first card, `studio.css:139`).

## Not rendered / not checked
- Phone for the hand-built section pages; dark mode as pictures; light/dark on the two instant pages' hover states.
- The live-data sections (Mapbox maps, store, live menu, inventory) and the pages that are not the home page.
- A real owner's photos: salon and basic would look different with a hero photo.
- `composeInstant`'s other pages (services, about, contact) for salon and basic; only the home page was rendered.
