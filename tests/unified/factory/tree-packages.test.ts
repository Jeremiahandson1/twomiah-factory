// The tenant repo carries every monorepo package the unified app depends on, read from the manifests
// (apps/api/src/unified/tree.ts workspacePackages) — a fixed list missed @twomiah/roof-core and every tenant's install
// failed; found by a dry run before the first Render build (2026-10-19). And repo creation falls back to the account's
// own repos only when GITHUB_ORG is not an organisation (hosts.ts createRepo).
import { test, expect } from 'bun:test'
import path from 'node:path'
import { workspacePackages } from '../../../apps/api/src/unified/tree'
import { createHosts } from '../../../apps/api/src/unified/hosts'

const ROOT = path.resolve(import.meta.dir, '..', '..', '..')

test("every package the app depends on, roof-core included, and nothing it doesn't", () => {
  const pkgs = workspacePackages(ROOT)
  expect(pkgs).toEqual(expect.arrayContaining(['roof-core', 'tenant-backend', 'tenant-ui']))
  expect(pkgs).not.toContain('types')
  expect(pkgs).not.toContain('utils')
})

const cfg = { renderApiKey: 'r', renderOwnerId: 'o', githubToken: 'g', githubOrg: 'someone', bunVersion: '1.3.14', dbPlan: 'basic_256mb', dbDiskGB: 1 }
test('a personal account (the org address answers 404): the repo is made under the account', async () => {
  const calls: string[] = []
  const hosts = createHosts(cfg, async (url: string) => {
    calls.push(url.replace('https://api.github.com', ''))
    if (url.endsWith('/orgs/someone/repos')) return new Response('{"message":"Not Found"}', { status: 404 })
    return new Response(JSON.stringify({ full_name: 'someone/x-app' }), { status: 201 })
  })
  expect(await hosts.createRepo('x-app', 'd')).toEqual({ fullName: 'someone/x-app' })
  expect(calls).toEqual(['/orgs/someone/repos', '/user/repos'])
})
test('a taken name or a refused token at the org is an error, never "try the other place"', async () => {
  for (const status of [422, 401, 403]) {
    const calls: string[] = []
    const hosts = createHosts(cfg, async (url: string) => { calls.push(url); return new Response('{"message":"no"}', { status }) })
    await expect(hosts.createRepo('x-app', 'd')).rejects.toThrow(String(status))
    expect(calls.length).toBe(1)
  }
})
