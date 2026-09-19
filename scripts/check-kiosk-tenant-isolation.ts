// CI guard for dispensary kiosk tenant isolation. The kiosk is unauthenticated, so it resolves the
// tenant's company itself. It once did `SELECT id FROM company LIMIT 1` with no ORDER BY — when a DB
// held a leftover demo company that arbitrary pick served a STRANGER's menu and dropped every kiosk
// order into the wrong company. Resolution must be deterministic and scoped to the company that owns
// the owner/admin account (a seed-only demo company has no users).
//   bun scripts/check-kiosk-tenant-isolation.ts
import { readFileSync } from 'node:fs'

const file = 'templates/crm-dispensary/backend/src/routes/kiosk.ts'
const raw = readFileSync(new URL('../' + file, import.meta.url), 'utf8')
// Strip line + block comments so the guard checks real code, not prose describing the old bug.
const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// The ambiguous, order-less pick must not come back.
if (/FROM\s+company\s+LIMIT/i.test(src)) fail(`${file}: resolves the tenant company with an unordered \`FROM company LIMIT 1\` — arbitrary across a multi-company DB`)
// Resolution must be scoped to the account owner (deterministic, demo-company-proof).
if (!/role\s+IN\s*\(\s*'owner'\s*,\s*'admin'\s*\)/i.test(src)) fail(`${file}: kiosk must resolve the tenant company via the owner/admin account, not an arbitrary row`)

// The age gate is a compliance control, so the customer's own device does not get to certify it. `verified`
// used to BE the gate — {verified:true} set age_verified, and the date of birth sent with it was stored and
// never read, so a 2012 DOB reached a real order. The age is computed server-side from the date of birth, by
// the one rule the register has used since QA F-02. (Dispensary T20 B2)
const cannabis = (() => { try { return readFileSync(new URL('../templates/crm-dispensary/backend/src/utils/cannabis.ts', import.meta.url), 'utf8') } catch { return '' } })()
if (!/export const ADULT_USE_MIN_AGE = 21/.test(cannabis)) fail('utils/cannabis.ts must state the adult-use minimum age')
if (!/export function ageFromDob\(/.test(cannabis)) fail('…and own the one age calculation')
if (!/export const minimumAgeFor = /.test(cannabis)) fail('…and the one minimum-age rule (18 only for a medical sale with a card)')
if (!/const age = ageFromDob\(dob\)/.test(src)) fail(`${file}: the kiosk must COMPUTE the age from the date of birth`)
if (!/if \(age < ADULT_USE_MIN_AGE\)/.test(src)) fail(`${file}: …and refuse anyone under it`)
if (!/code: 'dob_required'/.test(src)) fail(`${file}: …and require a date of birth rather than accepting a bare "yes"`)
if (/SET age_verified = true, id_verified = true/.test(src)) fail(`${file}: a kiosk cannot inspect a physical ID — it must not certify one`)
if (/verified: z\.boolean\(\),/.test(src)) fail(`${file}: a REQUIRED \`verified\` boolean is the old gate — the date of birth is the gate now`)
const ordersSrc = (() => { try { return readFileSync(new URL('../templates/crm-dispensary/backend/src/routes/orders.ts', import.meta.url), 'utf8') } catch { return '' } })()
if (/^function ageFromDob\(/m.test(ordersSrc)) fail('orders.ts must not keep a second copy of the age calculation')
if (!/const minAge = minimumAgeFor\(ord\)/.test(ordersSrc)) fail('the register must use the shared minimum-age rule, so the two paths cannot drift')

// The kiosk is anonymous by design, so the ceiling on what an anonymous caller can MAKE is the control. The
// app-wide write bucket allows 1,200 per 15 minutes — 1,200 fabricated orders — so the two creating endpoints
// carry their own, far smaller buckets. ONE limiter implementation: it used to be private to index.ts, which a
// route cannot import, and website-analytics.ts had already grown a second copy. (Dispensary T20 B2)
const readFile = (p: string) => { try { return readFileSync(new URL(`../${p}`, import.meta.url), 'utf8') } catch { return '' } }
const limiter = readFile('templates/crm-dispensary/backend/src/middleware/rateLimit.ts')
if (!limiter) fail('middleware/rateLimit.ts is missing — the limiter must have one home the routes can import')
if (!/export function createRateLimiter\(/.test(limiter)) fail('…exporting createRateLimiter')
if (!/cf-connecting-ip'\) \|\| \(c\.req\.header\('x-forwarded-for'\) \|\| ''\)\.split\(','\)\[0\]/.test(limiter)) fail("…keyed on the CLIENT address only — Render's edge appends a varying hop, and keying on the whole header gave every request its own counter (SALON-H5)")
if (!/export const KIOSK_MAX_SESSIONS = /.test(limiter) || !/export const KIOSK_MAX_CHECKOUTS = /.test(limiter)) fail('…and stating the kiosk ceilings where they can be read')
const dispIndex = readFile('templates/crm-dispensary/backend/src/index.ts')
if (/^function createRateLimiter\(/m.test(dispIndex)) fail('index.ts must not keep a private copy of the limiter')
if (!/from '\.\/middleware\/rateLimit\.ts'/.test(dispIndex)) fail('index.ts must use the shared limiter')
if (!/app\.use\('\/session\/start', createRateLimiter\(KIOSK_WINDOW_MS, KIOSK_MAX_SESSIONS/.test(src)) fail(`${file}: starting a session must be bucketed — it is anonymous and it writes`)
if (!/app\.use\('\/session\/:token\/checkout', createRateLimiter\(KIOSK_WINDOW_MS, KIOSK_MAX_CHECKOUTS/.test(src)) fail(`${file}: creating an order must be bucketed — that is the one that makes real rows`)

if (failed) { console.error(`\nkiosk tenant isolation: ${failed} check(s) FAILED`); process.exit(1) }
console.log('kiosk tenant isolation: company is resolved by the owner account, never an arbitrary row; the age gate is computed from a date of birth, not asserted by the device')
