// The admin menu (brief item 1): groups that fold, in an order the vertical sets, with no page left without a heading.
// Before: Lead Inbox, Audit Log, Help and Contact Twomiah sat under the Bookings heading on every vertical (a builder
// who never switched Bookings on still saw them there), a store's menu had no headings at all, and headings could not
// be folded. Three layers:
//   · the grouping rule itself (web/src/navGroups.ts), pure;
//   · every vertical's real menu, as the page builds it, for the pages that vertical can be shown;
//   · the shared shell (packages/tenant-ui AppShell) in a real DOM: a heading folds, the choice is kept per user, and the
//     heading holding the open page never folds shut.
import { describe, test, expect } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { Window } from 'happy-dom'
import { applyNavGroups } from '../web/src/navGroups.ts'

const ROOT = path.join(import.meta.dir, '..')
const item = (to: string, section?: string) => ({ to, label: to, icon: null as any, ...(section ? { section } : {}) })
const order = (nav: any[]) => nav.map((i) => `${i.section ?? '-'}:${i.to}`)

describe('applyNavGroups', () => {
  test('a page with no heading of its own follows the one above it, and the vertical files pages by address', () => {
    const nav = [item('/a', 'Business'), item('/b'), item('/c'), item('/d', 'Bookings'), item('/e')]
    const out = applyNavGroups(nav as any, { '/c': 'Sales', '/e': 'Sales' }, ['Sales', 'Business', 'Bookings'])
    expect(order(out)).toEqual(['Sales:/c', 'Sales:/e', 'Business:/a', 'Business:/b', 'Bookings:/d'])
  })

  test('with nothing set, only the order of the groups changes: a group not named goes after, Account last', () => {
    const nav = [item('/a', 'Business'), item('/audit', 'Account'), item('/z', 'Zeta'), item('/b', 'Business')]
    expect(order(applyNavGroups(nav as any, undefined, undefined))).toEqual(['Business:/a', 'Business:/b', 'Zeta:/z', 'Account:/audit'])
  })

  test("'' is no heading: the Dashboard stays at the top, headless", () => {
    const nav = [item('/x', 'Sales'), item('/dash', 'Business')]
    const out = applyNavGroups(nav as any, { '/dash': '' }, ['Sales'])
    expect(out.map((i: any) => i.to)).toEqual(['/dash', '/x'])
    expect(out[0].section).toBeUndefined()
  })

  test('the vertical can place Account itself', () => {
    const nav = [item('/a', 'Account'), item('/b', 'Sales')]
    expect(order(applyNavGroups(nav as any, undefined, ['Account', 'Sales']))).toEqual(['Account:/a', 'Sales:/b'])
  })
})

function menuOf(vertical: string): { collapsible: boolean; shown: { to: string; section: string | null; label: string }[] } {
  const r = Bun.spawnSync([process.execPath, 'run', path.join(ROOT, 'tests/support/menu-child.ts'), vertical], { cwd: ROOT })
  const text = r.stdout.toString()
  const at = text.lastIndexOf('@@MENU@@')
  if (at < 0) throw new Error(`${vertical}: no menu printed\n${text}\n${r.stderr.toString()}`)
  return JSON.parse(text.slice(at + 8))
}

const verticals = fs.readdirSync(path.join(ROOT, 'verticals')).filter((v) => fs.existsSync(path.join(ROOT, 'verticals', v, 'settings.ts')))

describe("every vertical's menu", () => {
  test('there are twelve verticals', () => { expect(verticals.length).toBe(12) })
  for (const v of verticals) {
    test(`${v}: every page has a heading but the Dashboard, and the four that sat under Bookings do not`, () => {
      const { shown, collapsible } = menuOf(v)
      expect(collapsible).toBe(true)
      const sectionOf = (to: string) => shown.find((i) => i.to === to)?.section
      // Only Bookings' own pages sit under Bookings.
      for (const i of shown) if (i.section === 'Bookings') expect(i.to.startsWith('/crm/bookings')).toBe(true)
      // The three that close the menu have the Account heading, and Account is the last group of all.
      for (const to of ['/crm/audit', '/crm/help', '/crm/contact-support']) if (shown.some((i) => i.to === to)) expect(sectionOf(to)).toBe('Account')
      const last = shown.filter((i) => i.section).map((i) => i.section)
      const lastGroup = last[last.length - 1]
      expect(lastGroup).toBe('Account')
      // Lead Inbox is with the people it belongs to, not under a Bookings or Account heading.
      if (sectionOf('/crm/leads') !== undefined) expect(['Bookings', 'Account']).not.toContain(sectionOf('/crm/leads'))
      // No page without a heading, except the ones at the very top (the Dashboard and, for a store, nothing else).
      const firstHeaded = shown.findIndex((i) => i.section)
      for (const i of shown.slice(firstHeaded)) expect(i.section).not.toBeNull()
      expect(firstHeaded).toBeLessThanOrEqual(1)
    })
  }

  test('a builder reads Sales, Projects, Field, Finance, Website, Bookings, Account — in that order, and every page is in one', () => {
    const { shown } = menuOf('contractor')
    const groups: string[] = []
    for (const i of shown) if (i.section && groups[groups.length - 1] !== i.section) groups.push(i.section)
    expect(groups).toEqual(['Sales', 'Projects', 'Field', 'Finance', 'Website', 'Bookings', 'Account'])
    expect(shown.find((i) => i.to === '/crm/leads')?.section).toBe('Sales')
    expect(shown.find((i) => i.to === '/crm/quotes')?.section).toBe('Sales')
    expect(shown.find((i) => i.to === '/crm/invoices')?.section).toBe('Finance')
    expect(shown.find((i) => i.to === '/crm/job-costing')?.section).toBe('Finance')
    expect(shown.find((i) => i.to === '/crm/schedule')?.section).toBe('Field')
    expect(shown.find((i) => i.to === '/crm/inspections')?.section).toBe('Projects')
    expect(shown.find((i) => i.to === '/crm/audit')?.section).toBe('Account')
  })

  test('a store, whose menu had no headings, now has them', () => {
    const { shown } = menuOf('store')
    expect(shown.filter((i) => !i.section).map((i) => i.to)).toEqual(['/crm/dashboard'])
    expect(shown.find((i) => i.to === '/crm/orders')?.section).toBe('Shop')
  })
})

