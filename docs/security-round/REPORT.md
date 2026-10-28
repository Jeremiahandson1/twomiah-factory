# Security round — report (2026-10-27)

Branch `cloud/security-round`, from `engine` (525f47a). `docs/security-round/REACHABILITY.md` has, per finding, whether our
app can reach it, with file:line.

## Audit count (`cd apps/unified && bun audit --prod`)

|  | high or critical | moderate / low |
|---|---|---|
| Before (engine, today) | **20** (1 critical, 19 high) | about 40 |
| After, with every commit on this branch | **4 high** (basic-ftp ×1, extract-zip ×2, zod ×1) | 2 (react-router) |
| After, only the commits the fence allows (up to `1db87eb`) | 5 high (the four above plus drizzle) | 2 (react-router) |

(The brief said 34; engine had already moved. 20 is what the audit printed at the start of this work.) The one critical, maplibre-gl, is gone.

## Upgraded, one commit each

| Commit | Change | Notes |
|---|---|---|
| `4697068` | **maplibre-gl 4.7.1 → 6.16.0** (the critical) | v5+ has no default export and loads its worker as a module file that a bundler does not copy: `import * as maplibregl`, the worker's built URL is given with `setWorkerUrl`, and the admin screens now serve `.mjs` as JavaScript (`server/http/adminScreens.ts`, test in `boot.test.ts`). Rendered with real tiles: the map loads, existing edges draw with labels, and a new edge can be drawn and measured (`docs/security-round/roof-map-editor-maplibre6-*.png`; the page is a harness, so it is unstyled by Tailwind). |
| `afd0cbc`, `143a461` | **patch/minor**: hono 4.13.11, qs 6.16.1, js-yaml 4.3.2, ip-address 10.7.4, brace-expansion | lock only. The basic-ftp override in the first commit was refused by the fence and removed by the second (below). |
| `b6c6246` | **nodemailer 6.10.1 → 10.2.1** (+ @types 8) | `apps/unified` only. A first draft (`import * as`) broke four store suites that stub the transport by patching the default export; it was caught by the CRM "adapted" suite and reverted to the default import before the commit. |
| `24ef195` | **csv-parse 5.5.5 → 7.0.3** | `apps/unified` only; the CSV import API (`csv-parse/sync`, `columns: true`) is unchanged. |
| `1db87eb` | **react-router open redirect closed in code** | `?returnTo=` in `packages/tenant-ui/src/contacts/ContactsPage.tsx` went straight to `navigate()`; `/\evil.example` is a host. `safeReturnPath` keeps app paths only. The library stays at 6.30.6. |
| `3d7b9fd` | **zod 3 → 4.6.6** — **fence-blocked, take or leave** | see below |
| `63c741d` | **drizzle-orm 0.36.4 → 0.45.4** — **fence-blocked, take or leave** | see below |

### What the zod migration found (worth knowing even if you leave it)
zod 4's `.partial()` applies a field's `.default(...)`. `PUT /api/invoices/:id` with `{ notes }` would have saved
`discount: 0, lineItems: []` over the invoice's real lines — silent data loss, 43 `.partial()` update schemas. It was caught by
`contractor-live-1022` ("saving it unchanged still works"). `partialOf()` (`packages/tenant-backend/src/partialOf.ts`,
test `tests/partial-of.test.ts`) keeps the zod-3 behaviour; every update schema uses it. Other changes: `invalid_type_error` /
`required_error` / `errorMap` → `error`; `z.record(v)` → `z.record(z.string(), v)`; `ZodError.errors` → `.issues`.
The app's own messages are kept; zod's default text for a missing field changed ("Required" → "Invalid input: expected …").

## What the fence blocked, and why (RULEBOOK §10, `scripts/check-unified-fence.ts`)

The rule (docs/RULEBOOK.md §10): the existing files a unified-app branch may change are `packages/*/src`, **`packages/*/package.json`
"only to declare libraries the shared code imports"**, `bun.lock`, and the unified app's own places. The script enforces it:
a shared manifest may only **gain** declarations — any existing entry changed is refused (`onlyDeclaresMore`); the **root `package.json`**
is not on the list at all.

