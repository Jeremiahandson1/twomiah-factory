# Security round, part 2 (2026-10-28)

Branch `cloud/security-round-2`, from `engine`. Pushed only there. Three planned steps; steps 1 and 2 done, **step 3 not done** (stop-and-report: the audit is not clean).

## 1. zod 3 -> 4 (GHSA-mrhx-c7xc-m3w5) — done, commit `804dfa0`

**Why the first try was reverted:** the shared code was rewritten to zod 4's `{ error: '…' }`; the 15 templates install their own `zod ^3.22.4` and vendor the shared code, and zod 3 ignores `{ error }`, so tests saw "Required" / "Expected number, received nan".

**Researched, not guessed** (same probe run on zod 3.22.4, 3.25.76 and 4.6.6):

| form | zod 3.22.4 | 3.25.76 | 4.6.6 |
|---|---|---|---|
| `invalid_type_error` / `required_error` | works | works | gone |
| `errorMap` (needed for literal, enum) | works | works | ignored |
| `{ error }` | ignored | ignored | works |
| `{ message }` | not honoured | works, **except on a literal** | works |

No single form works on all three, so the shared code now calls one helper, `zmsg('text')` (`packages/tenant-backend/src/zodMessage.ts`), which picks the form by the zod that is loaded (`z.core` exists only on 4). It replaces only the three problems a person's typing causes (type / literal / enum); a rule's own message keeps it and a rule without one keeps zod's default (as zod 3's `invalid_type_error` did). The matrix above was run against the helper too: same answers on all three versions. `partialOf()` (data-loss fix: zod 4's `.partial()` applies defaults and would wipe an invoice's lines on a PUT) is unchanged and works on 3 and 4 (checked). The unified app (zod 4 only) keeps `{ error }`.

**Guards:** `scripts/check-roof-validation.ts` now also accepts `partialOf(aiRuleFields)` (widened, not weakened: the old shape still passes) and is on the fence's allowed-guard list with a comment (`check-unified-fence.ts`). `docs/SECURITY_UPGRADES.json` has the zod entry back. `crm-automotive` and every template manifest untouched.

**Proof:** all 13 template suites (`tests/<suite>/harness/run.ts`) pass under **zod 3.25.76** (the version their sandboxes install, checked in the sandboxes); all 11 CRM suites on the unified app (zod 4) exit 0 (their "div" lines are the documented divergences); `apps/unified/tests/zod-message.test.ts` and `partial-of.test.ts` hold the helper and the partial. `^3.22.4` can resolve to 3.22.4 too: the helper was probed on it.

## 2. react-router 6 -> 7 (open redirect) — done, commits `1772767` and a follow-up

- `apps/unified` `react-router-dom ^7.18.2`. The built bundle has one router copy (v7.18.3). Build and types unchanged (baseline 203 shared / 0 app). `safeReturnPath` stays; its test passes.
- Rendered through the real server in a browser, desktop and phone (`docs/security-round/react-router-7/`): login, dashboard, contacts, a contact's detail (`:id` route), quotes, invoices, schedule, settings, sidebar link then browser back — all render, no page errors (the only console errors are the harness's missing live-socket). One thing I did **not** prove in a browser: the `?returnTo=` follow-through (my probe cancelled the edit modal without taking the `leaveModal` path); that is held by the `safeReturnPath` unit test.
- **Found by the full run and fixed (follow-up commit):** `stripe-link-card` and `job-notes-photos` failed with "useNavigate() may be used only in the context of a <Router>": `packages/tenant-ui` had its own `react-router-dom` 6 in its node_modules, so a shared screen and the test's `MemoryRouter` were two routers. The built app was never affected (vite dedupes), but the tests were right. Fix: tenant-ui's **dev** dependency to `^7.18.2`, with a ledger entry; its peer range (`^6`, what templates install) is unchanged.

## 3. security-scan on apps/unified — NOT done

`cd apps/unified && bun audit --prod --audit-level=high` is not clean except extract-zip. It also reports **zod 3.23.8**:
- `puppeteer 23 > chromium-bidi 0.11.0`, which pins `zod` exactly `3.23.8` (via `packages/roof-core`).
- `eslint-plugin-react-hooks` (platform), resolving an old zod in the lockfile.

The advisory range is `<4.6.6`, so no 3.x is clean. The ways out, none taken without you:
1. A root override `zod: ^4.6.6` (allowed with a ledger entry). I checked that `chromium-bidi 0.11.0` loads under zod 4 and that roof-core never selects the BiDi protocol; I did **not** run puppeteer against it. Forcing a major onto a library that pins an exact version is your call.
2. Upgrade puppeteer 23 -> 25 (its chromium-bidi uses zod ^4.6.5): a major on the roof PDF/estimate renderer.
3. Add unified to the scan with zod documented as a dated exception beside extract-zip.

## Full gate (everything build-check.yml and unified.yml run)

- build-check: all 289 `bun run scripts/…` / `tests/…` commands exit 0 (one, `premium-site-email`, needs the premium template's `bun install` first, as CI does; passes after it); `apps/api` and `apps/platform` builds; `cart-dom`; mobile `tsc`; the 13 template suites (above).
- unified.yml: all 11 `check-unified-*.ts` (fence: "63 changes, all inside the fence"); `build:web`; `tests/unified/factory` (210 pass; `build.test.ts` 2 pass, 1 skip — its own); the 11 CRM suites on the unified app; `bun run test` in `apps/unified`: 201 files, 199 clean on the first run and the two failures (above) fixed and re-run green (8 pass). I did not re-run the whole 35-minute unified run after that last fix — only those two files, the types, `build:web`, the fence and `check-shared-deps`.
- Not run here: the actual GitHub Actions runs (this is the same commands in this sandbox), and Windows.
