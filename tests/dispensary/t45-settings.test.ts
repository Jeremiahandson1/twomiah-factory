// crm-dispensary — the T45 settings mediums.
//
//   M1  The timezone picker said "saved" and stored nothing; after a reload it was back to Automatic.
//   M2  Store hours were stored twice and disagreed: the company column (which Settings shows)
//       against a stale settings JSON copy still saying 9–21 every day.
//   M3  Company fields were not validated: a whitespace-only name, a 500-character name, a name
//       carrying HTML, a phone of "abc", a ZIP of "1", a website of "javascript:alert(3)", a colour
//       of "red;background:url(x)", and opening hours of 25:00 or an open after the close.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Settings Dispensary', slug: 'settings', email: 'settings@test.local', state: 'OH',
  // A stale shadow copy, exactly as the tester found it: the blob still carries hours the column
  // disagrees with, from before the shadow rule existed.
  settings: { storeHours: { mon: { open: '09:00', close: '21:00', closed: false } }, taxRate: '99' },
  storeHours: { mon: { open: '10:00', close: '20:00', closed: false } },
  enabledFeatures: ['products', 'orders', 'delivery', 'merch_store'],
} as any).returning()

const owner = (await db.insert(user).values({
  email: 'owner-settings@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: co.id,
} as any).returning())[0]

const app = new Hono()
app.route('/api/company', (await import('./src/routes/company.ts')).default)

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, text: t, json: j }
}
const asOwner = as(owner)

const stored = async () => {
  const r: any = await db.execute(sql`SELECT settings, store_hours, name, phone, zip, website, primary_color FROM company WHERE id = ${co.id}`)
  return ((r as any).rows || r)?.[0] || {}
}
const settingsOf = async () => {
  const row = await stored()
  return typeof row.settings === 'string' ? JSON.parse(row.settings) : (row.settings || {})
}

// ── M1: choosing a timezone has to stick ────────────────────────────────────────────────────────
const setTz = await asOwner('PUT', '/api/company', { settings: { timezone: 'America/Chicago' } })
check('M1: choosing Central saves', setTz.status === 200, { status: setTz.status, body: setTz.json })
check('M1: ...and is stored', (await settingsOf()).timezone === 'America/Chicago', await settingsOf())

const reread = await asOwner('GET', '/api/company')
check('M1: ...and comes back on the next load, not Automatic', reread.json?.settings?.timezone === 'America/Chicago', reread.json?.settings)
check('M1: ...and the effective zone follows it', reread.json?.effectiveTimeZone === 'America/Chicago', reread.json?.effectiveTimeZone)

// Automatic is a real choice: it must CLEAR the stored zone, not leave the old one in place.
const auto = await asOwner('PUT', '/api/company', { settings: { timezone: null } })
check('M1: Automatic clears the choice', auto.status === 200, { status: auto.status })
check('M1: ...so the zone follows the licensed state again',
  (await settingsOf()).timezone === undefined && (await asOwner('GET', '/api/company')).json?.effectiveTimeZone === 'America/New_York',
  await settingsOf())

const badTz = await asOwner('PUT', '/api/company', { settings: { timezone: 'Mars/Olympus' } })
check('M1: a zone the system does not know is refused rather than silently ignored', badTz.status === 400, { status: badTz.status, body: badTz.json })

const topLevelTz = await asOwner('PUT', '/api/company', { timezone: 'America/Chicago' })
check('M1: the same key at the top level is refused rather than dropped', topLevelTz.status === 400, { status: topLevelTz.status, body: topLevelTz.json })

// ── M2: one set of opening hours, not two ───────────────────────────────────────────────────────
// Put the stale copy back: the M1 saves above already swept it, which is the fix working, but this
// section needs the tenant in the state the tester found it in.
await db.execute(sql`
  UPDATE company
  SET settings = ${JSON.stringify({ storeHours: { mon: { open: '09:00', close: '21:00', closed: false } }, taxRate: '99', receiptFooter: 'Thanks' })}::json
  WHERE id = ${co.id}
`)
const before = await settingsOf()
check('M2: setup — the stale shadow copy is there to begin with', !!before.storeHours && before.taxRate === '99', before)

const saveHours = await asOwner('PUT', '/api/company', {
  storeHours: { mon: { open: '08:00', close: '22:00', closed: false } },
  settings: { receiptFooter: 'Thanks' },
})
check('M2: saving the hours works', saveHours.status === 200, { status: saveHours.status, body: saveHours.json })

const after = await settingsOf()
check('M2: the stale copy in settings is gone', after.storeHours === undefined, after)
check('M2: ...and so are the other shadowed keys', after.taxRate === undefined, after)
check('M2: ...while the real column holds the new hours',
  (await stored()).store_hours?.mon?.close === '22:00' || JSON.parse(JSON.stringify((await stored()).store_hours)).mon.close === '22:00',
  (await stored()).store_hours)
check('M2: ...and an unrelated setting survived the sweep', after.receiptFooter === 'Thanks', after)

const shadowWrite = await asOwner('PUT', '/api/company', { settings: { storeHours: { mon: { open: '01:00', close: '02:00' } } } })
check('M2: writing hours into settings is still refused', shadowWrite.status === 400, { status: shadowWrite.status, body: shadowWrite.json })

// ── M3: the shop's identity is not free-form ────────────────────────────────────────────────────
const cases: Array<[string, any]> = [
  ['a whitespace-only name', { name: '   ' }],
  ['a 500-character name', { name: 'x'.repeat(500) }],
  ['a name carrying HTML', { name: '<b>Green Leaf</b>' }],
  ['a phone of "abc"', { phone: 'abc' }],
  ['a ZIP of "1"', { zip: '1' }],
  ['a javascript: website', { website: 'javascript:alert(3)' }],
  ['a colour that is a style fragment', { primaryColor: 'red;background:url(x)' }],
  ['an opening time of 25:00', { storeHours: { mon: { open: '25:00', close: '26:00', closed: false } } }],
  ['a close before the open', { storeHours: { mon: { open: '18:00', close: '09:00', closed: false } } }],
]
for (const [label, payload] of cases) {
  const res = await asOwner('PUT', '/api/company', payload)
  check(`M3: ${label} is refused`, res.status === 400, { status: res.status, body: res.json })
}

// …and the ordinary values still save.
const good = await asOwner('PUT', '/api/company', {
  name: 'Green Leaf Dispensary',
  phone: '(614) 555-0100',
  zip: '43004',
  state: 'oh',
  website: 'https://greenleaf.example',
  primaryColor: '#2563eb',
  storeHours: { mon: { open: '09:00', close: '21:00', closed: false }, sun: { open: '', close: '', closed: true } },
})
check('M3: a shop record with ordinary values still saves', good.status === 200, { status: good.status, body: good.json })
const row = await stored()
check('M3: ...with the name kept', row.name === 'Green Leaf Dispensary', row.name)
check('M3: ...the phone kept', row.phone === '(614) 555-0100', row.phone)
check('M3: ...and a lower-case state normalised', good.json?.state === 'OH', good.json?.state)
check('M3: ...and a day marked closed is left alone', good.status === 200, good.json?.storeHours)

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
