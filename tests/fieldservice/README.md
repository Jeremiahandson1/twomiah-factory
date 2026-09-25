# Field service behaviour suite

Run against a **real Postgres** (in-process PGlite) and the **real route files** — not mocks.

```bash
bun tests/fieldservice/harness/run.ts        # everything
bun tests/fieldservice/harness/run.ts t26    # only files whose name contains "t26"
KEEP=1 bun tests/fieldservice/harness/run.ts # leave the sandbox in place
```

The runner is `tests/harness/runSuite.ts`, shared with the salon suite; the only difference between the
two is the template name. See `tests/salon/README.md` for how the sandbox is assembled and why the
permission layer stays real.

## Why this suite exists

T26 left four findings — M2, L1, L2, L12 — whose evidence on the live tenant is a **row count**: 8 jobs
pointing at a deleted roster member, 25 invoices with a null due date, 39 quotes with no expiry, 19.5
billable hours worth nothing. Every one of those counts rows written *before* the fix, so a redeploy moves
none of them and the numbers look identical whether the code works or not. Counting rows cannot tell you
whether the behaviour is fixed; only a write can, and a write belongs here rather than on a tenant a
person is testing.

Each test uses settings that are deliberately **not** the defaults — 14-day quote validity, 45-day
payment terms — so a fallback that happens to match the built-in default cannot pass by luck.
