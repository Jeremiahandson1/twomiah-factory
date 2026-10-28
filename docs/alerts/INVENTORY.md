# Failure inventory — where a customer-facing failure was only a log line

Surveyed 2026-10-28 on branch `engine`. Every row was a `console.error` / `console.warn` (or silent) with no email to the
owner. "Wired" rows now go through `apps/api/src/services/alerts.ts` (see REPORT.md). Line numbers are on the
`cloud/error-alerts` branch, at the log line or the nearest statement.

Already alerting before this work (left as they were): `notifyDeployFailed` → `notifyProvisionFailure` on every failed
deploy (`services/email.ts:370`), signup's "Build generation" failure (`routes/factory/intake.ts` Auto-generate catch),
a preview given up on (`intake.ts` `giveUpOnPreview`), the health monitor (`services/healthMonitor.ts`, transition +
daily reminder), billing/lifecycle/CRM add-on/domain renewal via `notifyStaff`, hourly-cron `backup.ts` and
`regression.ts`.

## 1. Builds and deploys

| Failure | Where it was only logged | Alert |
|---|---|---|
| Unified build stalls (still running at 15 min; the customer got a "still working" email, the owner nothing) | `unified/factory.ts:449` | **wired** `deploy-stalled:<tenant>`; cleared when the build ends |
| Template build stalls | `routes/factory/deploy.ts:523` | **wired** (same key) |
| Paid customer's build never starts: `triggerAutoDeploy` rejects | `routes/factory/billing.ts:273`; `routes/factory/deploy.ts:931` | **wired** `deploy-crashed:<tenant>` |
| Build finished but the tenant's address couldn't be saved ("CRITICAL tenant update failed") | `unified/factory.ts:558` | **wired** `deploy-record:<tenant>` |
| Live but features not switched on (sync HTTP error / threw) | `unified/factory.ts:600,603` | **wired** `feature-sync:<tenant>` |
| Customer's own domain not connected after the build | `unified/factory.ts:623,633` | **wired** `domain-wiring:<tenant>` |
| Build fails outright | `unified/factory.ts:658`, `deploy.ts:511` | already alerted (`notifyDeployFailed`) — each failed attempt is its own event, so not de-duplicated |
| Staff-clicked Update Code fails | `deploy.ts` `startUnifiedUpdate` | not wired — staff started it and the result is on the job |

## 2. AI site builder

| Failure | Where | Alert |
|---|---|---|
| Anthropic out of credit / key refused, on a signup's AI site (the site silently falls back to the template) | `services/signupSite.ts:225` (catch around `composeSite`, `sectionComposer.ts:2239`) | **wired** `ai:credit` / `ai:auth` — one alert for the whole builder, naming the first business hit; cleared by the next successful compose |
| Same, on the intake/preview composer | `routes/factory/intake.ts` `autoComposeForNewIntake` (~:1968), staff compose (`:1269`) | **wired** (same keys) |
| AI compose gave up (attempts used) → template site | `signupSite.ts:225,272` | **wired** `ai-site:<tenant>` |
| AI site not ready when the build started → template site | `signupSite.ts:296` | **wired** `ai-site:<tenant>` |
| Compose "husk" retry throws and the husk ships | `sectionComposer.ts` husk-retry catch | not wired — output is still a site, just a thin one; see REPORT |

## 3. Public routes

| Failure | Where | Alert |
|---|---|---|
| `POST /public/signup` → 500 (account insert, or anything uncaught) | `routes/factory/intake.ts:448,632` | **wired** `route:signup`, named by the business typed in |
| `POST /public/signup` → 502, checkout could not be started | `intake.ts:618` | **wired** `route:signup-checkout` |
| `POST /public/preview` → 500 (premium and standard renders) | `intake.ts:1023,1058` | **wired** `route:preview` |
| `POST /public/intake` → 500 | `intake.ts:899,938` | **wired** `route:intake` |
| Buy-a-website checkout → 500 / 502 | `intake.ts:2363,2369,2410` | **wired** `route:checkout-premium` |

## 4. Stripe and money

| Failure | Where | Alert |
|---|---|---|
| Webhook signature rejected (wrong secret = every payment silently dropped) | `routes/factory/billing.ts:211`; Connect `:181` | **wired** `stripe-webhook-signature`, `stripe-connect-signature`; cleared by the next verified event |
| Webhook handler → 500 | `billing.ts:402` | **wired** `stripe-webhook:<event type>` |
| Payment failed (`past_due`) — the customer got an email, the owner didn't | `billing.ts:~394` | **wired** `payment-failed:<tenant>`; cleared when the tenant goes `active` |
| Domain the customer paid for can't be registered → refund | `billing.ts:563` | **wired** `domain-register:<tenant>` |
| …and the refund itself fails | `billing.ts:569` | **wired** `domain-refund:<payment>` |
| Post-payment domain registration crashes | `billing.ts:291` | **wired** |
| Domain bought, nameservers not set | `billing.ts:532` | **wired** `domain-nameservers:<tenant>` |
| Texting wallet top-up paid, not credited | `billing.ts` `[Wallet] Top-up credit failed` | **wired** `wallet-topup:<tenant>` |
| Texting / AI add-on paid, not switched on | `billing.ts` `[Messaging]/[AI] Enable mark failed` | **wired** `addon-enable:*` |

## 5. Scheduled jobs

| Failure | Where | Alert |
|---|---|---|
| In-process jobs (`booking-reminders`, `a2p-poll`, `email-alias-sweep`, `preview-sweep`, …) answer non-2xx or can't be reached | `services/scheduler.ts:54,58` | **wired** `job:<name>`; cleared on the next good run, so an hourly job that stays broken is one email a day |
| Daily lifecycle cron (trial/renewal/health/backup sweeps) reports errors | `cron/daily.ts` | **wired** `cron:<path>` (a once-a-day process, so one email a day at most) |
| Hourly `cron/cleanup.ts` fails | `cron/cleanup.ts:32,37` | **not wired** — see REPORT |

## 6. Unhandled

| Failure | Where | Alert |
|---|---|---|
| A request throws past its route's own try/catch (Hono default handler: log + bare 500) | `index.ts:87` (`app.onError`) | **wired** `unhandled:<METHOD> <route>:<message shape>` — ids and numbers are stripped from the key, so one bug is one email |
| Uncaught exception / unhandled rejection (Bun exits 1) | `index.ts:88` (`installCrashAlerts`) | **wired** — alert first (≤5 s), then exit 1 exactly as before |
