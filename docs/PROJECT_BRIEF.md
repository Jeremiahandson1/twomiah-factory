# Project brief — read this before any work

The owner's goals, decisions and working rules, kept here so a cloud session starts from the same facts as the
owner's local sessions (cloud sessions do not get the local notes). Facts are dated; re-check anything about live
state before acting on it. No passwords or keys belong in this file — ever.

Last updated: 2026-10-27.

## What Twomiah is

- Websites + industry software for local and service businesses. Marketing site: twomiah.com (repo
  `twomiah-website`, a separate repo). There is NO twomiah.app — tenants get their Render URL until they bring or
  buy a domain.
- Pricing (LIVE): website $49/mo, no build fee. Website + CRM $99/mo for up to 10 users, $139 up to 25, $199 up to
  50. **Plans are seats only — every feature is included. There are no feature tiers, ever.** Custom site $499
  one-time. The Exterior Visualizer is a separate product. Own-it licence = 36× monthly.
- "Buy it outright and take the code" means the customer gets THEIR copy to run themselves — not the right to
  resell Twomiah's code. Terms §7 says the same; they agree.
- Texting: $10/mo to switch on, and that $10 covers the line's monthly costs (number + carrier campaign fee). The
  prepaid texting wallet pays only the one-time carrier registration and each text at TRUE cost — ~1.26¢ blended
  (Twilio $0.0083 + carrier fee), kept in hundredths of a cent (since 2026-10-28, 4ea425472). Nothing charges the
  line twice (fixed 2026-10-26, d62e201c2).
- Free "text from your own phone": a Text button that opens the user's own texting app (no cost, no automation).
  The paid texting above is the automatic one. Different products — never blur them.
- Policies (owner, 2026-10-27): the 30-day money-back guarantee STAYS (Terms §4.5 matches); support is free; the only
  custom offer is the $499 one-time custom build; Sandata/EVV is NOT integrated (clock-in opens the Sandata app).
- A website claim that's only partly true gets BUILT to be true, not reworded.
- Every business texts from its own A2P-registered number. Never a shared number as a business sender.

## The plan: one product (docs/SPEC_UNIFIED_PRODUCT.md — THE design)

- One app per customer (apps/unified): website + bookings + CRM, one login, one database.
- **The trade is a setting, not a copied template.** "No more byte-identical sibling templates."
- Show first: a business sees its real site before paying; the AI writes it. Not a blank builder.
- Assembled from code that is already built and tested — not invented fresh.
- **Best and most secure, never the cheap shortcut:** each customer gets its own Render app server and its own
  Render Postgres server. No shared or pooled databases.
- Open industries for real signups (Factory env UNIFIED_LIVE_VERTICALS, 2026-10-28): contractor, fieldservice,
  landscaping, roofing, homecare, restaurant (incl. food truck), bar, salon, basic ("Other"), store (opened
  2026-10-27). Closed: vet, rv (live tests first). Dispensary has no unified version and is refused.
- `templates/` and the old per-template services are the pre-unified system; `crm-automotive` is parked — never
  modify it.

## The website look — what went wrong and what we're doing (2026-10-27)

- History (owner): the STANDARD templates — `templates/website-{contractor,fieldservice,homecare,landscaping,
  general,showcase,vet,rv,dispensary,store}` — were the decent sites, 3 looks per trade
  (`build/styles/themes/*.css`). Then PREMIUM templates (`templates/website-premium-*`) were made so the AI could
  pick and order sections and sites wouldn't look alike. But every premium template shares one look (Fraunces +
  Inter, one ~496-line main.css; only bar has its own design). The unified site was built from the premium code,
  so it inherited one look and the standard looks were left behind. Result: every site looks the same.
- Signups already use the AI builder (apps/api/src/services/signupSite.ts) — keep it. It decides sections, order
  and words; the look comes from the design stylesheet.
- Goal: bring the standard templates' looks back as a per-business setting (`site.design`,
  apps/unified/server/db/schema/site.ts:50), each look built ONCE on the shared section library
  (apps/unified/site/views/sections) so any business can use any look, with the AI writing the content and the
  free preview showing the same look. Not per-trade copies.
