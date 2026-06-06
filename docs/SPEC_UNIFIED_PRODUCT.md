# Twomiah Unified Product — Design Spec

**Status:** Design — not yet under construction
**Author:** Claude, 2026-06-06
**Reviewers:** Jeremiah
**Built as:** A standalone parallel codebase. Does not modify existing
factory, website-premium, or CRM templates. When ready, existing
customers migrate forward; new signups switch over.

---

## 1. Why this exists

Today, a Twomiah customer who buys both products ends up running:

- A **website-premium service** at `<slug>-site.onrender.com` with its
  own Postgres DB, schema (settings, pages, photos, leads, bookings,
  posts, users, sessions, audit).
- A **CRM service** at `<slug>-api.onrender.com` (or `-wrench-api`,
  `-leaf-api`, etc.) with its own Postgres DB, schema (140 tables —
  contacts, jobs, quotes, invoices, dispatch, fleet, etc.).
- Two separate logins. Two separate admin UIs. Lead from the website
  contact form does NOT automatically become a CRM contact unless a
  one-way sync is wired (it isn't, currently).

This is functional but feels like two products bolted together.

**Unified product goal:** one Postgres, one admin SPA, one login, one
billing relationship. A lead is a contact is a customer — same row,
seen from different angles. The customer says "I bought Twomiah" and
that's the whole product, not "I bought website + CRM + bookings."

This is what Wix, Squarespace, HubSpot, and Shopify do internally.
The marketing pitch is one product with feature tiers, the
engineering reality is one app with feature flags.

## 2. Non-goals

- **Not a microservices architecture.** Single deployable.
- **Not a multi-tenant database.** Still one Postgres per tenant — keeps
  data isolation, blast radius, and per-tenant migrations simple.
- **Not a no-code builder.** Show-first product positioning is preserved
  ([[project_website_showfirst]]). Premium customers can still tweak via
  the section customizer, but composition is AI-driven, not blank canvas.
- **Not API-first.** This is a customer-facing SaaS, not a developer
  platform. Public API is a future product, not V1 of this.

## 3. Architecture overview

```
                                tenant.twomiah-app.com
                                          │
                                          ▼
                            ┌─────────────────────────┐
                            │  Unified Hono Server    │
                            │  (Bun runtime, Render)  │
                            ├─────────────────────────┤
                            │  Public-marketing /     │   ← templated pages
                            │  Public-booking /book/* │   ← Twomiah Bookings
                            │  Customer-portal /portal/   ← invoice pay, doc view
                            │  Admin SPA /admin/*     │   ← unified admin
                            │  Admin API /api/admin/* │   ← single namespace
                            │  Internal /api/internal/    ← factory-signed
                            │  Customizer /customize/<t>  ← show-first edit
                            └─────────────────────────┘
                                          │
                                          ▼
                              ┌───────────────────────┐
                              │  Postgres (per-tenant)│
                              │  - core (users, etc)  │
                              │  - cms (pages, blog)  │
                              │  - crm (contacts...)  │
                              │  - bookings           │
                              └───────────────────────┘
```

Single Render service per tenant. Single Postgres per tenant.
Single GitHub repo per tenant. Single deploy.

## 4. Schema design

The schema splits into **layers**. Each layer is in its own file under
`db/schema/`. All layers are present in every tenant DB; feature flags
control which API endpoints + admin pages are active for the tenant.

### 4.1 Core layer (always present)

Tables:
- `users` (unified — used by both website admin and CRM)
- `sessions` (JWT jti tracking)
- `audit_log` (every state-changing admin action)
- `settings` (company info, branding, enabled_features jsonb)
- `feature_flags` (override map — used by ops to enable/disable features
  without redeploying)
- `photos` (R2-backed media library, shared across CMS + CRM)
- `notifications_outbox` (queued email + SMS; cron drains)

`users.role` enum: `'owner' | 'admin' | 'editor' | 'tech' | 'customer'`
- `owner`: full access, billing, can delete tenant
- `admin`: full feature access, no billing
- `editor`: can edit content but not user mgmt
- `tech`: CRM-side field tech (sees their jobs, time entries, schedule)
- `customer`: show-first customizer access only

### 4.2 CMS layer (when `cms` feature enabled)

Tables:
- `pages` (section-composition jsonb, customer-tweakable)
- `posts` (blog)
- `nav_items` (top-level navigation)

Routes activated when flag on:
- Public `/`, `/:slug`, `/blog/*`, `/contact`
- Admin `/admin/pages`, `/admin/posts`

### 4.3 Bookings layer (when `bookings` feature enabled)

Tables (existing): `booking_services`, `booking_availability_rules`,
`booking_blackouts`, `booking_zones`, `booking_calendar_connections`,
`bookings`, `booking_series`, `booking_waitlist`, `booking_bans`,
`booking_webhooks`.

Activated routes: public `/book/*`, admin `/admin/bookings*`,
`/admin/booking-*`, internal cron endpoints.

### 4.4 CRM layer (when `crm` feature enabled)

Tables (from crm-fieldservice merged into unified naming):
- `contacts` (people + companies — flattened, no separate accounts table)
- `pipelines` + `pipeline_stages` + `opportunities`
- `jobs` (work orders) + `job_line_items` + `job_visits`
- `quotes` + `quote_line_items` + `quote_versions`
- `invoices` + `invoice_line_items` + `invoice_payments`
- `tasks` (lightweight todos, distinct from jobs)
- `notes` + `note_attachments`
- `activity_log` (CRM-specific activity stream, distinct from `audit_log`)

### 4.5 Field-service layer (when `field_service` feature enabled)

Higher-tier CRM features:
- `dispatch_board_state`, `dispatch_assignments`
- `fleet_vehicles`, `fleet_locations`, `fleet_maintenance`
- `equipment`, `equipment_history`
- `inspections` + `inspection_items`
- `parts_inventory` + `parts_transactions`
- `pricebook_items`, `pricebook_categories`
- `maintenance_contracts`, `contract_visits`
- `dispatcher_views` (per-user board configs)

### 4.6 Integrations layer (when individual flags enabled)

- `ad_campaigns`, `ad_experiments` (when `ads` enabled)
- `call_logs`, `tracking_numbers` (when `call_tracking` enabled)
- `ai_receptionist_calls`, `ai_receptionist_config` (when enabled)
- `email_aliases`, `email_messages` (when `email_inbox` enabled)
- `quickbooks_sync_log` (when `quickbooks` enabled)
- `stripe_customers`, `stripe_subscriptions` (always present — used for
  the tenant's own billing too)

### 4.7 Cross-layer relationships

The big win of unified schema: cross-feature foreign keys.

- `bookings.contact_id` → `contacts.id` (a booking is automatically a
  contact, no sync)
- `leads` table goes away — contact form submissions write directly
  to `contacts` with `source = 'website_lead'`
- `jobs.booking_id` → `bookings.id` (a booked appointment becomes a job
  with one click)
- `invoices.contact_id` → `contacts.id`
- `pages.author_id` → `users.id`

## 5. Auth + permissions

### 5.1 Single session model

Single `users` + `sessions` table. JWT cookie at `auth` is valid for
all admin/customer/tech routes. `role` claim + path-prefix gating in
the middleware (already proven by the customizer V1):

```typescript
if (role === 'customer') {
  allow paths in: /api/admin/pages, /api/admin/photos, /api/admin/me
}
if (role === 'tech') {
  allow paths in: /api/admin/jobs (own only), /api/admin/schedule (own only)
}
// admin/editor/owner: standard RBAC by feature
```

### 5.2 Feature-flag gating

Every API route is wrapped with `requireFeature(featureKey)`. If the
tenant's `settings.enabled_features` doesn't include the key, the
endpoint returns 404 (not 403 — we don't want to reveal what features
exist). Frontend hides nav items + redirects when the flag's off.

### 5.3 Hard security baseline (inherited from existing premium)

- httpOnly + Secure + SameSite=Strict cookies
- 2FA (TOTP), recovery codes
- Login notifications via email
- Audit log on every state change
- Per-IP rate limit on login + lead form + booking POST
- CSP headers with nonce-based script-src in admin
- Password reset flow, email verification, force-logout-all
- Session revocation via `tokensInvalidatedAt`

## 6. Frontend structure

Single React + Vite SPA at `/admin/*`. Routes grouped by feature, lazy-
loaded so a tenant without CRM doesn't ship CRM JS.

```
admin/src/
├── App.tsx                 // route tree
├── contexts/
│   ├── AuthContext.tsx     // role + features
│   └── ThemeContext.tsx    // per-tenant brand colors
├── components/
│   ├── AdminLayout.tsx     // nav filter by role + features
│   ├── FeatureGate.tsx     // <FeatureGate flag="crm">…</FeatureGate>
│   └── ...
├── features/
│   ├── cms/
│   │   ├── PagesListPage.tsx
│   │   ├── PageEditPage.tsx
│   │   └── ...
│   ├── bookings/
│   │   ├── BookingsPage.tsx
│   │   ├── BookingsCalendarPage.tsx
│   │   └── ...
│   ├── crm/
│   │   ├── ContactsPage.tsx
│   │   ├── ContactDetailPage.tsx
│   │   ├── JobsPage.tsx
│   │   ├── PipelinePage.tsx
│   │   ├── QuotesPage.tsx
│   │   ├── InvoicesPage.tsx
│   │   └── ...
│   ├── field-service/
│   │   ├── DispatchBoard.tsx
│   │   ├── FleetPage.tsx
│   │   └── ...
│   └── account/
│       ├── BillingPage.tsx
│       ├── UsersPage.tsx
│       └── ...
└── api/client.ts           // single fetch wrapper, single base URL
```

Nav items declared per feature in `AdminLayout.tsx` with a `feature` key
matching `settings.enabled_features`. Customer/tech roles also filter
out items not in their whitelist.

## 7. Backend structure

```
src/
├── server.ts               // mount, middleware order
├── db/
│   ├── index.ts           // single drizzle client
│   └── schema/
│       ├── core.ts        // users, sessions, settings, audit
│       ├── cms.ts         // pages, posts
│       ├── bookings.ts    // already exists, copied forward
│       ├── crm.ts         // contacts, jobs, quotes, etc.
│       ├── field-service.ts
│       └── integrations.ts
├── routes/
│   ├── public/
│   │   ├── marketing.ts   // /, /:slug
│   │   ├── booking.ts     // /book/*
│   │   ├── contact.ts     // POST /api/leads → contacts
│   │   └── portal.ts      // /portal/* (invoice pay, doc view)
│   ├── admin/
│   │   ├── auth.ts        // /api/admin/login, /me, /logout, 2fa
│   │   ├── settings.ts
│   │   ├── pages.ts
│   │   ├── photos.ts
│   │   ├── posts.ts
│   │   ├── bookings.ts
│   │   ├── contacts.ts
│   │   ├── jobs.ts
│   │   ├── pipelines.ts
│   │   ├── quotes.ts
│   │   ├── invoices.ts
│   │   ├── dispatch.ts
│   │   └── ...
│   ├── internal/
│   │   ├── sync-features.ts // factory-signed feature updates
│   │   ├── booking-*.ts     // cron endpoints
│   │   └── webhooks.ts
│   └── customize/
│       └── token-entry.ts  // /customize/:token
├── lib/
│   ├── auth.ts            // JWT, sessions, role middleware
│   ├── features.ts        // requireFeature, hasFeature
│   ├── audit.ts
│   ├── email.ts           // Resend
│   ├── sms.ts             // Twilio
│   ├── ics.ts             // calendar invites
│   ├── google-calendar.ts
│   ├── outlook-calendar.ts
│   ├── stripe.ts
│   └── storage.ts         // R2 / local
└── services/
    ├── composer.ts        // AI section composer (called at deploy + on demand)
    ├── leads-to-contacts.ts // public form → unified contacts
    └── bookings-to-jobs.ts  // mark booking complete → optionally create job
```

## 8. Vertical specialization

The 7 existing verticals (contractor, fieldservice, homecare, roofing,
landscaping, dispensary, showcase) differ in:

- Section composer prompts (writing voice, default copy)
- Marketing template page sections (e.g., roofing has insurance/storm
  positioning, landscaping has seasonal CTAs)
- CRM workflow specifics (homecare has care plans + ADL tracking,
  roofing has measurement tool, fieldservice has dispatch board)
- Default pricing tiers

Architecture: **one codebase, vertical-scoped config**. Vertical is a
tenant setting (`settings.vertical = 'roofing'`), not a separate
template. Templates differ in `templates/verticals/<name>/`:

```
templates/verticals/roofing/
├── composer-prompts.ts
├── default-services.ts
├── nav-overrides.ts        // which CRM features show by default
└── public-page-sections.ts // hero copy, FAQ pre-fills, etc.
```

The single deployable reads the vertical setting at boot and loads the
right config. **No more 7 byte-identical sibling templates.** The
"propagate to 6 siblings" step from every change goes away.

This is one of the biggest engineering wins from the unification.

## 9. Phased build plan (independent project)

Build as a parallel codebase at `apps/unified/` so it can be developed
and tested without touching production tenants.

### Phase 1 — Foundation (2-3 weeks)

- Scaffold project: `apps/unified/`, Bun + Hono + Drizzle + Vite + React
- Core schema: users, sessions, settings, audit, photos
- Auth: JWT, 2FA, sessions, role middleware, audit log
- Feature flag system: `enabled_features` jsonb + `requireFeature` middleware
- Admin SPA shell: login, layout, feature-gated nav, account
- CMS layer: pages, photos, blog (port the section composer)
- Customizer: token-scoped customer access
- Deploy script: single Render service + Postgres
- **Exit criteria:** can sign up a new tenant, log in, edit pages, publish.

### Phase 2 — Bookings (1-2 weeks)

- Port bookings schema (already in good shape from current work)
- Port booking endpoints + admin pages (mostly copy-paste — 24/24 walkthrough already passes)
- Port Google/Outlook calendar integration
- Port public /book/* flow
- **Exit criteria:** walk-bookings.ts equivalent passes 24/24 on the unified codebase.

### Phase 3 — CRM core (4-6 weeks)

This is the biggest phase. Build incrementally — ship feature-by-feature.

- 3a. Contacts (1 week) — unified contacts table, merge in lead capture flow
- 3b. Pipelines + opportunities (1 week) — kanban board, stage moves
- 3c. Jobs (1-2 weeks) — work orders, line items, visits, status
- 3d. Quotes (1 week) — PDF generation, customer accept link
- 3e. Invoices (1 week) — Stripe payment links, customer portal
- 3f. Tasks + notes + activity log (3-4 days)
- **Exit criteria:** can run a job from contact creation through to paid invoice in the unified UI.

### Phase 4 — Field service (3-4 weeks, only if needed)

- Dispatch board, fleet, equipment, inspections, pricebook, parts,
  maintenance contracts
- These are the high-value differentiator features but lower priority
  than core CRM
- Can be deferred indefinitely if customer demand doesn't justify

### Phase 5 — Integrations (1 week each, ad-hoc)

- Ads (Twomiah Ads experiments)
- Call tracking
- QuickBooks sync
- Email inbox + aliases
- AI receptionist
- These are independent — build when first customer requests

### Phase 6 — Migration tooling (1-2 weeks)

- Export script: dump CRM Postgres + premium Postgres → JSON
- Import script: load JSON into unified Postgres
- Validation: row counts, FK integrity, file references
- Per-customer migration runbook
- **Exit criteria:** one test customer fully migrated end-to-end with
  zero data loss, no broken references.

### Phase 7 — Cutover (per-customer)

For each existing customer:
1. Notify them of migration window (off-hours)
2. Snapshot both DBs
3. Run export → import
4. Switch their DNS / Render service to the unified deploy
5. Verify (smoke test via Claude in Chrome)
6. Decommission old CRM + premium services after 7-day grace
7. Send "your unified Twomiah is live" email

New signups switch to unified the moment Phase 3 ships (or earlier — they
can sign up for unified with just CMS + bookings, no CRM).

## 10. Migration risks + mitigations

### Risk: Data loss during cutover
**Mitigation:** Pre-snapshot both DBs. Keep old services running for 7
days post-cutover (read-only) so we can compare. Validation script
runs row counts + FK checks before flipping DNS.

### Risk: FK reference breakage when contacts are deduped
**Mitigation:** Migration is ID-preserving. Old IDs map 1:1 to new IDs.
A `migration_id_map` table tracks any necessary remappings.

### Risk: Customer logs in, doesn't recognize the new UI
**Mitigation:** Pre-migration email with screenshots. Post-migration
in-app tour. Keep an "old UI" toggle for 30 days.

### Risk: Vertical-specific features missing
**Mitigation:** Each vertical's required feature list is documented in
`templates/verticals/<name>/required-features.md`. Migration checklist
verifies each.

### Risk: Stripe subscription confusion (two subs → one)
**Mitigation:** Pre-migration, change the existing CRM sub to $0 and
merge into the website sub (or vice versa). Or create one new sub and
cancel both old ones. Stripe supports this via the migration API.

### Risk: Active sessions get invalidated
**Mitigation:** Migration sets `tokensInvalidatedAt` so all users
re-log in on the new system. Email warning beforehand.

### Risk: Custom domain TTL during cutover
**Mitigation:** Pre-lower TTL on customer's CNAME/A record 24h before
cutover. Switch DNS. TTL low so propagation is < 15 min.

### Risk: External integrations (Google Calendar, Stripe, QuickBooks) break
**Mitigation:** Per integration: re-issue OAuth tokens during migration.
For QuickBooks, the connection survives (token tied to customer's QB
account, not our infra). For Stripe, the customer ID is preserved.

## 11. Open questions for V1 scope

- **Auth provider:** Stay on self-hosted JWT, or move to Clerk/WorkOS
  for SSO + enterprise readiness later?
- **Multi-user pricing:** When does the customer pay per-seat vs flat?
  CRM teams often go to 5+ users; current architecture assumes ~1-3.
- **Mobile app:** Existing apps/mobile (Expo) targets the CRM. Does
  unified codebase get its own mobile app, or do we expose REST/GraphQL?
- **Sub-tenant agencies:** crm-fieldservice has `/agency/*` routes for
  agencies running multiple businesses. Does unified preserve this?
- **Database hosting:** Stay on Render Postgres, or move to Neon (better
  scaling, branching for migrations)?
- **Vertical extensibility:** Can a customer mix verticals? E.g., a
  contractor who also does landscaping.

## 12. Estimated total effort

**Phase 1-3:** 8-11 weeks (single focused engineer)
**Phase 4:** +3-4 weeks if needed
**Phase 5:** ad-hoc per integration
**Phase 6-7:** 1-2 weeks tooling + 1-2 hours per customer migration

Realistic ship target for "unified V1 = CMS + bookings + core CRM, no
field-service, no ads": **3 months from project start.**

## 13. How this dovetails with current Path A++ work

Path A++ ships in the next 1-2 weeks on the existing dual-deploy
architecture. It gives customers:
- One login (shared users table between premium-site and CRM, via shared
  Postgres)
- "Add CRM" upgrade flow from the premium admin
- Stripe-billed CRM add-on SKU

Path A++ deliberately keeps the existing template structure intact, so
the unified product can be built in parallel without conflict. When
unified V1 ships, Path A++ customers are migrated forward via the
Phase 6 tooling — their shared-DB setup actually makes migration
*easier* than dual-DB customers, because the shared `users` rows
already match up.

So Path A++ is not throwaway work — it's the bridge that lets us start
selling the bundled experience now, while unified is being built
properly.

## 14. Decision log

- **2026-06-06:** Decided to build unified as a parallel project rather
  than attempt to refactor existing templates in place. The 42k LOC of
  existing CRM code, 75 route files, and 6 vertical variants make
  in-place refactoring high-risk. Greenfield is safer + faster.
- **2026-06-06:** Decided to ship Path A++ (shared DB, separate
  services) on existing codebase to unblock revenue while unified is
  being built.
- **2026-06-06:** Decided one Postgres per tenant (vs single multi-
  tenant DB) — preserves data isolation, blast radius, simpler audit.
- **2026-06-06:** Decided vertical = setting, not template — eliminates
  the "propagate to 6 siblings" overhead from every change.

---

*Iteratively update this doc as Phase 1 begins. Every architectural
decision goes in the decision log so future engineers (and future
sessions of this assistant) can pick up the context.*