// ---------------------------------------------------------------- the shared shell, in a DOM
const win: any = new Window({ url: 'https://crm.example.com/crm/quotes' })
for (const k of Object.getOwnPropertyNames(win)) if (!(k in globalThis)) (globalThis as any)[k] = win[k]
;(globalThis as any).window = win; (globalThis as any).document = win.document; (globalThis as any).navigator = win.navigator
;(globalThis as any).localStorage = win.localStorage
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { act } = React as any
const { createRoot } = await import('react-dom/client')
const { MemoryRouter } = await import('react-router-dom')
// .tsx by a path in a variable, so the server's tsconfig (no JSX) does not type-check the UI here.
const SHELL_TSX = '../../../packages/tenant-ui/src/shell/AppShell.tsx'
const AUTH_TSX = '../../../packages/tenant-ui/src/auth/AuthContext.tsx'
const { AppShell } = await import(SHELL_TSX) as any
const { AuthContext } = await import(AUTH_TSX) as any
const h = React.createElement as any
const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }

const NAV = [
  { to: '/crm/dashboard', label: 'Dashboard', icon: () => null, exact: true },
  { to: '/crm/contacts', label: 'Contacts', icon: () => null, section: 'Sales' },
  { to: '/crm/quotes', label: 'Quotes', icon: () => null },
  { to: '/crm/invoices', label: 'Invoices', icon: () => null, section: 'Finance' },
  { to: '/crm/expenses', label: 'Expenses', icon: () => null },
]

async function mount(opts: { collapsible?: boolean; path?: string; userId?: string }) {
  document.body.innerHTML = ''
  const el = document.createElement('div'); document.body.appendChild(el)
  const root = createRoot(el)
  const auth = { user: { id: opts.userId ?? 'u1', role: 'owner', email: 'o@x.test' }, company: { name: 'Acme' }, logout: () => {}, hasFeature: () => true, can: () => true }
  const config = { nav: NAV, brand: { fallbackName: 'Acme' }, ...(opts.collapsible === false ? {} : { collapsibleSections: true }) }
  await act(async () => { root.render(h(AuthContext.Provider, { value: { user: auth.user, company: auth.company } }, h(MemoryRouter, { initialEntries: [opts.path ?? '/crm/dashboard'] }, h(AppShell, { api: {}, auth, config })))) })
  await settle()
  return root
}
const links = () => [...document.querySelectorAll('nav a')].map((a: any) => a.textContent.trim())
const heading = (name: string) => document.querySelector(`[data-nav-section="${name}"]`) as any
const click = async (el: any) => { await act(async () => { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true })) }); await settle() }

describe('the shared shell folds a menu heading away', () => {
  test('headings are buttons that say whether they are open; a heading closed by the person hides its pages', async () => {
    localStorage.clear()
    const root = await mount({})
    expect(links()).toEqual(['Dashboard', 'Contacts', 'Quotes', 'Invoices', 'Expenses'])
    expect(heading('Finance').getAttribute('aria-expanded')).toBe('true')
    await click(heading('Finance'))
    expect(heading('Finance').getAttribute('aria-expanded')).toBe('false')
    expect(links()).toEqual(['Dashboard', 'Contacts', 'Quotes'])
    await click(heading('Finance'))
    expect(links()).toEqual(['Dashboard', 'Contacts', 'Quotes', 'Invoices', 'Expenses'])
    root.unmount()
  })

  test("the choice is remembered for that person only, across a reload", async () => {
    localStorage.clear()
    let root = await mount({ userId: 'u1' })
    await click(heading('Finance'))
    root.unmount()
    root = await mount({ userId: 'u1' })
    expect(links()).toEqual(['Dashboard', 'Contacts', 'Quotes'])
    root.unmount()
    root = await mount({ userId: 'u2' })
    expect(links()).toEqual(['Dashboard', 'Contacts', 'Quotes', 'Invoices', 'Expenses'])
    root.unmount()
  })

  test('the heading holding the open page does not fold shut under the person', async () => {
    localStorage.clear()
    let root = await mount({ path: '/crm/quotes' })
    await click(heading('Sales'))
    root.unmount()
    // closed before; now they open a page inside it: it is shown and the heading says so
    root = await mount({ path: '/crm/quotes' })
    expect(links()).toContain('Quotes')
    expect(heading('Sales').getAttribute('aria-expanded')).toBe('true')
    root.unmount()
  })

  test('a menu that does not opt in is unchanged: plain headings, no buttons', async () => {
    localStorage.clear()
    const root = await mount({ collapsible: false })
    expect(document.querySelectorAll('[data-nav-section]').length).toBe(0)
    expect(links()).toEqual(['Dashboard', 'Contacts', 'Quotes', 'Invoices', 'Expenses'])
    root.unmount()
  })
})