- Known: the old CSS cannot be dropped in — the old contractor CSS styles only 21 of the 911 class names in the new
  section HTML. Same-named themes are NOT the same file across trades (contractor's and fieldservice's
  "bold-industrial" differ completely); vet = homecare, rv ≈ contractor, store ≈ general.
- DONE 2026-10-27/28: the old looks were surveyed and dropped; four fresh whole looks were built — Foundry,
  Heritage, Studio and Market (made for shops) — SITE_DESIGN_SPECS in apps/unified/server/core/vertical.ts, any
  business may use any of them. A visitor picks one in the free preview on twomiah.com (drawn by the unified
  renderer, filled with clearly marked SAMPLE content that never reaches a real site) and at signup; the site is
  built in it. A store starts in Market.

## Open items (keep this list current — add when something is deferred, strike when it ships)

- Texting button's history record (cloud/text-from-phone, in progress) — "Text opened on your phone — not
  confirmed sent" on the contact's Activity card; then release.
- Update Code for Higgs, 547 and Amber Inn after the texting button lands (they get the looks, fixes, Gusto, export,
  true-cost texting, buy-outright) — compare each site before/after.
- Store: one fresh test signup since it opened (Retail Shop → Market look) — owner.
- Owner confirms: one Gusto hours file uploads cleanly; the Factory's GITHUB_TOKEN can invite collaborators
  (buy-outright handover — a failure alerts staff; POST /customers/:id/license/retry-handover re-runs it).
- Sections the old standard pages had that the new library lacks (docs/standard-looks/REPORT.md on
  cloud/standard-looks-survey): service detail pages (/services/:slug), "why choose us", testimonial carousel, map,
  blog preview, floating call button.
- Vet and RV live tests, then open them. Dispensary has no unified version.
- Phone app (apps/mobile): built, never submitted — Expo SDK 52 → 54 was required by the stores (2026-10-28, cloud/mobile-ready); icons, listing
  and checks are done. Owner steps and the real-phone test list: apps/mobile/store/READY.md (eas.json still has the Apple TODO placeholders).
- Claflin runs the old templates (old drizzle) — untouched until the owner names Claflin.
- A real customer taken through signup → a month → renewal/cancel with the owner watching.
- Alerts: memory is per-process (a restart can re-send one); credit running LOW and a thin AI site don't alert yet.
- The old crm-roof template keeps puppeteer 23 (no business runs it).

## How work is done here

- **Never guess.** Read the files, logs and live state before stating a cause or a fix. If you haven't checked
  it, say so. Never state what customers' live data contains without reading it.
- **Propose the right way first** and ask before building; never improvise a workaround. But if the answer is
  obviously logical, decide and build it.
- **No patches.** Fix the root cause, unify duplicated logic, and add a guard so it can't drift back. Fix by rule,
  not by the one path a report named — sweep the siblings.
- A feature that hasn't been tested end to end stays OFF on every path, and is never advertised until it's live.
- "Done" means checked in a real browser (rendered and looked at), on every dimension (roles, light and dark,
  phone and desktop) — not "the code compiles" or "HTTP 200".
- Text must always be readable against its background, in every state, light and dark.
- Product copy about a customer uses they/them — a name is not a pronoun. Home care imagery never implies
  medical/skilled nursing.
- Never modify anything Claflin unless the owner names it in that request.
- The owner owns Higgs Heritage Builders, 547 Eau Claire Home Care and Amber Inn — never ask for "the owner's
  yes" or a downtime window for them.
- Tests must never call live APIs (no billed Anthropic/Twilio calls from a test).
- Reports to the owner: short, plain language, what's done and what's blocking. No status check-in questions.

## Branches and releases

- `engine` is the integration branch; `main` is what's live. Releases fast-forward `main` to a CI-green `engine`
  (GitHub Actions: "Build check", "Unified app", "Security scan" — all three must be green).
- **Cloud sessions: work on your own new branch and push only there. Never push to `engine` or `main`.** The
  owner's local session reviews the branch and does the release.
- Before pushing code, run the unified guards (`scripts/check-unified-*.ts`), `bun run build:web` in
  apps/unified, and the tests for what you changed. CI is the full gate.
