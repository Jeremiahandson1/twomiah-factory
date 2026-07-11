# TWOMIAH SELLABILITY FIX MAP
_Working reference. The point of this file: stop the thrashing. **Restore, don't rebuild. Touch only the files a fix names. Verify before editing.**_

Last updated: 2026-07-11

---

## OPERATING RULES (my leash — reread before every edit)
1. **Restore, don't rebuild.** Everything here worked at some point. First `git log -S`/`git log -p` to find where it last worked, then apply the *minimal* diff to restore it. Do NOT write new systems for things that already exist.
2. **Touch only files named in the item.** No "while I'm here" edits to adjacent code. That's what causes the collateral breakage.
3. **Verify current file content before editing** (Read it — line numbers below may have shifted).
4. **Reuse existing services** (e.g. `geocoding.ts`) instead of authoring new ones.
5. Template/generator fixes affect **newly generated tenants only** → user regenerates to verify. Existing test tenants are frozen.
6. Deploy via **isolated worktree off `origin/main`**, applying only the named hunks — never drag the user's uncommitted WIP.
7. **Update this map's Status after each item.**

---

## VERIFIED ARCHITECTURE (so I never edit the wrong template again)
- **Wizard flow:** `signup.html` (always sends `products:['crm','website']`) → `apps/api/src/routes/factory/intake.ts:265/367` → `apps/api/src/services/generator.ts` template ladder.
- **Roofing PUBLIC site = `templates/website-contractor`** — server-rendered **EJS** at runtime on Render (`server-static.ts`), theme `modern-minimal`. Confirmed by live-site ground truth.
- **Roofing CRM = `templates/crm-roof`** (`crmTemplateFor('roofing')`).
- **`templates/cms` = the `/admin` content editor ONLY.** NOT the public site. (I wrongly edited this before — don't.)
- **Premium sites = `website-premium-*`** (EJS + own bundled admin). Reachable ONLY when `products` includes `'website-premium'`; **the wizard never sets it.**
- **Token replacement** (generator token map) runs on **every** template → generator-level fixes (city/region) fix all templates at once.

---

## DECISIONS (from user, 2026-07-11)
- **Do it ALL, properly:** fix the standard `website-contractor` AND wire premium routing so both tiers work.
- **CRM demo data: LOCALIZE** to the tenant's real city — **reuse the existing `geocoding.ts`**, do not rebuild.

---

## BUG INVENTORY

### WEBSITE  (public = `website-contractor`; some fixes at generator/token level hit all templates)

**W1 — City repeated ×4 + "the Springfield" grammar**  ·  Status: DONE for website-contractor + generator (pending deploy); siblings + JSON-LD pending
- Generator: `SERVICE_REGION` → "{City} area" (fixes "the Springfield"); new deduped tokens `{{SERVICE_AREAS}}` (grammatical join), `{{SERVICE_AREA_LINKS}}`, `{{SERVICE_AREA_ITEMS}}`. Type-clean.
- website-contractor: base.ejs (footer nav + prose), contact.ejs (list + note), home.ejs (2 prose + deduped serviceAreas array) now use the deduped tokens.
- STILL PENDING: sibling `website-*` templates (homecare/dispensary/landscaping/fieldservice/general/vet/rv/showcase) share the pattern — need the same token swap. Invisible JSON-LD areaServed (contact.ejs:383+, home.ejs:605, service.ejs:393+) still lists repeated city — SEO-only, low priority.
- Root: `generator.ts:472-475` NEARBY_CITY_n fall back to `c.city`; `nearbyCities` is a manual wizard field (`apps/api/src/components/factory/types.ts:48`, default `['','','','']`); EJS never dedupes/drops empties; `SERVICE_REGION` = bare city; templates literally say "the {{SERVICE_REGION}}".
- Restore-first: locate/reuse geo (`geocoding.ts`) for real nearby cities if we want them; otherwise dedupe + drop empty slots.
- Fix scope (only): `generator.ts` token map; `website-contractor/views/base.ejs:720-723,766`, `contact.ejs:162,173-176,288`, `home.ejs:117`. Mirror to sibling `website-*` templates that share the pattern.

**W2 — Gallery has no images (placeholder tiles)**  ·  Status: TODO (needs trace)
- Root: gallery renders `gallery-card-placeholder`; project images never populated at generation.
- Restore-first: trace how gallery projects got images before; reuse `serviceImageLibrary`. Do NOT invent a new image system.
- Fix scope: TBD after trace.

**W3 — Gallery "View Project" badge invisible on mobile / no background**  ·  Status: DONE for website-contractor (pending deploy); siblings pending
- `build/styles/public-pages.css`: `.view-btn` got `background: rgba(15,23,42,.55)`; added `@media (hover:none)` rule so the overlay/badge shows on touch. Sibling templates need the same.
- Root: `website-contractor/.../public-pages.css:393-414` `.view-btn` has no background + overlay `opacity:0` until `:hover` (invisible on touch). The `cms` fix (`.view-btn { background: rgba(15,23,42,.55) }`) was never backported.
- Fix scope (only): website-contractor `public-pages.css` `.view-btn` (backport bg + stop hover-gating the label). Check source vs `build/` copy.

**W4 — Hero is one generic default image for every tenant**  ·  Status: TODO (needs trace)
- Root: template ships `data/homepage.json:7` `image:'/images/hero.jpg'`; only overridden on customer upload. AI path (`contentGenerator.ts:306-311`, added 4d39839) backfills, but standard path keeps the shipped default.
- Restore-first: confirm whether hero-fill already worked (4d39839) and just isn't on this path; reuse `serviceImageLibrary`.
- Fix scope: TBD after trace.

**W5 — Premium templates unreachable via wizard**  ·  Status: TODO (design)
- Root: `signup.html` always `['crm','website']`; premium branch needs `'website-premium'`.
- Fix scope: wire premium as an option/upgrade (signup + intake + generator). Design first — pricing implications.

### CRM  (`templates/crm-roof`) — all verified with file:line

**C1 — Reports show $0 everywhere**  ·  Status: DONE (code — pending build+deploy)  ·  P0
- Fixed in `ReportsPage.tsx` (jobValue helper reads finalRevenue/estimatedRevenue/rcv; rep/crew use assignedSalesRepId/assignedCrewId) + `JobsPage.tsx` (revenue + crew columns → real fields). API untouched.
- `ReportsPage.tsx:89/108/185` sum `j.revenue||j.total` (neither exists); `:120/:132` key `salesRepId`/`crewId`. Real cols: `estimatedRevenue`/`finalRevenue`/`rcv`, `assignedSalesRepId`/`assignedCrewId`. Same bug `JobsPage.tsx:236-237`.
- Fix: read real cols (or alias `revenue` in `jobs.ts:118`); fix rep/crew keys.

**C2 — Jobs show no contact / contact's Jobs tab empty**  ·  Status: DONE (code — pending build+deploy)  ·  P0
- Fixed `JobsPage.tsx:221` (nested `job.contact`) + `ContactsPage.tsx` selectContact (fetch `GET /api/contacts/:id`, read `.jobs`/`.smsThread`).
- NOTE (separate, NOT reported, needs backend): `togglePortal` POSTs `/:id/portal` and `resendInvite` POSTs `/:id/portal/invite` — routes don't exist. Track as its own item; do not silently expand.
- `JobsPage.tsx:221` reads flat `job.contactName`; API returns nested `job.contact`. `ContactsPage.tsx:47-63` fetches `/api/contacts/:id/jobs` — route doesn't exist; jobs come inside `GET /api/contacts/:id` (`.jobs`). Same for sms/portal.
- Fix: read nested `job.contact`; read `.jobs` from `GET /api/contacts/:id`.

**C3 — Crews "— members" + broken create**  ·  Status: DONE (code — pending build+deploy)  ·  P0
- Fixed `CrewsPage.tsx:118` (`crew.size`) + create body (`size:` not `crewSize:`). Form already collects foreman fields, so create now succeeds with valid input. (Create-form required-field validation before submit = separate polish, not done.)
- `CrewsPage.tsx:118` reads `crew.crewSize`; field is `crew.size`. `:46` create sends `crewSize`; backend requires `size`.
- Fix: standardize on `size`.

**C4 — Dallas/Plano demo seed (localize)**  ·  Status: DONE (code — pending build+deploy)  ·  P1
- `seed.template.ts`: all demo city/state/zip → `{{CITY}}/{{STATE}}/{{ZIP}}`; storm prose + deliveryAddress + affectedZipCodes tokenized; coords derived from `geocodeAddress('{{COMPANY_ADDRESS}}','{{CITY}}',...)` (reused crm-roof geocoder) with a US-centroid fallback so the seed never fails. Verified: 0 Texas literals left.
- `seed.template.ts:99-793` hardcoded TX literals (company record IS tokenized). 
- Fix: tokenize demo rows to `{{CITY}}/{{STATE}}/{{ZIP}}`; **reuse `geocoding.ts`** for the measurement `center` lat/lng.

**C5 — Storm Radar dev-error leak + "provider: ."**  ·  Status: DONE (code — pending build+deploy)  ·  P1
- New migration `0013_fix_storm_radar_tables.sql` (+ `_journal.json` entry) creates `storm_radar_event` and renames `storm_event_match.storm_event_id`→`storm_radar_event_id` — additive, runs after 0009. Frontend `load()` → `Promise.allSettled`; banner + backend `/status` message → owner-facing copy (no filenames, no dangling provider).
- Migration drift: `0009` never creates `storm_radar_event`; col `storm_event_id` vs schema `storm_radar_event_id`. Two calls 500 → `Promise.all` rejects → null status. `StormRadarPage.tsx:95-96` dev strings.
- Fix: migration + tolerant per-call load + plain-English copy.

**C6 — Twilio raw env in Settings**  ·  Status: DONE (code — pending build+deploy)  ·  P1
- `SettingsPage.tsx` SMS card: removed the raw `TWILIO_*=...` env block → owner-facing copy ("set up during onboarding, contact support"). Kept the SMS-triggers list.
- `SettingsPage.tsx:450-467` static env-var text, no form. Creds already injected at generation.
- Fix: real labeled form or "connected / not connected" status.

**C7 — Fake counts (adjuster 7/3/2, storm "24 leads")**  ·  Status: DONE (code — pending build+deploy)  ·  P2
- Seed: adjuster `jobsWorkedTogether` 3/7/2 → 0 (no demo job links to an adjuster); storm `leadCount` 24 → 6 (matches the 6 seeded leads). Dynamic computation = future enhancement.
- `adjusterContact.jobsWorkedTogether` seed literals (`schema.ts:445`); `stormEvent.leadCount=24` (`schema.ts:480`) vs 6 rows. Printed as if computed.
- Fix: compute real counts or seed 0.

**C8 — Roof Reports empty vs Measurements shows 1**  ·  Status: DEFERRED (needs roof_report schema seed or product decision)  ·  P2
- Two tables; only `measurement_report` seeded, `roof_report` never. Naming collision, not a query bug.
- Fix: seed both or unify/rename (needs intent).

---

## GUARDRAILS — DO NOT TOUCH
- User's **uncommitted WIP** (visualizer defaults; generator color helpers/`ensureDark`). Deploy only named hunks via worktree off `origin/main`.
- **Live Stripe prices** (`stripe-prices.ts`) — already live; never regenerate.
- **`templates/cms`** is the admin editor — never "fix" public-site bugs there.
- Don't edit templates/files unrelated to the active item.

---

## GEO LOOKUP — forensic note (2026-07-11)
- Git history: website `nearbyCities` has been a **manual wizard field** throughout; no removed auto nearby-city lookup found.
- **Geocoding DOES exist:** `templates/crm/backend/src/services/geocoding.ts` (+ `crm-dispensary`). This is almost certainly "the geo lookup that worked." **Reuse it** for C4; verify before assuming anything is missing.
