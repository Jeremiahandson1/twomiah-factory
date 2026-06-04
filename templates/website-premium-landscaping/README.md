# website-premium-landscaping

The "premium tier" website template for lawn care, landscape design, and snow management.

Deeper forest green + warm earth-brown accent — weathered, seasonal, hands-on dependable. Not the office-park bright-green of national franchises. DM Serif Display on headlines for an organic, slightly old-timey feel that matches "neighborhood crew that's been here forever."

Same section-composition architecture as the other premium templates. Visual difference is theme CSS + sample data + composer prompt context.

## What makes this template different from `website-landscaping`

`website-landscaping` (the existing $19 template) uses a fixed EJS structure with token substitution — every site has the same hero shape, the same services layout, the same section order; only text and colors change.

`website-premium-landscaping` renders pages from a JSON section-composition schema. `pages.sections` is an array of `{ type, variant, data }` entries that the home.ejs renderer iterates over and dispatches to per-section partials under `views/sections/<type>/<variant>.ejs`. The composer (AI or staff) decides which sections appear, in what order, and with what variant — different builds produce visibly different sites.

See `apps/api/src/services/sectionComposer.ts` (`SECTION_SCHEMA`) for the canonical list of allowed section types + variants.

## Architecture

```
templates/website-premium-landscaping/
├── server-static.ts           Hono server: page renderer, lead capture, admin SPA mount
├── package.json               Bun + Hono + Drizzle + Sharp + R2
├── render.yaml.template       Render service + Postgres database
├── drizzle.config.ts          Migration target
├── .env.template              Env vars (DATABASE_URL, R2_*, SENDGRID, etc.)
├── db/
│   ├── index.ts               Drizzle client (pg pool)
│   └── schema.ts              Tables: settings, pages, photos, users, leads
├── views/
│   ├── base.ejs               Header / nav / footer shell
│   ├── home.ejs               Section renderer (loop sections → include partials)
│   └── sections/
│       ├── hero/              full-bleed, split, centered-stats
│       ├── services/          cards-grid, alternating
│       ├── cta/               banner, split
│       ├── about/             story
│       ├── team/              grid
│       └── contact/           form-info
├── build/styles/
│   └── main.css               Brand-tunable CSS variables, Inter + Fraunces, per-section styles
└── data/
    ├── settings.json          Local dev sample
    └── samples/               Hand-authored composition-a.json + composition-b.json
                                (live data lives in the `pages` table at runtime)
```

## Where the data lives

Per-page composition is in the `pages` table — one row per page (`home`, `about`, `services`, `contact`, plus any custom slugs the admin adds). Each row has a `sections` jsonb column that's the array the renderer iterates.

Per-site settings — company name, brand colors, nav, SEO defaults — live in the `settings` table (single row).

Uploaded photos go to the `photos` table (R2 keys + metadata); section JSON references images by url.

## Local development

```bash
cd templates/website-premium-landscaping
bun install
cp .env.template .env  # fill DATABASE_URL at minimum
bun run db:push        # creates tables in your local Postgres
bun run dev            # serves on :3000
```

For local-only rendering without a database (the proof-of-concept path), use `apps/api/scripts/render-premium-contractor-site.ts` — it generates standalone HTML from `data/settings.json` + `data/samples/composition-*.json` and from AI composition.

## Production deploy

The Factory deploys this template via `apps/api/src/services/deploy.ts` — a new tier ("website-premium") maps `crmRootDir` to this template. See task #20 for the deploy.ts wiring.

## Status

Customer-deployable. Renderer + composer + CMS admin (auth, pages, photos, settings, leads, users, account) are all live. Payment-gated deploy fires via Stripe checkout.session.completed → triggerAutoDeploy. Wired into the Factory signup wizard's tier picker (Standard vs Premium).
