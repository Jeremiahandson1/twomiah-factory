// A TENANT'S SECRETS, KEPT SEALED IN THE FACTORY'S DATABASE (security review S5, 2026-11-13).
//
// `tenants.database_url` is the address AND password of a business's whole database; `tenants.factory_sync_key` is the
// key the Factory signs its instructions to that business with (switch features, mark a payment paid). Both sat in the
// Factory's Supabase as plain text — so the day that table was readable with the dashboard's public key (S5-1), every
// business's database was one copy-and-paste away. Sealed, a read of the table gives nothing that opens anything.
//
// HOW. One wrapper round the Factory's own Supabase client (middleware/auth.ts) — the ~150 places that read and write
// these two columns do not change:
//   · a write to `tenants` (insert / update / upsert) seals the two columns on the way in;
//   · every read, of any table, opens them on the way out — wherever a tenant's row comes back, nested or not.
// A value is sealed with AES-256-GCM (lib/crypto.ts) and marked `enc:`; a value without the mark is plain text from
// before, and is read as it is — so rows are sealed as they are next written, or all at once (the admin route
// POST /admin/seal-tenant-secrets).
//
// THE KEY is FACTORY_SECRETS_KEY, a secret on the Factory's own service and nowhere else. Until it is set nothing is
// sealed and nothing changes. ONCE IT IS SET IT MUST NEVER BE CHANGED OR REMOVED: every sealed value is unreadable
// without it (the businesses keep running — their own services hold their own copies — but the Factory could no longer
// reach them until each value was entered again). docs/SECURITY.md says the same.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

export const TENANT_SECRET_COLUMNS = ['database_url', 'factory_sync_key'] as const
const MARK = 'enc:v1.'
const WRITES = new Set(['insert', 'update', 'upsert'])

const keyOf = (): Buffer | null => {
  const raw = process.env.FACTORY_SECRETS_KEY
  return raw ? createHash('sha256').update(raw, 'utf8').digest() : null
}
export const sealingIsOn = () => !!process.env.FACTORY_SECRETS_KEY
export const isSealed = (v: unknown): v is string => typeof v === 'string' && v.startsWith(MARK)

/** Seal one value (left as it is when no key is set, when it is empty, or when it is sealed already). */
export function sealSecret(v: unknown): unknown {
  const key = keyOf()
  if (!key || typeof v !== 'string' || !v || isSealed(v)) return v
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(v, 'utf8'), cipher.final()])
  return `${MARK}${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${enc.toString('base64')}`
}

/** Open one value (plain text from before is returned as it is). A sealed value with no key, or the wrong one, is an error — never passed on as if it were the secret. */
export function openSecret(v: unknown): unknown {
  if (!isSealed(v)) return v
  const key = keyOf()
  if (!key) throw new Error('A tenant secret is sealed but FACTORY_SECRETS_KEY is not set on this service')
  const [ivB64, tagB64, dataB64] = v.slice(MARK.length).split('.')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64 || '', 'base64'), { authTagLength: 16 })
  decipher.setAuthTag(Buffer.from(tagB64 || '', 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(dataB64 || '', 'base64')), decipher.final()]).toString('utf8')
}

const SECRET = new Set<string>(TENANT_SECRET_COLUMNS)

/** A row (or rows) on its way INTO `tenants`: the two columns sealed, everything else untouched. */
export function sealTenantWrite<T>(payload: T): T {
  if (Array.isArray(payload)) return payload.map((p) => sealTenantWrite(p)) as unknown as T
  if (!payload || typeof payload !== 'object') return payload
  let out: any = payload
  for (const col of TENANT_SECRET_COLUMNS) {
    if (col in (payload as any)) { if (out === payload) out = { ...(payload as any) }; out[col] = sealSecret((payload as any)[col]) }
  }
  return out
}

/** Whatever came back from a read: every sealed `database_url` / `factory_sync_key` in it opened, however deep it sits. */
export function openTenantRead<T>(value: T, depth = 0): T {
  if (!value || typeof value !== 'object' || depth > 6) return value
  if (Array.isArray(value)) { for (let i = 0; i < value.length; i++) value[i] = openTenantRead(value[i], depth + 1); return value }
  const o = value as any
  for (const k of Object.keys(o)) {
    if (SECRET.has(k)) { if (isSealed(o[k])) o[k] = openSecret(o[k]) }
    else if (o[k] && typeof o[k] === 'object') o[k] = openTenantRead(o[k], depth + 1)
  }
  return value
}

/** One query being built: its writes to `tenants` sealed, its answer opened. Each step of the chain stays wrapped. */
function wrapQuery(builder: any, table: string): any {
  return new Proxy(builder, {
    get(target, prop) {
      if (prop === 'then') {
        // Opened first, THEN handed to the caller's own handlers: an `await` listens only through the two it passes in,
        // so a value that cannot be opened has to reach its `onErr` — thrown inside its `onOk` it would be heard by nobody
        // and the await would never finish.
        return (onOk?: (v: any) => any, onErr?: (e: any) => any) => target.then((res: any) => {
          if (res && typeof res === 'object' && 'data' in res && res.data) res.data = openTenantRead(res.data)
          return res
        }).then(onOk, onErr)
      }
      const value = Reflect.get(target, prop, target)
      if (typeof value !== 'function') return value
      return (...args: any[]) => {
        if (table === 'tenants' && typeof prop === 'string' && WRITES.has(prop) && args.length) args[0] = sealTenantWrite(args[0])
        const next = value.apply(target, args)
        return next && typeof next === 'object' && typeof next.then === 'function' ? wrapQuery(next, table) : next
      }
    },
  })
}

/** The Factory's Supabase client, with `from()` wrapped (above). Everything else on the client is as it was. */
export function withSealedTenantSecrets<C extends { from: (table: string) => any }>(client: C): C {
  return new Proxy(client as any, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target)
      if (prop === 'from') return (table: string) => wrapQuery(value.call(target, table), table)
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as C
}

/**
 * The tenant a sync key belongs to. A lookup by the key itself (`.eq('factory_sync_key', key)`) finds only rows still
 * in plain text — a sealed value is different every time it is written — so the rows are read (opened by the wrapper)
 * and compared here, in constant time.
 */
export async function tenantBySyncKey(supabase: { from: (t: string) => any }, key: string): Promise<{ id: string; factory_sync_key: string } | null> {
  if (!key) return null
  const { data } = await supabase.from('tenants').select('id, factory_sync_key').not('factory_sync_key', 'is', null)
  const want = createHash('sha256').update(key).digest()
  let found: { id: string; factory_sync_key: string } | null = null
  for (const row of (data || []) as Array<{ id: string; factory_sync_key: string }>) {
    const got = createHash('sha256').update(String(row.factory_sync_key || '')).digest()
    if (got.equals(want) && !found) found = row
  }
  return found
}
