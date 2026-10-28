# Site sections — what the old standard sites had, now on new customer sites

Branch `cloud/site-sections` (from `engine`; nothing pushed anywhere else). Source list: `docs/standard-looks/REPORT.md` §b.
One commit per block, in the order asked, then structured data. Every block follows the facts policy: a section whose facts the
owner did not give renders nothing, and the AI builder cannot add a fact the intake does not hold.

## What was built

| # | Block | Where the facts come from | With no facts |
|---|---|---|---|
| 1 | **Service pages** `/services/<slug>`: hero, what's included, "what this covers", a quote form posting to the existing enquiry handler (with the service named as the source), links to the other services. In the sitemap and `llms.txt`; linked from the services sections | The business's own "What we do" cards (owner's cards, else price book / menu / spaces). Never the composer's one-card stand-in, never a "how it works" list, never a card the owner linked elsewhere | No page, no link |
| 2 | **Why choose us** (numbered cards) | Owner reasons only: each title must trace to the intake; an untraceable sentence goes, the title stays; fewer than two reasons drops the section | Renders nothing |
| 3 | **Testimonials carousel** | The same real reviews as the quotes variant. Native scroll-snap (works without JavaScript); arrows, Home/End and focusable track; no autoplay; reduced motion respected; slides labelled "Review n of N" | One review: no controls, no script |
| 4 | **Map: "Find us"** | The business address and service areas from settings. A drawing plus links to OpenStreetMap / Google / Apple Maps: no API key, no iframe, no script, no tracking, works without JavaScript | No address and no areas: nothing |
| 5 | **Latest blog posts** on the home page | The business's published posts, filled in by the server; the composer supplies framing only | No posts: nothing |
| 6 | **Sub-service links** in service cards | The parts the owner named for a service; each links to its anchor on that service's page. Editor field added to both card forms | A card with no parts shows no list |
| 7 | **Gallery filter bar** | A group the owner types per photo in the editor (never composed). Buttons shown by script only, with `aria-pressed` and a live count | Under two groups: no bar, no script |
| 8 | **About "values"** | Owner-stated values only, same rule as why-choose (never "integrity", "quality"…) | Renders nothing |
| 9 | **Floating "Call now"** (phones, under 768px) | The business's own phone number | No number: absent. It steps aside while a form is on screen or a box has focus, so it never covers a form's buttons; room is kept under the page |
| 10 | **Structured data** (schema.org JSON-LD), `server/site/structuredData.ts` | See below | See below |
| 11 | **Container queries** | Every new block declares `container: name / inline-size` and lays itself out by its own width (a test checks each block's base rule) | — |

Skipped as asked: dispensary-only blocks, showcase embers, WebGL hero.

A new section got all of: the view; styles in the base sheet **and** each whole look (Foundry, Heritage, Studio, Market); the AI
builder's `SECTION_SCHEMA`, page recipes and facts rule (`composerFacts.ts`); the editor's list and forms; a marked preview sample
where it helps (why-choose).

## Structured data (item 10)

- **Type** from the vertical and trade: RoofingContractor, GeneralContractor, HVACBusiness, Plumber, Electrician, HousePainter,
  Locksmith, HairSalon, NailSalon, DaySpa, BeautySalon, Restaurant, CafeOrCoffeeShop, BarOrPub, Store, AutomotiveBusiness;
  a vet carries `LocalBusiness` + `VeterinaryCare`; **LocalBusiness whenever unsure** (home care and landscaping have no schema.org
  type that is certain — `HomeHealthCareService` does not exist in schema.org, so it is not used).
- **Hours:** `openingHoursSpecification` (dayOfWeek, opens, closes) from the saved company hours only; days with the same hours
  share an entry; closed or unsaid days have none; nothing at all with no saved hours. The free-form `openingHours` is never used.
- **sameAs** from the owner's own "Follow us" sections; **hasOfferCatalog** from the services the site lists; address is the area
  only (city, state), never the street.
- **/services/<slug>:** a `Service` with `provider` (the business) and `areaServed`, with its parts as an offer catalog.
- **FAQPage** only for questions and answers visible on that page (code comment: Google limits FAQ rich results mainly to
  government and health sites, so this is for accuracy, not a promised SEO boost).
- **BreadcrumbList** on every inner page, matching the real path.
- **No ratings or reviews, anywhere.** Nothing in code, UI or docs claims rich-result eligibility.
- **Tests render the real pages** (`tests/site-structured-data.test.ts`): roofing, home care and a store, each with home, a service
  page, an inner page and an FAQ page. The JSON-LD is pulled from the served HTML and compared with what the page shows (type,
  services listed, hours only if given, breadcrumbs vs path, FAQ vs visible text), then **every page is validated against
  schema.org's own vocabulary** (`tests/fixtures/schemaorg/`: types, which properties belong on which type, what each holds —
  built from schema.org's published `schemaorg-current-https.jsonld`, retrieved 2026-10-28; the tests never fetch anything).
  The validator itself is tested to catch an invented type, a property on the wrong type, a wrong value and a dangling `@id`.
- Honest limits: schema.org validation says the markup is made of real parts used as the vocabulary says; it says nothing about
  what a search engine will show. The vocabulary file is a snapshot; `build.ts` rebuilds it.

## Looks and screens

Every block was rendered in all four looks, light and dark, at 390px (iPhone-13 device emulation) and 1440px, and **every image was
opened** (`docs/site-sections/*.png`: `s1` service page, `s2` why-choose, `s3` carousel, `s4` map, `s5` blog, `s6-cards`/`s6-alt`
sub-service links, `s7` gallery filter, `s8` values, `s9` call-now at the top and at the form, plus desktop with no button). The rig is
in `docs/site-sections/tools` (boots the real app on an in-memory database with a plainly fake business).

Fixed after looking: heritage sub-service links centred under left-aligned alternating rows; market links crowding. Accepted, noted:
studio carousel card shadow slightly clipped at the track bottom; heritage blog card shows a double rule. Sticky headers overlapping
element screenshots in a few images are the page header, not a defect.

## Side effects worth knowing

- The Factory no longer composes a page per service (`instantComposer.ts`); the site builds `/services/<slug>` itself, so sites made
  before this change have the pages too. `scripts/check-composer-facts.ts` and `signup-site.test.ts` now expect a card per service.
- The old inline LocalBusiness block in `base.ejs` moved to `structuredData.ts` (one `@graph` per page). `tests/site-routes.test.ts`
  reads the business node from the graph.
- `tests/site-parity.test.ts` (new site vs the old templates) lists the three changed shared views as intentionally merged and strips
  the Call-now button and JSON-LD before comparing.
- The signup preview carries `socialLinks` (a guard requires its settings keys to match a real request's).

## Gate

Rebased on the current `engine` (which already fixes the two failures the first gate run showed: the TextButton light-card guard
and the missing `jsqr` module), `bun install`, then:

- `check-composer-facts` (1834 checks), `check-light-card-dark-text` and `check-unified-types` (0 errors in the app, shared packages at their baseline): pass. The first gate run covered all 275 `scripts/check-*.ts` of both workflows; the only failures were those two engine ones and the composer-facts check this work changed (fixed, above).
- `bun run build:web`: builds.
- Tests touched by this work, after the rebase: 216 pass, 0 fail across `site-service-pages`, `site-sections`, `site-section-fields`, `site-structured-data`, `site-parity`, `site-routes`, `signup-look`, `site-signup-preview` (unified), and 83 pass across `site-sections` and `signup-site` (Factory).
- Not done: a complete run of every unified test file and every `tests/unified/factory` file. A full unified run was started but stopped at about half (100 of 211 files, none failing) so the rebase could proceed; it was not repeated.
