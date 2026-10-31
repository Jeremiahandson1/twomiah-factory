// What the catalog screens share: the records the server answers (server/crm/store/catalog/*.ts, read for each shape),
// reading a list reply, and money and rates typed as text and sent as whole numbers.
//
// Replaces the template's services/api.ts types (the unified server's replies differ: a list is { data, pagination },
// a reward's use count is usageCount, a loyalty member is a contact) and lib/format.ts (dollarsToCents parsed with
// parseFloat and multiplied, so '1.005' or '0.29' could land a cent off; these read the digits instead).
import { useEffect, useState } from 'react'
import { api } from '../../../../api'
import { money } from '@twomiah/tenant-ui/src/money'

export interface ProductImage { id: string; productId: string; url: string; alt: string | null; position: number; isPrimary: boolean }
export interface ProductVariant {
  id: string; productId: string; sku: string; name: string; priceCents: number
  compareAtPriceCents: number | null; weightOz: number | null
  inventoryQty: number | null; options: Record<string, string> | null; position: number
  gtin?: string | null; mpn?: string | null
  /** Tell the owner when stock reaches this (store_low_stock); null = no alert. */
  lowStockAt?: number | null
  /** What a unit costs the shop. Absent for a seat that may not see it (margin:read); null = none entered. */
  costCents?: number | null
  /** Who the shop buys it from, and the count a reorder brings it back to (store_reorders). */
  supplierId?: string | null; reorderToQty?: number | null
}
export interface Product {
  id: string; slug: string; name: string; tagline: string | null; description: string | null
  status: 'draft' | 'active' | 'archived'; featured: boolean; leadTimeDays: number | null
  seoTitle: string | null; seoDescription: string | null; position: number
  /** physical | gift_card; the feeds' brand and condition; the upsells' category and the owner's picks. */
  kind?: 'physical' | 'gift_card'; brand?: string | null; condition?: 'new' | 'refurbished' | 'used'; category?: string | null
  boughtTogetherIds?: string[] | null; alsoLikeIds?: string[] | null
  /** Days after an order arrives that the post-purchase "time to reorder" email goes out; null = none. */
  replenishAfterDays?: number | null
  images: ProductImage[]; variants: ProductVariant[]
}
export interface DiscountCode {
  id: string; code: string; type: 'percent' | 'fixed'; value: number; active: boolean
  minSubtotalCents: number; maxUses: number | null; usedCount: number; expiresAt: string | null; createdAt: string
}
export interface Review {
  id: string; productId: string; productName: string | null; productSlug: string | null
  authorName: string; authorEmail: string | null; rating: number; title: string | null; body: string | null
  status: 'pending' | 'approved' | 'rejected'; verifiedPurchase: boolean; createdAt: string
}
export interface ShippingZone { name: string; countries: string[]; states: string[]; rateCents: number; freeThresholdCents?: number | null }
export interface TaxRate { country: string; state: string; rateBps: number }
/** server/db/schema/store.ts storeSettings, as GET /api/admin/settings answers it. */
export interface StoreSettings {
  id: string; currency: string; flatShippingCents: number; freeShippingThresholdCents: number | null; taxRateBps: number
  shippingZones: ShippingZone[] | null; taxRates: TaxRate[] | null
  abandonedCartEnabled: boolean; abandonedCartDelayMinutes: number; reviewsEnabled: boolean; reviewRequestDays: number
  stripeTaxEnabled?: boolean; pickupEnabled?: boolean; pickupAddress?: string | null; pickupHours?: string | null
  /** The product feeds' private token: sent only to the owner (settings:update). */
  feedToken?: string | null
}

/** A list reply's rows (RULEBOOK §3: { data, pagination }); anything else is no rows. */
export function listOf<T>(reply: unknown): T[] {
  const data = (reply as { data?: unknown } | null)?.data
  return Array.isArray(data) ? (data as T[]) : []
}

/** A refusal's code and per-box messages (RULEBOOK §3: { error, code?, fields? }), from the shared client's error. */
export function refusalOf(err: unknown): { code?: string; fields: Record<string, string> } {
  const data = (err as { data?: { code?: unknown; fields?: unknown } } | null)?.data
  const fields = data?.fields && typeof data.fields === 'object' ? (data.fields as Record<string, string>) : {}
  return { code: typeof data?.code === 'string' ? data.code : undefined, fields }
}

/**
 * A decimal typed by a person, in hundredths: '24.99' → 2499, '7.25' (a percent) → 725 basis points. Read from the
 * digits, rounded half up at the third decimal, so no float ever touches it. '' and anything that is not a plain
 * non-negative number is null — the form says so rather than sending 0.
 */
export function toHundredths(text: string): number | null {
  const s = String(text ?? '').trim().replace(/^\$/, '').replace(/,/g, '')
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s)
  if (!m || (!m[1] && !m[2])) return null
  const whole = Number(m[1] || '0')
  const frac = (m[2] || '').padEnd(3, '0')
  const cents = whole * 100 + Number(frac.slice(0, 2)) + (Number(frac[2]) >= 5 ? 1 : 0)
  return Number.isSafeInteger(cents) ? cents : null
}

/** Hundredths as the text a form shows: 2499 → '24.99'; null → ''. */
export function fromHundredths(n: number | null | undefined): string {
  if (n === null || n === undefined) return ''
  const sign = n < 0 ? '-' : ''
  const a = Math.abs(Math.trunc(n))
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`
}

/** A whole number typed by a person ('' → null; '3.5', '-1', 'x' → NaN, so the form can say which box is wrong). */
export function toWhole(text: string): number | null {
  const s = String(text ?? '').trim()
  if (!s) return null
  return /^\d+$/.test(s) ? Number(s) : NaN
}

/** Basis points as a percent for a form: 725 → '7.25', 500 → '5'. */
export const bpsToPercent = (bps: number | null | undefined) => (bps === null || bps === undefined ? '' : String(bps / 100))

/** Cents in the store's currency: 2499 → '$24.99'. */
export function formatMoney(cents: number | null | undefined, currency = 'usd'): string {
  const n = Number(cents ?? 0) / 100
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: (currency || 'usd').toUpperCase() }).format(n)
  } catch {
    return `${money(n)}`
  }
}

/** The store's currency (GET /api/admin/settings, which every seat may read); 'usd' until it answers. */
export function useStoreCurrency(): string {
  const [currency, setCurrency] = useState('usd')
  useEffect(() => {
    let live = true
    api.get('/api/admin/settings')
      .then((s: Partial<StoreSettings> | null) => { if (live && s?.currency) setCurrency(s.currency) })
      .catch(() => { /* the default is a fine fallback for showing prices */ })
    return () => { live = false }
  }, [])
  return currency
}

/** A product's status badge — each ink on its ground in both themes (gray-600 on gray-100 is 6.9:1). */
export const PRODUCT_STATUS: Record<Product['status'], { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300' },
  active: { label: 'Active', cls: 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300' },
  archived: { label: 'Archived', cls: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400' },
}
