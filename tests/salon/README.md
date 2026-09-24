# Salon behaviour suite

402 assertions across 22 files, run against a **real Postgres** (in-process PGlite) and the **real route
files** — not mocks. This is what has caught most of the regressions in the T27–T30 campaign, including
several of mine before they shipped.

```bash
bun tests/salon/harness/run.ts          # everything
bun tests/salon/harness/run.ts t30      # just the files whose name contains "t30"
KEEP=1 bun tests/salon/harness/run.ts   # leave the sandbox in place to poke at
```

## What actually runs

`harness/run.ts` assembles a tenant in a temp directory, per run, out of the current tree:

| | |
|---|---|
| `templates/crm-salon/backend` | the real routes, services and schema |
| `packages/tenant-backend/src` | vendored in as `src/shared`, exactly as the Factory does it |
| `harness/fixtures/db-index.ts` | the node-postgres Pool → in-process PGlite |
| `harness/fixtures/middleware-auth.ts` | bearer verification → an `x-test-user` header |
| `harness/fixtures/setup.ts` | the tenant's own migrations in journal order, then the boot reconcile |

Assembling it per run rather than committing a sandbox is the point: the suite cannot drift away from the
templates it tests, and no generated code lands in git.

**The permission layer is real.** Only the *identity* check is stubbed, so `requirePermission` and
`requireRole` are exercised for real — which is where the T28/T29 role findings were caught. A sandbox
that stubs `requireRole` to a no-op makes every 403 assertion pass vacuously; don't do that.

**`TZ=UTC` is pinned by the runner.** Several tests assert on the *shop's* calendar day rather than the
server's, and a runner in another zone reads green on a real defect. `t28-evening-dates.test.ts` goes
further and pins the clock to 01:30 UTC — 20:30 the previous day in Chicago — so the UTC day and the shop
day differ and only one answer can be right; it exits non-zero rather than draw a conclusion if they
happen to coincide.

## Writing one

Each file is standalone: set up its own company and users, hit the routes through Hono, print `ok`/`FAIL`
per assertion, and exit non-zero if any failed. No framework. A test states the behaviour in the words of
the person who reported it:

```ts
check('an appointment with no client is refused', r.status === 400, r.json)
```

Two things to hold to, both learned the hard way:

- **Prove it fails.** A test that passes against the broken code is worse than none, because it certifies
  the bug. Break the fix, watch it go red, put it back.
- **Assert the fix, not the symptom.** `t30-email-usage` checks that a review email is recorded *and*
  that a campaign is not double-counted — the two pull against each other, and without the second the
  obvious fix looks correct while silently double-counting every campaign.
