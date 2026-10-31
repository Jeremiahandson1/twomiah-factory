// Keys for the public store API (store_api, 2026-10-31, parity row 8). A key is shown ONCE, when it is made; only its SHA-256 is kept
// (the key is 192 random bits, so a fast hash cannot be guessed back). A key carries scopes — what it may read or write — and can be
// revoked; a revoked or unknown key is simply not a key.
import crypto from 'node:crypto'
import { and, desc, eq, isNull, lt, or } from 'drizzle-orm'
import { storeApiKey } from '../../../db/schema/store.ts'

export const API_SCOPES = ['products:read', 'orders:read', 'customers:read', 'inventory:read', 'inventory:write'] as const
export type ApiScope = (typeof API_SCOPES)[number]
export const API_SCOPE_LABELS: Record<ApiScope, string> = {
  'products:read': 'Read products', 'orders:read': 'Read orders', 'customers:read': 'Read customers', 'inventory:read': 'Read stock counts', 'inventory:write': 'Change stock counts',
}
const hash = (key: string) => crypto.createHash('sha256').update(key).digest('hex')
const LAST_USED_EVERY_MS = 60_000

export type ApiKeyRow = typeof storeApiKey.$inferSelect
/** What the screen is told of a key: never the hash. */
export const keyView = (k: ApiKeyRow) => ({ id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes as string[], lastUsedAt: k.lastUsedAt, revokedAt: k.revokedAt, createdAt: k.createdAt })

export function createApiKeys(db: any) {
  async function create(companyId: string, name: string, scopes: ApiScope[]): Promise<{ row: ApiKeyRow; key: string }> {
    const key = 'tsk_' + crypto.randomBytes(24).toString('base64url')
    const [row] = await db.insert(storeApiKey).values({ companyId, name, prefix: key.slice(0, 10), keyHash: hash(key), scopes }).returning()
    return { row, key }
  }
  const list = (companyId: string): Promise<ApiKeyRow[]> => db.select().from(storeApiKey).where(eq(storeApiKey.companyId, companyId)).orderBy(desc(storeApiKey.createdAt))
  async function revoke(companyId: string, id: string): Promise<ApiKeyRow | null> {
    const [row] = await db.update(storeApiKey).set({ revokedAt: new Date() }).where(and(eq(storeApiKey.id, id), eq(storeApiKey.companyId, companyId), isNull(storeApiKey.revokedAt))).returning()
    return row ?? null
  }
  /** The live key this secret belongs to, or null. Stamps "last used" at most once a minute. */
  async function find(raw: string, now = new Date()): Promise<ApiKeyRow | null> {
    if (!/^tsk_[A-Za-z0-9_-]{32}$/.test(raw)) return null
    const [row] = await db.select().from(storeApiKey).where(and(eq(storeApiKey.keyHash, hash(raw)), isNull(storeApiKey.revokedAt))).limit(1)
    if (!row) return null
    if (!row.lastUsedAt || now.getTime() - new Date(row.lastUsedAt).getTime() > LAST_USED_EVERY_MS) {
      await db.update(storeApiKey).set({ lastUsedAt: now }).where(and(eq(storeApiKey.id, row.id), or(isNull(storeApiKey.lastUsedAt), lt(storeApiKey.lastUsedAt, new Date(now.getTime() - LAST_USED_EVERY_MS))))).catch(() => {})
    }
    return row
  }
  return { create, list, revoke, find }
}
export type ApiKeys = ReturnType<typeof createApiKeys>
