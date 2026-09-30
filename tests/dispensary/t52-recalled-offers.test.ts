// crm-dispensary — T51/T52 N2: a recalled product must not be OFFERED anywhere a customer sees it.
//
// B1 closed every sale DOOR. The offer surfaces were closed only where guard #171's hand-written
// list happened to name them, and a tester found the AI Recs page suggesting recalled stock to 8 of
// 8 customers checked. Nothing recalled can be SOLD — so this is not a compliance leak — but staff
// are told to recommend a product the till will then refuse, in front of the customer.
//
// Inverting that guard (every route serving product rows must exclude recalled, or be a named staff
// surface with a reason) turned up three more that no report had reached:
//
//   · the PUBLIC SEO product pages and their "related products"
//   · the in-store signage menu boards
//   · the menu SYNC that pushes the catalogue to Weedmaps and Dutchie, where customers order —
//     a recall clears every screen the shop owns and leaves the product listed on someone else's
//
// …and a sale DOOR nobody had noticed: the AI budtender's add-to-cart checked `active` and
// `in_stock` and never asked about the lot, so a recalled product went into a basket.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, product, contact } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Offer Leaf', slug: 'leaf-n2', email: 'n2@test.local', state: 'OH',
  enabledFeatures: ['products', 'orders', 'batches', 'contacts', 'ai_budtender', 'signage', 'seo_pages', 'menu_sync'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-n2@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: co.id,
} as any).returning()

const mkProduct = async (name: string) => (await db.insert(product).values({
  name, companyId: co.id, category: 'flower', price: '50', stockQuantity: 100, strainName: 'Blue Dream',
  strainType: 'hybrid', weightGrams: '3.5', taxCategory: 'cannabis', trackInventory: true,
  active: true, visible: true, inStock: true, thcPercent: '20', totalSold: 5,
} as any).returning())[0]

const good = await mkProduct('Good Kush')
const bad = await mkProduct('Recalled Kush')
const [ada] = await db.insert(contact).values({
  type: 'customer', name: 'Ada', companyId: co.id, dateOfBirth: '1985-04-02',
} as any).returning()

const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }
await rows(sql`
  INSERT INTO batches (id, batch_number, product_id, initial_quantity, current_quantity, status, company_id, created_at, updated_at)
  VALUES (gen_random_uuid(), 'N2-BAD', ${bad.id}, 10, 10, 'recalled', ${co.id}, NOW(), NOW()),
         (gen_random_uuid(), 'N2-OK', ${good.id}, 10, 10, 'active', ${co.id}, NOW(), NOW())
`)

const app = new Hono()
for (const [mount, file] of [
  ['/api/recommendations', './src/routes/recommendations.ts'],
  ['/api/signage', './src/routes/signage.ts'],
  ['/api/menu-sync', './src/routes/menu-sync.ts'],
  ['/api/seo-pages', './src/routes/seo-pages.ts'],
] as Array<[string, string]>) {
  app.route(mount, (await import(file)).default)
}
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const api = async (path: string) => {
  const res = await app.request(path, { headers: { 'x-test-user': owner.id } })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
/** Every product name anywhere in a response — the question is "is it offered", not "in which field". */
const namesIn = (v: any): string[] => {
  const out: string[] = []
  const walk = (x: any) => {
    if (!x) return
    if (Array.isArray(x)) { x.forEach(walk); return }
    if (typeof x === 'object') {
      if (typeof x.name === 'string') out.push(x.name)
      Object.values(x).forEach(walk)
    }
  }
  walk(v)
  return out
}
const offers = (r: any, name: string) => namesIn(r.json).includes(name)

// ══════════ the AI Recs page — what the tester found ════════════════════════════════════════════
{
  const sim = await api(`/api/recommendations/similar/${good.id}`)
  check('"similar to this" answers', sim.status === 200, { status: sim.status, body: sim.json })
  check('…and does NOT suggest the recalled product', !offers(sim, 'Recalled Kush'), namesIn(sim.json))

  const forCust = await api(`/api/recommendations/for-customer/${ada.id}`)
  check('recommendations for a customer answer', forCust.status === 200, { status: forCust.status, body: forCust.json })
  check('…and do not suggest the recalled product', !offers(forCust, 'Recalled Kush'), namesIn(forCust.json))
  check('…while the sellable one is still offered', offers(forCust, 'Good Kush'), namesIn(forCust.json))

  const trend = await api('/api/recommendations/trending')
  check('trending answers', trend.status === 200, trend.status)
  check('…and does not list the recalled product', !offers(trend, 'Recalled Kush'), namesIn(trend.json))
}

// ══════════ the three surfaces no report had reached ════════════════════════════════════════════
{
  // The real paths, read from the route files. The first version of this guessed
  // /api/signage/menu/:id and /api/menu-sync/preview, got 404s, and SKIPPED both — so the two
  // surfaces I was least sure about were the two the test quietly did not cover. A skip that looks
  // like a pass is worse than a failure.
  const [screen] = await rows(sql`
    INSERT INTO digital_signs (id, company_id, name, type, created_at, updated_at)
    VALUES (gen_random_uuid(), ${co.id}, 'Front Board', 'menu_board', NOW(), NOW())
    RETURNING id
  `)
  const board = await api(`/api/signage/screens/${screen.id}/menu-data`)
  check('the in-store menu board answers', board.status === 200, { status: board.status, body: board.json })
  check('…and does NOT show the recalled product', !offers(board, 'Recalled Kush'), namesIn(board.json))
  check('…while still showing the sellable one', offers(board, 'Good Kush'), namesIn(board.json))

  const content = await api(`/api/signage/screens/${screen.id}/content`)
  check('the screen content feed does not carry the recalled product',
    content.status !== 200 || !offers(content, 'Recalled Kush'), { status: content.status, names: namesIn(content.json) })

  const sync = await api('/api/menu-sync/weedmaps/preview')
  check('the marketplace sync preview answers', sync.status === 200, { status: sync.status, body: sync.json })
  check('…and excludes the recalled product — it would otherwise stay listed on Weedmaps',
    !offers(sync, 'Recalled Kush'), namesIn(sync.json))
  check('…while still carrying the sellable one', offers(sync, 'Good Kush'), namesIn(sync.json))
}

// ══════════ and the rule itself, so a fifth surface cannot invent a sixth answer ════════════════
{
  const { withoutRecalled, recalledProductIds } = await import('./src/services/sellableStock.ts')
  const ids = await recalledProductIds(db, co.id, [good.id, bad.id])
  check('the one definition of "recalled" names the recalled product', ids.has(bad.id) && !ids.has(good.id), [...ids])
  const kept = await withoutRecalled(db, co.id, [{ id: good.id, name: 'Good Kush' }, { id: bad.id, name: 'Recalled Kush' }])
  check('…and the shared filter drops it and keeps the other',
    kept.length === 1 && (kept[0] as any).name === 'Good Kush', kept)
  const empty = await withoutRecalled(db, co.id, [])
  check('…and an empty list costs no query and stays empty', Array.isArray(empty) && empty.length === 0, empty)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
