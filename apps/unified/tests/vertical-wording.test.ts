// A restaurant, a bar, a salon, a clinic and an agency speak their own words on Team and Settings (store gaps, item 2 —
// the store's own are in store-wording.test.ts). The shared screens (packages/tenant-ui) say "The people you schedule and
// pay.", "Department", "Hourly Rate", "Work week starts on … Overtime is hours over 40" and a clock sentence that lists
// timesheets, invoices, online bookings and the AI Receptionist. Each is now a per-vertical option, and each vertical sets it
// from what it is actually OFFERED (featureRegistry): the pay week only where Time Tracking (the pay run) or the agency's own
// payroll is; a clock sentence naming only the features the trade has; a Rate column only where an hourly rate is read.
//   · rendered in a real DOM from each vertical's own settings (loadVertical) — the objects the server hands the screens;
//   · the sentences are CHECKED AGAINST THE FEATURE SET, so a feature added to a trade later without its word fails here;
//   · home care's settings use no medical words and no contractor's "jobs" (it is a non-medical agency).
import { describe, test, expect } from 'bun:test'
import { Window } from 'happy-dom'
import { loadVertical } from '../server/core/vertical.ts'
import { getFeaturesForTemplate } from '@twomiah/tenant-backend'

const win: any = new Window({ url: 'https://app.example.com/crm/team' })
for (const k of Object.getOwnPropertyNames(win)) if (!(k in globalThis)) (globalThis as any)[k] = win[k]
;(globalThis as any).window = win; (globalThis as any).document = win.document
Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true })
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const React = await import('react')
const { act } = React as any
const { createRoot } = await import('react-dom/client')
const { MemoryRouter } = await import('react-router-dom') as any
const TEAM = '../../../packages/tenant-ui/src/people/TeamPage.tsx'
const SETTINGS_PAGE = '../../../packages/tenant-ui/src/shell/SettingsPage.tsx'
const AUTH = '../../../packages/tenant-ui/src/auth/AuthContext.tsx'
const PERMS = '../../../packages/tenant-ui/src/auth/PermissionsContext.tsx'
const TOAST = '../../../packages/tenant-ui/src/ui/Toast.tsx'
const CONFIRM = '../../../packages/tenant-ui/src/ui/ConfirmProvider.tsx'
const { TeamPage } = await import(TEAM) as any
const { SettingsPage } = await import(SETTINGS_PAGE) as any
const { AuthContext } = await import(AUTH) as any
const { PermissionsProvider } = await import(PERMS) as any
const { ToastProvider } = await import(TOAST) as any
const { ConfirmProvider } = await import(CONFIRM) as any
const h = React.createElement as any

const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const text = () => document.body.textContent || ''
const OWNER = { id: 'u1', role: 'owner', firstName: 'Jeremiah', lastName: 'Phillips', email: 'owner@biz.test' }
const COMPANY = { id: 'c1', name: 'Test Co', timezone: '', effectiveTimezone: 'America/Chicago', workWeekStart: 0, settings: {} }
const toast = { success() {}, error() {}, info() {}, warning() {} }

const TRADES = [
  { id: 'restaurant', template: 'crm-restaurant' },
  { id: 'bar', template: 'crm-bar' },
  { id: 'salon', template: 'crm-salon' },
  { id: 'vet', template: 'crm-vet' },
  { id: 'homecare', template: 'crm-homecare' },
] as const
const offered = (template: string) => new Set(getFeaturesForTemplate(template).map((f) => f.id))
const screensOf = async (id: string) => (await loadVertical(id)).screens as any

async function mountTeam(config: Record<string, unknown>, open: boolean) {
  document.body.innerHTML = ''
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host)
  const api = {
    get: async (p: string) => (p === '/api/team' ? { data: [{ id: 'u1', name: 'Jeremiah Phillips', role: 'owner', email: 'owner@biz.test', active: true, hasLogin: true, _source: 'user' }], pagination: { page: 1, limit: 25, total: 1, pages: 1 } } : { data: [] }),
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

/** The shared Settings page with a vertical's own settings, built as web/src/screens.tsx builds them (workWeek unless it says false). */
async function mountSettings(settings: any, features: Set<string>) {
  document.body.innerHTML = ''
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host)
  const api = { get: async () => ({}), post: async () => ({}), put: async () => ({}), delete: async () => ({}) }
  const auth = { user: OWNER, company: COMPANY, updateCompany() {}, can: () => true, hasFeature: (f: string) => features.has(f) }
  await act(async () => {
    root.render(h(MemoryRouter, { initialEntries: ['/crm/settings'] }, h(AuthContext.Provider, { value: auth },
      h(PermissionsProvider, { role: 'owner', permissions: ['company:read', 'company:update', 'users:read'] },
        h(ToastProvider, null, h(ConfirmProvider, null,
          h(SettingsPage, { api, auth, toast, config: { ...settings, timeZone: true, workWeek: settings.workWeek !== false } })))))))
  })
  await settle()
  return root
}

