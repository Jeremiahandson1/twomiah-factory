// The store speaks a shop's words (store gaps, item 2). The shared screens (packages/tenant-ui) ship to every vertical, so
// each wording is a per-vertical OPTION whose default is what every other vertical already says:
//   · Team: "The people you schedule and pay.", the Department column and box, "Hourly Rate" / "Rate …/hr" — a shop shows
//     "The people who work in your shop." and none of those three (TeamConfig.subtitle / department / hourlyRate);
//   · Settings › Company: "Work week starts on … Overtime is hours over 40" — screens.tsx used to pass workWeek: true AFTER
//     spreading the vertical's settings, so no vertical could turn it off; and the time-zone sentence that names timesheets,
//     invoices, online bookings and the AI Receptionist (SettingsConfig.timeZoneHint);
//   · Settings › Texting: a card with no feature gate though Two-Way Texting is not offered to a store;
//   · the setup wizard's texting step, which sent a shop to that card.
// Rendered in a real DOM from the store's own settings (loadVertical('store')) — the very objects the server hands the
// screens — with the default config beside it as the control.
import { describe, test, expect, beforeAll } from 'bun:test'
import { Window } from 'happy-dom'
import { loadVertical } from '../server/core/vertical.ts'
import { getFeaturesForTemplate } from '@twomiah/tenant-backend'

const store = await loadVertical('store')
const screens = store.screens as any

const win: any = new Window({ url: 'https://shop.example.com/crm/team' })
for (const k of Object.getOwnPropertyNames(win)) if (!(k in globalThis)) (globalThis as any)[k] = win[k]
;(globalThis as any).window = win; (globalThis as any).document = win.document
Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true })
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
// The page reads the vertical's screens from a JSON element the server writes into it (http/adminScreens.ts).
const el = win.document.createElement('script'); el.setAttribute('type', 'application/json'); el.id = 'vertical-screens'; el.textContent = JSON.stringify(screens)
win.document.head.appendChild(el)

const React = await import('react')
const { act } = React as any
const { createRoot } = await import('react-dom/client')
const { MemoryRouter } = await import('react-router-dom') as any
// .tsx screens by a path in a variable, so the server's tsconfig (no JSX) does not type-check the UI here.
const TEAM = '../../../packages/tenant-ui/src/people/TeamPage.tsx'
const SETTINGS_PAGE = '../../../packages/tenant-ui/src/shell/SettingsPage.tsx'
const AUTH = '../../../packages/tenant-ui/src/auth/AuthContext.tsx'
const PERMS = '../../../packages/tenant-ui/src/auth/PermissionsContext.tsx'
const TOAST = '../../../packages/tenant-ui/src/ui/Toast.tsx'
const CONFIRM = '../../../packages/tenant-ui/src/ui/ConfirmProvider.tsx'
const APP_SCREENS = '../web/src/screens.tsx'
const { TeamPage } = await import(TEAM) as any
const { SettingsPage } = await import(SETTINGS_PAGE) as any
const { AuthContext } = await import(AUTH) as any
const { PermissionsProvider } = await import(PERMS) as any
const { ToastProvider } = await import(TOAST) as any
const { ConfirmProvider } = await import(CONFIRM) as any
const { Settings } = await import(APP_SCREENS) as any
const h = React.createElement as any

const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const text = () => document.body.textContent || ''
const OWNER = { id: 'u1', role: 'owner', firstName: 'Jeremiah', lastName: 'Phillips', email: 'owner@shop.test' }
const COMPANY = { id: 'c1', name: 'Perch and Prarie', timezone: '', effectiveTimezone: 'America/Chicago', workWeekStart: 0, settings: {} }
const toast = { success() {}, error() {}, info() {}, warning() {} }

/** The store's two seats' Settings page: what the shop's own owner is shown. */
const offered = (template: string) => new Set(getFeaturesForTemplate(template).map((f) => f.id))
function auth(features: Set<string>) {
  return { user: OWNER, company: COMPANY, updateCompany() {}, can: () => true, hasFeature: (f: string) => features.has(f) }
}

async function mountTeam(config: Record<string, unknown> | undefined, open = false) {
  document.body.innerHTML = ''
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host)
  const api = {
    get: async (p: string) => (p === '/api/team' ? { data: [{ id: 'u1', name: 'Jeremiah Phillips', role: 'owner', email: 'owner@shop.test', active: true, hasLogin: true, _source: 'user' }], pagination: { page: 1, limit: 25, total: 1, pages: 1 } } : { data: [] }),
    post: async () => ({}), put: async () => ({}), delete: async () => ({}),
  }
  await act(async () => {
    root.render(h(MemoryRouter, null, h(AuthContext.Provider, { value: { user: OWNER, company: COMPANY, can: () => true } },
      h(PermissionsProvider, { role: 'owner', permissions: ['team:read', 'team:create', 'team:update', 'team:delete', 'users:read'] },
        h(ToastProvider, null, h(ConfirmProvider, null, h(TeamPage, { api, toast, config })))))))
  })
  await settle()
  if (open) {
    const add = [...document.querySelectorAll('button')].find((b: any) => /Add Member/.test(b.textContent || '')) as any
    await act(async () => { add.dispatchEvent(new win.MouseEvent('click', { bubbles: true })) })
    await settle()
  }
  return root
}

