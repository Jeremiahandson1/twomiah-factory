// A throwaway tenant for tests: an in-memory Postgres (PGlite) with every migration applied, then the real server.
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import * as schema from '../server/db/schema/index.ts'
import { MIGRATIONS } from '../server/db/migrate.ts'
import { createApp } from '../server/app.ts'
import { loadVertical } from '../server/core/vertical.ts'
import { blankLiveKeys } from './noLiveKeys.ts'

// No live outside service from a test, whatever the shell holds (noLiveKeys.ts).
blankLiveKeys()

process.env.JWT_SECRET ||= 'test-access-secret'
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret'

/** An in-memory file store standing in for R2. */
export function memoryStore() {
  const objects = new Map<string, { body: Buffer; contentType: string }>()
  return {
    objects,
    put: async (key: string, body: Buffer, contentType: string) => { objects.set(key, { body, contentType }) },
    getObject: async (key: string) => objects.get(key) ?? null,
    remove: async (key: string) => { objects.delete(key) },
  }
}

export async function bootTenant(opts: { vertical?: string; adminDist?: string; stripe?: any } = {}) {
  const client = new PGlite()
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: MIGRATIONS })
  const vertical = await loadVertical(opts.vertical ?? 'contractor')
  const store = memoryStore()
  const { app, services } = createApp({ db, vertical, store, adminDist: opts.adminDist, ...(opts.stripe ? { testing: { stripe: opts.stripe } } : {}) })
  // Phone notifications are recorded, never sent to Expo (noLiveKeys.ts is for keys; Expo needs none).
  const pushed: any[] = []
  services.phonePush.setTransport(async (msgs) => { pushed.push(...msgs); return msgs.map(() => ({ status: 'ok' as const, id: 'test' })) })
  const call = (path: string, init: RequestInit & { json?: unknown } = {}) => {
    const headers = new Headers(init.headers)
    let body = init.body
    if (init.json !== undefined) { headers.set('content-type', 'application/json'); body = JSON.stringify(init.json) }
    return app.request(path, { ...init, headers, body })
  }
  return { client, db, app, services, call, schema, store, pushed }
}

/** The company and its owner, as the Factory provisions them. */
export async function seedOwner(t: Awaited<ReturnType<typeof bootTenant>>, password = 'Correct-horse-1') {
  const [co] = await t.db.insert(t.schema.company).values({ name: 'Test Builders', slug: 'test-builders' }).returning()
  const [owner] = await t.db.insert(t.schema.user).values({
    email: 'owner@test.example', passwordHash: await Bun.password.hash(password, 'bcrypt'),
    firstName: 'Olive', lastName: 'Owner', role: 'owner', companyId: co.id,
  }).returning()
  return { company: co, owner, password }
}