describe("the Team page in each trade's words", () => {
  const WANT: Record<string, { subtitle: string; department: boolean; rate: boolean }> = {
    restaurant: { subtitle: 'The people who work in your restaurant.', department: true, rate: false },
    bar: { subtitle: 'The people who work in your bar.', department: true, rate: true },
    salon: { subtitle: 'The people who work in your salon.', department: false, rate: true },
    vet: { subtitle: 'The people who work in your clinic.', department: false, rate: false },
  }
  for (const [id, want] of Object.entries(WANT)) {
    test(`${id}: its own sentence, ${want.department ? 'a department' : 'no department'}, ${want.rate ? 'an hourly rate' : 'no hourly rate'}`, async () => {
      const screens = await screensOf(id)
      const root = await mountTeam({ ...screens.team, hasFeature: () => false }, true)
      const t = text()
      expect(t).toContain(want.subtitle)
      expect(t).not.toMatch(/schedule and pay/i)
      expect(/Department/.test(t)).toBe(want.department)
      expect(/Hourly Rate/.test(t)).toBe(want.rate)
      root.unmount()
    })
  }

  test('an hourly rate is shown exactly where the trade can read one (it has Time Tracking, the pay run)', async () => {
    for (const t of TRADES.filter((x) => x.id !== 'homecare')) {
      const screens = await screensOf(t.id)
      expect(screens.team.hourlyRate !== false).toBe(offered(t.template).has('time_tracking'))
    }
  })

  test("home care has no shared Team page: its caregivers are the agency's own list, and /crm/team is hidden for it", async () => {
    const src = await Bun.file(new URL('../web/src/crm/verticals/homecare.tsx', import.meta.url)).text()
    expect(src).toMatch(/SHARED_HIDDEN[^\]]*'\/crm\/team'/s)
  })
})

describe("Settings › Company says only what each trade has", () => {
  test('the pay week (Work week starts on … overtime) is shown only where there is a pay run', async () => {
    const payRun = { restaurant: false, bar: true, salon: true, vet: false, homecare: true } as Record<string, boolean>
    for (const t of TRADES) {
      const screens = await screensOf(t.id)
      const root = await mountSettings(screens.settings, offered(t.template))
      const page = text()
      expect(/Work week starts on/.test(page)).toBe(payRun[t.id]!)
      expect(/Overtime is hours over 40/.test(page)).toBe(payRun[t.id]!)
      root.unmount()
    }
    // The trades that have one are exactly those with Time Tracking, or home care with its own payroll.
    for (const t of TRADES.filter((x) => x.id !== 'homecare')) expect(payRun[t.id]).toBe(offered(t.template).has('time_tracking'))
  })

  test("each clock sentence names a feature only if the trade is offered it", async () => {
    const WORDS: Array<[string, RegExp]> = [['time_tracking', /timesheets/i], ['online_booking', /online bookings/i], ['ai_receptionist', /AI Receptionist/], ['invoices', /invoices/i]]
    for (const t of TRADES) {
      const screens = await screensOf(t.id)
      const hint: string = screens.settings.timeZoneHint
      expect(typeof hint).toBe('string')
      const has = offered(t.template)
      for (const [feature, word] of WORDS) {
        // Home care's clock-ins are its visits' (EVV), not the shared timesheets; its billing is its own, not the shared invoices.
        if (t.id === 'homecare' && (feature === 'time_tracking' || feature === 'invoices')) { expect(word.test(hint)).toBe(false); continue }
        expect(word.test(hint)).toBe(has.has(feature))
      }
      // And the page really prints it, in place of the shared sentence.
      const root = await mountSettings(screens.settings, has)
      expect(text()).toContain(hint)
      expect(text()).not.toContain('timesheets, online bookings and the AI Receptionist')
      root.unmount()
    }
  })

  test('control — with nothing said, the shared page keeps the work week and the trades\' clock sentence', async () => {
    const root = await mountSettings({}, new Set())
    expect(text()).toContain('Work week starts on')
    expect(text()).toContain('timesheets, online bookings and the AI Receptionist')
    root.unmount()
  })
})

describe('Settings › Texting follows Two-Way Texting for these trades too', () => {
  test('every one of them is offered it, so each keeps its Texting card and its wizard step', async () => {
    for (const t of TRADES) {
      expect(offered(t.template).has('two_way_texting')).toBe(true)
      expect((await screensOf(t.id)).onboarding.integrations).toContain('twilio')
    }
  })
})

describe("home care's Settings are an agency's, in plain non-medical words", () => {
  const MEDICAL = /\b(patients?|clinics?|clinical|medical|medications?|nurs(e|es|ing)|doctors?|physicians?|diagnos\w*|treatments?|therap\w*|prescri\w*|hospital)\b/i
  const CONTRACTOR = /\b(jobs?|quotes?|projects?|crews?|technicians?|invoicing)\b/i

  test('the role list describes the four seats by what they hold — no jobs, no invoicing, no medical words', async () => {
    const screens = await screensOf('homecare')
    const roles = screens.settings.roles as Array<{ value: string; label: string; description: string }>
    expect(roles.map((r) => r.value)).toEqual(['viewer', 'field', 'manager', 'admin'])
    expect(roles.find((r) => r.value === 'field')!.label).toBe('Caregiver')
    expect(roles.find((r) => r.value === 'manager')!.label).toBe('Office Manager')
    for (const r of roles) {
      expect(r.description).not.toMatch(CONTRACTOR)
      expect(r.description).not.toMatch(MEDICAL)
    }
  })

  test('nothing home care sets for Team or Settings uses a medical word', async () => {
    const screens = await screensOf('homecare')
    const strings: string[] = []
    const walk = (v: unknown) => { if (typeof v === 'string') strings.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk) }
    walk(screens.settings); walk(screens.team)
    expect(strings.length).toBeGreaterThan(4)
    for (const s of strings) expect(s).not.toMatch(MEDICAL)
  })
})
