// Signup never hands out a slug whose unified names are taken: externalNamesForSlug / slugIsFree
// (apps/api/src/services/resourceOwnership.ts) know the unified tenant's repo `<slug>-app`, service `<slug>-app` and
// database `<slug>-app-db` — from unified/names.ts, not a copied string. The template names are exactly as before.
import { test, expect } from 'bun:test'
import {
  externalNamesForSlug, slugIsFree, allocateSlug, CRM_API_SUFFIXES, CRM_FRONT_SUFFIXES, DB_SLUG_SUFFIXES, type SlugLookups,
} from '../../../apps/api/src/services/resourceOwnership'
import { unifiedNames } from '../../../apps/api/src/unified/names'

/** The template names, as the allocator built them before the unified path (the pre-cutover formula). */
function templateNames(slug: string) {
  const services = new Set<string>([slug, slug + '-site', slug + '-pricing-api', slug + '-vision'])
  for (const s of CRM_API_SUFFIXES) services.add(slug + s)
  for (const s of CRM_FRONT_SUFFIXES) services.add(slug + s)
  const databases = new Set<string>([slug + '-pricing-db'])
  for (const s of DB_SLUG_SUFFIXES) databases.add(slug + s + '-db')
  return { services: [...services], databases: [...databases] }
}

const lookups = (taken: { repos?: string[]; services?: string[]; databases?: string[]; tenants?: string[] }): SlugLookups => ({
  tenantSlugTaken: async (s) => (taken.tenants || []).includes(s),
  repoExists: async (n) => (taken.repos || []).includes(n),
  serviceExists: async (n) => (taken.services || []).includes(n),
  databaseExists: async (n) => (taken.databases || []).includes(n),
})

test('the unified names are among the names checked — the ones names.ts gives', () => {
  const n = externalNamesForSlug('acme')
  const u = unifiedNames('acme')
  expect(n.repos).toContain(u.repo)
  expect(n.services).toContain(u.service)
  expect(n.databases).toContain(u.database)
  expect([u.repo, u.service, u.database]).toEqual(['acme-app', 'acme-app', 'acme-app-db'])
})

test('template names unchanged: every old name is still checked, and only the unified ones were added', () => {
  for (const slug of ['acme', 'five47-eau-claire', 'zz-fleet-2']) {
    const n = externalNamesForSlug(slug)
    const old = templateNames(slug)
    const u = unifiedNames(slug)
    expect(n.repo).toBe(slug)
    expect(n.repos[0]).toBe(slug)
    expect(n.services.filter((s) => s !== u.service).sort()).toEqual([...old.services].sort())
    expect(n.databases.filter((d) => d !== u.database).sort()).toEqual([...old.databases].sort())
  }
})

test('a slug the unified build would refuse (too long) still gets every template name, and no unified ones', () => {
  const long = 'a'.repeat(61)
  const n = externalNamesForSlug(long)
  expect(n.repos).toEqual([long])
  expect(n.services).not.toContain(long + '-app')
  expect(n.databases).not.toContain(long + '-app-db')
  expect(n.services.sort()).toEqual(templateNames(long).services.sort())
})

test('a taken unified repo, service or database makes the slug taken', async () => {
  expect(await slugIsFree('acme', lookups({}))).toEqual({ free: true })
  expect(await slugIsFree('acme', lookups({ repos: ['acme-app'] }))).toEqual({ free: false, reason: 'GitHub repo acme-app exists' })
  expect(await slugIsFree('acme', lookups({ services: ['acme-app'] }))).toEqual({ free: false, reason: 'Render service acme-app exists' })
  expect(await slugIsFree('acme', lookups({ databases: ['acme-app-db'] }))).toEqual({ free: false, reason: 'Render Postgres acme-app-db exists' })
  // The template reasons are as before.
  expect(await slugIsFree('acme', lookups({ repos: ['acme'] }))).toEqual({ free: false, reason: 'GitHub repo acme exists' })
  expect(await slugIsFree('acme', lookups({ services: ['acme-roof-api'] }))).toEqual({ free: false, reason: 'Render service acme-roof-api exists' })
})

test('a lookup that fails on a unified name makes the slug taken, never free', async () => {
  const l = lookups({})
  l.repoExists = async (n) => { if (n === 'acme-app') throw new Error('GitHub 502'); return false }
  expect(await slugIsFree('acme', l)).toEqual({ free: false, reason: 'lookup failed: GitHub 502' })
})

test('the allocator moves past a slug whose unified service is someone else\'s', async () => {
  const r = await allocateSlug(['acme', 'acme-2'], lookups({ services: ['acme-app'] }))
  expect(r.slug).toBe('acme-2')
  expect(r.skipped).toEqual([{ slug: 'acme', reason: 'Render service acme-app exists' }])
})
