# website-premium-bar

The bar & tavern premium template. Reference tenant: **Amber Inn Bar & Grill**, Eau Claire, WI (est. 1881, Walter Brewing tied house). Spec and build plan live in `C:\ALL TWOMIAH PRODUCTS\amber-inn\` (`SPEC.md`, `BUILD_PLAN.md`, `DISCOVERY_2026-09-07.md`).

Cloned from `website-premium-foodtruck` with the whole Twomiah Bookings system removed (a bar is walk-in business; private parties go through an inquiry form, never a reservation platform).

## What makes this template different

1. **It answers "should I go there right now?"** — the Tonight Board (kitchen open / closes in, bar hours, what's on tap, tonight's game, tonight's special, how busy) replaces the hero. Fed by `/api/live`, the single source of live truth for the site, the phone agent, and anything else.
2. **Bar hours ≠ kitchen hours.** `lib/hours/` owns every hours decision (weekly per department, holiday + game-day + "closing early" overrides, `America/Chicago` DST). The board, the JSON-LD `department`, and the voice agent all read from it.
3. **The menu is real HTML with real prices** and `Menu / MenuSection / MenuItem` JSON-LD. Never a PDF, never an image. Square Catalog becomes the source of truth in Phase 2.
4. **The console.** `/console` is a PIN-gated PWA a bartender runs one-thumbed: kitchen open/closed, tonight's special, 86 an item, tap/blow a keg, room status, post an event, party inbox.
5. **Dark-first design.** Matte-black leather, walnut, bottle green, oxblood, gold-foil type, brass hairlines. Light palette derived for daylight; all three viewer states (system, `data-theme="dark"`, `data-theme="light"`) supported. Fonts come from settings (`fontDisplay` / `fontEyebrow` / `fontBody` / `fontMono`).

## Layout

```
server-static.ts        Hono runtime: public pages, /api/*, /admin SPA, sitemap, robots
views/base.ejs          Shell: fonts + theme from settings, JSON-LD slot, header/footer
views/home.ejs          Section-composition renderer (pages.sections JSON → partials)
views/sections/*        Section partials (hero, menu, about, before_after, faq, cta, …)
build/styles/main.css   Tokens (dark-first) + every section's styles
lib/schema-org/         Typed JSON-LD builders (business now; menu/event/faq next)
lib/hours/              Hours engine (prompt 2)
db/schema.ts            Drizzle schema (Postgres on Render)
scripts/initDb.ts       First-boot seed: factory payload → content/ → local fallback
scripts/render-static.ts  No-DB renderer → _render/*.html for eyeballing / Lighthouse
content/                TENANT content (settings.json, pages/*.json, later menu/taps/timeline)
admin/                  React admin (pages, photos, leads, posts, users, settings)
```

Tenant content lives in `content/` and Postgres; everything else is machinery shared by every bar. The second install should be a content job, not a code job.

## Run

```bash
bun install
cp .env.template .env                 # DATABASE_URL, JWT_SECRET, ADMIN_EMAIL, ADMIN_INITIAL_PASSWORD, R2_*
bun run db:push && bun scripts/initDb.ts
bun run dev                           # http://localhost:3000  (admin at /admin)

bun run render:static                 # no DB: content/ → _render/home.html
bun test lib                          # hours engine + schema builder tests
```

## Rules (from SPEC.md)

- No accessibility overlay. No QR-replaces-the-menu. No reservation platform. No hero carousel. No scraped "popular times". No digital meat raffle.
- Menu = semantic HTML with prices. Hours through `lib/hours/` only. Site must work with JavaScript disabled.
- Budgets are acceptance criteria: LCP ≤ 2.0 s, INP ≤ 200 ms, CLS ≤ 0.05, homepage JS ≤ 120 KB gz, Lighthouse a11y + SEO 100.
- Voice: dry, plain, Wisconsin. No exclamation marks.
