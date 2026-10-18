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
| An action with nothing to return | `{ success: true }` |

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
  by hand, so a module can't be reachable with its feature switched off.
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

The `engine` branch only adds files, in `apps/unified/`, `tests/unified/`,
`scripts/check-unified-*.ts`, `.github/workflows/unified.yml` and `docs/`. It never
modifies or deletes an existing file, with three exceptions:

- `docs/SPEC_UNIFIED_PRODUCT.md`, the design this branch builds.
- `bun.lock`, which the install regenerates when the app joins the workspace.
- `packages/*/package.json`, only to declare libraries the shared code already
  imports. The Factory copies only a package's `src/` into a live CRM, so a live CRM
  never sees this file.

Existing shared code in `packages/*/src` is used as it is, read-only. Anything moved
out of existing code (rather than imported) is listed in `docs/CUTOVER_LEDGER.md`,
so the original is deleted at cutover and no second copy survives.

## 11. No new convention without a yes

When a task has a proper way and a quick way, the proper way is proposed and the
owner decides. Nothing in this rulebook is worked around; a rule that is wrong is
changed here, with its check.
