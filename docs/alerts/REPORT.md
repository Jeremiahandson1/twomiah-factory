# Error alerts — report

Branch `cloud/error-alerts` (from `engine`). Not merged, no PR.

Note: `docs/PROJECT_BRIEF.md` is on `main` but not on `engine` (the branch this started from), so I read it from
`origin/main` — it is the file to carry onto `engine` if cloud sessions are meant to find it there.

## What alerts now

One path: `apps/api/src/services/alerts.ts` → `raiseAlert(key, what, business, detail)` → the existing `notifyStaff`
(`STAFF_NOTIFY_EMAIL`, else `INTAKE_NOTIFY_EMAIL`, else `support@twomiah.com`). No new service, table or dependency.

- **First failure for a key** → email at once. Subject is plain English: `⚠ New signups are failing (500) — Acme Roofing`.
- **Same key again** → nothing. A burst of one error is one email (the send is claimed before the mail goes out, so
  concurrent repeats see it too).
- **Still failing 24 h later** → one `Still broken: …` reminder with the count and the first-seen time, then quiet again.
- **Recovery** → the success path calls `clearAlert(key)` (a good signup, a good job run, a verified Stripe event, a
  working compose …); the next failure is a fresh alert. No "recovered" email — that would be another message to mute.
- **Ceiling** → at most 10 alert emails an hour across *different* failures; the rest are counted into the next email.
- A mail that fails to send is not recorded as sent, so the next occurrence tries again. `raiseAlert` never throws and
  callers don't await it, so the customer's response never waits on, or changes with, an alert.

Everything in `INVENTORY.md` marked **wired** uses it: stalled/crashed builds, post-build records (address, features,
domain), the Anthropic account out of credit or key refused (one `ai:credit` alert for the whole builder, so ten
signups on an empty account is one email), AI site falling back to the template, signup / preview / intake / buy-a-website
500s, Stripe signature and handler failures, failed payments, domain purchase/refund/nameserver failures, wallet top-ups
and add-ons paid but not applied, the in-process scheduled jobs, the daily cron, unhandled request errors and crashes.

What the customer sees is unchanged: same status codes and bodies on every route (the `onError` reply is Hono's own default),
same fallback sites, same emails. `notifyStaff` gained one thing: a `null` tenant omits the "Tenant:" line.

The health monitor and the existing `notifyProvisionFailure` callers were left alone — the monitor already follows this
rule, and re-keying it would have stretched its 20 h reminder to 48 h.

## What still doesn't, and why

1. **State is in memory.** A Factory restart (every deploy) forgets it, so a failure still happening after a deploy
   alerts once more. A crash *loop* emails once per restart (each process is fresh; the 10/hour cap is per process too).
   A durable version needs a table — a new store, which the brief ruled out. This is the one thing I'd build next if it
   proves noisy.
2. **Hourly `cron/cleanup.ts`** is its own short-lived process each hour; with no memory between runs, alerting would mean
   an email every hour — exactly what gets muted. It needs the durable state above. It exits 1, so Render shows the failure.
3. **Failed deploys are one email per attempt**, not de-duplicated: `notifyDeployFailed` already emails staff and a test
   (`tests/shared/deploy-ownership.test.ts`) pins that line. A retry is a new attempt and arguably should say so.
4. **A thin AI site** (the compose "husk" retry throws and the first husk ships) is still only a warning: the site exists and
   the owner can request changes; detecting "thin" is a judgement, not a failure.
5. **Staff-triggered actions** (Update Code, staff compose) report to the staff member who clicked.
6. **Failures inside a tenant's own app** (its CRM erroring for its users) are not the Factory's; the health monitor only
   sees whether it answers.
7. **Slow-burn problems** — Anthropic credit *running low*, Stripe webhook *silence* — aren't failures any code path sees.
   Only the hard failure (account empty, signature rejected) alerts.
8. **Forged signature requests** can trigger the Stripe signature alert; de-duplication bounds that to one email a day.

## Tests

`tests/unified/factory/alerts.test.ts` (25 tests, mail/DB/Stripe/Anthropic all stand-ins): the rule (once, repeat, burst,
daily reminder, recovery, unsent retry, hourly cap, escaping); out of credit; AI fall-back; stalled build; scheduler jobs;
unhandled errors (and that an HTTP error isn't one); signup 500, preview 500, Stripe signature, handler 500, failed
payment — each producing one alert, a repeat none, a recovery a reset.
