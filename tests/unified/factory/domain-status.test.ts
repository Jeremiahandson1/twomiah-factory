// A domain is "live" only when the site OPENS at it — not when DNS is set. Perch and Prarie (10/29): the Domain page said
// "perchandprarie.com is live" with links that did not work, because Namecheap was waiting on its verify-email; the page
// had said "there's nothing for you to do". No network here: the fetch is a stand-in.
import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
const { siteOpens } = await import('../../../apps/api/src/routes/factory/lifecycle.ts')

describe('is the site open at its own address', () => {
  test('any HTTP answer is open; a 5xx, a DNS/TLS failure or a timeout is not', async () => {
    const answer = (status: number) => (async () => new Response(null, { status })) as any
    expect(await siteOpens('shop.test', answer(200))).toBe(true)
    expect(await siteOpens('shop.test', answer(301))).toBe(true)
    expect(await siteOpens('shop.test', answer(404))).toBe(true)
    expect(await siteOpens('shop.test', answer(503))).toBe(false)
    expect(await siteOpens('shop.test', (async () => { throw new TypeError('fetch failed') }) as any)).toBe(false)
  })
  test('the status route says active only when the site opens, and names the verify inbox for a domain we bought', () => {
    const src = readFileSync(new URL('../../../apps/api/src/routes/factory/lifecycle.ts', import.meta.url), 'utf8')
    expect(src).toMatch(/status: zoneStatus\?\.status !== 'active' \? 'pending_nameservers' : opens \? 'active' : 'pending_site'/)
    expect(src).toMatch(/verifyEmail: tenant\.admin_email \|\| tenant\.email/)
  })
  test('the Domain page tells the owner to verify with Namecheap, and never says there is nothing to do', () => {
    const page = readFileSync(new URL('../../../apps/unified/web/src/crm/pages/DomainPage.tsx', import.meta.url), 'utf8')
    expect(page).toContain("status.status === 'pending_site'")
    expect(page).toMatch(/verify your email with Namecheap/)
    expect(page).not.toMatch(/nothing for you to do/)
  })
})
