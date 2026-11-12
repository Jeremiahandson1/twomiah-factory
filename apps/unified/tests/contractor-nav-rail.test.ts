// Contractor parity row 8 — the menu folded to a rail of icons, remembered per user (Buildertrend, JobTread; packages/tenant-ui
// shell/AppShell.tsx; nav_rail, not ready). Fails without the change: there was no rail.
//   · with nav_rail on, a person who chose the rail gets a narrow menu of icons, each named on hover and to a screen reader,
//     and the page moves over to meet it; the choice is theirs alone (another sign-in on the same browser has its own);
//   · off: the menu is as it was and offers no rail, whatever was chosen; the switch is hidden and the contractor CRM's.
import { describe, test, expect } from 'bun:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { Briefcase, Users } from 'lucide-react'
import { FEATURE_REGISTRY } from '../../../packages/tenant-backend/src/featureRegistry.ts'

const store = new Map<string, string>()
;(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, String(v)) }, removeItem: (k: string) => { store.delete(k) } }
// Loaded through paths held in variables, as nav-groups.test.ts does: the app's tsconfig has no --jsx for the package's .tsx.
const SHELL_TSX = '../../../packages/tenant-ui/src/shell/AppShell.tsx'
const AUTH_TSX = '../../../packages/tenant-ui/src/auth/AuthContext.tsx'
const { AppShell, railKey, readRail } = await import(SHELL_TSX) as any
const { AuthContext } = await import(AUTH_TSX) as any

const nav = [
  { to: '/crm/projects', label: 'Projects', icon: Briefcase, section: 'Work' },
  { to: '/crm/contacts', label: 'Contacts', icon: Users, section: 'People' },
]
const render = (features: string[], userId = 'u1') => {
  const auth = { user: { id: userId, email: `${userId}@x.example`, role: 'owner' }, company: { name: 'Acme Builders' }, logout: async () => {}, hasFeature: (f: string) => features.includes(f), can: () => true }
  const h = createElement as any
  return renderToString(h(MemoryRouter, { initialEntries: ['/crm/projects'] },
    h(AuthContext.Provider, { value: auth },
      h(AppShell, { api: { get: async () => ({}), post: async () => ({}) }, auth, config: { nav, search: false } }))))
}

describe('row 8: the rail', () => {
  test('the choice is kept per user', () => {
    store.clear()
    store.set(railKey('u1'), '1')
    expect([readRail('u1'), readRail('u2')]).toEqual([true, false])
  })

  test('on and chosen: a rail of icons, each named, the page moved over, and a button to open it again', () => {
    store.clear()
    store.set(railKey('u1'), '1')
    const html = render(['nav_rail'])
    expect(html).toContain('data-rail="true"')
    expect(html).toContain('w-16')
    expect(html).toContain('lg:ml-16')
    expect(html).toMatch(/title="Projects"/)
    expect(html).toMatch(/<span class="sr-only">Projects<\/span>/)
    expect(html).toContain('Expand the menu')
    expect(html).not.toMatch(/>Work</)
  })

  test('another person on the same browser has the full menu, and can fold it', () => {
    const html = render(['nav_rail'], 'u2')
    expect(html).not.toContain('data-rail="true"')
    expect(html).toContain('lg:ml-64')
    expect(html).toContain('Collapse menu')
  })

  test('off: the menu as it was, no rail and no button, whatever was chosen; the switch is hidden and the contractor CRM’s', () => {
    store.set(railKey('u1'), '1')
    const html = render([])
    expect(html).not.toContain('data-rail')
    expect(html).not.toContain('nav-rail-toggle')
    expect(html).toContain('lg:ml-64')
    const f = FEATURE_REGISTRY.find((x: any) => x.id === 'nav_rail') as any
    expect([!!f?.hidden, f?.templates]).toEqual([false, ['crm']])
  })
})
