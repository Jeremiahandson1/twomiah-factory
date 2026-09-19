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
// (Settings → General), else a conservative 1 oz. It used to be a hardcoded 2.5 oz in both the
// register and the online menu regardless of Settings (go-live QA V-1).
//
// IMPORTANT — this is the retail SALE limit the register enforces per transaction, NOT the
// personal POSSESSION limit. They differ: Colorado raised possession to 2 oz in 2022 but a
// store may still sell at most 1 oz of flower per transaction (final QA sign-off correction).
// We deliberately ship NO per-state table: sale limits change and vary by product class, so the
// operator (or their compliance counsel) sets the value in Settings. 1 oz is the common floor.
export const GRAMS_PER_OZ = 28.3495
export const DEFAULT_LIMIT_OZ = 1
export function resolvePurchaseLimitOz(co: { purchaseLimitOz?: string | null; state?: string | null } | null | undefined): number {
  const configured = Number(co?.purchaseLimitOz)
  if (Number.isFinite(configured) && configured > 0) return configured
  return DEFAULT_LIMIT_OZ
}

export function isCannabisLine(p: { taxCategory?: string | null; category?: string | null; productCategory?: string | null }): boolean {
  if (p.taxCategory === 'cannabis') return true
  if (p.taxCategory === 'non_cannabis') return false
  return CANNABIS_CATEGORIES.has(String(p.category || p.productCategory || '').toLowerCase())
}

// ── Age ────────────────────────────────────────────────────────────────────────────────────────
// 21 to buy cannabis; 18 on a medical sale with a card on file. The register has enforced this
// server-side since QA F-02 ("client-side-only enforcement is not a compliance control"), and the
// kiosk now runs the SAME rule from here rather than trusting a boolean the customer's own device
// supplies — it asked "are you 21?", stored the answer as proof, and discarded the date of birth
// it was given. A date of birth in 2012 walked straight through. (Dispensary T20 B2)
export const ADULT_USE_MIN_AGE = 21
export const MEDICAL_MIN_AGE = 18

/** Whole years between a date of birth and today; null when there is no usable date. */
export function ageFromDob(dob: string | Date | null | undefined): number | null {
  if (!dob) return null
  const birth = new Date(dob as any)
  if (Number.isNaN(birth.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age
}

/** The minimum age this sale requires: 18 only for a medical sale that actually carries a card. */
export const minimumAgeFor = (o: { isMedical?: boolean | null; medicalCardNumber?: string | null }): number =>
  o?.isMedical && o?.medicalCardNumber ? MEDICAL_MIN_AGE : ADULT_USE_MIN_AGE
