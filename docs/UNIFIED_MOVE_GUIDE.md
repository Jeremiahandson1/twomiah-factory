# Moving a template module into the unified app

How a CRM template's own code (a `routes/*.ts` file and the `services/*.ts` it uses, in
`templates/<crm>/backend/src`) moves into `apps/unified`. Read `docs/RULEBOOK.md` first;
this is how its rules apply to a move. The behaviour must not change except where this
guide says so, and every change is reported.

## Where it goes

- The router: `apps/unified/server/crm/<group>/<module>.ts`, exporting
  `create<Module>Routes(d: CrmDeps)` that returns a `Hono<AppEnv>`.
- Its service, if the template had one only it uses: in the same file, or
  `server/crm/<group>/<module>Service.ts` exporting `create<Module>Service(d: CrmDeps)`.
- Every query that uses raw SQL (`sql\``, `sql.raw(`, `.execute(`):
  `apps/unified/server/data/<module>.ts`, one named function per query, taking `db` as its
  first argument and returning camelCase objects. The router/service calls it.
- Registration: the group's `server/crm/<group>/index.ts` returns the `Mount[]`.
- Schema tables are imported directly: `import { rfi, project } from '../../db/schema/index.ts'`.
  The schema already has every base-CRM table, column for column. Don't change the schema; if
  a module needs a change, stop and report it.
- Shared code: `import { createActorName, ... } from '@twomiah/tenant-backend'`.
- `CrmDeps` (`server/crm/deps.ts`) carries `db, audit, logger, authenticate, permissions,
  features, realtime, services`. `services` is `server/crm/services.ts` (sms, stripeService,
  reviews, emailService, storage, bulk, …). Live updates: `d.realtime.emitToCompany`,
  `d.realtime.EVENTS`. Free-text cleaning: `server/core/sanitize.ts`.

## The mount

```ts
{ path: '/api/rfis', access: 'user', feature: 'rfis', router: createRfiRoutes(d) }
```

- `access: 'user'`: the registry signs the person in before the router runs, so the router
  does NOT `use('*', authenticate)`. Remove the template's line.
- A router with paths that must answer without a session (a provider webhook, a customer's
  link, a public page): `access: 'public'`, and the router applies `d.authenticate` itself to
  everything else, after the public paths, exactly as the template ordered them.
- `feature`: the id the template's `index.ts` gated the path with
  (`requireEnabledFeature('x')`). If the template didn't gate it, look at the template
  frontend's sidebar gate for its screen (`templates/<crm>/frontend/src`, the shell config's
  `features`). If the screen is gated, gate the API the same (gate both sides). If neither is
  gated, leave it ungated. Report which you chose.
- Inside the router, each action keeps its `requirePermission(...)` exactly as the template
  has it: `d.permissions.requirePermission('rfis:read')`. A template action with NO
  permission check keeps none, but you report it as a finding.

## Replies (RULEBOOK §3): only `server/http/reply.ts`

| Template | Unified |
|---|---|
| `c.json({ error: 'X' }, 404)` | `fail(c, 404, 'X')` |
| `c.json({ error: 'X', code: 'y' }, 409)` | `fail(c, 409, 'X', 'y')` |
| `c.json({ error: 'Validation failed', details: parsed.error.issues }, 400)` | `invalid(c, parsed.error)` (`server/http/errors.ts`) |
| `c.json({ data, pagination: {page, limit, total, pages} })` | `list(c, data, { page, limit, total })` |
| `c.json(rows)` where `rows` is an array | `list(c, rows, { page: 1, limit: rows.length, total: rows.length })`, and REPORT the endpoint: its screen must read `.data` |
| `c.json(record)` / `c.json(record, 201)` | `one(c, record)` / `one(c, record, 201)` |
| `c.json({ success: true })` | `done(c)`; with a sentence the screen shows: `done(c, 'Sent.')` |
| `c.json({ success: true, something })` | `one(c, { success: true, something })` |
| other extra fields on an error (`{ error, max, page }`) | keep the sentence and `code`; put the rest in the sentence or drop it. Report it. |

Use the `AppEnv` type for `c.get('user')`: `new Hono<AppEnv>()` from `server/http/env.ts`.
A thrown error with `.status` becomes that reply through `server/http/errors.ts`.

## What must not change

- Paths, methods, permissions, validation, the numbers a route computes, what it writes.
- Audit rows: keep every `audit.log(...)` call (`d.audit.log`, `d.audit.ACTIONS`, `d.audit.ENTITIES`).
- Background timers the template started at import time: don't start them in the factory.
  Report them; they're started once from `crm/services.ts` `startJobs`.

## Checking

From the worktree root (`C:/ALL TWOMIAH PRODUCTS/engine-wt`):

- `bun scripts/check-unified-rules.ts`: the rules, including no `c.json(` and no raw SQL
  outside `server/data/`.
- `bun scripts/check-unified-types.ts`: 0 type errors in the app. Shared baseline unchanged.
- `bun tests/crm/harness/run-unified.ts <filter>`: the base CRM's own behaviour suite against
  the unified app, filtered by file name (e.g. `bids`, `t32-`). Each run gets its own sandbox.
- `cd apps/unified && bun test tests`: the app's own tests.

A test in `tests/crm` that fails because it expects the template's old reply shape (a bare
array where the rulebook says `{ data, pagination }`) is reported, never edited. The tests
under `tests/<crm>` are the templates' and are fenced.

## Reporting

For each module, give:

1. The mount line(s).
2. A ledger row for `docs/CUTOVER_LEDGER.md` (the unified file | the template file it came from | notes).
3. Every endpoint whose reply shape changed.
4. Findings: defects in the template code you moved (a missing permission, a 500, a leak).
   Fix one in the unified copy only when the fix is narrow and certain, and say so.
5. The suite result for the tests that cover it.
