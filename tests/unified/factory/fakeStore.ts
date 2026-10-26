// A stand-in for the Factory's Supabase client: tables of rows, and the from().select/insert/update/eq/order/limit/
// single/maybeSingle chain the Factory code uses, awaited the way supabase-js is (a thenable query).
export type Row = Record<string, any>

export function fakeStore(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {}
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }))
  const writes: Array<{ table: string; op: 'insert' | 'update' | 'delete'; values: Row; where: Array<[string, any]> }> = []
  let n = 0

  function query(table: string) {
    const rows = () => (tables[table] ||= [])
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select'
    let values: Row = {}
    let inserted: Row[] = []
    const where: Array<[string, any]> = []
    let order: [string, boolean] | null = null
    let limit = Infinity
    const within: Array<[string, any[]]> = []
    const atLeast: Array<[string, any]> = []
    const match = (r: Row) => where.every(([k, v]) => r[k] === v) && within.every(([k, vs]) => vs.includes(r[k])) && atLeast.every(([k, v]) => r[k] >= v)
    const run = (): { data: any; error: any } => {
      if (op === 'insert') return { data: inserted, error: null }
      if (op === 'delete') {
        const hit = rows().filter(match)
        tables[table] = rows().filter((r) => !match(r))
        writes.push({ table, op: 'delete', values: {}, where: [...where] })
        return { data: hit, error: null }
      }
      if (op === 'update') {
        const hit = rows().filter(match)
        for (const r of hit) Object.assign(r, values)
        writes.push({ table, op: 'update', values, where: [...where] })
        return { data: hit, error: null }
      }
      let out = rows().filter(match)
      if (order) { const [k, asc] = order; out = [...out].sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * (asc ? 1 : -1)) }
      return { data: out.slice(0, limit).map((r) => ({ ...r })), error: null }
    }
    const q: any = {
      select: () => q,
      insert: (v: Row | Row[]) => {
        op = 'insert'
        inserted = (Array.isArray(v) ? v : [v]).map((r) => ({ id: 'row-' + ++n, created_at: new Date(Date.now() + n).toISOString(), ...r }))
        rows().push(...inserted)
        for (const r of inserted) writes.push({ table, op: 'insert', values: r, where: [] })
        return q
      },
      update: (v: Row) => { op = 'update'; values = v; return q },
      delete: () => { op = 'delete'; return q },
      eq: (k: string, v: any) => { where.push([k, v]); return q },
      in: (k: string, vs: any[]) => { within.push([k, vs]); return q },
      gte: (k: string, v: any) => { atLeast.push([k, v]); return q },
      order: (k: string, o: { ascending?: boolean } = {}) => { order = [k, o.ascending !== false]; return q },
      limit: (x: number) => { limit = x; return q },
      single: async () => { const { data } = run(); const r = Array.isArray(data) ? data[0] : data; return r ? { data: { ...r }, error: null } : { data: null, error: { code: 'PGRST116', message: 'no row' } } },
      maybeSingle: async () => { const { data } = run(); return { data: Array.isArray(data) ? (data[0] ?? null) : data, error: null } },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    }
    return q
  }
  return { from: (t: string) => query(t), tables, writes }
}

/**
 * ONE stand-in Factory DB for the test files that load the same Factory modules (services/a2p.ts, messagingWallet.ts):
 * a module binds the `supabase` of the first file that loads it, so files that each made their own store saw each
 * other's (bun runs them in one process). Each file reseeds its tables and sets its own `rpc` in beforeEach.
 */
export const sharedFactoryDb: ReturnType<typeof fakeStore> & { rpc?: (fn: string, args: any) => Promise<any> } = fakeStore()
