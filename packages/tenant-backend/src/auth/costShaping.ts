// What the business PAID, withheld from a seat without `margin:read` — for a module whose reads are open to every seat
// because the work needs them (the fleet's vehicles, a customer's equipment), but whose rows carry a cost. (Live role
// check, 2026-10-23: a technician and a read-only viewer read every vehicle's fuel spend and maintenance bills, and every
// service record's cost on a customer's equipment.)
//
// The same rule as inventory's costed() (inventory/inventory.ts) and the pricebook's: the read is NOT refused, the cost
// keys are taken out. `margin:read` is the one permission the fleet asks this question with (auth/permissions.ts, the
// note on the admin row). Open when the template wired no `canSee`: a module that silently starts withholding figures
// from the owner would be the worse bug.
export type CanSee = (role: string, permission: string, userId?: string) => Promise<boolean>

export function createCostShaping(canSee: CanSee | undefined, costKeys: Iterable<string>) {
  const KEYS = new Set(costKeys)
  const strip = (v: any): any => {
    if (Array.isArray(v)) return v.map(strip)
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const out: Record<string, any> = {}
      for (const [k, val] of Object.entries(v)) {
        // A list's paging is counts, never money.
        if (k === 'pagination') out[k] = val
        else if (!KEYS.has(k)) out[k] = strip(val)
      }
      return out
    }
    return v
  }
  /** May the signed-in seat see cost? Fails CLOSED when the check itself throws. */
  const maySeeCost = async (c: any): Promise<boolean> => {
    if (!canSee) return true
    const u = c.get('user') as any
    try { return await canSee(u?.role, 'margin:read', u?.userId) } catch { return false }
  }
  /** Answer a read, minus the cost keys for a seat that may not see them. */
  const costed = async (c: any, data: any, status?: number) => {
    const body = (await maySeeCost(c)) ? data : strip(data)
    return status ? c.json(body, status) : c.json(body)
  }
  return { costed, maySeeCost, strip }
}
