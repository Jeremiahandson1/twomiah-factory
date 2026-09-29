// crm-dispensary — T48 Q13: overlapping delivery zones, the two halves P20 did not cover.
//
// T47 P20 stopped a NEW zone claiming a postcode another zone already covers. It left two things:
//
//   1. EDIT was wide open. The same overlap could be created by saving an existing zone with the
//      postcode added, so the rule held only for whoever happened to do it in the order the guard
//      expected. A guard on create alone is a guard on the order somebody does things in.
//
//   2. The zones already in the table when the rule arrived are still overlapping — T45 Zone and
//      T46 Zone both cover 43004 and 43085 on the test tenant — and nothing in the product showed
//      it. The checkout quotes whichever fee the matcher reaches first and nobody can see why.
//
// Reported rather than auto-corrected: which of two zones keeps a postcode is the shop's decision,
// and it is worth real money to them.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Twomiah Leaf', slug: 'leaf-t48dz', email: 'dz@test.local', state: 'OH',
  enabledFeatures: ['orders', 'delivery'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-t48dz@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: co.id,
} as any).returning()

const app = new Hono()
app.route('/api/delivery', (await import('./src/routes/delivery.ts')).default)

const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': owner.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const mkZone = async (name: string, zipCodes: string[], deliveryFee = 5) =>
  api('POST', '/api/delivery/zones', { name, zipCodes, deliveryFee, minimumOrder: 0, estimatedMinutes: 60 })

// ── create still refuses, as P20 made it ────────────────────────────────────────────────────────
{
  const a = await mkZone('T48 North', ['43004', '43085'])
  check('Q13: the first zone is created', a.status === 200 || a.status === 201, { status: a.status, body: a.json })

  const b = await mkZone('T48 South', ['43085', '43220'], 10)
  check('Q13: a NEW zone claiming a taken postcode is refused', b.status === 409, { status: b.status, body: b.json })
  check('Q13: …naming the zone that already has it', b.json?.zone === 'T48 North', b.json)
}

// ── and EDIT refuses too, which it did not ──────────────────────────────────────────────────────
{
  const made = await mkZone('T48 East', ['43230'], 7)
  const id = (made.json?.id || made.json?.data?.id)
  check('Q13: a non-overlapping zone is created', !!id, made.json)

  const clash = await api('PUT', `/api/delivery/zones/${id}`, { zipCodes: ['43230', '43004'] })
  check('Q13: editing a zone into an overlap is refused — this route had no guard at all',
    clash.status === 409, { status: clash.status, body: clash.json })
  check('Q13: …naming the postcode and the zone that holds it',
    clash.json?.code === 'zone_overlap' && /43004/.test(String(clash.json?.error)) && /T48 North/.test(String(clash.json?.error)),
    clash.json)

  // …and a zone must not refuse on its OWN postcodes, or nothing could ever be edited.
  const itself = await api('PUT', `/api/delivery/zones/${id}`, { zipCodes: ['43230'], deliveryFee: 9 })
  check('Q13: a zone can still be edited on its own postcodes', itself.status === 200, { status: itself.status, body: itself.json })

  const noZips = await api('PUT', `/api/delivery/zones/${id}`, { estimatedMinutes: 90 })
  check('Q13: …and an edit that touches no postcodes is unaffected', noZips.status === 200, { status: noZips.status, body: noZips.json })
}

// ── the overlaps already in the table are visible ───────────────────────────────────────────────
//
// Written straight to the table, which is how the tenant's own pair got there: they predate the
// rule, so the create route would never let them in now.
{
  await db.execute(
    (await import('drizzle-orm')).sql`
      INSERT INTO delivery_zones(id, name, zip_codes, delivery_fee, minimum_order, min_order, estimated_minutes, active, company_id, created_at, updated_at)
      VALUES (gen_random_uuid(), 'T48 Legacy', '["43004"]'::jsonb, 12, 0, 0, 60, true, ${co.id}, NOW(), NOW())
    `,
  )

  const list = await api('GET', '/api/delivery/zones')
  const zones = list.json || []
  const north = zones.find((z: any) => z.name === 'T48 North')
  const legacy = zones.find((z: any) => z.name === 'T48 Legacy')

  check('Q13: the pre-existing overlap is reported on the zone', (legacy?.overlaps || []).length === 1, legacy?.overlaps)
  check('Q13: …naming the other zone', legacy?.overlaps?.[0]?.zone === 'T48 North', legacy?.overlaps)
  check('Q13: …and the postcode they share', legacy?.overlaps?.[0]?.zipCodes?.includes('43004'), legacy?.overlaps)
  check('Q13: …from both sides, because either one could be the one to fix',
    (north?.overlaps || []).some((o: any) => o.zone === 'T48 Legacy'), north?.overlaps)
  check('Q13: …in a sentence a shop can act on',
    /43004/.test(String(legacy?.overlapWarning)) && /take the postcode out/i.test(String(legacy?.overlapWarning)),
    legacy?.overlapWarning)

  const clean = zones.find((z: any) => z.name === 'T48 East')
  check('Q13: a zone that clashes with nothing says so', (clean?.overlaps || []).length === 0 && clean?.overlapWarning === null, clean?.overlaps)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
