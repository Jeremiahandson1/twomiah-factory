# Claims true — report (2026-10-28)

Branch `cloud/claims-true`, rebased on `origin/engine` (b486abce2) on 2026-10-28 (clean, no conflicts). One commit per claim, then two follow-ups (overtime, hosting choice). Nothing pushed to `engine` or `main`.
`docs/PROJECT_BRIEF.md` is not on `engine` (only `main`); it was read from `main`.

| | Claim | Commit |
|---|---|---|
| A | Hours to Gusto, every trade | `feat(payroll): hours for Gusto for every trade` |
| B | Export everything | `feat(export): "Export everything"` |
| C | Texting at true cost | `fix(texting): charge texts at true cost` |
| D | Buy it outright, self-serve | `feat(license): self-serve "Buy it outright"` |

Screens (desktop + phone, light + dark) are in this folder: `b-export-everything-*`, `c-texting-*`, `f-payrun-overtime-*` (the pay run, in California, with overtime and the notice), `g-own-it-hosting-*` (checkout with "I'll host it myself" picked), `g-own-it-bought-self-*` (after payment). The first Gusto and checkout shots were replaced: the pay run and checkout changed.
`tools/serve.ts` boots the real app on an in-memory DB; `tools/shoot.ts` takes the four shots. (The sticky header sits mid-page in a few full-page shots; that is the screenshot, not the page. The "Could not reach billing" line on the Billing shots is the stand-in Factory having no texting route.)

## A. Gusto hours export
- One shared builder (`server/crm/payrollExport/gustoHours.ts`); home care's `/api/gusto/export-csv` now calls it, no copy. Every other trade: `GET /api/payroll/gusto-hours` from `time_entry`, behind `payroll:read` (the pay run's permission), same entries and day-cut as the pay run, sync-log + audit row. "Hours for Gusto" button on the Pay run panel.
- **Not confirmed:** Gusto's help pages could not be fetched (403), and search shows only that Gusto's CSV upload ("Smart Import") auto-matches whatever columns the file has — no fixed template. We kept home care's header (`First Name, Last Name, Email, Regular Hours, Overtime Hours, Total Hours`). **Upload one real file in Gusto to confirm it maps.**
- Overtime: see follow-up 1 below (the pay run now shows the same split as the file).

## B. Export everything
- Settings › Your Data → one ZIP (owner/admin, `settings:update`): a CSV for every table that has rows, website pages + media list in `website/`, README, manifest. Built from the Drizzle schema, scoped to the signed-in company (company_id, or a foreign key up to a table that has it). Audit-logged.
- Left out on purpose and listed per file in the manifest: passwords, tokens, API keys/secrets, stored service credentials; sessions, 2FA secrets, push endpoints.
- Guard `scripts/check-unified-export-everything.ts` (added to CI) fails if a new table can be neither scoped nor deliberately left out.
- Photos/files themselves are not in the ZIP; `media.csv` lists them with their addresses.

## C. Texting at true cost
- Wallet and ledger now in hundredths of a cent (integers); migration `apps/api/migrations/2026-10-28_messaging_hundredths_of_a_cent.sql` converts existing balances exactly. **Must be applied by hand on live Supabase before this deploys.**
- Blended 1.26¢/segment (Twilio 0.83¢ + carrier fee avg 0.43¢); per carrier 1.18¢ AT&T, 1.28¢ T-Mobile, 1.33¢ Verizon. Env overrides in dollars (`TWILIO_SMS_SEGMENT_USD`, `CARRIER_FEE_*_USD`); `TWILIO_SMS_SEGMENT_CENTS` is gone. Texting page shows the real price. Low-balance/reload work in the new unit.
- Twilio prices are the ones from your 2026-10-27 check; not re-fetched.
- **Honest limit:** Twilio's message resource carries no carrier, so today every text is billed the blended fee; the code takes a carrier when a report names one. A monthly reconciliation against Twilio usage is not built. `crm-dispensary`, `crm-homecare`, `crm-roof` have their own `messagingUsage.ts` copies, left alone (still work).
- `docs/PROJECT_BRIEF.md` still says "1¢" — update when this merges.