| File refused | Rule | What the upgrade changes there | Who runs that code today |
|---|---|---|---|
| `package.json` (root) | not in `MODIFY_ALLOWED` | adds `"overrides": { "basic-ftp": "^6.2.3" }` — the only way to patch basic-ftp, which `puppeteer > proxy-agent > get-uri` pins to 5.x | the whole monorepo install (every workspace, the Factory's own build, templates). **Not committed** (reverted in `143a461`); basic-ftp stays 5.3.1. |
| `packages/tenant-backend/package.json` | `onlyDeclaresMore`: `dependencies.zod changed` | `zod ^3.22.4` → `^4.6.6` (commit `3d7b9fd`) | **Every unified customer** (the app imports it as a workspace package) **and every generated template tenant**: `apps/api/src/services/generator.ts` (≈375, 782) copies `packages/tenant-backend/src` into each template CRM, whose own manifest still says zod ^3. The vendored code uses only APIs that exist in zod 3 or are ignored by it (`error:` params are ignored → default messages; `removeDefault`, `.issues`, 2-arg `z.record` exist in 3), so a template tenant keeps working with zod 3 but loses a few custom messages. |
| `packages/tenant-backend/package.json` | same: `peerDependencies.drizzle-orm changed` (it is declared as both a dependency and a peer) | `drizzle-orm ^0.36.4` → `^0.45.2` (commit `63c741d`) — manifest only, **no source change was needed** | same two groups. Template tenants carry their own manifests (^0.36.4), so they are unchanged. |
| `packages/tenant-ui/package.json` | same | `react-router-dom ^6` → `^7.18`: not attempted (see below) | unified admin screens and every template's frontend. |

I did **not** change the fence or RULEBOOK §10 (editing the guard was refused, correctly, and is yours to decide). Two commits
(`3d7b9fd` zod, `63c741d` drizzle) are on the branch **last and separate**; `check-unified-fence.ts` fails on them by design —
drop either (or both) with `git revert` / by cherry-picking the earlier ones; the commits before them pass the fence
(`bun run scripts/check-unified-fence.ts origin/main` at `1db87eb`: "all inside the fence").
If you accept them, the fence needs one narrow rule: a shared manifest's existing range may be *raised* for a library named in a
security audit — and the root `package.json` may change its `overrides`. I had that edit drafted (a `RAISABLE` list and an
`onlyOverridesChanged` check) and did not apply it.

## What is left

- **drizzle**: done and green (below), but waiting on the fence. The SQL-identifier advisory is **not reachable today**
  (REACHABILITY.md: every identifier is a constant, the catalogue, or allow-listed), so this is hardening.
- **zod**: green, waiting on the fence. The reachable part (oversized arrays on public routes) also wants a body-size
  limit (`hono/body-limit`) — there is none anywhere in `server/`. A transitive zod 3 stays (`eslint-plugin-react-hooks` in
  platform, `puppeteer > chromium-bidi`): no 3.x fix exists; not reachable (dev tooling; local browser protocol).
- **react-router** (moderate): 6 → 7 changes the manifests of `tenant-ui` and `apps/platform` and the shared screens' router
  imports — skipped as told. The one reachable use (`returnTo`) is already closed in code.
- **extract-zip** (2 high): no version fixes it; install-time only (Chromium download for puppeteer). **basic-ftp** (1 high):
  needs the root override above. Both are unreachable at runtime (REACHABILITY.md).
- **Not done:** step 5, adding `apps/unified` to `security-scan.yml`. The audit is not clean (4 high, 2 moderate), so I did
  not. If you take zod and drizzle, only the three unreachable ones remain; `--ignore` those three GHSA ids in the workflow (with
  their reasons), or fix the fence first.

## Checks

One full gate on the branch tip (all commits, zod and drizzle together), after the per-upgrade runs of patch/minor, zod,
nodemailer and drizzle:

- `apps/unified` tests, all files (3 shards): **200 files, 0 failed** (includes the new `partial-of`, `safe-return-path`, `boot` .mjs test).
- `tests/unified/factory` (build end to end + the rest): **212 pass, 0 fail**.
- CRM suites on the unified app (crm, fieldservice, basic, landscaping, restaurant, bar, rv, salon, vet, homecare, adapted): **all 11 exit 0**.
- `scripts/check-unified-*.ts`: **10 of 11 pass** (types: 0 errors, shared baseline 203 unchanged; whole-lists, write-controls,
  rules, …). **`check-unified-fence.ts` fails, on purpose of the two blocked commits**: `packages/tenant-backend/package.json`
  (zod, drizzle-orm). It passes at `1db87eb` ("12 change(s) … all inside the fence").
- `bun run build:web` (apps/unified) builds; `bun run build` in apps/api builds.
- Not run: `build-check.yml`'s other jobs (platform build, the template guards) and the templates' own suites — the shared lock
  moved under them; CI runs them when you release to engine. `apps/platform` was not built here.
- Sandbox notes: pglite `beforeEach` needs `--timeout 120000` (the runner uses it). A container restart mid-run killed the first patch/minor
  gate; the unified, Factory and eight CRM suites had already passed, and the remaining suites, guards and builds were re-run
  on the same tree.
