/**
 * lib/square/catalog.ts — the menu's two directions.
 *
 * PUSH (once, at go-live): the menu already transcribed into menu_items is
 * written into the seller's empty Square catalog, so nobody retypes it at the
 * register. Square ids come back and are stored on our rows.
 *
 * PULL (forever after): Square is the source of truth. A catalog webhook (or
 * the admin button) lists the catalog and upserts menu_sections/menu_items by
 * Square id, keeping everything that is ours alone — slug, story, hero photo,
 * signature flag, dietary tags, the console's 86. Items gone from Square are
 * deactivated, never deleted, so a signature page's story survives a mistake.
 */
import { asc, eq } from 'drizzle-orm'
import type { db as DB } from '../../db'
import { menuItems, menuSections, squareState } from '../../db/schema'
import { formatCents, squareApi, squareConfig } from './client'

export interface Variation { id: string | null; name: string; priceCents: number | null; soldOut?: boolean }

const AMOUNT = /\$\s*(\d+(?:\.\d{1,2})?)/g
const cents = (s: string) => Math.round(Number(s) * 100)

function variationPairNames(sectionDescription: string | null | undefined): [string, string] {
  const m = /\b(sandwich|burger)\s*\/\s*platter\b/i.exec(sectionDescription || '')
  return m ? [m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(), 'Platter'] : ['Regular', 'Large']
}

/**
 * Turn the transcribed price label into Square variations.
 *   "$5.79 / $7.29"              (section says "Sandwich / platter") → Sandwich 579, Platter 729
 *   "Tuesdays · $7.49 / $9.09"   → the same, the "Tuesdays" part carries no price
 *   "15 / $7.99 · 20 / $10.39"   → "15 pieces" 799, "20 pieces" 1039
 *   no label, priceCents 949     → Regular 949
 *   nothing                      → [] (a variable-price item; the register asks)
 */
export function variationsFromLabel(priceCents: number | null | undefined, priceLabel: string | null | undefined, sectionDescription?: string | null): Variation[] {
  const label = (priceLabel || '').trim()
  if (!label) return typeof priceCents === 'number' ? [{ id: null, name: 'Regular', priceCents }] : []
  const out: Variation[] = []
  for (const part of label.split('·').map(p => p.trim()).filter(Boolean)) {
    const amounts = [...part.matchAll(AMOUNT)].map(m => cents(m[1]))
    if (!amounts.length) continue
    if (amounts.length >= 2) {
      const [a, b] = variationPairNames(sectionDescription)
      out.push({ id: null, name: a, priceCents: amounts[0] }, { id: null, name: b, priceCents: amounts[1] })
      continue
    }
    const name = part.replace(AMOUNT, '').replace(/[\/:]/g, ' ').replace(/\s+/g, ' ').trim()
    out.push({ id: null, name: !name ? 'Regular' : /^\d+$/.test(name) ? `${name} pieces` : name, priceCents: amounts[0] })
  }
  if (!out.length && typeof priceCents === 'number') out.push({ id: null, name: 'Regular', priceCents })
  return out
}

// Size names the section description already explains ("Sandwich / platter"), so the price column can stay short.
const PLAIN_SIZES = /^(regular|sandwich|burger|platter|basket|dinner|small|large|single|double)$/i

/**
 * The printed label for an item's variations, short enough for a phone's price column.
 * One price → null (the price column shows it). "Sandwich/Platter" → "$5.79 / $7.29", like the paper menu.
 * Anything else keeps its names: "15 pieces $7.99 · 20 pieces $10.39".
 */
export function labelFromVariations(vs: Variation[]): string | null {
  const priced = vs.filter(v => typeof v.priceCents === 'number')
  if (priced.length <= 1) return null
  if (priced.every(v => PLAIN_SIZES.test(v.name.trim()))) return priced.map(v => formatCents(v.priceCents)).join(' / ')
  return priced.map(v => `${v.name} ${formatCents(v.priceCents)}`).join(' · ')
}

export function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'item'
}

// ─── PUSH ──────────────────────────────────────────────────────────────────

interface PushSection { id: string; slug: string; name: string; description: string | null; items: Array<typeof menuItems.$inferSelect> }

