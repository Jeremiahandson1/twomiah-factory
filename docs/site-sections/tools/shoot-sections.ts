// One screen of the public site in every look, light and dark, at a phone and a desktop width, into docs/site-sections/.
//   bun docs/site-sections/tools/shoot-sections.ts <base-url> <path> <name> [selector]
// Photographs the page, or the element `selector` when given (so each image is the section itself, large enough to read).
// Phone = device emulation (iPhone-class, 390px, touch); desktop = 1440px. Names: <name>-<look>-<light|dark>-<390|1440>.png
import { createRequire } from 'node:module'
import path from 'node:path'
const { chromium, devices } = createRequire(import.meta.url)('playwright')

const [base, route, name, selector, only] = process.argv.slice(2)
const out = path.resolve(import.meta.dir, '..')
const looks = (only || 'foundry,heritage,studio,market').split(',')
const browser = await chromium.launch()
for (const look of looks) {
  await fetch(base + '/__design/' + look)
  for (const scheme of ['light', 'dark']) {
    for (const width of [390, 1440]) {
      const ctx = await browser.newContext(width === 390
        ? { ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: scheme as any }
        : { viewport: { width: 1440, height: 900 }, colorScheme: scheme as any })
      const page = await ctx.newPage()
      await page.goto(base + route, { waitUntil: 'networkidle' })
      await page.waitForTimeout(400)
      const file = path.join(out, `${name}-${look}-${scheme}-${width}.png`)
      if (selector) await page.locator(selector).first().screenshot({ path: file })
      else await page.screenshot({ path: file, fullPage: true })
      await ctx.close()
    }
  }
}
await browser.close()
console.log('done', name)
