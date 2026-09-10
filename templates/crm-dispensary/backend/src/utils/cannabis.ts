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
export function isCannabisLine(p: { taxCategory?: string | null; category?: string | null; productCategory?: string | null }): boolean {
  if (p.taxCategory === 'cannabis') return true
  if (p.taxCategory === 'non_cannabis') return false
  return CANNABIS_CATEGORIES.has(String(p.category || p.productCategory || '').toLowerCase())
}
