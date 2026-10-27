# Standard looks — survey (2026-10-27, engine @ 511985c)

Survey only. Nothing outside `docs/standard-looks/` was changed. The old templates were rendered from scratch copies
(not from `templates/`), so no theme switch ever touched `data/settings.json` in the repo.

84 screenshots: 7 templates × 3 themes × {home, one service page} × {1440 desktop, iPhone 13 emulation at 390px},
full page. Named `<template>-<theme>-<page>-<width>.png`. Every one of the 84 final files was opened and looked at
(the 18 contractor/fieldservice files had to be opened a second time because the first pass returned no image).
Phone shots are 390px wide at 1× pixel density (3× made the folder 80 MB).

## How they were rendered (and what I verified about booting)

- `bun server-static.ts` (`templates/website-*/package.json` "start") **boots with no env vars and no database**.
  Verified: all 7 started on a free `PORT`, `/api/health` answered 200, pages answered 200. Content comes from
  `data/*.json` (`server-static.ts:415` `loadJSON('homepage.json')`), not a DB.
- It does **not** boot from the raw template: the files are full of `{{TOKENS}}` (e.g. `data/settings.json:2-13`,
  `server-static.ts:34 SITE_URL`, 40 distinct tokens). I filled them with the generator's own defaults/shape
  (`apps/api/src/services/generator.ts:607-718`) using sample business "Westridge Services, Madison WI",
  primary `#1d4ed8`, accent `#f59e0b`. After filling, no token was left (my fill script printed `unfilled tokens: none`).
- `bun install` is needed inside each copy (hono, ejs, sharp…); done per copy.
- The theme is `settings.theme` → `base.ejs` loads `/styles/themes/<theme>.css`
  (contractor `views/base.ejs:54-55`; same line ±5 in the others). I switched it per theme in the scratch copy.
