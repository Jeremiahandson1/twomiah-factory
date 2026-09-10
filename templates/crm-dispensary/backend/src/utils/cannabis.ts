// Single source of truth for "is this product cannabis?" — used by the register (orders.ts),
// the public online menu (menu.ts), tax, purchase limits and the age gate.
//
// Product categories that are cannabis (excise-taxed, count toward the purchase limit, require
// 21+/ID). Both spellings of pre-roll are accepted: seeded rows and older data use 'preroll'
// while the enum is 'pre_roll'.
export const CANNABIS_CATEGORIES = new Set(['flower', 'pre_roll', 'preroll', 'edible', 'concentrate', 'vape', 'tincture'])

// tax_category is the explicit switch when set; when it is NULL (every seeded product, and any
// row created before the column existed) fall back to the category. Excise was keyed on
// tax_category === 'cannabis' ALONE, so a tenant whose products had tax_category NULL charged
// $0 excise on every sale while Settings said 15% — a systemic under-remittance. (QA F-01)
// Per-transaction cannabis purchase limit (oz flower-equivalent): company.purchase_limit_oz
// (Settings → General) → the state's adult-use flower limit → 2.5 oz. It used to be a hardcoded
// 2.5 oz in both the register and the online menu regardless of Settings/state (go-live QA V-1).
export const GRAMS_PER_OZ = 28.3495
export const DEFAULT_LIMIT_OZ = 2.5
// Adult-use flower purchase limits (oz) — verify against current statute before onboarding;
// operators can override in Settings. CO raised its limit to 2 oz in 2022 (HB21-1090).
export const STATE_LIMIT_OZ: Record<string, number> = {
  CO: 2, CA: 1, WA: 1, OR: 2, NV: 2.5, AZ: 1, MI: 2.5, IL: 1, MA: 1, NJ: 1, NY: 3, CT: 0.5, VT: 1, ME: 2.5, MO: 3, MD: 1.5, RI: 1, MT: 1, NM: 2, VA: 1, DE: 1, MN: 2, OH: 2.5, AK: 1,
}
export function resolvePurchaseLimitOz(co: { purchaseLimitOz?: string | null; state?: string | null } | null | undefined): number {
  const configured = Number(co?.purchaseLimitOz)
  if (Number.isFinite(configured) && configured > 0) return configured
  const st = String(co?.state || '').trim().toUpperCase()
  return STATE_LIMIT_OZ[st] || DEFAULT_LIMIT_OZ
}

export function isCannabisLine(p: { taxCategory?: string | null; category?: string | null; productCategory?: string | null }): boolean {
  if (p.taxCategory === 'cannabis') return true
  if (p.taxCategory === 'non_cannabis') return false
  return CANNABIS_CATEGORIES.has(String(p.category || p.productCategory || '').toLowerCase())
}