describe("the Team page in a shop's words", () => {
  test("the store's own settings ask for a shop's roster: its sentence, no department, no hourly rate", async () => {
    expect(screens.team).toEqual({ roleLabel: 'Role', rolePlaceholder: 'e.g. Packer, Customer service', subtitle: 'The people who work in your shop.', department: false, hourlyRate: false })
    const root = await mountTeam({ ...screens.team, hasFeature: () => false }, true)
    const t = text()
    expect(t).toContain('The people who work in your shop.')
    expect(t).not.toMatch(/schedule and pay/i)
    expect(t).not.toMatch(/Department/i)
    expect(t).not.toMatch(/Hourly Rate/i)
    expect(t).not.toMatch(/\/hr/)
    // The column that is left is the role, in the shop's word, and the roster card says what it holds.
    expect(t).toContain('Role')
    root.unmount()
  })

  test('the banner for a login-only roster names only what a shop keeps', async () => {
    const root = await mountTeam({ ...screens.team, hasFeature: () => false })
    expect(text()).toContain('Add a member to start your own roster with roles.')
    expect(text()).not.toMatch(/departments|rates/)
    root.unmount()
  })

  test('control — a vertical that says nothing keeps every word it had', async () => {
    const root = await mountTeam({ hasFeature: () => false }, true)
    const t = text()
    expect(t).toContain('The people you schedule and pay.')
    expect(t).toContain('Department')
    expect(t).toContain('Hourly Rate')
    expect(t).toContain('Add a member to start your own roster with roles, departments and rates.')
    root.unmount()
  })
})

describe('Settings › Company has no pay week for a shop', () => {
  test("the store's settings turn the work week off and word the clock for a shop", () => {
    expect(screens.settings.workWeek).toBe(false)
    expect(screens.settings.timeZoneHint).toBe('The one clock for your shop: your opening hours, order times and reports all keep time on it.')
  })

  test('the real Settings screen (screens.tsx) shows the shop its own clock sentence and no work week or overtime', async () => {
    document.body.innerHTML = ''
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(h(MemoryRouter, { initialEntries: ['/crm/settings'] }, h(AuthContext.Provider, { value: auth(offered('crm-store')) },
        h(PermissionsProvider, { role: 'owner', permissions: ['company:read', 'company:update', 'users:read'] },
          h(ToastProvider, null, h(ConfirmProvider, null, h(Settings)))))))
    })
    await settle()
    const t = text()
    expect(t).toContain('The one clock for your shop')
    expect(t).not.toMatch(/Work week starts on/)
    expect(t).not.toMatch(/Overtime is hours over 40/)
    expect(t).not.toMatch(/timesheets/i)
    root.unmount()
  })

  test('control — with nothing said, the shared page still shows the work week and the trades\' clock sentence', async () => {
    document.body.innerHTML = ''
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    const api = { get: async () => ({}), post: async () => ({}), put: async () => ({}), delete: async () => ({}) }
    await act(async () => {
      root.render(h(MemoryRouter, { initialEntries: ['/crm/settings'] }, h(ConfirmProvider, null,
        h(SettingsPage, { api, auth: auth(new Set()), toast, config: { timeZone: true, workWeek: true } }))))
    })
    await settle()
    const t = text()
    expect(t).toContain('Work week starts on')
    expect(t).toContain('Overtime is hours over 40')
    expect(t).toContain('timesheets, online bookings and the AI Receptionist')
    root.unmount()
  })
})

describe('Settings › Texting and the wizard follow what the store is offered', () => {
  test('Two-Way Texting is not offered to a store, so Settings lists no Texting card; a vertical that has it still does', async () => {
    expect(offered('crm-store').has('two_way_texting')).toBe(false)
    expect(offered('crm-salon').has('two_way_texting')).toBe(true)
    const link = (features: Set<string>) => async () => {
      document.body.innerHTML = ''
      const host = document.createElement('div'); document.body.appendChild(host)
      const root = createRoot(host)
      await act(async () => {
        root.render(h(MemoryRouter, { initialEntries: ['/crm/settings'] }, h(AuthContext.Provider, { value: auth(features) },
          h(PermissionsProvider, { role: 'owner', permissions: ['company:read', 'company:update', 'users:read'] },
            h(ToastProvider, null, h(ConfirmProvider, null, h(Settings)))))))
      })
      await settle()
      // The Settings tabs: each sub-page is one button or link named by its label.
      const labels = [...document.querySelectorAll('a, button')].map((n: any) => (n.textContent || '').trim())
      root.unmount()
      return labels
    }
    const store = await link(offered('crm-store'))()
    const salon = await link(offered('crm-salon'))()
    // The tabs are really there (Users, Integrations…), so the Texting one's absence is the gate and not an empty page.
    expect(store).toContain('Integrations')
    expect(store).not.toContain('Texting')
    expect(salon).toContain('Texting')
  })

  test("the setup wizard's steps for a store no longer include texting", () => {
    expect(screens.onboarding.integrations).toEqual(['store_domain', 'store_payments', 'store_first_product'])
    expect(screens.onboarding.integrations).not.toContain('twilio')
  })
})
