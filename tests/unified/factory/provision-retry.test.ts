// The build's setup call (POST /api/internal/provision) is asked again when the tenant gives a gateway answer — no
// answer, 502, 503, 504 — as while Render swaps the instance that just went live (the first home-care build on Render
// answered 502 there, 2026-10-19). Safe because the call is: a provisioned tenant answers "already provisioned". A real
// refusal (a 400) is not retried. The hosts are stand-ins; the tree is the real one.
import { test, expect } from 'bun:test'
import path from 'node:path'
import { buildUnifiedTenant } from '../../../apps/api/src/unified/build'

const ROOT = path.resolve(import.meta.dir, '..', '..', '..')
const version = 'abcdef1'

function stage(answers: number[]) {
  const asked: number[] = []
  const hosts: any = {
    repoFullName: (n: string) => 'acct/' + n,
    getRepo: async () => null, findService: async () => null, findDatabase: async () => null, getEnv: async () => ({}),
    createDatabase: async () => ({ id: 'dpg-1' }), getDatabase: async () => ({ status: 'available' }), databaseUrl: async () => 'postgres://x',
    createRepo: async () => ({ fullName: 'acct/t-app' }), createService: async () => ({ id: 'srv-1', url: 'https://t-app.onrender.com' }),
    setEnv: async () => {}, deploy: async () => {}, updateServiceCommands: async () => {},
    health: async () => ({ commit: 'c0ffee1', version }),
    callTenant: async () => { const s = answers[Math.min(asked.length, answers.length - 1)]; asked.push(s); return { status: s, body: s === 201 ? { companyId: 'c' } : { error: 'no' } } },
  }
  const io = { hosts, push: async () => 'c0ffee1', sleep: async () => {} }
  return { io, asked }
}
const input = () => ({ tenant: { id: 't1', slug: 't' }, vertical: 'store', provision: {}, factoryUrl: 'https://f', owned: { repos: new Set<string>(), serviceIds: new Set<string>(), databaseIds: new Set<string>() }, root: ROOT, version })

test('a 502 then a 201: asked again, and the build succeeds', async () => {
  const s = stage([502, 201])
  const r = await buildUnifiedTenant(input(), s.io as any)
  expect(r.success).toBe(true)
  expect(s.asked).toEqual([502, 201])
}, 120_000)

test('a refusal (400) is not asked again: the build fails with it', async () => {
  const s = stage([400, 201])
  const r = await buildUnifiedTenant(input(), s.io as any)
  expect(r.success).toBe(false)
  expect(s.asked).toEqual([400])
}, 120_000)

test('no answer every time: six tries, then the build fails, its record kept for the teardown', async () => {
  const s = stage([0])
  const r = await buildUnifiedTenant(input(), s.io as any)
  expect(r.success).toBe(false)
  expect(s.asked.length).toBe(6)
  expect(r.record?.serviceId).toBe('srv-1')
}, 120_000)
