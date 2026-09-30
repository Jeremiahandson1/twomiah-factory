// crm-dispensary — T52 N8: a recall must leave the public menu at once, not within a minute.
//
// The public menu was cached for 60 seconds flat. So for up to a minute after a recall the shop was
// still offering, by name and price, a product it had just declared unsafe. Nothing could be SOLD —
// the till, the kiosk, order-ahead and the AI budtender all ask the batch (T49 B1) — so this was
// never a compliance leak. It is the shop publicly advertising a recalled lot, and "our website was
// a minute behind" is not something anyone wants to say to a regulator or to a buyer.
//
// The fix deliberately is NOT "the recall route clears the cache". That is the shape this codebase
// has been burned by four times now (T47 P20, T48 Q6, T49 B1, T52 M6): a rule every writer must
// remember. Batch status alone is written from five places in batches.ts plus wholesale.ts,
// manufacturing.ts and compliance.ts, and a product leaves the menu through `active`, `visible`,
// price and stock as well as through a recall.
//
// So the cache validates itself: a cached menu carries a stamp — newest updated_at and row count
// across this company's products and batches — and is served only while the shop's stock still
// stamps the same. These tests are about that property, so they exercise it through several
// different writers, including ones that know nothing about a menu.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, product } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Cache Leaf', slug: 'leaf-n8', email: 'n8@test.local', state: 'OH',
  enabledFeatures: ['products', 'orders', 'batches', 'contacts'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-n8@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: co.id,
} as any).returning()

const mkProduct = async (name: string) => (await db.insert(product).values({
  name, companyId: co.id, category: 'flower', price: '50', stockQuantity: 100, strainName: 'Blue Dream',
  strainType: 'hybrid', weightGrams: '3.5', taxCategory: 'cannabis', trackInventory: true,
  active: true, visible: true, inStock: true, thcPercent: '20',
} as any).returning())[0]

const good = await mkProduct('Steady Kush')
const bad = await mkProduct('Doomed Kush')

const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }
await rows(sql`
  INSERT INTO batches (id, batch_number, product_id, initial_quantity, current_quantity, status, company_id, created_at, updated_at)
  VALUES (gen_random_uuid(), 'N8-A', ${good.id}, 10, 10, 'active', ${co.id}, NOW(), NOW()),
         (gen_random_uuid(), 'N8-B', ${bad.id},  10, 10, 'active', ${co.id}, NOW(), NOW())
`)

