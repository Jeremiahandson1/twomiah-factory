// Reading the field group's replies (server/crm/roof/field/*.ts): a list is { data, pagination } (RULEBOOK §3).

export interface Pagination { page: number; limit: number; total: number; pages: number }

/** A list reply's rows; anything else is no rows. */
export function listOf<T>(reply: unknown): T[] {
  const data = (reply as { data?: unknown } | null)?.data
  return Array.isArray(data) ? (data as T[]) : []
}

/** A list reply's pagination, or null. */
export function paginationOf(reply: unknown): Pagination | null {
  const p = (reply as { pagination?: Pagination } | null)?.pagination
  return p && typeof p.total === 'number' ? p : null
}
