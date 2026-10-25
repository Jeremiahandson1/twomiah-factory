// The product feeds (2026-10-24, the store upgrade): the catalogue on sale as Google Merchant Center reads it (RSS 2.0
// XML with the g: namespace, or a tab-separated file) and as Meta's catalog reads it (CSV), at addresses only the owner
// knows: /api/public/feeds/<token>/google.xml, /google.tsv and /meta.csv. The token is store_settings.feed_token, made
// on first read and replaced from Settings (which retires the old addresses).
//
// One row per variant, the fields Shopify's Google & YouTube and Facebook channels send: id (the SKU), item_group_id
// (the product, when it has several variants), title, description, link, image_link, price (and sale_price when a
// compare-at price is above it), availability, brand (the product's, else the store's name), gtin and mpn when the
// variant has them (identifier_exists 'no' when it has neither), condition. Gift cards are not listed — Google does not
// take them as products. A closed store answers 503, as its catalogue does.
import { timingSafeEqual } from 'node:crypto'
import { Hono, type Context, type MiddlewareHandler } from 'hono'
import type { CrmDeps } from '../../deps.ts'
import type { StoreCore } from '../core.ts'
import { feedPrice } from '../lib/money.ts'
import { storefrontCatalogue, type StorefrontProduct } from './catalogue.ts'
import { requestOrigin } from './checkoutService.ts'

export interface FeedRow {
  id: string; item_group_id: string; title: string; description: string; link: string; image_link: string
  price: string; sale_price: string; availability: 'in_stock' | 'out_of_stock'; brand: string; gtin: string; mpn: string
  identifier_exists: string; condition: string
}

/** Plain text from the owner's description (it may carry markup), on one line, at most Google's 5,000 characters. */
const plain = (s: string | null | undefined) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 5000)

/** The feed's rows: one per variant of every product on sale that is goods (not a gift card). */
export function feedRows(products: StorefrontProduct[], origin: string, storeName: string, currency: string): FeedRow[] {
  const base = origin.replace(/\/+$/, '')
  const abs = (u: string | undefined) => (!u ? '' : /^https?:\/\//i.test(u) ? u : u.startsWith('/') ? base + u : '')
  const rows: FeedRow[] = []
  for (const p of products) {
    if ((p as any).kind === 'gift_card') continue
    const image = p.images.find((i) => i.isPrimary) ?? p.images[0]
    for (const v of p.variants) {
      const onSale = v.compareAtPriceCents != null && v.compareAtPriceCents > v.priceCents
      const gtin = (v as any).gtin || '', mpn = (v as any).mpn || ''
      rows.push({
        id: v.sku,
        item_group_id: p.variants.length > 1 ? p.id : '',
        title: (v.name && v.name !== p.name && v.name !== 'Default' ? `${p.name} - ${v.name}` : p.name).slice(0, 150),
        description: plain(p.description) || plain(p.tagline) || p.name,
        link: `${base}/product/${encodeURIComponent(p.slug)}`,
        image_link: abs(image?.url),
        price: feedPrice(onSale ? v.compareAtPriceCents! : v.priceCents, currency),
        sale_price: onSale ? feedPrice(v.priceCents, currency) : '',
        availability: v.inventoryQty === null || v.inventoryQty > 0 ? 'in_stock' : 'out_of_stock',
        brand: (p as any).brand || storeName,
        gtin, mpn,
        identifier_exists: gtin || mpn ? '' : 'no',
        condition: (p as any).condition || 'new',
      })
    }
  }
  return rows
}

const xmlEsc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]!))

/** Google Merchant Center's RSS 2.0 feed. Empty fields are left out. */
export function googleXml(rows: FeedRow[], meta: { title: string; link: string }): string {
  const items = rows.map((r) => '<item>' + (Object.entries(r) as [string, string][])
    .filter(([, v]) => v !== '').map(([k, v]) => `<g:${k}>${xmlEsc(v)}</g:${k}>`).join('') + '</item>').join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>${xmlEsc(meta.title)}</title><link>${xmlEsc(meta.link)}</link><description>${xmlEsc(meta.title)} products</description>\n${items}\n</channel></rss>\n`
}

/** Google's tab-separated feed: a header of attribute names, one line per row; a tab or line break in a value is a space. */
export function googleTsv(rows: FeedRow[]): string {
  const header: (keyof FeedRow)[] = ['id', 'item_group_id', 'title', 'description', 'link', 'image_link', 'price', 'sale_price', 'availability', 'brand', 'gtin', 'mpn', 'identifier_exists', 'condition']
  const cell = (v: string) => v.replace(/[\t\r\n]+/g, ' ')
  return [header.join('\t'), ...rows.map((r) => header.map((k) => cell(r[k])).join('\t'))].join('\n') + '\n'
}

/** Meta's catalog CSV: its own availability words ("in stock"), every value quoted. */
export function metaCsv(rows: FeedRow[]): string {
  const header = ['id', 'title', 'description', 'availability', 'condition', 'price', 'sale_price', 'link', 'image_link', 'brand', 'gtin', 'mpn', 'item_group_id'] as const
  const q = (v: string) => `"${v.replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`
  return [header.join(','), ...rows.map((r) => header.map((k) => q(k === 'availability' ? r.availability.replace(/_/g, ' ') : r[k])).join(','))].join('\n') + '\n'
}

/** Is `given` this store's feed token? Constant-time, and never true when the store has none. */
export function tokenMatches(given: string, token: string | null | undefined): boolean {
  if (!token || !given) return false
  const a = Buffer.from(given), b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function createFeedRoutes(d: CrmDeps, core: StoreCore, shopperDoor: MiddlewareHandler) {
  const app = new Hono()
  const rowsFor = async (c: Context): Promise<{ rows: FeedRow[]; title: string; link: string } | null> => {
    const co = await core.shop()
    if (!co) return null
    const settings = await core.settings(co.id)
    if (!tokenMatches(c.req.param('token') || '', settings.feedToken)) return null
    const origin = requestOrigin(c)
    return { rows: feedRows(await storefrontCatalogue(d, co.id), origin, co.name, settings.currency || 'usd'), title: co.name, link: origin }
  }
  const notFound = (c: Context) => c.text('Not found', 404)
  app.get('/feeds/:token/google.xml', shopperDoor, async (c) => {
    const f = await rowsFor(c); if (!f) return notFound(c)
    return c.body(googleXml(f.rows, f), 200, { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'no-store' })
  })
  app.get('/feeds/:token/google.tsv', shopperDoor, async (c) => {
    const f = await rowsFor(c); if (!f) return notFound(c)
    return c.body(googleTsv(f.rows), 200, { 'content-type': 'text/tab-separated-values; charset=utf-8', 'cache-control': 'no-store' })
  })
  app.get('/feeds/:token/meta.csv', shopperDoor, async (c) => {
    const f = await rowsFor(c); if (!f) return notFound(c)
    return c.body(metaCsv(f.rows), 200, { 'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store' })
  })
  return app
}