- Reveal-on-scroll content (`.animate-on-scroll`, `home.ejs:86`; dispensary `.scroll-reveal`) is invisible until
  scrolled to, so the script scrolls the whole page slowly before the full-page shot, then checks nothing is left at
  opacity 0 (only the dispensary's closed "quick-view" overlay is).

## a. How the 7 looks really differ

### The shared skeleton (why they feel related)

Every old template is ~3,400–3,800 lines of base `build/styles/main.css` plus a theme overlay:
contractor 3483, fieldservice 3442, landscaping 3442, homecare 3823, general 3425, showcase 3428, dispensary 3424 lines.
contractor vs general `main.css` differ by 90 lines (of ~3,450). The page structure for 6 of 7 is the same list of
`<section>`s in `home.ejs`: services → why-choose → testimonials → (visualizer/estimator CTA) → trust → CTA → blog →
FAQ → contact → map (contractor `home.ejs:80,118,149,192,221,260,301,375,406,431,548`; fieldservice `:84,122,153,176,215,283,314,345,459`;
general `:91,134,165,208,237,276,349,380,395,507`). Layout therefore does **not** change between themes of one
template; the theme changes font, colour treatment, button shape, hero treatment and card styling. Homecare and
dispensary are the two with their own markup.

### Per template, per theme (fonts: `themes/<theme>.css` lines 12-17; screenshots in this folder)

| Template / theme | Heading / body font (file:line) | Look as rendered |
|---|---|---|
| contractor / bold-industrial | Oswald / Roboto (`website-contractor/build/styles/themes/bold-industrial.css:14-17`) | near-black bands (`--dark-bg #1a1a1a`, `:30`), square uppercase buttons, dark service cards |
| contractor / modern-minimal | DM Sans / DM Sans (`modern-minimal.css:15-18`) | white/grey (`--mm-bg #f5f5f3`, `:24`), light, pill buttons, no card chrome |
| contractor / professional-corporate | Playfair Display / Source Sans 3 (`professional-corporate.css:14-17`) | serif headings, navy ramp derived from primary (`:28-36`), gold underline under every heading |
| fieldservice / bold-industrial | Rajdhani / Barlow (`website-fieldservice/.../bold-industrial.css:13-16`) | dark slate `#0f1729` (`:22`), uppercase condensed, electric-blue accent |
| fieldservice / modern-minimal | Inter / Inter (`modern-minimal.css:13-16`) | light, black buttons, grey hero |
| fieldservice / professional-corporate | Nunito / Open Sans (`professional-corporate.css:13-16`) | rounded, primary-coloured bands, amber pill buttons (`--warm-amber`, `:27`) |
| landscaping | same three files as fieldservice — see near-duplicates | |
| homecare / clean-professional | Poppins / IBM Plex Sans (`website-homecare/.../clean-professional.css:13-16`) | white + ice-tint bands, geometric sans, split hero with photo on the right |
| homecare / family-modern | Quicksand / Nunito (`family-modern.css:13-16`) | rounded, lavender tints, curved hero edge, gradient CTA to a second colour |
| homecare / warm-community | Playfair Display / Lora (`warm-community.css:12-15`) | cream `#fdf8f4` (`:21`), serif everywhere, brown-tinted gradient CTA |
| general / bold-contrast | Bebas Neue / Work Sans (`website-general/.../bold-contrast.css:14-17`) | black/white, uppercase condensed, near-black hero |
| general / clean-minimal | Space Grotesk / Inter (`clean-minimal.css:13-16`) | white, left-aligned headings with a short rule, outlined buttons |
| general / trade-professional | Merriweather / Source Serif 4 (`trade-professional.css:13-16`) | cream `#faf6f1` (`:24`), serif, primary-coloured footer/CTA, amber buttons |
| showcase / clean-spotlight | Fraunces / Inter (`website-showcase/.../clean-spotlight.css:11-12`) | general's layout in a serif skin, 48-line overlay |
| showcase / midnight-neon | Bricolage Grotesque / Inter (`midnight-neon.css:11-12`) | same layout, dark FAQ + glow on buttons, 70-line overlay |
| showcase / warm-bold | Anton / Inter (`warm-bold.css:11-12`) | same layout, uppercase Anton, peach FAQ band, 51-line overlay |
| dispensary / botanical-organic | Cormorant Garamond / Karla (`website-dispensary/.../botanical-organic.css:13-16`) | ivory/cream (`--bo-cream`, `:23`), serif, forest-green bands |
| dispensary / glassmorphism-dark | Outfit / Space Grotesk (`glassmorphism-dark.css:13-16`) | black `#0a0a0a` (`--gd-bg`, `:23`), frosted cards, gradient headline text, wavy dividers |
| dispensary / streetwear-bold | Bebas Neue / Barlow (`streetwear-bold.css:14-17`) | pure black, square outlined cards, uppercase |

Colour caveat: most themes take the owner's primary colour (`{{PRIMARY_COLOR}}`, e.g. `bold-industrial.css:24`), so
in my renders everything is blue. The *hue* in a real tenant would follow the owner's colour; what the theme fixes is
the ground colours, fonts, shapes and effects.

### Near-duplicates (measured, `diff … | grep -c '^[<>]'`)

- **landscaping = fieldservice.** `build/styles/main.css`: 0 lines differ (3442/3442). `themes/modern-minimal.css`: 0
  lines differ. `themes/professional-corporate.css`: 0 lines differ. `themes/bold-industrial.css`: 23 lines differ
  (hero background pattern and overlay, `:207-222`, and one comment). `home.ejs`: 35 lines differ. So landscaping's
  "3 looks" are fieldservice's 3 looks; only the sample copy differs.
- **showcase ≈ general.** `home.ejs` 12 lines differ (735/733); `main.css` 21 lines differ. Showcase's themes are
  48–70-line overlays (`website-showcase/build/styles/themes/*.css`) on that base, plus `showcase.css` (60 lines of
  ember particles, `showcase.css:8-17`). In the screenshots showcase and general are the same page in different fonts.
- **Same-named themes are different files across trades**, as the brief says: contractor vs fieldservice
  `bold-industrial` 1023 changed lines, `modern-minimal` 970, `professional-corporate` 951 (different fonts and
  tokens). But by eye the *layout* is the same section list in both.
- **Same idea, repeated (my judgement from the screenshots, not measured):** "dark, uppercase, condensed, square
  buttons" appears six times — contractor/fieldservice/landscaping `bold-industrial`, general `bold-contrast`,
  dispensary `streetwear-bold`, and showcase `warm-bold` (Anton). "White, sans, light" appears as contractor
  `modern-minimal`, fieldservice/landscaping `modern-minimal`, general `clean-minimal`, showcase `clean-spotlight`.
  "Serif + warm" appears as contractor `professional-corporate`, general `trade-professional`, homecare
  `warm-community`, dispensary `botanical-organic`.
- **Genuinely different markup:** homecare (`home.ejs:34` `hero-split`, `:89` `trust-bar`, 405 lines vs ~735 for
  general; 7 sections) and dispensary (711 lines of `home.ejs` differ from general; fluid-canvas hero `:69`, 21+
  bar `:101`, stats `:108`, hours `:133`, products `:194`; plus `animations.css`/`effects.css`).

Count: 21 theme files, but 3 are byte-identical copies of other templates' (landscaping ×2 fully identical, ×1 nearly)
and 3 more are thin overlays on general. Distinct skins: 15. Distinct *structures*: 3 (the shared list, homecare, dispensary).

### Problems visible in the old looks themselves

- **Unreadable text, measured:** `fieldservice` bold-industrial home, service-card sub-links are `rgb(30,58,95)` on
  `rgb(15,23,41)` = **1.55:1**. Cause: `website-fieldservice/build/styles/main.css:855-858` `.service-links a { color: var(--navy) }`
  and `--navy` is `{{SECONDARY_COLOR}}` (`main.css:23`), never overridden by the theme. Landscaping bold-industrial
  uses the same CSS and looks the same in `landscaping-bold-industrial-home-1440.png` (I measured only fieldservice).
- **Layout break (seen, not root-caused):** `contractor-bold-industrial-home-1440.png` — the 9 service cards form
  two uneven columns with one very tall card and a stripe on the left instead of a tidy grid.
- Contractor-family hero shows overlapping ghost text ("Quality Craftsmanship…") behind the hero buttons in
  every theme's home shot — the animated hero badges, with no photo behind them.
- Phone, contractor service page: the floating "Call Now" button (`views/base.ejs:805-811`, `.mobile-call-fab`)
  sits on top of the estimate form's Name/Phone fields (`contractor-*-service-390.png`).
- Phone, homecare: only a hamburger shows in the header, no logo (no logo file in the sample).

## b. Sections/blocks on the old pages with no match in `apps/unified/site/views/sections`

Checked by grep of `apps/unified/site/views`, `apps/unified/server/site` and `site/public/styles/main.css` for the
old class names (hits listed as 0 = not found). The unified library has 47 section folders (`ls sections`).

Home-page blocks:
1. **"Why choose us"** — contractor `home.ejs:118` (same in fieldservice `:122`, landscaping `:122`, general `:134`,
   showcase `:134`, dispensary `:236`). `why-choose` / `why_choose`: 0 hits.
2. **Latest blog posts** — `home.ejs:375` (contractor). Unified has `/blog` routes (`server/site/routes.ts:483,510`)
   but no section; `blog-preview`: 0 hits.
3. **Map section** — `home.ejs:548`. `map-section`: 0 hits. (`sections/location/live-map.ejs` is a live crew-location
   map, a different thing.)
4. **Sub-service links inside each service card** — `home.ejs:101` (`service.links`), seen in every home shot as the
   small link list under each card. Unified `services/cards-grid.ejs:20-24` and `alternating.ejs` have title, text
   and one link only.
5. **Testimonials carousel** — `home.ejs:147-189` (carousel, dots). `testimonials/quotes.ejs` has no carousel/slide code.
6. **Hero extras** — `hero-line`, `hero-tagline`, `hero-awards`, `ken-burns` image animation (`hero.animation`,
   `data/homepage.json`): 0 hits in unified. The unified heroes (`hero/full-bleed`, `split`, `centered-stats`) cover the
   layouts, not these.
7. **Scroll-reveal animations** (`animate-on-scroll`, `scroll-reveal`, script `home.ejs:797-810`): 0 hits.
8. **Dispensary-only home blocks:** WebGL fluid hero (`home.ejs:69`), 21+ notice bar (`:101`, unified has only the
   `age/modal` popup), counters section (`:108`; `stats/bar` is the nearest, not the same), glass-card "Visiting"
   cards with wavy dividers (`:236`, `divider-wave`: 0 hits), theme (sun) toggle in the header (shot: `dispensary-*-service-1440.png`).
9. **Showcase ember particles** — `website-showcase/build/styles/showcase.css:8-17` + `/scripts/showcase.js`
   (`views/base.ejs:805`). `sx-ember`/`showcase.js` not in unified.

Page-level blocks (old pages the unified site has no equivalent of; unified only has `/:slug` pages built from
sections, `routes.ts:652`, and no `/services/:slug` route):
10. **Service detail page** — `views/service.ejs` (442 lines) via `server-static.ts:428` `/services/:slug`: breadcrumb
    "All Services" (`service.ejs:78`), hero with an inline lead form "Request a Roofing Estimate" (`:186`), "What
    We Offer" checklist (`:162`), sticky CTA card, "Explore Our Other Services" chips (`:327`). `hero-form`,
    `other-services`: 0 hits.
11. **Sub-service page** — `views/subservice.ejs` (370 lines): `service-hero` (`:38`), `service-main` (`:72`),
    `service-projects` (`:197`), `service-faq` (`:233`), `service-cta` (`:299`), `sub-services` (`:312`).
12. **Gallery page extras** — `gallery.ejs:19,30,49,130`: hero + filter bar (`gallery-filters`: 0 hits) + grid + CTA.
    Unified `gallery/grid.ejs` is a grid only.
13. **About page "values" block** — `about.ejs:43` (`about-values`): 0 hits; `about/story` covers the story.
14. **Dispensary loyalty page** — `loyalty.ejs:7,18,45,55,81` (hero, how-it-works, tiers, points check, CTA). The only
    unified "loyalty" is the restaurant's `regulars/signup`. Dispensary has no unified version at all (brief).
15. **Dispensary menu/order pages** — `menu.ejs` (filters `:50`, live menu `:68`) and `order.ejs:21`; unified has
    `menu/*` and `order/*` for the restaurant, not for dispensaries' strain/category menu with the filter chips.
16. **Chrome that has no match** (`base.ejs`): second "services bar" nav under the header (contractor `:579`, the dark
    strip in every shot) — `services-bar`/`services-nav`: 0 hits; `utility-nav` (`:548`): 0 hits; floating
    "Call Now" button (`:805-811`) and the right-edge "Request a Quote" tab (`:815-817`): 0 hits.

Blocks that DO have a match (so not gaps): hero → `hero/*`, services → `services/*`, FAQ → `faq/accordion`, trust →
`trust/badges`, CTA → `cta/*`, contact → `contact/form-info`, projects → `projects/grid|detail`, visualizer/estimator →
`tools/*`, hours → `hours/table`, areas → `areas/list`, homecare split hero → `hero/split`, text-size toggle →
`base.ejs:337`, age gate → `age/modal`, team/stats/gallery/testimonials.

## c. What I could not render, and why

- **No photos.** The templates ship `image: ""` everywhere (`data/homepage.json`, `data/services.json`), so heroes show
  flat colour/gradients and logos are broken-image boxes with alt text (and `{{COMPANY_NAME}}`-style text inside the
  placeholder `logo.svg` in the homecare/contractor sets). A real tenant has photos; the heroes will look different.
- **Dispensary service page:** dispensary has no `/services/:slug` route (`website-dispensary/server-static.ts`
  routes: `/menu`, `/order`, `/loyalty`, `/about`, `/contact`, `/blog`…). I shot **`/menu`** as its "second page".
  The menu reads `CRM_API_URL` (`server-static.ts:445-459`), which is unset, so it shows "Menu Coming Soon", not
  products. `/order` and `/loyalty` were not shot.
- **Dispensary age gate:** I set the `age_verified` cookie (`server-static.ts:101`) so pages render. The gate screen
  itself was not shot. Dispensary was shot with `prefers-reduced-motion` on, because its scroll-driven reveals
  (`animations.css:256-262`) otherwise leave sections blank; so the WebGL fluid hero, the particle/animation effects
  and the animated reveals were **not** captured. In those shots the home FAQ rows appear blurred (a reveal state that
  never completed under reduced motion) — a capture artefact, not verified as the live look.
- **General and showcase have no services** (`data/services.json` is empty), so "Our Services" is empty on their home
  shots and their "service page" is the template's fallback stub for `/services/consulting`
  (`server-static.ts:428-445`: text "Ask Westridge Services about consulting"), not authored content.
- **Fonts:** Google Fonts loaded through the sandbox proxy (CSS answered 200). At capture, the browser's
  `document.fonts.check` said the heading face was **not loaded** on 5 of the 21 home renders (homecare
  clean-professional/family-modern/warm-community, dispensary botanical-organic/glassmorphism-dark; themes use
  `display=optional`, e.g. `bold-industrial.css:10`, so a slow first paint falls back). By eye the headings in those
  shots look like the intended faces, but I did not prove it.
- **Not rendered at all, as asked:** rv, vet, store. Not shot: blog, gallery, about, contact, estimator, visualize,
  privacy/terms and 404 pages (only home + one service page were asked for); they are listed in (b) from the view files.
- **Interactions** (hamburger open, FAQ open, form validation, carousel, Call Now behaviour) were not exercised;
  only static full-page renders.
- **Unified-site side-by-side:** not rendered here (the task was the old looks only).
