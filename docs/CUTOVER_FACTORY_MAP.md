# The live Factory's tenant lifecycle, and what the unified path still needs (2026-10-20)

Read-only map of `apps/api/src` (R = `routes/factory`, S = `services`), file:line as of engine `ea26ef689`. Owner's "go"
2026-10-20: wire the unified path into the live Factory behind `UNIFIED_SIGNUPS` = off | test | all (starts off).

## How a tenant is built today
- Entry: `POST /public/signup` (R/intake.ts:272) — slug `allocateSlug` (:296, names S/resourceOwnership.ts:128-135),
  products (default `['crm','website']`, `deployProductsForVertical` adds `website-premium`,`cms` when
  `SIGNUP_WEBSITE_ENGINE=premium`, :334-337), premium pages composed into `preview_premium_pages` (:339-350), `tenants`
  row inserted pending (:353-388: plan default `starter10`, `deployment_model='saas'`, products, features from
  `crmTemplateFor`, `admin_password`, `notes` holding the timezone), `intake_data.signup` (:411), welcome email (:418),
  background `generate()` + `factory_jobs` row (template = products.join('+')) (:464-490), `triggerAutoDeploy` if already
  paid (:499-509), Stripe checkout (:526-541). Also `/public/intake` (:607, website only, no deploy) and
  `/public/intake/:id/checkout-premium` (:2286).
- Stripe webhook (R/billing.ts:194): `checkout.session.completed` → `triggerAutoDeploy` (:257-263); CRM add-on →
  `provisionCrmAddonForTenant` (:249-254); comp promo (:69-88).
- Admin: `POST /customers/:id/deploy` → `runDeploy` (R/deploy.ts:18-63), `/regenerate` (:330-377), `/flip-to-crm` (:143).
- `triggerAutoDeploy` (R/deploy.ts:810): skips if `render_frontend_url`/`render_backend_url` set (:820) or a job is
  deploying (:826); sets deploying; `runDeploy`; `seedIntakePhotosIfPremium` (:851-927).
- `runDeploy` (R/deploy.ts:460): 15-min "still working" email timer (:463); `generate()` (:508); `deployCustomer` (:517);
  `factory_jobs` update incl. `github_repo`, `render_service_ids {backend,frontend,site,database,…}` (:526-551);
  `tenants` writes `render_frontend_url`, `render_backend_url`, `database_url`, `factory_sync_key`, `admin_email` (:559-571),
  `features` (:591-596), `website_url`, `ads_url`, `r2_bucket_name` (:602-613); `waitUntilServing` (:620-630);
  `status='active'` + audit (:635-640); POST `/api/internal/sync-features` + `pushSubscriptionToTenant` (:643-662); domain:
  `wireDomainInfrastructure`, `cloudflare_zone_id`, `sendgrid_domain_auth_id`, `reconcileAliasesInBackground` (:682-717);
  `attachTwomiahSubdomain` (:728-753); `notifyDeployComplete`, scrub `admin_password` (tenant + job config) (:758-780);
  failure → `deploy_failed`, `notifyDeployFailed` (:781-805).
- `deployCustomer` (S/deploy.ts:1076) integration env (:1337-1477): TWILIO_* (messaging SID only when A2P approved,
  :1352-1362), RESEND_API_KEY, tenant STRIPE_*, GOOGLE_MAPS_API_KEY, SENTRY_DSN, SENDGRID_API_KEY, NEARMAP_API_KEY,
  REPLICATE_API_TOKEN, FEATURE_PACKAGE, SEAT_LIMIT, GOOGLE_CALENDAR_*, R2, VISION_URL, ADS_URL, FROM_EMAIL/FROM_NAME/
  REPLY_TO_EMAIL, ANTHROPIC_API_KEY, Stripe webhook auto-registration (:1454-1465), QBO (:1477);
  `refreshPlatformIntegrationEnv` (:868-904: API_URL, BACKEND_URL, the Factory's Stripe Connect keys, QBO). Render project
  grouping `RENDER_PROJECT_ENV_ID` (:1926-1938).
- Domains: `wireDomainInfrastructure` (S/deploy.ts:2415) — Cloudflare zone, CNAMEs @/www → site, app → backend, email
  routing, Resend auth, SPF/DMARC, Render custom domains, SITE_URL. Services found by `findRenderServicesBySlug`
  (S/deploy.ts:2264, suffix list :2281-2287 — no `-app`). `attachTwomiahSubdomain` (S/deploy.ts:2347).

## Update, teardown, ongoing
- Update Code: `POST /customers/:id/update-code` (R/deploy.ts:198), `/resync-shared-code` (:395) → `updateCustomerCode`
  (S/deploy.ts:2106; ownership :2083; env refresh :2202-2214). `/redeploy` (:162), `PATCH /service/:role` (:231).
- Offboard: `beginOffboard` (R/lifecycle.ts:1234), `/offboard` (:1307), `/reactivate` (:1349), `/cancel-now` (:1404),
  daily `/renewal-check` grace teardown (:1105-1132). Test cleanup `hardDeleteTestTenant` (S/testCleanup.ts:192: guessed
  service names :41-90 without `-app`; databases :249 without `-app-db`; repo :268; no `detachTwomiahSubdomain`).
- Every tenant: backups (S/tenantBackup.ts:96-101 already finds `<slug>-app-db`), health (S/healthMonitor.ts:119-151),
  sync-subscription (S/tenantSubscription.ts:48-55), sync-features (R/admin.ts:578), inbound email
  (R/lifecycle.ts:39-72), Connect forwarding `/api/stripe/factory-event` (S/connectWebhook.ts:31), email aliases
  (S/emailAliasSync.ts:101-122), roof reports (R/roofReview.ts:81), calendar/GBP callbacks (R/lifecycle.ts:684-875),
  booking reminders/rebook/review via `ourPremiumSiteOrigin` (R/lifecycle.ts:902-998; S/premiumSiteUrl.ts:22 only
  `<slug>-site.onrender.com`).
- Nothing marks a tenant as unified: no column; code branches on template names in many places.

## Gaps (must for a working signup)
1. No caller of `buildUnifiedTenant`. 2. No tenants-row writes (urls, sync key, database_url, status). 3. No
`factory_jobs` record (`loadOwnedResources` S/resourceOwnership.ts:80 is the only `Owned` source). 4. Status/audit/
ready+failure email/password scrub. 5. Provision body (company, owner + bcrypt hash, features, site pages from
`preview_premium_pages`, timezone). 6. `integrationEnv`. 7. `externalNamesForSlug` lacks `-app`/`-app-db`.
## Gaps (soon after)
8. Domains/twomiah.app with the unified service. 9. `ourPremiumSiteOrigin` for unified hosts. 10. Unified endpoints the
Factory calls: seed-photos, booking-reminders/rebook/review-requests, calendar, send-sms, `/api/stripe/factory-event`,
`/api/leads/inbound/email` (check each against what the unified app already does itself). 11. Stripe webhook
registration for tenant keys. 12. Vision/Ads registration. 13. Teardown/test cleanup/grace for `-app`. 14. Update Code
route for unified tenants + env refresh. 15. Database `suspended` status. 16–20: project grouping, still-working timer,
partial-build rollback, R2 (where unified photos live), job status for the SSE stream. 21. A column saying which engine.
22. `FACTORY_API_URL`/`FACTORY_SYNC_URL` for roof reports.
