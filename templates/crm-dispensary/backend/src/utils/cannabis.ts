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

// ── Weight ─────────────────────────────────────────────────────────────────────────────────────
// Per-unit cannabis weight in grams. Seeded products store it in weight_grams; older rows use
// weight + weight_unit. Reading only `weight` meant every seeded flower rang up as 0 g, so a 3.09 oz
// cart passed the limit and the order stored weight 0, breaking EOD/Metrc/audit reconstruction
// (retest#7). The kiosk had no weight logic AT ALL — it counted nothing, enforced nothing and wrote
// 0 — so 2.47 oz went through a till that refuses 1.11 oz at the register. (Dispensary T20 B1)
export function unitGramsOf(p: { weightGrams?: any; weight?: any; weightUnit?: string | null }): number {
  if (p?.weightGrams != null && String(p.weightGrams) !== '') return Number(p.weightGrams) || 0
  if (!p?.weight) return 0
  const n = Number(p.weight) || 0
  return p.weightUnit === 'oz' ? n * GRAMS_PER_OZ : n
}

/**
 * Cannabis lines whose flower-equivalent weight cannot be established, by name.
 *
 * The limit used to treat these as ZERO and wave them through: forty chocolate bars carrying 4,000 mg
 * of THC, and 29 grams of a flower product whose weight field was blank, both counted as 0 oz against
 * a 1 oz cap. cartCannabisGrams skips any line that comes back as 0 (`if (unit > 0)`), so an unweighed
 * cannabis product contributed nothing at all rather than refusing. (Dispensary T29 H3)
 *
 * The fallback chain below this function was written to avoid under-counting and still ended at zero,
 * which is the same under-count wearing a comment. There is no safe number to guess here — a limit is
 * a legal one, and a product nobody can weigh cannot be sold until someone weighs it. So the tills
 * refuse and name the product, instead of quietly selling past the cap.
 */
export function uncountableCannabisLines(
  lines: Array<{ product: any; quantity: any }>,
  _factors?: EquivalencyFactors,
): string[] {
  const names: string[] = []
  for (const { product, quantity } of lines) {
    if (!isCannabisLine(product || {})) continue
    if ((Number(quantity) || 0) <= 0) continue
    // The test is the product's OWN WEIGHT, not its flower-equivalent. A topical weighs 200 g and
    // contributes nothing because its equivalency factor is deliberately 0 — "weighs nothing toward
    // the limit" and "cannot be weighed" are different facts, and refusing the first would stop a
    // legitimate sale the rules are written to allow. Only a line whose grams are unknown is
    // uncountable; an edible with a weight but no potency already falls back to that weight.
    if (unitGramsOf(product || {}) > 0) continue
    // …or whose MILLIGRAMS are known. An edible labelled 100 mg is perfectly countable without a
    // weight — milligrams are how it is sold and how the limit is written — so refusing it for having
    // no grams would take a correctly-recorded product off the shelf. (T30)
    if (unitThcMg(product || {}) > 0) continue
    const name = product?.name || product?.productName || 'A cannabis product'
    if (!names.includes(name)) names.push(name)
  }
  return names
}

/** The one refusal, so the register and the kiosk say the same thing. Null when every line can be counted. */
export function unweighedCannabisRefusal(names: string[]): { error: string; code: string; products: string[] } | null {
  if (!names.length) return null
  const list = names.join(', ')
  return {
    error: `${list} ${names.length === 1 ? 'has' : 'have'} no weight recorded, so this sale cannot be counted against the purchase limit. Set a weight (or THC mg) on ${names.length === 1 ? 'it' : 'them'} in Products before selling.`,
    code: 'cannabis_weight_missing',
    products: names,
  }
}

/**
 * Grams the way an order stores them.
 *
 * A cart is weighed by adding floating-point numbers, so 0.1 g + 0.2 g lands on
 * 0.30000000000000004 — and because the column is text, that is the string that got written and
 * printed back on Order Detail. Three decimals is one milligram, finer than any scale in a
 * dispensary. All three tills write through here, so the register, the online menu and the kiosk
 * cannot record the same basket differently. (Dispensary T31 L7)
 */
