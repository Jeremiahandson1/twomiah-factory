// CI guard: Salon T20 lows — L1, L2, L4, L5.
//
//   L1 — PUT /api/company merges, which is right and was the T12 fix. But merge-only meant a key could
//        only ever be ADDED: writing an unknown key stored it verbatim, and writing it back as null
//        stored the null rather than removing it. The blob grew in one direction only.
//   L2 — three refusals named the wrong reason. "2026-02-30" and "2026-13-01" are shaped like dates, so
//        they passed the format check and were judged against the booking window instead: "That date is
//        in the past." and "Please choose a date within 30 days." A price of "abc" was refused with
//        "Price cannot be negative." All three correctly rejected the input and all three lied about why.
//   L4 — GET /api/clients returned portalToken and portalTokenExp for every client that had one. That is
//        a bearer credential for the client portal, handed out in a LIST, to a vertical with no portal
//        UI at all — nothing in the salon bundle reads it and /api/portal/contacts/:token 404s here.
//   L5 — useTheme() only applies the `dark` class when a component that calls it mounts, and the only
//        one is the shell. The 404 catch-all lives outside it, so an unknown /crm URL loaded in full
//        light theme whatever the user had chosen.
//   bun scripts/check-salon-lows.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// ── L1 ────────────────────────────────────────────────────────────────────────────────────────────
const companyRoutes = read('packages/tenant-backend/src/company/company.ts')
if (!companyRoutes) fail('the shared company routes are missing')
if (!/for \(const \[k, v\] of Object\.entries\(data\.settings as Record<string, unknown>\)\) if \(v === null\) delete merged\[k\]/.test(companyRoutes)) fail('an explicit null must REMOVE a settings key — merge-only means the blob can never have anything taken out of it')
if (!/const merged: Record<string, unknown> = \{ \.\.\.\(\(cur\?\.settings as any\) \|\| \{\}\), \.\.\.data\.settings \}/.test(companyRoutes)) fail('…while a partial write must still MERGE, which is the fix that has to keep holding')

// ── L2 ────────────────────────────────────────────────────────────────────────────────────────────
const time = read('packages/tenant-backend/src/booking/time.ts')
if (!/export const isRealDate = \(s: unknown\): boolean =>/.test(time)) fail('a date that is shaped right but is not a day needs its own check — isIsoDate only tests the shape')
if (!/return dt\.getUTCFullYear\(\) === y && dt\.getUTCMonth\(\) === m - 1 && dt\.getUTCDate\(\) === d/.test(time)) fail('…by checking the parts survive the round trip, which is what catches Feb 30 rolling into Mar 2')
const bookingSvc = read('packages/tenant-backend/src/booking/service.ts')
if ((bookingSvc.match(/if \(!isRealDate\(date\)\) throw new BookingError\(`\$\{date\} is not a real date/g) || []).length < 2) fail('…and BOTH the slots read and the booking write must use it, before either compares the date to the window')
const menu = read('templates/crm-salon/backend/src/routes/serviceMenu.ts')
if ((menu.match(/error: 'Price must be a number\.'/g) || []).length < 2) fail('a price of "abc" must be refused for not being a number, on create AND on update — it was answered with "cannot be negative"')
if (!/error: 'Price cannot be negative\.'/.test(menu)) fail('…and a negative price must still say negative')

// ── L4 ────────────────────────────────────────────────────────────────────────────────────────────
const clients = read('templates/crm-salon/backend/src/routes/clients.ts')
if (!/const \{ portalToken, portalTokenExp, \.\.\.contactSafe \} = r\.contact/.test(clients)) fail('the clients list must not ship portalToken — it is a bearer credential, in a list, for a feature this vertical does not have')
if (!/\.\.\.contactSafe,/.test(clients)) fail('…and must serialise the stripped contact, not the raw row')

// ── L5 ────────────────────────────────────────────────────────────────────────────────────────────
const hooks = read('packages/tenant-ui/src/shell/hooks.ts')
if (!/export function applyStoredTheme\(\): void/.test(hooks)) fail('the saved theme must be appliable without mounting the shell')
const uiIndex = read('packages/tenant-ui/src/index.ts')
if (!/export \{ applyStoredTheme,/.test(uiIndex)) fail('…and exported so an entry point can call it')
const main = read('templates/crm-salon/frontend/src/main.tsx')
if (!/applyStoredTheme\(\);/.test(main)) fail('…and called at startup, or anything outside the shell (the 404 page) loads in light theme whatever the user chose')

if (failed) { console.error(`\nsalon lows: ${failed} check(s) FAILED`); process.exit(1) }
console.log('salon lows: a settings key can be removed, refusals name the real reason, no portal secret in a list, and the theme applies before the shell')