/** Build one BatchUpsertCatalogObjects batch from our menu. Pure — tested. */
export function buildCatalogPush(sections: PushSection[]) {
  const objects: any[] = []
  for (const sec of sections) {
    const catId = `#cat-${sec.slug}`
    objects.push({ type: 'CATEGORY', id: catId, category_data: { name: sec.name } })
    for (const it of sec.items) {
      const stored = Array.isArray(it.variations) ? (it.variations as Variation[]) : []
      const vs = stored.length ? stored : variationsFromLabel(it.priceCents, it.priceLabel, sec.description)
      const variations = (vs.length ? vs : [{ id: null, name: 'Regular', priceCents: null }]).map((v, n) => ({
        type: 'ITEM_VARIATION',
        id: `#var-${it.slug}-${n}`,
        item_variation_data: typeof v.priceCents === 'number'
          ? { name: v.name, pricing_type: 'FIXED_PRICING', price_money: { amount: v.priceCents, currency: 'USD' } }
          : { name: v.name, pricing_type: 'VARIABLE_PRICING' },
      }))
      objects.push({
        type: 'ITEM',
        id: `#item-${it.slug}`,
        item_data: {
          name: it.name,
          ...(it.description ? { description: it.description } : {}),
          categories: [{ id: catId }],
          reporting_category: { id: catId },
          variations,
        },
      })
    }
  }
  return objects
}

export interface PushResult { categories: number; items: number; variations: number; skippedBecauseCatalogHasItems?: number }

/**
 * Write our menu into Square. Refuses when the seller's catalog already has
 * items (unless force) — pushing twice would duplicate the whole menu.
 */
export async function pushMenuToSquare(db: typeof DB, opts: { force?: boolean } = {}): Promise<PushResult> {
  const cfg = squareConfig()
  if (!cfg) throw new Error('Square is not configured')
  if (!opts.force) {
    const existing = await squareApi<{ objects?: any[] }>('/v2/catalog/list?types=ITEM', 'GET', undefined, cfg)
    const n = (existing.objects || []).filter(o => !o.is_deleted).length
    if (n > 0) return { categories: 0, items: 0, variations: 0, skippedBecauseCatalogHasItems: n }
  }
  const secRows = await db.select().from(menuSections).where(eq(menuSections.isActive, true)).orderBy(asc(menuSections.sortOrder))
  const itemRows = await db.select().from(menuItems).where(eq(menuItems.isActive, true)).orderBy(asc(menuItems.sortOrder))
  const sections = secRows.map(s => ({ id: s.id, slug: s.slug, name: s.name, description: s.description, items: itemRows.filter(i => i.sectionId === s.id) }))
  const objects = buildCatalogPush(sections)
  const res = await squareApi<{ id_mappings?: Array<{ client_object_id: string; object_id: string }> }>('/v2/catalog/batch-upsert', 'POST', {
    idempotency_key: crypto.randomUUID(),
    batches: [{ objects }],
  }, cfg)
  const map = new Map((res.id_mappings || []).map(m => [m.client_object_id, m.object_id]))

  let categories = 0, items = 0, variations = 0
  await db.transaction(async (tx) => {
    for (const s of sections) {
      const catId = map.get(`#cat-${s.slug}`)
      if (catId) { await tx.update(menuSections).set({ squareCategoryId: catId }).where(eq(menuSections.id, s.id)); categories++ }
      for (const it of s.items) {
        const itemId = map.get(`#item-${it.slug}`)
        if (!itemId) continue
        const obj = objects.find(o => o.id === `#item-${it.slug}`)
        const vs: Variation[] = obj.item_data.variations.map((v: any) => ({
          id: map.get(v.id) || null,
          name: v.item_variation_data.name,
          priceCents: v.item_variation_data.price_money?.amount ?? null,
        }))
        variations += vs.length
        await tx.update(menuItems).set({ squareItemId: itemId, squareVariationId: vs[0]?.id || null, variations: vs, updatedAt: new Date() }).where(eq(menuItems.id, it.id))
        items++
      }
    }
  })
  await upsertState(db, { catalogPushedAt: new Date() })
  return { categories, items, variations }
}

