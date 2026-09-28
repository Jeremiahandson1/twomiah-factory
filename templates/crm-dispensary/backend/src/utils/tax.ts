/**
 * What a basket is taxed, for every till in the building.
 *
 * There are two ways to sell in this product — the register (routes/orders.ts) and the kiosk
 * (routes/kiosk.ts) — and until now only one of them charged tax. The kiosk wrote its subtotal into
 * `total` and stopped, so a $70 basket rang up at $70 on the tablet and $87.50 over the counter.
 * (Dispensary T29 B2.)
 *
 * The cause was not a missing line. It was a second implementation of "complete a sale": every money
 * rule the register grew — the configured rates, excise on cannabis lines only, tax on the DISCOUNTED
 * price, rounding to cents — had to be written twice to hold, and the second copy was never written.
 * So the arithmetic lives here now and both tills call it. A till that does not call this has no tax,
 * and check-one-tax-definition.ts fails the build for it.
 *
 * Nothing here is new behaviour: this is the register's math, moved. The register's own suite is what
 * proves that — it passed unchanged across the move.
 */

/** Used only when the operator has not set a rate in Settings. Both vary by state. */
export const DEFAULT_EXCISE_RATE = 0.15   // cannabis excise
export const DEFAULT_SALES_RATE = 0.0875  // state + local sales tax

/** Cents. Raw floats like 2.8000000000000003 render badly and break exact-match reconciliation. */
export const round2 = (n: number) => Math.round(n * 100) / 100

export type TaxRates = { salesRate: number; exciseRate: number }

/**
 * Does a medical sale skip the cannabis excise here? Default yes: Ohio — this product's first
 * market — exempts registered patients, as do most medical programmes, and a patient charged a tax
 * they do not owe is a refund and a compliance problem rather than a rounding difference.
 * A state that does tax patients sets settings.tax.medicalExciseExempt to false.
 */
export const DEFAULT_MEDICAL_EXCISE_EXEMPT = true

export function medicalExciseExempt(co: { settings?: any } | null | undefined): boolean {
  let settings: any = co?.settings
  if (typeof settings === 'string') { try { settings = JSON.parse(settings) } catch { settings = null } }
  const configured = settings?.tax?.medicalExciseExempt
  return configured == null ? DEFAULT_MEDICAL_EXCISE_EXEMPT : configured !== false
}

/**
 * The rates this company charges. Settings holds percents ("8.5"), not fractions — the register
 * charged a hardcoded constant once and disagreed with the number the operator had typed.
 * A blank, absent or unparseable value falls back to the default rather than to zero: an untaxed
 * sale is a compliance problem, not a free upgrade.
 */
export function taxRatesFor(
  co: { taxRate?: any; exciseTaxRate?: any; settings?: any } | null | undefined,
  sale?: { isMedical?: boolean | null },
): TaxRates {
  const sales = co?.taxRate != null && co.taxRate !== '' ? Number(co.taxRate) / 100 : DEFAULT_SALES_RATE
  const excise = co?.exciseTaxRate != null && co.exciseTaxRate !== '' ? Number(co.exciseTaxRate) / 100 : DEFAULT_EXCISE_RATE
  const exciseRate = Number.isFinite(excise) ? excise : DEFAULT_EXCISE_RATE
  return {
    salesRate: Number.isFinite(sales) ? sales : DEFAULT_SALES_RATE,
    // A registered patient does not pay the adult-use excise in Ohio, and in most medical
    // programmes. It stays here rather than in the till because a route that applies a rate itself
    // is exactly how the kiosk ended up untaxed — check-one-tax-definition.ts enforces that.
    exciseRate: sale?.isMedical && medicalExciseExempt(co) ? 0 : exciseRate,
  }
}

/** A line, however the till happens to spell it. `tax_category` comes off raw SQL, `taxCategory` off drizzle. */
export type TaxableLine = {
  taxCategory?: string | null
  tax_category?: string | null
  lineTotal?: any
  total?: any
  total_price?: any
}

const lineAmount = (l: TaxableLine) => Number(l.lineTotal ?? l.total ?? l.total_price ?? 0) || 0
const isCannabisTaxLine = (l: TaxableLine) => (l.taxCategory ?? l.tax_category) === 'cannabis'

/**
 * The part of the basket excise applies to. Excise is cannabis-only; sales tax is everything.
 * One definition, so the two tills cannot disagree about which lines are cannabis for TAX — a
 * separate question from whether a line counts toward the purchase LIMIT (utils/cannabis.ts).
 */
export function cannabisSubtotalOf(lines: TaxableLine[]): number {
  return lines.filter(isCannabisTaxLine).reduce((sum, l) => sum + lineAmount(l), 0)
}

export type AssessedTax = {
  cannabisSubtotal: number
  taxableCannabis: number
  taxableAll: number
  exciseTax: number
  salesTax: number
  totalTax: number
  grandTotal: number
}

/**
 * Tax is assessed on the DISCOUNTED price. Charging it on the gross once made a customer with a 100%
 * discount pay $7 of tax on a $0 purchase (F-07). The discount is spread across cannabis and
 * non-cannabis merchandise pro rata, so excise and sales tax each apply to their own net base.
 */
export function assessTax(args: {
  subtotal: number
  cannabisSubtotal: number
  discount?: number
  rates: TaxRates
}): AssessedTax {
  const subtotal = Number(args.subtotal) || 0
  const cannabisSubtotal = Number(args.cannabisSubtotal) || 0
  const discount = Number(args.discount) || 0
  const { salesRate, exciseRate } = args.rates

  const cannabisShare = subtotal > 0 ? cannabisSubtotal / subtotal : 0
  const taxableCannabis = Math.max(0, cannabisSubtotal - discount * cannabisShare)
  const taxableAll = Math.max(0, subtotal - discount)
  const exciseTax = round2(taxableCannabis * exciseRate)
  const salesTax = round2(taxableAll * salesRate)
  const totalTax = round2(exciseTax + salesTax)
  const grandTotal = round2(subtotal + totalTax - discount)

  return { cannabisSubtotal, taxableCannabis, taxableAll, exciseTax, salesTax, totalTax, grandTotal }
}
