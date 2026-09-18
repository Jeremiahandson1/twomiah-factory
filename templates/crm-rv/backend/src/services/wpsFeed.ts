/**
 * WPS (Western Power Sports) Data Depot v4 puller — automatic aftermarket parts rail.
 *
 * Pulls the dealer's WPS catalog (SKU, name, list price, dealer cost, stock status)
 * on the dealer's OWN API token — no OEM approval needed (WPS is an aftermarket
 * distributor; access rides the dealer's WPS account). Upserts into catalog_part and
 * refreshes the cost of any linked stocked item.
 *
 * API (docs: wps-inc.com/data-depot/v4/api): base https://api.wps-inc.com,
 * auth `Authorization: Bearer <token>`, `GET /items` with cursor pagination
 * (page[size], page[cursor]; envelope { data, meta.cursor.next }).
 *
 * ⚠️ FIELD MAPPING: WPS doesn't publish the exact /items field names without an
 * account. The mapper below covers the documented/likely names (sku, name,
 * list_price, standard_dealer_price, status) defensively — confirm against a real
 * response once we have Chance's WPS token, and adjust mapItem if needed.
 */
import { db } from '../../db/index.ts'
import { catalogPart, inventoryItem } from '../../db/schema.ts'
import { and, eq, sql } from 'drizzle-orm'

const WPS_BASE = 'https://api.wps-inc.com'

function num(v: any): string | null {
  if (v == null || v === '') return null
  const n = String(v).replace(/[^0-9.]/g, '')
  return n === '' ? null : n
}

// Map a WPS item → our catalog_part shape.
function mapItem(it: any): any | null {
  const sku = it?.sku || (it?.id != null ? String(it.id) : null)
  if (!sku) return null
  const price = num(it.list_price ?? it.mapp_price ?? it.msrp ?? it.price)
  const cost = num(it.standard_dealer_price ?? it.dealer_price ?? it.your_price ?? it.cost)
  const status = String(it.status || '').toUpperCase()
  const availability = status === 'STK' ? 'In stock'
    : status === 'DSC' ? 'Discontinued'
    : status === 'NEW' || status === 'PRE' ? 'Order from OEM'
    : 'Order from OEM'
  return {
    partNumber: String(sku),
    name: it.name || it.description || String(sku),
    oem: it.brand || it.supplier || 'WPS', // aftermarket distributor; refine to real brand later via /brands
    category: 'Parts',
    price: price ?? '0',
    cost,
    availability,
    fitment: null,
  }
}

async function upsertRows(companyId: string, rows: any[]) {
  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK).map((p) => ({
      companyId, partNumber: p.partNumber, name: p.name, oem: p.oem, category: p.category,
      price: p.price, cost: p.cost, msrp: null, availability: p.availability, fitment: p.fitment,
      source: 'feed:wps',
    }))
    if (!batch.length) continue
    await db.insert(catalogPart).values(batch).onConflictDoUpdate({
      target: [catalogPart.companyId, catalogPart.partNumber, catalogPart.oem],
      set: {
        price: sql`excluded.price`, cost: sql`excluded.cost`, availability: sql`excluded.availability`,
        name: sql`excluded.name`, category: sql`excluded.category`, source: sql`excluded.source`, updatedAt: new Date(),
      },
    })
  }
}

async function refreshLinkedCosts(companyId: string): Promise<number> {
  const upd: any = await db.execute(sql`
    UPDATE inventory_item ii SET unit_cost = cp.cost, updated_at = now()
    FROM catalog_part cp
    WHERE ii.catalog_part_id = cp.id AND cp.company_id = ${companyId} AND cp.cost IS NOT NULL
  `)
  return Number(upd?.rowCount ?? upd?.count ?? 0)
}

/**
 * Pull the WPS catalog for a company. Cursor-paginates /items, upserts, refreshes costs.
 * maxPages bounds a full sync (WPS has ~tens of thousands of SKUs).
 */
export async function pullWps(
  companyId: string,
  token: string,
  { pageSize = 250, maxPages = 400 }: { pageSize?: number; maxPages?: number } = {},
): Promise<{ ok: boolean; imported?: number; costsUpdated?: number; pages?: number; error?: string }> {
  if (!token) return { ok: false, error: 'No WPS API token configured' }
  let cursor: string | null = null
  let imported = 0
  let pages = 0
  try {
    do {
      const url = new URL(WPS_BASE + '/items')
      url.searchParams.set('page[size]', String(pageSize))
      if (cursor) url.searchParams.set('page[cursor]', cursor)
      const res = await fetch(url.toString(), {
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
        signal: AbortSignal.timeout(45000),
      })
      if (res.status === 401 || res.status === 403) return { ok: false, error: 'WPS auth failed — check the API token' }
      if (!res.ok) return { ok: false, error: `WPS API HTTP ${res.status}` }
      const body: any = await res.json().catch(() => null)
      const list = Array.isArray(body?.data) ? body.data : (body?.data ? [body.data] : [])
      const rows = list.map(mapItem).filter(Boolean)
      if (rows.length) { await upsertRows(companyId, rows); imported += rows.length }
      cursor = body?.meta?.cursor?.next || null
      pages++
    } while (cursor && pages < maxPages)

    const costsUpdated = await refreshLinkedCosts(companyId)
    console.log(`[WPS] ${companyId}: imported ${imported} items over ${pages} pages, refreshed ${costsUpdated} stocked costs`)
    return { ok: true, imported, costsUpdated, pages }
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) }
  }
}

export default { pullWps }
