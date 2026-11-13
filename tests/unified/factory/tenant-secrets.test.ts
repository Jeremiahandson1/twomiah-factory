// A tenant's database address and sync key are sealed in the Factory's database (security review S5, 2026-11-13;
// apps/api/src/lib/tenantSecrets.ts). Against a stand-in for the Supabase client that keeps what it is given, so the
// test reads what is really STORED as well as what the Factory's code is handed back.
import { describe, test, expect, beforeEach } from 'bun:test'
import { withSealedTenantSecrets, sealSecret, openSecret, isSealed, tenantBySyncKey } from '../../../apps/api/src/lib/tenantSecrets.ts'

type Row = Record<string, any>
/** A tiny thenable query builder over arrays: from(t).insert/update/upsert(...).eq(...).select(...).single(). */
function fakeClient(store: Record<string, Row[]>) {
  const from = (table: string) => {
    const q: any = { op: 'select', payload: null as any, filters: [] as Array<[string, any]>, one: false, joinTenant: false }
    const api: any = {
      insert(p: any) { q.op = 'insert'; q.payload = p; return api },
      update(p: any) { q.op = 'update'; q.payload = p; return api },
      upsert(p: any) { q.op = 'upsert'; q.payload = p; return api },
      select(cols?: string) { q.joinTenant = /tenants/.test(cols || ''); q.cols = cols; return api },
      eq(k: string, v: any) { q.filters.push([k, v]); return api },
      not() { return api },
      single() { q.one = true; return api },
      then(ok: any, err: any) {
        try {
          const rows = (store[table] ||= [])
          const hit = (r: Row) => q.filters.every(([k, v]: [string, any]) => r[k] === v)
          let out: Row[] = []
          if (q.op === 'insert' || q.op === 'upsert') { const list = Array.isArray(q.payload) ? q.payload : [q.payload]; for (const r of list) rows.push({ ...r }); out = list.map((r: Row) => ({ ...r })) }
          else if (q.op === 'update') { for (const r of rows) if (hit(r)) { Object.assign(r, q.payload); out.push({ ...r }) } }
          else out = rows.filter(hit).map((r) => (q.joinTenant ? { ...r, tenants: { ...(store.tenants.find((t) => t.id === r.company_id) || {}) } } : { ...r }))
          // A column alias, as PostgREST gives it: `db:database_url` comes back under `db`.
          if (q.cols && /\w+:\w+/.test(q.cols)) out = out.map((r) => Object.fromEntries(String(q.cols).split(',').map((c) => c.trim()).map((c) => { const [as, col] = c.includes(':') ? c.split(':') : [c, c]; return [as, r[col]] })))
          return Promise.resolve({ data: q.one ? out[0] ?? null : out, error: null }).then(ok, err)
        } catch (e) { return Promise.reject(e).then(ok, err) }
      },
    }
    return api
  }
  return { from, auth: { getUser: () => 'untouched' } }
}

let store: Record<string, Row[]>
let supabase: ReturnType<typeof fakeClient>
const DB = 'postgres://u:secret-password@db.internal:5432/acme'
const KEY = 'sync-key-acme-0123456789'

beforeEach(() => {
  process.env.FACTORY_SECRETS_KEY = 'a-long-secret-set-on-the-factory-service'
  store = { tenants: [], roof_review_queue: [] }
  supabase = withSealedTenantSecrets(fakeClient(store))
})

describe('sealed in the database, plain to the Factory\'s own code', () => {
  test('an insert stores neither secret as written; a read hands both back', async () => {
    await supabase.from('tenants').insert({ id: 't1', name: 'Acme', database_url: DB, factory_sync_key: KEY })
    expect(isSealed(store.tenants[0].database_url)).toBe(true)
    expect(isSealed(store.tenants[0].factory_sync_key)).toBe(true)
    expect(JSON.stringify(store.tenants)).not.toContain('secret-password')
    expect(JSON.stringify(store.tenants)).not.toContain(KEY)
    expect(store.tenants[0].name).toBe('Acme')
    const { data } = await supabase.from('tenants').select('*').eq('id', 't1').single()
    expect(data).toMatchObject({ database_url: DB, factory_sync_key: KEY, name: 'Acme' })
  })

  test('an update seals; a tenant\'s row nested in another table\'s read is opened too; the rest of the client is as it was', async () => {
    await supabase.from('tenants').insert({ id: 't1', name: 'Acme' })
    await supabase.from('tenants').update({ factory_sync_key: KEY }).eq('id', 't1')
    expect(isSealed(store.tenants[0].factory_sync_key)).toBe(true)
    store.roof_review_queue.push({ id: 'r1', company_id: 't1' })
    const { data } = await supabase.from('roof_review_queue').select('*, tenants!fk(render_backend_url, factory_sync_key)')
    expect((data as any[])[0].tenants.factory_sync_key).toBe(KEY)
    expect((supabase as any).auth.getUser()).toBe('untouched')
  })

  test('a row from before, in plain text, is read as it is — and sealed the next time it is written', async () => {
    store.tenants.push({ id: 'old', database_url: DB, factory_sync_key: KEY })
    const { data } = await supabase.from('tenants').select('*').eq('id', 'old').single()
    expect(data).toMatchObject({ database_url: DB, factory_sync_key: KEY })
    await supabase.from('tenants').update({ database_url: (data as any).database_url }).eq('id', 'old')
    expect(isSealed(store.tenants[0].database_url)).toBe(true)
  })

  test('the same value sealed twice is stored differently, and a sealed value is not sealed again', () => {
    const a = sealSecret(KEY) as string, b = sealSecret(KEY) as string
    expect(a).not.toBe(b)
    expect(openSecret(a)).toBe(KEY)
    expect(sealSecret(a)).toBe(a)
  })

  test('a tenant is found by its sync key whether its row is sealed or still plain; a wrong key finds nobody', async () => {
    await supabase.from('tenants').insert({ id: 'sealed', factory_sync_key: KEY })
    store.tenants.push({ id: 'plain', factory_sync_key: 'older-plain-key-000000' })
    expect((await tenantBySyncKey(supabase, KEY))?.id).toBe('sealed')
    expect((await tenantBySyncKey(supabase, 'older-plain-key-000000'))?.id).toBe('plain')
    expect(await tenantBySyncKey(supabase, 'not-a-key')).toBeNull()
    expect(await tenantBySyncKey(supabase, '')).toBeNull()
  })
})

describe('the key', () => {
  test('with no key set nothing is sealed and nothing changes', async () => {
    delete process.env.FACTORY_SECRETS_KEY
    await supabase.from('tenants').insert({ id: 't1', database_url: DB })
    expect(store.tenants[0].database_url).toBe(DB)
    expect((await supabase.from('tenants').select('*').eq('id', 't1').single()).data).toMatchObject({ database_url: DB })
  })

  test('a sealed value is never handed on as if it were the secret: no key, or the wrong key, is an error', async () => {
    await supabase.from('tenants').insert({ id: 't1', database_url: DB })
    delete process.env.FACTORY_SECRETS_KEY
    const read = () => new Promise((ok, no) => (supabase.from('tenants').select('*').eq('id', 't1').single() as any).then(ok, no))
    await expect(read()).rejects.toThrow(/FACTORY_SECRETS_KEY/)
    process.env.FACTORY_SECRETS_KEY = 'a-different-key'
    await expect(read()).rejects.toThrow()
  })
})