// ─── PULL ──────────────────────────────────────────────────────────────────

export interface CatalogSection { squareId: string; name: string }
export interface CatalogItem {
  squareId: string; categoryId: string | null; name: string; description: string | null
  imageUrl: string | null; variations: Variation[]; soldOut: boolean
}

function presentAt(o: any, locationId: string): boolean {
  if (Array.isArray(o.absent_at_location_ids) && o.absent_at_location_ids.includes(locationId)) return false
  if (o.present_at_all_locations === false) return Array.isArray(o.present_at_location_ids) && o.present_at_location_ids.includes(locationId)
  return true
}

/** Square catalog objects → sections + items for one location. Pure — tested. */
export function mapCatalog(objects: any[], locationId: string): { sections: CatalogSection[]; items: CatalogItem[] } {
  const live = objects.filter(o => o && !o.is_deleted)
  const images = new Map(live.filter(o => o.type === 'IMAGE').map(o => [o.id, o.image_data?.url || null]))
  const items: CatalogItem[] = []
  for (const o of live) {
    if (o.type !== 'ITEM' || !presentAt(o, locationId)) continue
    const d = o.item_data || {}
    if (d.is_archived) continue
    const variations: Variation[] = (d.variations || [])
      .filter((v: any) => v && !v.is_deleted && presentAt(v, locationId))
      .map((v: any) => {
        const vd = v.item_variation_data || {}
        const override = (vd.location_overrides || []).find((x: any) => x.location_id === locationId)
        return {
          id: v.id,
          name: vd.name || 'Regular',
          priceCents: vd.pricing_type === 'VARIABLE_PRICING' ? null : (typeof vd.price_money?.amount === 'number' ? vd.price_money.amount : null),
          soldOut: !!override?.sold_out,
        }
      })
    if (!variations.length) continue
    items.push({
      squareId: o.id,
      categoryId: d.categories?.[0]?.id || d.category_id || d.reporting_category?.id || null,
      name: String(d.name || '').trim() || 'Item',
      description: (d.description_plaintext || d.description || '').trim() || null,
      imageUrl: (d.image_ids || []).map((id: string) => images.get(id)).find(Boolean) || null,
      variations,
      soldOut: variations.every(v => v.soldOut),
    })
  }
  const used = new Set(items.map(i => i.categoryId).filter(Boolean))
  const sections = live
    .filter(o => o.type === 'CATEGORY' && used.has(o.id))
    .map(o => ({ squareId: o.id, name: String(o.category_data?.name || 'Menu').trim() }))
  if (items.some(i => !i.categoryId || !sections.find(s => s.squareId === i.categoryId))) {
    sections.push({ squareId: '__uncategorized', name: 'More' })
    for (const i of items) if (!i.categoryId || !sections.find(s => s.squareId === i.categoryId)) i.categoryId = '__uncategorized'
  }
  return { sections, items }
}

async function listCatalog(): Promise<any[]> {
  const out: any[] = []
  let cursor = ''
  for (let page = 0; page < 50; page++) {
    const q = '/v2/catalog/list?types=ITEM,CATEGORY,IMAGE' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '')
    const res = await squareApi<{ objects?: any[]; cursor?: string }>(q)
    out.push(...(res.objects || []))
    if (!res.cursor) break
    cursor = res.cursor
  }
  return out
}

const DRINK = /\b(drink|drinks|beverage|beverages|beer|beers|tap|taps|wine|cocktail|cocktails|soda|spirits|liquor|bar)\b/i

export interface SyncResult { sections: number; items: number; created: number; deactivated: number; soldOut: number }

