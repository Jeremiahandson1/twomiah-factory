# Claims true — report (2026-10-28)

Branch `cloud/claims-true`, from `engine` (d62e201c2). Four commits, one per claim, in this order. Nothing pushed to `engine` or `main`.
`docs/PROJECT_BRIEF.md` is not on `engine` (only `main`); it was read from `main`.

| | Claim | Commit |
|---|---|---|
| A | Hours to Gusto, every trade | `feat(payroll): hours for Gusto for every trade` |
| B | Export everything | `feat(export): "Export everything"` |
| C | Texting at true cost | `fix(texting): charge texts at true cost` |
| D | Buy it outright, self-serve | `feat(license): self-serve "Buy it outright"` |

Screens (desktop + phone, light + dark) are in this folder: `a-gusto-*`, `b-export-everything-*`, `c-texting-*`, `d-own-it-*`.
`tools/serve.ts` boots the real app on an in-memory DB; `tools/shoot.ts` takes the four shots. (The sticky header sits mid-page in a few full-page shots; that is the screenshot, not the page. The "Could not reach billing" line on the Billing shots is the stand-in Factory having no texting route.)

## A. Gusto hours export
- One shared builder (`server/crm/payrollExport/gustoHours.ts`); home care's `/api/gusto/export-csv` now calls it, no copy. Every other trade: `GET /api/payroll/gusto-hours` from `time_entry`, behind `payroll:read` (the pay run's permission), same entries and day-cut as the pay run, sync-log + audit row. "Hours for Gusto" button on the Pay run panel.
- **Not confirmed:** Gusto's help pages could not be fetched (403), and search shows only that Gusto's CSV upload ("Smart Import") auto-matches whatever columns the file has — no fixed template. We kept home care's header (`First Name, Last Name, Email, Regular Hours, Overtime Hours, Total Hours`). **Upload one real file in Gusto to confirm it maps.**
- **Your call:** the non-home-care pay run pays all hours flat (no overtime). The Gusto file splits overtime as hours over 40 in a Sunday–Saturday week (home care's rule), so Gusto would pay overtime the Twomiah pay run does not show. Say if you want everything exported as regular hours instead.

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
- Decisions for you: (1) buying does **not** cancel the hosted subscription (shown to the owner); (2) read access only, since the Factory keeps pushing updates to that repo; (3) the §7 text on screen is worded from your brief — **check it against the live Terms**, I could not see them (the website is a separate repo).
- Not built: a licences list in the platform dashboard (the row and audit entry exist).
- Needs live setup: `GITHUB_TOKEN` with permission to add collaborators on those repos, and R2 configured (already used by offboarding exports).

## Checks run (all on the final branch)
- `scripts/check-unified-*.ts`: all pass (fence: 71 changes, inside). Also permission-vocabulary and action-colour guards. `bun run build:web`: ok.
- Tests: new `export-everything` (7), `license` (7), `gusto-hours` (5), Factory `own-it-license` (16), `texting-true-cost` (11); `boot`, `admin-host`, `homecare-payroll`, all of `tests/unified/factory` (226) pass. No test calls Stripe, GitHub, Twilio or Gusto.
- Not run: the full unified suite (CI shards it) and the template suites.