export const gramsText = (g: number): string => String(Math.round((Number(g) || 0) * 1000) / 1000)

/** Cannabis grams on a cart. Non-cannabis lines weigh nothing toward the limit. */
export function cartCannabisGrams(lines: Array<{ product: any; quantity: any }>, factors?: EquivalencyFactors): number {
  let grams = 0
  for (const { product, quantity } of lines) {
    if (!isCannabisLine(product)) continue
    const unit = lineFlowerEquivalentGrams(product, factors)
    if (unit > 0) grams += unit * (Number(quantity) || 0)
  }
  return grams
}

// ── Equivalency ────────────────────────────────────────────────────────────────────────────────
// A limit expressed in flower is not a limit on raw mass: the Equivalency module already stores what a gram
// of each category is WORTH in flower (1 g concentrate = 2.5 g flower, 10 mg THC of edible = 1 g flower,
// topicals count for nothing), per company and state. Nothing read those rules — the limit counted raw grams
// — so 25 g of concentrate, which is 62.5 g of flower equivalent, walked under a 1 oz cap. (Dispensary T20 H5)
export type EquivalencyFactors = Map<string, { factor: number; unit: string }>

/** 'preroll' and 'pre_roll' are the same category; rules are keyed the way the enum spells it. */
export const equivalencyKey = (p: { category?: string | null; productCategory?: string | null }): string => {
  const raw = String(p?.category || p?.productCategory || '').toLowerCase()
  return raw === 'preroll' ? 'pre_roll' : raw
}

/**
 * One unit of this product, in grams of FLOWER EQUIVALENT.
 *
 * With no rule for the category, this is the product's own weight — the behaviour before the rules were read,
 * so an unconfigured tenant is never worse off. Where the rule is written in mg of THC, the potency has to
 * come from somewhere: a product carries thc_percent and a weight, so mg = grams x percent x 10. A product
 * with no usable potency falls back to its own weight rather than to zero, because counting an edible as
 * nothing is the very under-count this fixes. There is no per-unit mg-THC field on a product; adding one is
 * the way to make edibles exact, and that is a product decision, not something to infer here.
 */
export function lineFlowerEquivalentGrams(product: any, factors?: EquivalencyFactors): number {
  const grams = unitGramsOf(product)
  const rule = factors?.get(equivalencyKey(product))
  if (!rule) return grams
  if (rule.unit === 'mg_thc') {
    const mg = unitThcMg(product)
    return mg > 0 ? mg * rule.factor : grams
  }
  return grams * rule.factor
}

/**
 * THC in one unit of this product, in milligrams.
 *
 * Prefer the number printed on the packet (thc_mg). Before that field existed the only way to express
 * potency was a percentage of weight, which an edible does not meaningfully have — so 40 chocolate
 * bars at 100 mg each were counted as 0.14 oz against a 1 oz cap instead of roughly 14 oz, and the
 * equivalency rules that knew what a milligram is worth had nothing to work with. (T29 H3 / T30)
 *
 * The percentage path stays for flower and concentrate, where a percentage of a real weight IS the
 * potency: mg = grams x percent x 10.
 */
export function unitThcMg(p: any): number {
  const direct = Number(p?.thcMg ?? p?.thc_mg)
  if (Number.isFinite(direct) && direct > 0) return direct
  const pct = Number(p?.thcPercent ?? p?.thc_percent)
  const grams = unitGramsOf(p || {})
  return Number.isFinite(pct) && pct > 0 && grams > 0 ? grams * pct * 10 : 0
}

/** The one over-limit answer, so every till says the same thing. Null when the basket is allowed. */
export function overPurchaseLimit(totalGrams: number, limitOz: number): { error: string; totalWeightOz: string; limitOz: string } | null {
  if (totalGrams <= limitOz * GRAMS_PER_OZ + 1e-6) return null
  return {
    error: `Purchase exceeds limit: ${(totalGrams / GRAMS_PER_OZ).toFixed(2)}oz exceeds the ${limitOz}oz maximum`,
    totalWeightOz: (totalGrams / GRAMS_PER_OZ).toFixed(2),
    limitOz: String(limitOz),
  }
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
