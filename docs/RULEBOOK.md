# Twomiah Rulebook

The one way things are done in the unified app (`apps/unified`, see
`docs/SPEC_UNIFIED_PRODUCT.md` §0). Every rule marked **[checked]** is enforced by
`scripts/check-unified-rules.ts`, which runs on every push to `engine` and fails the
build on a violation. A rule is changed only with the owner's yes, and the check
changes in the same commit.

Each rule codifies what the existing code already does most often, so moving code
in means conforming, not rewriting.

## 1. One language **[checked]**

TypeScript, front and back. No `.js`, `.jsx`, `.mjs` or `.cjs` source files.

## 2. One naming convention **[checked]**

- Database tables and columns are `snake_case`: `audit_log`, `company_id`.
- TypeScript names and API JSON keys are `camelCase`: `auditLog`, `companyId`.
- New tables are singular nouns (`contact`, `page`, `portfolio_item`), as 140 of the
  base CRM's 148 tables are. Names inherited from existing tables keep their spelling
  so tenant data moves across unchanged.
- One set of column types: JSON is `json`, never `jsonb` (60 to 0 in the base CRM);
  a timestamp is `timestamp` without a time zone and holds UTC (395 to 6). A
  top-level record carries `company_id`; a child row (a line item) reaches its
  company through its parent.
- The Drizzle schema is the only place the two meet. Raw SQL (`sql\`...\``,
  `.execute(`) is allowed only in files under `apps/unified/server/data/`, and those
  functions return camelCase objects. A database row in snake_case never reaches a
  reply.

## 3. One reply shape **[checked]**

| Reply | Shape |
|---|---|
| Error | `{ error: string, code?: string, fields?: { [field]: message } }` with a 4xx/5xx status; `fields` only on a validation failure, so a form can mark each wrong box |
| List | `{ data: T[], pagination: { page, limit, total, pages } }` |
| One record | the record object |
| An action with nothing to return | `{ success: true, message?: string }`; `message` only when the screen shows the person a sentence |

Code in `apps/unified/server` replies only through `server/http/reply.ts`
(`fail`, `list`, `one`, `done`). Calling `c.json(` anywhere else in the server
fails the check. (The shared packages already use these shapes: 656 of their 656
error replies are `{ error: ... }`, and their lists are `{ data, pagination }`.)

## 4. One name per thing **[checked]**

- The business is the `company` table. A person who signs in is the `user` table.
  Every vertical. What the screen calls them ("Agency", "Practice", "Shop") comes
  from the vertical's vocabulary in its settings, never from a table name.
- Table names that would fork these are refused: `companies`, `users`, `agency`,
  `agencies`, `tenant`, `tenants`.

## 5. One ID type **[checked]**

Every table's primary key is `id: text('id').primaryKey().$defaultFn(() => createId())`
(cuid2), exactly as the base CRM's 148 tables do.

## 6. One way to mount an API **[checked]**

- Every API router is mounted through `apps/unified/server/http/registry.ts`. Each
  entry declares its `access` (`public`, `factory` or `user`) and, for an optional
  module, its `feature` id from the shared feature registry.
- The registry applies sign-in and the feature gate. Nothing mounts an `/api` route
  by hand, so a module can't be reachable with its feature switched off. A module's
  router may compose another at its own root (`.route('/', inner)`, e.g. to put an
  admin gate in front of a shared router); that adds no path.
- Inside a router, each action checks its permission with `requirePermission`.

## 7. One way to change the database **[checked]**

A numbered Drizzle migration in `apps/unified/server/db/migrations`, applied at boot.
Never `drizzle-kit push`.

## 8. Verticals are settings and add-ons, never copies **[checked]**

- A vertical lives in `apps/unified/verticals/<id>/`: `settings.ts` and an optional
  `addons/` folder, nothing else.
- No file in a vertical may be a copy of an engine file.
- A vertical never imports from another vertical.

## 9. Every tenant is built by the Factory

No hand-built tenants. Anything special about a tenant is a Factory setting, so the
Factory can rebuild and update every tenant the same way.

## 10. The live system is not touched during construction **[checked]**

The `engine` branch adds files in `apps/unified/`, `tests/unified/`,
`scripts/check-unified-*.ts`, `.github/workflows/unified.yml`, `docs/`, and
`apps/api/src/unified/` — the Factory's side of the unified app (a database server and a service per tenant,
Update Code), added beside the Factory and wired in at cutover (owner's yes, 2026-10-18); no existing
Factory file changes, so nothing live imports it before then. The
templates and the Factory (`templates/`, `apps/api/`, `apps/platform/`) are not
modified or deleted. The existing files it may change:

- **The shared code, `packages/*/src`.** It is the engine: the unified app improves
  it in place instead of copying it (owner's yes, 2026-10-18). The CRM templates use
  the same code, so every existing check (`build-check.yml`: the guards and every
  CRM behaviour suite) runs on every push to `engine`; a change that breaks a
  template fails there. Nothing reaches a live customer before cutover.
- `.github/workflows/build-check.yml`, only its `on:` trigger, so it runs on `engine`.
- `packages/*/package.json`, only to declare libraries the shared code imports.
- `docs/SPEC_UNIFIED_PRODUCT.md`, the design this branch builds.
- `bun.lock`, which the install regenerates.
- **Cutover (owner's "go", 2026-10-20):** the live Factory (`apps/api/src`, `apps/api/schema.sql`, `apps/api/migrations`,
  `apps/platform/src`, `tests/shared`) gains the unified path behind a switch (`UNIFIED_SIGNUPS`: off, test, all) that
  starts **off**: merged and deployed, nothing changes for any business until it is turned.
- **The unified app's own places, once merged (2026-10-20):** `engine` was merged into `main`, so the unified app's
  files exist there too and changing one reads as an existing file changed. Its own places — `apps/unified/`,
  `apps/api/src/unified/`, `tests/unified/`, `scripts/check-unified-*.ts`, `.github/workflows/unified.yml`, `docs/` —
  may be changed and deleted as freely as they were added. The templates, the rest of `scripts/` and
  `build-check.yml`'s jobs keep the rule above.
- **The CRM templates' behaviour suites' own test files** (`tests/<suite>/*.test.ts`, 2026-10-20): a test can be wrong
  while the live code is right, and its fix runs nothing live. Their harnesses and the templates keep the rule above.
- `apps/mobile/` and its tests `tests/mobile/`, the phone app: it has no users yet, so it changes with the unified app
  (owner, 2026-10-19) — its files may be changed, added or deleted.
- The four guards that check the shared feature registry and shared defaults (`scripts/check-feature-vocabulary.ts`,
  `check-not-ready-features.ts`, `check-parked-features.ts`, `check-vertical-vocabulary.ts`), only when a change to
  `packages/*/src` changes what they check — so `build-check.yml` keeps meaning something on `engine`.

Anything moved out of existing code (rather than imported) is listed in
`docs/CUTOVER_LEDGER.md`, so the original is deleted at cutover and no second copy
survives.

## 11. No new convention without a yes

When a task has a proper way and a quick way, the proper way is proposed and the
owner decides. Nothing in this rulebook is worked around; a rule that is wrong is
changed here, with its check.
