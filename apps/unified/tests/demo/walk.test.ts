// Every screen a visitor can reach, in every trade's demo, in a real browser: it renders (no error page, no script error),
// every /api call it makes is answered inside the page, and nothing is requested from any other host. Wide and light, then a
// phone's width and dark. Needs the demo's data for every trade (bun run record:demo) and the built demo (bun run build:demo).
//
//   cd apps/unified && bun test --timeout 900000 tests/demo/walk.test.ts      (ONLY=salon,store to run some)
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { chromium, type Browser } from 'playwright-core'
import { DEMO_TRADES } from '../../demo/trades.ts'
import { walkDemo } from '../../demo/walk.ts'
import { startHost } from './helpers.ts'

const only = (process.env.ONLY || '').split(',').filter(Boolean)
let host: ReturnType<typeof startHost>
// One browser for every walk, each walk in a fresh context of its own (no cookies, storage or cache carried over). A browser
// launched per walk died in CI (10/30) about 100 ms after every second launch — "Connection terminated while reading from
// pipe", exit 0 — and the walk then waited on a browser that was gone: every phone walk, which followed a desktop one.
let browser: Browser
beforeAll(async () => { host = startHost(); browser = await chromium.launch() })
afterAll(async () => { await browser?.close().catch(() => {}); host?.server.stop(true) })
async function walk(trade: string, viewport: { width: number; height: number }, colorScheme: 'light' | 'dark', maxPages?: number) {
  const context = await browser.newContext({ viewport, colorScheme })
  try { return await walkDemo({ base: host.base, trade, viewport, colorScheme, maxPages, page: await context.newPage() }) }
  finally { await context.close().catch(() => {}) }
}

const verdict = (r: Awaited<ReturnType<typeof walkDemo>>) => ({
  unanswered: [...new Set(r.unavailable)],
  errorPages: r.errorPages,
  scriptErrors: r.pageErrors,
  outside: r.outside,
  saysUnavailable: r.unavailableText,
})
const clean = { unanswered: [], errorPages: [], scriptErrors: [], outside: [], saysUnavailable: [] }

describe('every screen of every demo renders from its recorded data', () => {
  for (const trade of DEMO_TRADES.filter((t) => !only.length || only.includes(t.id))) {
    test(`${trade.label}: desktop, light — every screen in the menu and two rows of each list`, async () => {
      const r = await walk(trade.id, { width: 1440, height: 900 }, 'light')
      expect(r.pages.length, 'the walk found almost nothing to open').toBeGreaterThan(20)
      expect(verdict(r)).toEqual(clean)
    }, 900_000)
    test(`${trade.label}: phone, dark`, async () => {
      const r = await walk(trade.id, { width: 390, height: 844 }, 'dark', 45)
      expect(r.pages.length).toBeGreaterThan(10)
      expect(verdict(r)).toEqual(clean)
    }, 900_000)
  }
})
