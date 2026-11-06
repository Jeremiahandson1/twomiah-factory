// The Materials dashboard's sort (RULEBOOK §2: raw SQL lives here). Roofr's order list sorts on status, number, address,
// supplier, amount and delivery; ours adds the job and the order date. Text sorts ignore case, and an order with nothing in
// the column goes last whichever way it is sorted (a plain `desc` would put the blanks first).
import { desc, sql } from 'drizzle-orm'
import { job, material } from '../db/schema/index.ts'

export const MATERIAL_SORTS = ['status', 'po', 'job', 'address', 'supplier', 'orderDate', 'delivery', 'amount'] as const
export type MaterialSort = (typeof MATERIAL_SORTS)[number]

const column: Record<MaterialSort, { col: any; text: boolean }> = {
  status: { col: material.orderStatus, text: true },
  po: { col: material.poNumber, text: true },
  job: { col: job.number, text: true },
  address: { col: material.deliveryAddress, text: true },
  supplier: { col: material.supplier, text: true },
  orderDate: { col: material.orderDate, text: false },
  delivery: { col: material.deliveryDate, text: false },
  amount: { col: material.totalCost, text: false },
}

/** The ORDER BY for a sort and direction; ties and the default are newest first. */
export function materialOrderBy(sort: MaterialSort | undefined, dir: 'asc' | 'desc'): any[] {
  const tail = [desc(material.createdAt), desc(material.id)]
  if (!sort) return tail
  const { col, text } = column[sort]
  const expr = text ? sql`lower(${col})` : sql`${col}`
  return [dir === 'desc' ? sql`${expr} DESC NULLS LAST` : sql`${expr} ASC NULLS LAST`, ...tail]
}
