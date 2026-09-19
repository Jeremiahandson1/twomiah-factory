// CI guard: the loyalty settings are stored where they are read, and the bonuses they promise are paid.
//
// Dispensary T21 M7 — "Welcome and birthday loyalty bonuses are still never granted". A new customer's
// $80 first purchase ended on exactly 80 points. Three parties disagreed about where the config lived:
//   * Settings → Loyalty PUT five flat loyalty fields to /api/company, whose zod schema had none of
//     them, so every one was stripped and the screen toasted a save that never happened;
//   * the award engine read company.settings.loyalty.pointsPerDollar, somewhere the screen never wrote;
//   * the GET handed back the legacy loyalty_points_per_dollar column.
// One reader now owns it (utils/loyaltyConfig.ts), the PUT stores into settings.loyalty, and the GET
// reads back through the same reader — so what is saved is what is granted.
//   bun scripts/check-loyalty-bonuses.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const B = 'templates/crm-dispensary/backend/src/'

// ── one reader ──────────────────────────────────────────────────────────────────────────────────────
const cfg = read(B + 'utils/loyaltyConfig.ts')
if (!cfg) fail('utils/loyaltyConfig.ts is missing — the loyalty settings need one definition, not three')
if (!/export function loyaltyConfig\(/.test(cfg)) fail('…it must export the reader the engine and the API share')
if (!/pointsPerDollar: nonNegative\(l\.pointsPerDollar, nonNegative\(co\?\.loyaltyPointsPerDollar, DEFAULT_POINTS_PER_DOLLAR\)\)/.test(cfg)) fail('…points-per-dollar must come from settings.loyalty, falling back to the legacy column so an untouched tenant keeps its rate')
if (!/export const DEFAULT_WELCOME_POINTS = 0/.test(cfg)) fail('an unconfigured tenant must grant no welcome bonus it never asked for')
if (!/export const DEFAULT_BIRTHDAY_BONUS = 0/.test(cfg)) fail('…nor a birthday bonus')
if (!/d\.getUTCMonth\(\) === now\.getMonth\(\)/.test(cfg)) fail('the birthday month must be read in UTC — a date-only column at midnight UTC slips a month in a negative offset')

// ── stored where it is read ─────────────────────────────────────────────────────────────────────────
const co = read(B + 'routes/company.ts')
if (!co) fail('the company routes are missing')
if (!/loyaltyWelcomePoints: z\.number\(\)\.int\(\)\.min\(0\)\.optional\(\)/.test(co)) fail('PUT /api/company must ACCEPT the welcome bonus — a field the schema lacks is silently stripped')
if (!/loyaltyBirthdayBonus: z\.number\(\)\.int\(\)\.min\(0\)\.optional\(\)/.test(co)) fail('…and the birthday bonus')
if (!/loyaltyPointsPerDollar: z\.number\(\)\.min\(0\)\.optional\(\)/.test(co)) fail('…and points per dollar')
if (!/for \(const \[bodyKey, settingKey\] of Object\.entries\(LOYALTY_SETTING_KEYS\)\)/.test(co)) fail('…and must map them into settings.loyalty, where the award engine reads')
if (!/loyalty: \{ \.\.\.\(\(base as any\)\.loyalty \|\| \{\}\), \.\.\.loyaltyPatch \}/.test(co)) fail('…merging, so saving one loyalty field does not wipe the others')
if (!/Object\.assign\(clone, loyaltyConfigResponse\(row\)\)/.test(co)) fail('the company response must carry the loyalty config back, or the screen shows its own placeholders as if they were saved')

// ── and actually paid ───────────────────────────────────────────────────────────────────────────────
const ord = read(B + 'routes/orders.ts')
if (!ord) fail('the orders routes are missing')
if (/const pointsRate = \(settings: any\)/.test(ord)) fail('orders.ts must not keep its own copy of the points rate — that is the drift this fixed')
if (!/const loyalty = loyaltyConfig\(coRow\)/.test(ord)) fail('the award engine must read the shared loyalty config')
if (!/RETURNING id/.test(ord)) fail('the auto-enrol INSERT must report whether it created the member, or the welcome bonus cannot be paid exactly once')
if (!/const welcomeBonus = loyalty\.enabled && justEnrolled \? loyalty\.welcomePoints : 0/.test(ord)) fail('the welcome bonus must be paid on joining, and only on joining')
if (!/if \(inBirthdayMonth\(ct\?\.dob\)\)/.test(ord)) fail('the birthday bonus must be paid in the birthday month')
if (!/AND lt\.created_at >= date_trunc\('year', NOW\(\)\)/.test(ord)) fail('…at most once per calendar year')
if (!/type = 'bonus' AND lt\.description LIKE 'Birthday bonus%'/.test(ord)) fail('…found by its own ledger line')
// the bonuses must NOT ride on the order's earned-points figure, which is what a refund reverses
if (!/UPDATE orders SET loyalty_points_earned = \$\{pointsEarned\}/.test(ord)) fail("the order must record only what the PURCHASE earned — a refund reverses that figure, and a welcome bonus is not something the customer bought")

const loy = read(B + 'routes/loyalty.ts')
if (!loy) fail('the loyalty routes are missing')
if (!/const startingPoints = data\.initialPoints \+ welcomeBonus/.test(loy)) fail('a customer enrolled at the counter must get the same welcome bonus as one enrolled by a purchase')

if (failed) { console.error(`\nloyalty bonuses: ${failed} check(s) FAILED`); process.exit(1) }
console.log('loyalty bonuses: the settings are stored where they are read, the welcome bonus is paid once on joining, and the birthday bonus once a year')