const app = new Hono()
app.route('/api/menu', (await import('./src/routes/menu.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)

/** Every product name anywhere in the menu response — the question is "is it offered", not "where". */
const namesIn = (v: any): string[] => {
  const out: string[] = []
  const walk = (x: any) => {
    if (!x) return
    if (Array.isArray(x)) { x.forEach(walk); return }
    if (typeof x === 'object') { if (typeof x.name === 'string') out.push(x.name); Object.values(x).forEach(walk); return }
  }
  walk(v)
  return out
}
const menu = async () => {
  const res = await app.request(`/api/menu?slug=${co.slug}`)
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, names: namesIn(j) }
}

// ══════════ the shop opens, and the menu is cached ══════════════════════════════════════════════
{
  const first = await menu()
  check('the public menu answers', first.status === 200, { status: first.status, body: first.json })
  check('…listing both products', first.names.includes('Steady Kush') && first.names.includes('Doomed Kush'), first.names)

  const second = await menu()
  check('a second read with nothing changed gives the same menu',
    JSON.stringify(second.json) === JSON.stringify(first.json), { first: first.names, second: second.names })
}

// ══════════ the finding ═════════════════════════════════════════════════════════════════════════
{
  // A recall, through the real column the real routes write.
  await rows(sql`UPDATE batches SET status = 'recalled', updated_at = NOW() WHERE batch_number = 'N8-B' AND company_id = ${co.id}`)

  const after = await menu()
  check('a recalled product is off the public menu on the VERY NEXT read — it used to linger up to 60s',
    !after.names.includes('Doomed Kush'), after.names)
  check('…and the rest of the shop is still on it', after.names.includes('Steady Kush'), after.names)
  check('…and the count the page prints agrees', Number(after.json?.totalProducts) === 1, after.json?.totalProducts)
}

// ══════════ and it is the STOCK that decides, not the recall route ══════════════════════════════
//
// Nothing below goes anywhere near a recall. These are ordinary writers that have no idea a menu
// exists — which is the whole reason the cache asks the stock rather than waiting to be told.
{
  await db.update(product).set({ price: '75', updatedAt: new Date() } as any)
    .where(sql`${product.id} = ${good.id}` as any)
  const priced = await menu()
  const steady = JSON.stringify(priced.json).includes('75')
  check('a price change reaches the menu at once as well', steady, priced.json?.menu)
}
{
  // Hiding a product from the menu is a different column again.
  await db.update(product).set({ visible: false, updatedAt: new Date() } as any)
    .where(sql`${product.id} = ${good.id}` as any)
  const hidden = await menu()
  check('hiding a product takes it off at once', !hidden.names.includes('Steady Kush'), hidden.names)
  check('…and the menu is now empty rather than stale', Number(hidden.json?.totalProducts) === 0, hidden.json?.totalProducts)
}
{
  const fresh = await mkProduct('Late Arrival')
  const withNew = await menu()
  check('a product added after the cache was filled appears at once', withNew.names.includes('Late Arrival'), withNew.names)

  // A DELETE has to be caught by the row COUNT, and only the delete of a row that is NOT the newest
  // proves it. Deleting the most recently touched product also moves MAX(updated_at) — backwards,
  // but still a change — so that case stays green with the counts taken out of the stamp entirely.
  // A mutation run said exactly that: dropping the product count left the whole suite passing.
  // So age this row first, take a menu on the settled state, and only then delete it.
  await rows(sql`UPDATE products SET updated_at = NOW() - interval '1 hour' WHERE id = ${fresh.id}`)
  const aged = await menu()
  check('…and is still listed once it is no longer the most recently touched row', aged.names.includes('Late Arrival'), aged.names)

  await rows(sql`DELETE FROM products WHERE id = ${fresh.id}`)
  const withoutNew = await menu()
  check('…and deleting it — with MAX(updated_at) unmoved — still takes it off at once; the COUNT is what sees that',
    !withoutNew.names.includes('Late Arrival'), withoutNew.names)
}
{
  // The same hole on the batches side. Removing a batch row from under a product is not a recall,
  // and it moves no product's updated_at at all.
  const other = await mkProduct('Second Shelf')
  await rows(sql`
    INSERT INTO batches (id, batch_number, product_id, initial_quantity, current_quantity, status, company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), 'N8-C', ${other.id}, 10, 10, 'recalled', ${co.id}, NOW(), NOW())
  `)
  const recalledOff = await menu()
  check('a product recalled through a brand-new batch row is off the menu at once', !recalledOff.names.includes('Second Shelf'), recalledOff.names)

  await rows(sql`UPDATE batches SET updated_at = NOW() - interval '1 hour' WHERE batch_number = 'N8-C' AND company_id = ${co.id}`)
  await menu()
  await rows(sql`DELETE FROM batches WHERE batch_number = 'N8-C' AND company_id = ${co.id}`)
  const backOn = await menu()
  check('…and deleting that batch — again with MAX(updated_at) unmoved — puts the product back at once',
    backOn.names.includes('Second Shelf'), backOn.names)
}

// ══════════ T50: the product PAGE opens with the id the listing hands you ═══════════════════════
//
// The page matched a slug-ified name only, and the listing returns `id` and `slug` side by side, so
// a caller holding the id got "Product not found" for every product in the shop. A tester reported
// exactly that and could not check the page's recall exclusion at all, because they could never
// load a product page to check it on.
{
  const listed = await menu()
  const shelf = (listed.json?.menu || []).flatMap((cat: any) => cat.products || [])
  const one = shelf[0]
  check('the menu gives each product an id and a slug', !!one?.id && !!one?.slug, one)

  const get = async (handle: string) => {
    const res = await app.request(`/api/menu/${handle}?slug=${co.slug}`)
    const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
    return { status: res.status, json: j }
  }

  const byId = await get(String(one?.id))
  check('…and the page opens by ID — every id used to answer "Product not found"',
    byId.status === 200 && byId.json?.id === one?.id, { status: byId.status, body: byId.json })

  const bySlug = await get(String(one?.slug))
  check('…and still by slug, which is what it always took',
    bySlug.status === 200 && bySlug.json?.id === one?.id, { status: bySlug.status, body: bySlug.json })

  const nonsense = await get('no-such-product')
  check('…and something that is neither is still a 404', nonsense.status === 404, nonsense.status)

  // …and now the recall exclusion on the page is reachable to check, which was the point of the
  // tester's note. 'Doomed Kush' was recalled above and is off the listing; its page has to go too,
  // or the product is still being offered at its own URL.
  const [doomed] = await rows(sql`SELECT id, name FROM products WHERE company_id = ${co.id} AND name = 'Doomed Kush'`)
  const recalledPage = await get(String(doomed?.id))
  check('a recalled product\'s own page is a 404 as well — not just its listing',
    recalledPage.status === 404, { status: recalledPage.status, body: recalledPage.json })
}

// ══════════ the cache is still a cache ══════════════════════════════════════════════════════════
//
// It would be easy to "fix" staleness by never caching, and every assertion above would still pass
// on a public page that now runs its full twenty-query build on every hit. This proves a hit is
// really served from memory: the row is changed WITHOUT moving updated_at, which no route in the
// codebase does, so the stamp is unmoved and the cached copy is what comes back.
{
  await rows(sql`UPDATE products SET visible = true WHERE id = ${good.id}`) // note: no updated_at
  const stillCached = await menu()
  check('an unstamped write does NOT rebuild — so reads are genuinely cached, not silently re-run',
    !stillCached.names.includes('Steady Kush'), stillCached.names)

  await rows(sql`UPDATE products SET updated_at = NOW() WHERE id = ${good.id}`)
  const rebuilt = await menu()
  check('…and the moment the stamp moves, the menu is rebuilt', rebuilt.names.includes('Steady Kush'), rebuilt.names)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
