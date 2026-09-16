// CI guard: crm-restaurant (events) money/capacity fields can't be saved negative on ANY write path.
//  T14 HIGH-3: POST /api/event-spaces {minimumSpend:-500, hireFee:-250} and POST /api/menu-packages
//  {pricePerPerson:-30} returned 201. Menu lines already refused negatives on POST but not on PUT, and a
//  scheduled payment's amount was only validated on POST. CSV import wrote the same columns unguarded.
//   bun scripts/check-events-nonneg.ts
import { readFileSync } from 'node:fs'
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const read = (p: string) => strip(readFileSync(new URL(`../templates/crm-restaurant/backend/src/${p}`, import.meta.url), 'utf8'))
const spaces = read('routes/eventSpaces.ts')
const menus = read('routes/menuPackages.ts')
const events = read('routes/events.ts')
const imp = read('services/import.ts')

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// Slice one route handler: from its app.<verb>('<path>' to the next app.<verb>( or EOF.
const handler = (src: string, verb: string, path: string) => {
  const start = src.indexOf(`app.${verb}('${path}'`)
  if (start < 0) return ''
  const next = src.slice(start + 1).search(/\napp\.(get|post|put|delete)\(/)
  return next < 0 ? src.slice(start) : src.slice(start, start + 1 + next)
}

// (1) spaces + packages: every column listed, checked on POST (body) and PUT (updates) before the write.
for (const [name, src, cols] of [
  ['eventSpaces', spaces, ['seatedCapacity', 'standingCapacity', 'minimumSpend', 'hireFee']],
  ['menuPackages', menus, ['pricePerPerson', 'minGuests']],
] as const) {
  const list = src.match(/const NON_NEGATIVE = \[([\s\S]*?)\] as const/)?.[1] || ''
  for (const col of cols) if (!list.includes(`'${col}'`)) fail(`${name}: NON_NEGATIVE must include ${col}`)
  const post = handler(src, 'post', '/')
  const put = handler(src, 'put', '/:id')
  if (!/negativeFieldError\(body\)[\s\S]*db\.insert/.test(post)) fail(`${name}: POST must run negativeFieldError(body) before insert`)
  if (!/negativeFieldError\(updates\)[\s\S]*db\.update/.test(put)) fail(`${name}: PUT must run negativeFieldError(updates) before update`)
}

// (2) events: menu line + payment edits carry the same guards as their POSTs.
const menuPut = handler(events, 'put', '/:id/menu/:lineId')
if (!/'Unit price cannot be negative'[\s\S]*'Quantity cannot be negative'[\s\S]*db\.update/.test(menuPut)) fail('PUT /:id/menu/:lineId must refuse negative unitPrice and quantity before update')
const payPut = handler(events, 'put', '/:id/payments/:paymentId')
if (!/'Amount must be a positive number'[\s\S]*db\.update/.test(payPut)) fail('PUT /:id/payments/:paymentId must refuse a non-positive amount before update')

// (3) CSV import applies the same rule before insert.
const impSpaces = imp.slice(imp.indexOf('export async function importSpaces'), imp.indexOf('export async function importMenus'))
const impMenus = imp.slice(imp.indexOf('export async function importMenus'), imp.indexOf('export function validateCSV'))
if (!/cannot be negative[\s\S]*db\.insert\(eventSpace\)/.test(impSpaces)) fail('importSpaces must skip rows with negative capacity/money before insert')
if (!/cannot be negative[\s\S]*db\.insert\(menuPackage\)/.test(impMenus)) fail('importMenus must skip rows with a negative price/minimum before insert')

if (failed) { console.error(`\nevents non-negative: ${failed} check(s) FAILED`); process.exit(1) }
console.log('events non-negative: spaces, packages, menu-line/payment edits and CSV import all refuse negatives')
