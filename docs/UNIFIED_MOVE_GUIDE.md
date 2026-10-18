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
- `bun tests/unified/harness/crm.ts <filter>`: the base CRM's own behaviour suite against
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

# Merging a near-copy CRM into the unified app (step 3e)

The base CRM (`templates/crm`) is in the unified app. Each near-copy CRM (`templates/crm-<v>`) is a copy of it
that drifted: some files differ because the trade differs, some because one copy got a fix the others didn't,
some because the copy is simply older. Field service was merged first; follow what it did
(`verticals/fieldservice/settings.ts`, `CrmSettings` in `server/core/vertical.ts`, its entries in
`tests/unified/harness/unified-divergences.ts`, `git log --grep "field service"`).

The schema is already merged for every vertical (migration 0006): every table and column any of them has.
Don't change the schema; if you find a column missing, stop and report it.

## 1. Sort every file that differs from the base copy

For each file in `templates/crm-<v>/backend/src/routes/` (and the `services/` they use, `index.ts`'s gates
and timers, `middleware/permissions.ts`), diff it against `templates/crm/backend/src/...`
(`diff <(tr -d '\r' < A) <(tr -d '\r' < B)`), and put each difference in exactly one bucket:

- **The trade differs** (labels, which tables a shared module is handed, options, a checklist, a default):
  a switch. Use an existing `CrmSettings` field if one fits; otherwise add one — optional, documented, its
  absence meaning the base CRM's behaviour — and read it where the module is wired
  (`server/modules/crm.ts`, `server/crm/services.ts`). The vertical's `settings.ts` holds only data: no code.
- **A fix one copy has** (a bug comment, a T-number, a guard, a correct date range): apply it to the unified
  engine for every vertical, with a comment saying where it came from. Field service's examples: payroll's
  shop-day range, invoice.job_id revenue, the pricebook-trial gate.
- **The copy is older** (the base has the fix, the copy doesn't): nothing to do. Say so in your report.

Gates in the copy's `index.ts` that differ: the unified mount takes the union where both make sense
(`['service_agreements', 'maintenance_contracts']`), and both sides are gated (menu and API).

## 2. The vertical's own modules

Routes the base CRM doesn't have (`routes/<x>.ts` with no base counterpart) move the way the base's own
modules did — this guide's first half — into `apps/unified/server/crm/<v>/`, registered from that folder's
`index.ts` (already wired into `server/modules/crm.ts`), each behind the feature the copy's `index.ts`
gated it with. Their raw SQL goes in `server/data/<v><Module>.ts`.

## 3. Settings

`apps/unified/verticals/<v>/settings.ts`: id, label, mfaIssuer, featureSet (`crm-<v>`), role labels and
extra role permissions (from the copy's `middleware/permissions.ts`), `crm` switches, `screens` (every
`frontend/src/*Config.ts`, menu renames in `screens.nav` keyed by page address, `searchPlaceholder`), and the
website's `site` design and words (from `templates/website-premium-<v>` where one exists, else the closest).
Register it in `loadVertical` (`server/core/vertical.ts`).

## 4. Screens

The copy's screens with no base counterpart: move them with the move script into
`apps/unified/web/src/crm/pages/<v>/`, type them properly for strict TypeScript (no `@ts-nocheck`), fix every
read of a reply that became a list, and register their routes and menu items in
`apps/unified/web/src/crm/verticals/<v>.tsx` (already wired into `App.tsx` and `shell.ts`). A menu item is
gated by the copy's features, so other verticals never see it.

## 5. The suite

`tests/unified/harness/<v>.ts` (copy `fieldservice.ts`): the copy's own suite, unchanged, against the
unified app as `<v>`. Make it pass. A failure that is a deliberate difference — a reply shape the rulebook
replaced, the replaced booking module or website webhook, a test reading the template's own source — is
registered in `tests/unified/harness/unified-divergences.ts` under `<v>`, naming the assertions, why, and the
test that holds the behaviour on the unified app (write that test if none exists). Reply-shape ones get an
adapted copy (entries in the adaptation script; ask for it). Nothing is registered to make a real defect go
away.

## Working beside others

Several verticals are merged at once. `server/core/vertical.ts`, `server/modules/crm.ts`,
`server/crm/services.ts` and `unified-divergences.ts` are shared: change them only with the Edit tool (it
refuses if the file changed since you read it — then re-read and redo the edit), in small edits, never by
rewriting the file or with sed. Your own folders are yours alone.
