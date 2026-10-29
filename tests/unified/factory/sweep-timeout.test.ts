// The hourly email-alias sweep failed with "The socket connection was closed unexpectedly" (10/29): the scheduler calls the
// Factory's own route and waits; Bun closes a request that sends nothing for idleTimeout seconds (default 10), and the sweep —
// one tenant after another, Cloudflare and each CRM per tenant — passed 10 s once a fifth domain joined it.
import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('the Factory gives its long internal jobs time', () => {
  test('the server waits longer than Bun\'s 10-second default (and within its 255 s maximum)', () => {
    const m = /idleTimeout:\s*(\d+)/.exec(read('apps/api/src/index.ts'))
    expect(m).not.toBeNull()
    const s = Number(m![1])
    expect(s).toBeGreaterThanOrEqual(60)
    expect(s).toBeLessThanOrEqual(255)
  })
  test('the sweep settles tenants a few at a time, not one after another', () => {
    const src = read('apps/api/src/routes/factory/lifecycle.ts')
    const sweep = src.slice(src.indexOf("factory.post('/internal/email-alias-sweep'"), src.indexOf('// ─── Delete Job'))
    expect(sweep).toMatch(/Promise\.all\(Array\.from\(\{ length: Math\.min\(4, list\.length\) \}, worker\)\)/)
    expect(sweep).not.toMatch(/for \(const t of tenants \|\| \[\]\) \{\n\s+const r = await reconcileTenantAliases/)
  })
})