## D. Buy it outright (self-serve)
- Settings › Billing, owner only: price (36× the plan's monthly list price — a discount does not shrink it), what you get, Terms §7 wording, GitHub username + accepted checkbox, then Stripe checkout for exactly that amount.
- On payment (`checkout.session.completed`, purpose `own_it_license`, deliberately no `factory_customer_id` so billing/auto-deploy are untouched): licence recorded once per Stripe session in `tenant_licenses` (**migration `2026-10-28_tenant_licenses.sql` to apply by hand**), GitHub **read** invitation to the business's own repo, full data export (B) made by the tenant app via `/api/internal/handover-export` and emailed as a 7-day link. Each step is kept on the row; retried, never repeated; staff alerted on failure; staff retry `POST /customers/:id/license/retry-handover`.
- Hosting: see follow-up 2 below (the owner now chooses). Decisions for you: (1) read access only, since the Factory keeps pushing updates to that repo; (2) the §7 text on screen is worded from your brief — **check it against the live Terms**, I could not see them (the website is a separate repo).
- Not built: a licences list in the platform dashboard (the row and audit entry exist).
- Needs live setup: `GITHUB_TOKEN` with permission to add collaborators on those repos, and R2 configured (already used by offboarding exports).

## Follow-up 1 — overtime, by the work week (every trade)
- New company setting **Work week starts on** (Settings › Company, default Sunday; column `company.work_week_start`, migration `0037_work_week_start`, runs at boot). One rule in `payrollExport/workWeek.ts`: overtime = hours over 40 in each work week starting that day. The Time page's **Pay run** now has Regular and Overtime columns (and totals), the Gusto file uses the same function, and home care's payroll/Gusto file reads the same setting (its SQL week-bucketing takes the start day).
- **Daily overtime:** if the business's state is CA, AK, NV or CO (code or full name), the pay run shows a notice that daily overtime is not calculated and the hours are by the week only. Nothing is guessed.
- "Earned" on the pay run is still straight time (hours × rate); the overtime hours are shown but the premium rate is applied in Gusto. Say if you want Twomiah to show an overtime-rate figure too.
- Not handled: a week that straddles the pay period counts only its days inside the period (same as home care already did).
- Tests (`gusto-hours.test.ts`, now 10): a week crossing 40 (47 h → 40 + 7) with the pay run and file agreeing; the same hours with a Monday work week → no overtime; setting validation and permission; CA/CO/AK/NV notice vs WI none; pure helpers. Home care (`homecare-payroll.test.ts`, 20): 45 h across a Saturday-start week.

## Follow-up 2 — hosting choice at checkout
- The checkout now asks **"Keep Twomiah hosting it"** or **"I'll host it myself"** (no default; the button stays off until one is picked), with what each does written next to it before payment: the first keeps the subscription going; the second sets it to end when the period already paid for ends, with that date shown, and says that after it the site, app and texting no longer run on Twomiah.
- On payment, "I'll host it myself" calls Stripe `cancel_at_period_end` on the hosting subscription (never an immediate cancel; the service runs to the period's end). Done once per licence, retried if it fails (staff alerted), and recorded with the licence (`hosting`, `hosting_end_at`, `hosting_note`; **apply migration `2026-10-29_tenant_licenses_hosting.sql` after the 10-28 one**). The handover email and the Billing screen state the choice and the end date. A business with no subscription on file is recorded as such.
- Tests with no Stripe calls: choice required (a made-up one refused), carried in metadata, price unchanged by it, end called once and not on redelivery, failure → needs-attention then a retry ends it and nothing else, no-subscription case, and that the Stripe call is `cancel_at_period_end`, never a cancel.
- Note: when the subscription ends, Stripe's `customer.subscription.deleted` suspends the Twomiah-hosted app by the Factory's existing rule — that is the intent of "I'll host it myself".

## Checks run (all on the final branch)
- `scripts/check-unified-*.ts`: all pass (fence: 71 changes, inside). Also permission-vocabulary and action-colour guards. `bun run build:web`: ok.
- Tests: `export-everything` (7), `license` (8), `gusto-hours` (10), `homecare-payroll` (20), `boot` (24), Factory `own-it-license` (23) and all of `tests/unified/factory` (304) pass. No test calls Stripe, GitHub, Twilio or Gusto.
- Not run: the full unified suite (CI shards it) and the template suites.