/** Square → menu_sections/menu_items. Keeps local-only columns. One transaction. */
export async function syncFromSquare(db: typeof DB, objects?: any[]): Promise<SyncResult> {
  const cfg = squareConfig()
  if (!cfg) throw new Error('Square is not configured')
  const { sections, items } = mapCatalog(objects || await listCatalog(), cfg.locationId)
  const result: SyncResult = { sections: sections.length, items: items.length, created: 0, deactivated: 0, soldOut: 0 }

  await db.transaction(async (tx) => {
    const localSecs = await tx.select().from(menuSections)
    const localItems = await tx.select().from(menuItems)
    const secSlugs = new Set(localSecs.map(s => s.slug))
    const itemSlugs = new Set(localItems.map(i => i.slug))
    const unique = (base: string, taken: Set<string>) => { let s = base, n = 2; while (taken.has(s)) s = `${base}-${n++}`; taken.add(s); return s }

    // Sections
    const secIdBySquare = new Map<string, string>()
    const keptSecs = new Set<string>()
    let nextSort = localSecs.reduce((m, s) => Math.max(m, s.sortOrder), -1) + 1
    for (const s of sections) {
      const match = localSecs.find(l => l.squareCategoryId === s.squareId)
        || localSecs.find(l => !l.squareCategoryId && !keptSecs.has(l.id) && (l.name.toLowerCase() === s.name.toLowerCase() || l.slug === slugify(s.name)))
      if (match) {
        await tx.update(menuSections).set({ name: s.name, squareCategoryId: s.squareId, isActive: true }).where(eq(menuSections.id, match.id))
        secIdBySquare.set(s.squareId, match.id); keptSecs.add(match.id)
      } else {
        const [row] = await tx.insert(menuSections).values({ slug: unique(slugify(s.name), secSlugs), name: s.name, kind: DRINK.test(s.name) ? 'drink' : 'food', squareCategoryId: s.squareId, sortOrder: nextSort++ }).returning()
        secIdBySquare.set(s.squareId, row.id); keptSecs.add(row.id)
      }
    }
    for (const l of localSecs) if (!keptSecs.has(l.id) && l.isActive) await tx.update(menuSections).set({ isActive: false }).where(eq(menuSections.id, l.id))

    // Items
    const keptItems = new Set<string>()
    const now = new Date()
    for (const [idx, it] of items.entries()) {
      const priced = it.variations.filter(v => typeof v.priceCents === 'number')
      const common = {
        name: it.name,
        sectionId: secIdBySquare.get(it.categoryId || '') || null,
        variations: it.variations,
        priceCents: priced.length ? Math.min(...priced.map(v => v.priceCents as number)) : null,
        priceLabel: labelFromVariations(it.variations),
        squareItemId: it.squareId,
        squareVariationId: it.variations[0]?.id || null,
        squareSoldOut: it.soldOut,
        isActive: true,
        updatedAt: now,
      }
      if (it.soldOut) result.soldOut++
      const match = localItems.find(l => l.squareItemId === it.squareId)
        || localItems.find(l => !l.squareItemId && !keptItems.has(l.id) && (l.name.toLowerCase() === it.name.toLowerCase() || l.slug === slugify(it.name)))
      if (match) {
        await tx.update(menuItems).set({
          ...common,
          // Square wins where it has something to say; our copy stays where it is silent.
          description: it.description ?? match.description,
          imageUrl: match.imageUrl || it.imageUrl,
        }).where(eq(menuItems.id, match.id))
        keptItems.add(match.id)
      } else {
        const [row] = await tx.insert(menuItems).values({ ...common, slug: unique(slugify(it.name), itemSlugs), description: it.description, imageUrl: it.imageUrl, sortOrder: 1000 + idx }).returning()
        keptItems.add(row.id); result.created++
      }
    }
    for (const l of localItems) if (!keptItems.has(l.id) && l.isActive) { await tx.update(menuItems).set({ isActive: false, updatedAt: now }).where(eq(menuItems.id, l.id)); result.deactivated++ }
  })

  await upsertState(db, { lastSyncAt: new Date(), lastSyncResult: `${result.items} items in ${result.sections} sections; ${result.created} new, ${result.deactivated} removed, ${result.soldOut} sold out` })
  return result
}

export async function upsertState(db: typeof DB, patch: Partial<typeof squareState.$inferInsert>) {
  const [row] = await db.select().from(squareState).limit(1)
  if (row) await db.update(squareState).set({ ...patch, updatedAt: new Date() }).where(eq(squareState.id, row.id))
  else await db.insert(squareState).values({ ...patch })
}

export async function getState(db: typeof DB) {
  const [row] = await db.select().from(squareState).limit(1)
  return row || null
}
