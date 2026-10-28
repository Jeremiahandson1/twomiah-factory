# Security round, part 3: puppeteer 23 -> 25 (2026-10-28)

Branch `cloud/puppeteer-25`, from `engine`. Pushed only there.

## Result

`bun audit --prod --audit-level=high` in `apps/unified` now reports **no vulnerabilities** (396 packages). Not just "extract-zip left": both remaining findings are gone, because puppeteer 25 removed them at the source.

| finding | why it is gone |
|---|---|
| zod 3.23.8 (GHSA-mrhx-c7xc-m3w5) | puppeteer 23 > chromium-bidi 0.11 pinned `zod` exactly at 3.23.8 (no 3.x release has the fix). puppeteer 25 > chromium-bidi 157 uses `zod ^4.6.5`. |
| extract-zip (GHSA-jmr9-qjv8-65gv, GHSA-7pqw-9j4j-h8q3) | `@puppeteer/browsers` 3 unpacks with `modern-tar`; extract-zip is no longer in the tree. |

`apps/api` and `apps/platform` audit clean as before.

## What changed

- `packages/roof-core/package.json`: `puppeteer ^23.0.0` -> `^25.16.0` (25.16.0 is the current 25.x), with its entry in `docs/SECURITY_UPGRADES.json` (manifest, package, exact range, GHSA-mrhx-c7xc-m3w5, why). The fence passes.
- `packages/roof-core/src/pdfGenerator.ts`: **one change** — `browserInstance?.isConnected?.()` -> `browserInstance?.connected`. `Browser.isConnected()` was removed in 25 (changelog, 25.0.0 breaking list); `connected` is a property that exists from 21.3, so it works on both. Without it the check silently went false.
- `.github/workflows/security-scan.yml`: `apps/unified` added to the audit loop. **No exception is needed** (the audit is clean), so none was written — nothing is ignored; a new finding in it fails the job like any other. (The brief expected extract-zip as a dated exception; it no longer exists.)

Changelog read (25.0.0 breaking list): `Puppeteer.product` removed, min Node 22, `executablePath()`/`defaultArgs()` return a Promise, `Browser.isConnected()` removed, ESM only, `MouseOptions.clickCount`, cookie `sameParty`, newline headers. Only `isConnected` touches our code: we pass `executablePath` as an option (not call it), we never use the others, and the dynamic `import('puppeteer')` + `.default.launch` still works (checked). Under 24: Firefox-over-CDP and old launch options removed (we use neither). Node here is 22.22 and Bun 1.4.4 (CI pins Bun 1.3.14; Render uses the configured Bun) — puppeteer 25 needs Node >= 22.12, and it ran under Bun in every check below.

## Corrections to the brief, said plainly

- **The unified app never calls `pdfGenerator.ts`.** Its roof report `/pdf` route returns a print-ready HTML page (`apps/unified/server/crm/roof/reports/roofReports.ts`: "the unified app does not launch a headless browser in a tenant's server"); `generateReportPDF` builds that HTML. `generatePdfFromHtml` has one caller in the repo: `apps/roof-estimator/backend/src/routes/reports.ts`. So the roof report feature being held off was not what protected anyone — nothing in the unified server launches Chrome, today or when the report is turned on. The upgrade is still right (the vulnerable zod shipped in the install tree), and `pdfGenerator.ts` is proven below for whoever uses it.
- **No template vendors `packages/roof-core`.** `templates/crm-roof` has its own `pdfGenerator.ts` and its own `puppeteer ^23` (not touched: templates are fenced; `crm-automotive` untouched). Its suite ran in the gate and passes.

## Proof: a real roof report PDF through `pdfGenerator.ts`

`docs/security-round/puppeteer-25/`: `roof-report.pdf` (3 letter pages, 622 KB) and `page-1..3.png`, made by the real `generateReportHTML` -> `generatePdfFromHtml` with sample data (a four-segment roof, six edges, measurements, AI analysis) and the singleton browser used twice. No live API: the satellite image request is answered locally with a stock roofing photo, so the measurement overlay does not line up with that picture (expected; it is a stand-in, not an aerial). All three pages were opened: header and company, address banner, imagery with legend and totals (page 1); the AI analysis, measurement table with the valley and ice-and-water highlights, segment table (page 2); the disclaimer tail and credit line (page 3). Fonts embedded (Inter), images embedded.
The same report run through puppeteer **23** (same Chromium) gives pages **pixel-identical** to 25 on all three pages and identical extracted text. The disclaimer box splits across pages 2 and 3 in both: that is the template's layout, not the upgrade, and I did not change it.

## Chrome: how it is found, and that it still is

Unchanged code path: `PUPPETEER_EXECUTABLE_PATH` if set, else puppeteer's own browser cache. Checked on 25: with the variable set to the sandbox Chromium it launches (Chrome 153); with it empty, puppeteer finds the cached Chrome by default (156). Render: `bun install` does not run puppeteer's `postinstall` (no `trustedDependencies`), so a Render build downloads no Chrome — **as before** — and the Render blueprint sets no `PUPPETEER_EXECUTABLE_PATH`; anything that wants a PDF there needs one (this is why the unified app serves HTML). The server starts: the roofing vertical boots and answers 200 on `/health` and `/login`.

## Full gate (what build-check.yml and unified.yml run)

- build-check: all 289 `scripts/…` / `tests/…` commands pass; `apps/api` and `apps/platform` builds; `cart-dom`; mobile `tsc`; the 13 template suites (incl. `crm-roof`) exit 0.
- unified.yml: all 11 `check-unified-*.ts` (fence: all 9 changes inside); `build:web`; `tests/unified/factory` (build + the rest); `bun run test` in `apps/unified`: **201 files, 2062 pass, 0 fail**; the roof tests (102) on their own earlier.
- The 11 CRM suites on the unified app: see the note at the end of this file.
- Not run here: the real GitHub Actions runs, and Windows.
