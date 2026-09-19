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
// Pinned on the shared RULE, not on one argument shape: the register now folds in the medical card
// held on the customer record (T21 M8), so what it passes has grown — but it must still be this one
// function, never a second age constant written out at the register.
if (!/const minAge = minimumAgeFor\(/.test(ordersSrc)) fail('the register must use the shared minimum-age rule, so the two paths cannot drift')
if (/const minAge = (21|18)\b/.test(ordersSrc)) fail('…and must never hardcode the age it enforces')

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

// The purchase limit is what makes this a legal till rather than a shopping cart, and the kiosk had none of
// it: no weight counted, no limit applied, total_cannabis_weight_oz written as 0. 20 eighths (2.47 oz) went
// through a shop whose register refuses 1.11 oz. One weight rule and one refusal, used by both. (T20 B1)
if (!/export function unitGramsOf\(/.test(cannabis)) fail('utils/cannabis.ts must own the per-unit weight rule (weight_grams, else weight + weight_unit)')
if (!/export function cartCannabisGrams\(/.test(cannabis)) fail('…and the cart total, so non-cannabis lines weigh nothing toward the limit')
if (!/if \(!isCannabisLine\(product\)\) continue/.test(cannabis)) fail('…which must actually SKIP the non-cannabis lines — a t-shirt counting toward a cannabis limit refuses a legal basket')
if (!/export function overPurchaseLimit\(/.test(cannabis)) fail('…and the one over-limit answer, so both tills refuse the same basket the same way')
if (!/const totalGrams = cartCannabisGrams\(/.test(src)) fail(`${file}: the kiosk must WEIGH the basket`)
if (!/const over = overPurchaseLimit\(totalGrams, limitOz\)/.test(src)) fail(`${file}: …and apply the company's purchase limit to it`)
if (!/if \(over\) \{/.test(src)) fail(`${file}: …and refuse when it is over`)
if (!/total_cannabis_weight_oz/.test(src)) fail(`${file}: the order must RECORD the cannabis weight — a zero there breaks EOD, Metrc and any audit reconstruction`)
if (!/\$\{totalCannabisWeightOz\}/.test(src)) fail(`${file}: …the computed figure, not a literal`)
// (the register reaches unitGramsOf THROUGH lineFlowerEquivalentGrams — pinned below with the H5 checks —
//  so what matters here is that it has not re-inlined the weight rule)
if (/prod\.weightGrams != null && String\(prod\.weightGrams\) !== ''/.test(ordersSrc)) fail('the register must use the shared weight rule, not a second copy')
if (!/const overLimit = overPurchaseLimit\(totalWeightGrams, limitOz\)/.test(ordersSrc)) fail('…and the shared over-limit answer')

// A limit written in flower is not a limit on raw mass. The Equivalency module already stored what a gram of
// each category is worth in flower, per company and state, and NOTHING on the selling side read it — so 25 g
// of concentrate (62.5 g of flower equivalent) passed a 1 oz cap. (Dispensary T20 H5)
const equivService = readFile('templates/crm-dispensary/backend/src/services/equivalency.ts')
if (!equivService) fail('services/equivalency.ts is missing — the rules a till enforces and the defaults a page seeds must have one home')
if (!/export async function loadEquivalencyFactors\(companyId: string\)/.test(equivService)) fail('…exporting the loader both tills use')
if (!/WHERE company_id = \$\{companyId\} AND is_active IS NOT FALSE/.test(equivService)) fail("…reading only the company's ACTIVE rules")
if (!/export const DEFAULT_RULES/.test(equivService)) fail('…and owning the seedable defaults')
if (/^const DEFAULT_RULES/m.test(readFile('templates/crm-dispensary/backend/src/routes/equivalency.ts'))) fail('routes/equivalency.ts must not keep a second copy of the defaults — the page that seeds and the till that enforces would describe the same state differently')
if (!/export function lineFlowerEquivalentGrams\(/.test(cannabis)) fail('utils/cannabis.ts must convert a line to FLOWER EQUIVALENT grams')
if (!/if \(!rule\) return grams/.test(cannabis)) fail('…falling back to the raw weight when a tenant has configured no rule, so nobody is worse off for not setting them up')
if (!/return mg > 0 \? mg \* rule\.factor : grams/.test(cannabis)) fail('…and, for a rule written in mg of THC, never counting an unknown potency as ZERO — that is the under-count this fixes')
if (!/const unitGrams = lineFlowerEquivalentGrams\(prod, equivalencyFactors\)/.test(ordersSrc)) fail('the register must weigh in flower equivalent')
if (!/const equivalencyFactors = await loadEquivalencyFactors\(currentUser\.companyId\)/.test(ordersSrc)) fail('…from the tenant\'s own rules')
if (!/cartCannabisGrams\(items\.map\(\(i: any\) => \(\{ product: i\.product \|\| \{\}, quantity: i\.quantity \}\)\), factors\)/.test(src)) fail(`${file}: the kiosk must weigh in flower equivalent too, or the two tills disagree`)

// The SCREEN has to ask for what the server now requires. Making the date of birth mandatory server-side
// without this would have left a real customer at a real kiosk stuck on "Enter your date of birth to
// continue." — the API probes that proved the gate could never have caught it. (Dispensary T20 B2 / T21)
const kioskPage = readFile('templates/crm-dispensary/frontend/src/pages/KioskOrderPage.tsx')
if (!kioskPage) fail('the kiosk order page is missing')
else {
  if (!/id="kiosk-dob"/.test(kioskPage)) fail('the kiosk age screen must ask for a date of birth')
  if (!/dobProvided: dateOfBirth/.test(kioskPage)) fail('…and send it to the gate')
  if (/verify-age`, \{ verified: true \}\)/.test(kioskPage)) fail('…a bare {verified:true} is the old gate, and the server now refuses it — the screen would dead-end')
  if (!/disabled=\{loading \|\| !dateOfBirth\}/.test(kioskPage)) fail('…and must not let the customer continue without one')
}
// the order has to carry what the register and the state reports read afterwards (T21 M13)
if (!/total_cannabis_weight_oz, total_weight_grams, customer_dob/.test(src)) fail('a kiosk order must record grams and the date of birth it checked, not just the ounces')
if (!/\$\{totalGrams\.toFixed\(2\)\}/.test(src)) fail('…the computed grams, which EOD and Metrc read')
if (!/\$\{session\.dob_provided \|\| null\}/.test(src)) fail("…and the date of birth from the session, so the budtender's own check does not start blank")

// The kiosk API had no credential at all: anyone with the hostname could create real orders. A customer is
// standing at the device, so the credential belongs to the DEVICE — paired once from Settings, revocable on
// its own, which is what Stripe Terminal and Square do with their terminals. (Dispensary T21 B1)
const devices = readFile('templates/crm-dispensary/backend/src/services/kioskDevice.ts')
if (!devices) fail('services/kioskDevice.ts is missing — pairing must have one home')
if (!/createHash\('sha256'\)\.update\(String\(token\)\)\.digest\('hex'\)/.test(devices)) fail('a device token must be stored as a HASH — a leaked row must not hand anyone a working kiosk')
if (!/WHERE token_hash = \$\{hashToken\(token\)\} AND status = 'active'/.test(devices)) fail('…and looked up by that hash, active devices only')
if (!/pairing_code = NULL, pairing_expires_at = NULL/.test(devices)) fail('a pairing code must be spent on use — one code, one tablet')
// Shipping that credential in WARN mode left the switch to be found, and nobody found it: the kiosk chain
// went on completing unauthenticated for four more test runs, an order created with no token at all. PAIRING
// is the switch now — the one moment an operator says "these are my tablets", and the only moment at which
// enforcing costs them nothing. A shop that has not paired still warns, so the blackout the warn default was
// protecting against still cannot happen. (Dispensary T23 B1, four runs open)
if (/return mode === 'enforce' \? 'enforce' : 'warn'/.test(devices)) fail('enforcement must not fall back to a flat warn — that is the default that left the kiosk open for four runs')
if (!/export async function hasPairedDevice\(/.test(devices)) fail('kioskDevice.ts must be able to answer whether a tablet has ever been paired')
if (!/WHERE company_id = \$\{companyId\} AND status = 'active'/.test(devices)) fail('…counting only ACTIVE devices, so revoking the last tablet lets a shop back in rather than locking it out')
if (!/if \(mode === 'enforce' \|\| mode === 'warn'\) return mode/.test(devices)) fail('an explicit company setting must still win, in BOTH directions')
if (!/return \(await hasPairedDevice\(companyId\)\) \? 'enforce' : 'warn'/.test(devices)) fail('…and with nothing set, having paired a tablet must BE the switch')
if (!/const requireDevice = async \(c: any, next: any\) =>/.test(src)) fail('the kiosk write endpoints must identify the device')
for (const route of ["'/session/start'", "'/session/:token/add-item'", "'/session/:token/checkout'"]) {
  if (!new RegExp(`app\\.use\\(${route.replace(/[/:]/g, '\\$&')}, requireDevice\\)`).test(src)) fail(`${route} must go through the device check — it writes`)
}
if (!/code: 'kiosk_not_paired'/.test(src)) fail('…refusing an unpaired kiosk under a code the screen can act on')
if (/app\.use\('\/menu', requireDevice\)/.test(src)) fail('the public menu must stay public — it is a menu')
if (!/kiosk_device_id/.test(src)) fail('a session must record WHICH tablet started it')
// …and the tablet needs a way to GET a token, or the credential can never be used at all.
if (kioskPage) {
  if (!/id="kiosk-pairing-code"/.test(kioskPage)) fail('the kiosk page must offer a pairing screen')
  if (!/localStorage\.setItem\('kioskToken', data\.token\)/.test(kioskPage)) fail('…and keep the token for next time')
  // BOTH places send it: the write helper and the "am I still paired?" check. One of them alone is a kiosk
  // that works until a manager revokes it and then never notices.
  if ((kioskPage.match(/'X-Kiosk-Token': kioskToken/g) || []).length < 2) fail('…and send it on every kiosk call, including the pairing check')
  if (!/setNeedsPairing\(!s\?\.paired && s\?\.enforcement === 'enforce'\)/.test(kioskPage)) fail("…showing the pairing screen only when the shop is enforcing, so warn mode keeps an unpaired kiosk working")
}

// The kiosk routes are PUBLIC by design, so no amount of authentication can say "this shop does not have a
// kiosk". The enabled-feature switch is the only thing that can, and the dispensary was the one CRM never
// wired to the shared gate at all — so its public routes were mounted for every dispensary whether the shop
// runs a kiosk or not. (Dispensary T23 B1)
const dispGate = readFile('templates/crm-dispensary/backend/src/middleware/enabledFeature.ts')
if (!dispGate) fail('crm-dispensary has no enabled-feature gate — the one CRM that was never wired to the shared one')
else {
  if (!/createEnabledFeatureGate\(\{ db, tables: \{ company \} \}\)/.test(dispGate) || !/from '\.\.\/shared\/index\.ts'/.test(dispGate)) fail('crm-dispensary/middleware/enabledFeature.ts must be glue over the shared gate, not its own copy')
  if (/db\.select\(/.test(dispGate)) fail('…and must not carry its own gate logic')
}
if (!/isFeatureEnabled \} from '\.\.\/middleware\/enabledFeature\.ts'/.test(src)) fail(`${file}: must import the enabled-feature gate`)
if (!/!\(await isFeatureEnabled\(companyId, 'kiosk'\)\)/.test(src)) fail(`${file}: a shop with the kiosk switched off must be refused the endpoint outright`)
if (!/code: 'FEATURE_NOT_ENABLED'/.test(src)) fail(`${file}: …under the fleet's own code, so the screen reads it the same way everywhere`)
{
  // Switching the module off is how an operator says they have stopped using the kiosk, so it has to hold
  // against the tablet they paired as well — otherwise the one device that can still write is the one they
  // forgot to unplug. That means the feature check sits ABOVE the paired-device short-circuit.
  // Read only requireDevice's own body: two later handlers resolve a companyId the same way, and matching
  // those made this pass with the middleware's own line deleted.
  const mwAt = src.indexOf('const requireDevice = async (c: any, next: any) =>')
  const mw = mwAt < 0 ? '' : src.slice(mwAt, src.indexOf('\napp.', mwAt))
  if (!mw) fail(`${file}: requireDevice must be a single middleware this guard can read`)
  else {
    const featureAt = mw.indexOf("code: 'FEATURE_NOT_ENABLED'")
    const deviceAt = mw.indexOf("if (device) { c.set('kioskDevice', device); return next() }")
    if (deviceAt < 0) fail(`${file}: requireDevice must let a paired device through`)
    else if (featureAt < 0 || featureAt > deviceAt) fail(`${file}: the feature check must sit ABOVE the paired-device short-circuit, or a paired tablet keeps writing after the module is switched off`)
    if (!/const companyId = device\?\.companyId \|\|/.test(mw)) fail(`${file}: …resolving the company from the paired device first, so that check costs no extra query`)
  }
}

if (failed) { console.error(`\nkiosk tenant isolation: ${failed} check(s) FAILED`); process.exit(1) }
console.log('kiosk tenant isolation: company is resolved by the owner account, never an arbitrary row; the age gate is computed from a date of birth, not asserted by the device')
