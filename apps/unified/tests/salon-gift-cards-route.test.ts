// A salon's Gift cards page is the salon's (salon live test 11/07). Every trade's routes are mounted under /crm and the first match wins
// (App.tsx): the bar's gift-cards route came first, so a salon opening Gift cards got the bar's page, which reads /api/gift-cards — a module
// a salon does not have ("This module is not enabled for your account"). The bar keeps its own; the salon's is the only one in a salon.
// The trade comes from the page's #vertical-screens (crm/vertical.ts), read once per page load — so each trade is its own process.
import { describe, test, expect } from 'bun:test'
import path from 'node:path'

const PROBE = `
import { Window } from 'happy-dom'
const win = new Window({ url: 'https://x.example.com/crm' })
for (const k of Object.getOwnPropertyNames(win)) if (!(k in globalThis)) globalThis[k] = win[k]
globalThis.window = win; globalThis.document = win.document; globalThis.navigator = win.navigator
win.document.body.innerHTML = '<script type="application/json" id="vertical-screens">' + JSON.stringify({ home: process.env.HOME_TRADE }) + '</' + 'script>'
const bar = await import('./web/src/crm/verticals/bar.tsx')
const salon = await import('./web/src/crm/verticals/salon.tsx')
console.log(JSON.stringify({ bar: bar.routes.map((r) => r.props.path), salon: salon.routes.map((r) => r.props.path) }))
`
const DIR = path.resolve(import.meta.dir, '..')
function routesAs(home: string): { bar: string[]; salon: string[] } {
  const r = Bun.spawnSync([process.execPath, '-e', PROBE], { cwd: DIR, env: { ...process.env, HOME_TRADE: home } })
  const out = r.stdout.toString().trim().split('\n').pop() || '{}'
  return JSON.parse(out)
}

describe('who answers /crm/gift-cards', () => {
  test('in a salon: only the salon\'s page', () => {
    const r = routesAs('salon')
    expect(r.bar).not.toContain('gift-cards')
    expect(r.salon).toContain('gift-cards')
  }, 60_000)
  test('in a bar: the bar keeps its own', () => {
    expect(routesAs('bar').bar).toContain('gift-cards')
  }, 60_000)
})
