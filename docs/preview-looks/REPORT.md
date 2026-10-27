# Preview and signup take the visitor's look (2026-10-27)

Branch `cloud/preview-looks`, from `engine` (c6c25f6). A visitor picks Foundry, Heritage or Studio in the free preview;
the signup keeps the choice; the business is built in that look.

## What changed

- **Preview** (`POST /public/preview`, `apps/api/src/routes/factory/intake.ts`). New optional `design`. For a trade the
  unified app is open to, the page is drawn by the unified renderer — the page a signup really gets — in that look.
  - "Open to": decided exactly as a real signup of that trade is (`UNIFIED_SIGNUPS` + `UNIFIED_LIVE_VERTICALS`,
    `unified/preview.ts unifiedPreviewVertical`). Every other trade (vet, RV, dispensary, store…) keeps today's preview.
  - No `design`: the trade's own default look. A `design` that is not foundry/heritage/studio: refused, 422 "Unknown design."
  - The cache key includes the look. Rate limit, in-flight cap and angle-bracket stripping are untouched.
- **Signup** (`POST /public/signup`). Same `design`, same validation (400 on a bad one, before anything is written). Kept
  with the signup at `intake_data.signup.design`; `provisionSite` (`unified/factory.ts chosenLook`) puts it into the
  provision body's `site.design`, and `writeStartingSite` (`apps/unified/server/modules/provision.ts:92`, which already
  took `design`) writes it to `website.design`. No change was needed in the unified build.
- **One list of looks.** `SITE_DESIGN_SPECS` rows get `choosable: true` (foundry, heritage, studio);
  `SITE_LOOKS` and `siteLookOf` read it. The Factory asks the unified app (`config/siteLooks.ts`) instead of keeping
  its own list, so a fourth look is one row.
- **The renderer** is `apps/unified/server/site/signupPreview.ts` (not `site/preview.ts`, which is the website editor's
  preview). It builds the same context a request would, runs `renderSections` and `siteStylesheet`, inlines the
  stylesheet and points links/forms nowhere. A test holds its settings keys equal to a real request's.

## The dependency question — proved, not assumed

Clean clone of this branch, then exactly Render's build, `cd apps/api && bun install`:
the unified app's own dependencies are installed in `apps/unified/node_modules` (ejs 3.1.10, drizzle-orm,
`@twomiah/tenant-backend` linked), and from `apps/api` the renderer imports and runs (`renderSections`,
`siteStylesheet`, all 11 designs). So no stop was needed. The renderer is imported when the first preview asks, not at
Factory start, so a problem in it fails a preview and never the Factory's boot. A new test fails if the unified server
ever imports a library the unified app does not declare itself.
Not checked: a real Render deploy (this is a clone of the same install command on the same Bun).

## Tests (none call a live API)

- `tests/unified/factory/preview-looks.test.ts` (13): the preview draws each look (and no other look's fonts);
  home care and a restaurant too; cache key per look; no look = the trade's default; bad values (`nonsense`, `bar`,
  `classic`, a number, an object) refused; a closed trade (vet) keeps its preview; the seventh preview from one address
  is 429; markup in a name is stripped; a bad signup design is refused with nothing written; the signup stores the design;
  the provision body carries it and the unified schema accepts it; and the Factory's body provisioned into a real
  unified app (in-memory database) leaves `website.design = 'studio'` and the page is drawn in it.
- `apps/unified/tests/signup-look.test.ts` (5): provisioning with a look writes the row and the live page wears it;
  only the three are choosable; the preview renderer per look; its settings keys match a real request's.
- `tests/unified/factory/package-imports-declared.test.ts`: the new "unified app declares what its server imports".

## Renders (36, all opened) — `docs/preview-looks/<trade>-<look>-<width>-<mode>.png`

Contractor ("Westridge Builders"), home care ("Hearthside Home Care") and restaurant ("Fieldhouse Kitchen"), each in
the three looks, 1440 and 390 (iPhone 13 emulation), light and dark: made from the real preview function.
Contrast, measured in the browser: **no text under 4.5:1 on any of the 36**. Controls at rest/hover/focus: 8 readings
(Heritage dark, "Get in touch" 3.93–3.97) are flagged; the measuring box includes the pill's rounded corners over the
dark page — the button is dark ink on `#FF3D00` (about 5.3:1), seen in the render. Not a change.

What the pictures show, plainly:
- **The preview page is short.** A preview built from only a name, trade and town has a hero, a call-to-action band and
  the footer (home care adds the find-care form). No "What we do", no menu, no photos. That is the page a signup with no
  services typed gets from the composer (`instantComposer`), not something the looks cut. The AI builder's page, which
  a real signup gets when it finishes, is fuller. If the preview should look as rich as the samples, the fix is in the
  composer, not here — say if you want it.
- The brand colour is the signup default `#FF3D00` (the preview has no colour choice).
- The text-size pill appears mid-page in the phone shots of home care: it is a fixed control, and a full-page capture
  puts it at the bottom of the first screen. On a phone it sits at the bottom of the screen.

## Checks

- Factory tests `tests/unified/factory`: 213 pass (22 files). `tests/unified` as a whole also contains `vet/` files that
  fail with `Cannot find package 'hono'` — they fail the same on untouched `engine` (checked with my changes stashed).
- unified: `signup-look`, `site-whole-looks`, `site-parity`, `provision`, `provision-bookings`: 72 pass.
- All 11 `scripts/check-unified-*.ts` pass (the types check too: 0 errors, baseline unchanged); `bun run build:web` builds.

## Files

`apps/api/src/routes/factory/intake.ts`, `apps/api/src/unified/factory.ts`, `apps/api/src/unified/preview.ts` (new),
`apps/api/src/config/siteLooks.ts` (new), `apps/unified/server/core/vertical.ts`,
`apps/unified/server/site/signupPreview.ts` (new), `apps/unified/tests/signup-look.test.ts` (new),
`tests/unified/factory/preview-looks.test.ts` (new), `tests/unified/factory/package-imports-declared.test.ts`,
`docs/preview-looks/`.

Not done, on purpose: twomiah.com (separate repo) must send `design`; nothing is sent today, so until it does the
preview and signup behave as before except for the trades now drawn by the unified renderer. **That last part changes
today's preview for the live trades even with no `design`** — contractor, field service, landscaping, roofing,
home care, restaurant, bar, salon and "other" now show the unified page (their default look), not the old premium page.
