// "Call now": the phone view at the top of the page (button showing), scrolled to the contact form (button gone), and the desktop
// view (no button). bun docs/site-sections/tools/shoot-callnow.ts <base-url>
import { createRequire } from 'node:module'
import path from 'node:path'
const { chromium, devices } = createRequire(import.meta.url)('playwright')
const base = process.argv[2] || 'http://localhost:4320'
const out = path.resolve(import.meta.dir, '..')
const browser = await chromium.launch()
for (const look of ['foundry', 'heritage', 'studio', 'market']) {
  await fetch(base + '/__design/' + look)
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: scheme as any })
    const page = await ctx.newPage()
    await page.goto(base + '/', { waitUntil: 'networkidle' })
    await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(out, `s9-callnow-${look}-${scheme}-390-top.png`) })
    await page.locator('.contact-form').first().scrollIntoViewIfNeeded()
    await page.locator('.contact-form button[type=submit]').scrollIntoViewIfNeeded()
    await page.waitForTimeout(500)
    await page.screenshot({ path: path.join(out, `s9-callnow-${look}-${scheme}-390-form.png`) })
    await ctx.close()
    const d = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme as any })
    const dp = await d.newPage()
    await dp.goto(base + '/', { waitUntil: 'networkidle' })
    await dp.waitForTimeout(300)
    await dp.screenshot({ path: path.join(out, `s9-callnow-${look}-${scheme}-1440.png`) })
    await d.close()
  }
}
await browser.close()
console.log('done')
