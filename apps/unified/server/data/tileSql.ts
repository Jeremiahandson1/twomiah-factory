// SQL the phone's home-screen conditions need that the query builder has no form for (rulebook §2: raw SQL lives in server/data/).
// The conditions themselves are written once in crm/<trade>/tileConditions.ts; these are the two fragments they build on.
import { ilike, or, sql } from 'drizzle-orm'

/**
 * The vaccinations that count: the LATEST administration (with a due date) per (patient, vaccine), of a living patient — a
 * renewed shot's old row does not nag. DISTINCT ON has no builder form; ties on the given date settle on the id.
 */
export const latestDueVaccinationCondition = (vaccination: any, companyId: string) => sql`${vaccination.id} in (
  select distinct on (v.patient_id, lower(v.vaccine)) v.id
  from vaccination v join patient p on p.id = v.patient_id
  where v.company_id = ${companyId} and v.due_date is not null and p.deceased = false
  order by v.patient_id, lower(v.vaccine), v.given_date desc nulls last, v.id
)`

/**
 * Stock look-up on the product list (`?q=`): a name, a variant's name, its SKU, or its barcode (GTIN, whole).
 * Wildcards the shopper typed are literal. `product` / `variant` are the Drizzle tables.
 */
export function productSearchCondition(product: any, variant: any, q: string) {
  const needle = `%${q.trim().replace(/[\\%_]/g, (ch) => '\\' + ch)}%`
  return or(
    ilike(product.name, needle),
    sql`exists (select 1 from ${variant} where ${variant.productId} = ${product.id} and (${variant.sku} ilike ${needle} or ${variant.name} ilike ${needle} or ${variant.gtin} = ${q.trim()}))`,
  )!
}

/**
 * "Low stock" (store_low_stock): a product with an option that tracks its stock, has a level set, and is at or under it.
 * One definition for the Products list's filter and the Dashboard's tile. `product` / `variant` are the Drizzle tables.
 */
export const lowStockProductCondition = (product: any, variant: any) =>
  sql`exists (select 1 from ${variant} where ${variant.productId} = ${product.id} and ${variant.lowStockAt} is not null and ${variant.inventoryQty} is not null and ${variant.inventoryQty} <= ${variant.lowStockAt})`
