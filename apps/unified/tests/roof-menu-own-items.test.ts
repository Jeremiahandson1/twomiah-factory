// Every roofing menu item of its own reaches a roofer's menu (roofing live test 11/07). roofingMenu (crm/verticals/roof.tsx) built the
// menu from two fixed lists and the shared items; roofing's own items on neither list — Card payments (card_surcharge /
// payments_overview) and Permits (roof_permits) — were in no list at all, so the page could not be found with its switches on.
// The trade comes from the page's #vertical-screens (crm/vertical.ts), read once per page load — so the probe is its own process.
import { test, expect } from 'bun:test'
import path from 'node:path'

const PROBE = `
import { Window } from 'happy-dom'
const win = new Window({ url: 'https://x.example.com/crm' })
for (const k of Object.getOwnPropertyNames(win)) if (!(k in globalThis)) globalThis[k] = win[k]
globalThis.window = win; globalThis.document = win.document; globalThis.navigator = win.navigator
win.document.body.innerHTML = '<script type="application/json" id="vertical-screens">' + JSON.stringify({ home: 'roofing' }) + '</' + 'script>'
const roof = await import('./web/src/crm/verticals/roof.tsx')
const shared = [{ to: '/crm/contacts', label: 'Contacts' }, { to: '/crm/quotes', label: 'Quotes' }, { to: '/crm/invoices', label: 'Invoices' }, { to: '/crm/card-payments', label: 'Card payments (shared)' }, { to: '/crm/website', label: 'Website', section: 'Website' }]
const menu = roof.roofingMenu(shared)
console.log(JSON.stringify({ own: roof.nav.map((i) => i.to), menu: menu.map((i) => i.to), labels: menu.map((i) => i.label) }))
`
const DIR = path.resolve(import.meta.dir, '..')

test('a roofer\'s menu holds every one of roofing\'s own items, once, and the shared item it replaces is gone', () => {
  const r = Bun.spawnSync([process.execPath, '-e', PROBE], { cwd: DIR })
  const out = JSON.parse(r.stdout.toString().trim().split('\n').pop() || '{}')
  for (const to of out.own) expect(out.menu.filter((x: string) => x === to).length).toBe(1)
  expect(out.menu).toContain('/crm/card-payments')
  expect(out.menu).toContain('/crm/permits')
  expect(out.menu).toContain('/crm/storm-map')
  expect(out.menu).toContain('/crm/territories')
  expect(out.labels).not.toContain('Card payments (shared)')
}, 60_000)
