// Screenshots one screen four ways (desktop + phone, light + dark) into docs/claims-true/.
//   bun docs/claims-true/tools/shoot.ts <base-url> <path> <name> [email] [password] [actions-module]
// e.g. bun docs/claims-true/tools/shoot.ts http://localhost:4310 /crm/settings/export b-export-everything
// An optional module can export `async function before(page)` to click/fill before the shot.
import { createRequire } from 'node:module'
import path from 'node:path'
const { chromium } = createRequire(import.meta.url)('playwright')

const [base, route, name, email = 'owner@test.example', password = 'Correct-horse-1', mod] = process.argv.slice(2)
const out = path.resolve(import.meta.dir, '..')
const hook = mod ? await import(path.resolve(mod)) : null
const browser = await chromium.launch()
for (const [size, viewport] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 390, height: 844 }]] as const) {
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport, colorScheme: theme as any, ...(size === 'phone' ? { isMobile: true, hasTouch: true } : {}) })
    await ctx.addInitScript((th: string) => { try { localStorage.setItem('theme', th) } catch {} }, theme)
    const page = await ctx.newPage()
    await page.goto(base + '/login')
    await page.fill('input[type=email]', email)
    await page.fill('input[type=password]', password)
    await page.click('button[type=submit]')
    await page.waitForURL(/\/crm/, { timeout: 30000 })
    await page.goto(base + route)
    await page.waitForLoadState('networkidle')
    if (hook?.before) await hook.before(page, { size, theme })
    await page.waitForTimeout(500)
    await page.screenshot({ path: path.join(out, `${name}-${size}-${theme}.png`), fullPage: true })
    await ctx.close()
  }
}
await browser.close()
console.log('done', name)
