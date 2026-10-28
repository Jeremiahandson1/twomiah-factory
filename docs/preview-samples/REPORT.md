# The free preview looks like a full site (2026-10-28)

Branch `cloud/preview-samples`, from `engine`. Nothing pushed to `engine` or `main`; no PR.

## What it does

The preview on twomiah.com used to show a hero, one stand-in "What we do" card and a call to action. It now also shows,
**in the preview only**, clearly marked sample sections: services with photos, a gallery, two sample reviews, an about
block and an FAQ (a price list for salon; sample products in the shop grid for a store). A bar across the top says
**"Example content — your real site uses your own services, photos and reviews."**

- **Marked:** reviews are attributed "Sample review" (never a person), prices read "Sample price", gallery captions "Sample
  project/event/moment", store taglines "Sample product — not for sale", and every sample heading ends "(sample)".
- **Where it lives:** `apps/api/src/config/previewSamples.ts` (the sets), `apps/api/src/unified/preview.ts` (adds them
  after `provisionSite`), `apps/unified/server/site/signupPreview.ts` (the banner, own colours: white on #1f2937).
  `provisionSite`, the composers and `signupSite.ts` are untouched.
- **Photos:** real only. The Factory's own stock library (`/hero-library/…`, credited in the page footer through the usual
  credits path) plus Unsplash photos each checked to load (store products, a few restaurant shots). With no library
  address configured a section that needs library photos is left out rather than drawn broken.
- A real service list is never replaced: only a "What we do" holding just the stand-in card is.

## Can it leak? (`tests/unified/factory/preview-samples.test.ts`, 32 tests, none call a live API)

By marker (every sample section has `sample: true`, the real hero/CTA do not, nothing the build makes has one), by text
(no sample sentence in `provisionSite`'s output or the template composer's, for 9 trades), by render (the same page
rendered without samples has no banner and no "Sample review"), and by import (a scan of `apps/api/src`, `apps/unified`
and `packages` finds only `unified/preview.ts` reading the file). `scripts/check-composer-facts.ts` is **not edited**: it
guards the composers, which are unchanged; the leak test is the guard for the samples (it is outside the fence's own list
of editable guard files, so I did not touch it).

## Renders (112, all opened) — `<trade>-<look>-<width>-<mode>.jpg`

contractor, roofing, homecare, salon, restaurant, basic, store × foundry, heritage, studio, market × 1440 and 390
(iPhone 13 emulation) × light and dark. Made from the real `renderUnifiedPreview`. (JPEG, to keep the folder at 36 MB.)

Contrast, measured in the browser: **no text under 4.5:1 on any of the 112** (text hidden, pixels behind each element). Controls at
rest/hover/focus: the only readings under 4.5 are `.service-card` (240): the measured box is the whole card including its
photograph; the card's title is dark on white (or light on dark) — seen in the renders. Same known artefact as the earlier
looks reports.

## Found and fixed while rendering

- **Market on a phone drew a 3-card services row three columns wide** ("renovation / s" broke mid-word). A more specific
  `:has()` rule beat the width rules; `market.css` now makes a short list one column at ≤560px. Market re-rendered after.
- Four cards in a 3-column grid left one alone, and five gallery photos left a gap: sets are 3 or 6.

## Limits, said plainly

- **Salon and basic have no gallery**: the stock library has only two salon photos and two generic ones; I did not invent photo
  ids or reuse the same picture. Salon shows two service photos; basic shows two photos and one text card.
- The hero photo is what the composer already picks (the hero library); the basic/store hero uses a generic shop photo.
- The sample text is deliberately plain ("Sample card: …"): it is repeated across trades, and a real site would not say it.
- Store and basic only reach the preview when the Factory serves those trades through the unified renderer
  (`UNIFIED_SIGNUPS` / `UNIFIED_LIVE_VERTICALS`); I rendered with `UNIFIED_SIGNUPS=all`. Store signups remain refused until
  `store` is live.
- Clicking "Add to cart" on a sample product is not exercised.

## Checks

`preview-samples` 32, `preview-looks` 13 and `signup-look` 5 pass (the pglite tests need `--timeout 120000` in this sandbox,
as before); `site-whole-looks` and `site-parity` pass (68 with signup-look); all 11 `scripts/check-unified-*.ts` pass;
`check-composer-facts.ts` passes (1772); `bun run build:web` builds.
