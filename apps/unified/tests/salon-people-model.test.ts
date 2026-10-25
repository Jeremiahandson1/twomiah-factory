// A salon's two lists of people, made one model (salon live test, 2026-10-25: the menu had Contacts with 5 rows and
// Clients with 3, and the tester could not tell why; a contact's page offered Company and a street address for a person
// in the chair). The rule, in one place each side:
//   · Clients (/api/clients) is everyone who sits in the chair — every contact type but people.ts NON_CLIENT_TYPES;
//   · All Contacts (/api/contacts) is everyone on file — clients, leads and suppliers;
//   · a client's page is their chart (/crm/clients/:id) — where search already sent one (searchService.ts) and where
//     every /crm/contacts/:id link now lands (packages/tenant-ui contacts ContactsConfig.chart, set in the salon's
//     settings from the SAME list); leads and suppliers keep the contact page.
// Other verticals and the templates set no chart: every contact opens where it always did.
import { describe, test, expect, beforeAll } from 'bun:test'
import { bootTenant, seedOwner } from './harness.ts'
import { loadVertical } from '../server/core/vertical.ts'
import { NON_CLIENT_TYPES } from '../server/crm/salon/people.ts'
import { resolveContactsConfig } from '../../../packages/tenant-ui/src/contacts/types.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let token = ''
const as = (path: string, init: any = {}) => t.call(path, { ...init, headers: { Authorization: `Bearer ${token}` } })
const ids: Record<string, string> = {}

beforeAll(async () => {
  t = await bootTenant({ vertical: 'salon' })
  const seeded = await seedOwner(t)
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken
  expect((await as('/api/company/features', { method: 'PUT', json: { features: ['contacts', 'invoices', 'client_profiles', 'service_menu', 'salon_booking'] } })).status).toBe(200)
  for (const [key, type] of [['client', 'client'], ['lead', 'lead'], ['supplier', 'vendor']] as const) {
    const r = await as('/api/contacts', { method: 'POST', json: { name: `Zinnia ${key}`, type } })
    expect(r.status).toBe(201)
    ids[key] = (await r.json()).id
  }
}, 60_000)

describe("a salon's people: Clients and All Contacts, and where each person opens", () => {
  test('Clients holds the people in the chair; All Contacts holds everyone, leads and suppliers included', async () => {
    const clients = (await (await as('/api/clients?search=Zinnia')).json()).data.map((r: any) => r.id)
    expect(clients).toEqual([ids.client])
    const all = (await (await as('/api/contacts?search=Zinnia&limit=50')).json()).data.map((r: any) => r.id).sort()
    expect(all).toEqual([ids.client, ids.lead, ids.supplier].sort())
  }, 30_000)

  test("the screens are told the server's own rule: a client's page is the chart, from the same list", async () => {
    const salon = await loadVertical('salon')
    const contacts = (salon.screens as any).contacts
    expect(contacts.chart).toMatchObject({ path: '/crm/clients/:id', feature: 'client_profiles' })
    expect([...contacts.chart.exceptTypes].sort()).toEqual([...NON_CLIENT_TYPES].sort())
    // the list says what it holds, under the name the menu gives it
    expect((salon.screens as any).nav['/crm/contacts']).toBe('All Contacts')
    expect(contacts.title).toBe('All Contacts')
    expect(contacts.intro).toMatch(/clients, leads and suppliers/i)
    // a person in the chair is not asked for a Company or a street address; a supplier is
    expect(contacts.hiddenFields.client).toEqual(['company', 'address'])
    expect(contacts.hiddenFields.vendor).toBeUndefined()

    const on = resolveContactsConfig({ ...contacts, hasFeature: () => true })
    expect(on.pageFor({ id: ids.client, type: 'client' })).toBe(`/crm/clients/${ids.client}`)
    for (const type of ['lead', 'vendor', 'other']) expect(on.pageFor({ id: 'x', type })).toBeNull()
    expect(on.hides('client', 'company')).toBe(true)
    expect(on.hides('vendor', 'company')).toBe(false)
    // with charts switched off, a client opens on the contact page as before
    expect(resolveContactsConfig({ ...contacts, hasFeature: (f: string) => f !== 'client_profiles' }).pageFor({ id: 'x', type: 'client' })).toBeNull()
  })

  test('search sends each person to the same page the screens do', async () => {
    const r = await as('/api/search?q=Zinnia')
    expect(r.status).toBe(200)
    const urls = Object.fromEntries((await r.json()).results.filter((x: any) => x.type === 'contact').map((x: any) => [x.id, x.url]))
    const contacts = (((await loadVertical('salon')).screens) as any).contacts
    const cfg = resolveContactsConfig({ ...contacts, hasFeature: () => true })
    for (const [key, type] of [['client', 'client'], ['lead', 'lead'], ['supplier', 'vendor']] as const) {
      expect(urls[ids[key]]).toBe(cfg.pageFor({ id: ids[key], type }) || `/crm/contacts/${ids[key]}`)
    }
  }, 30_000)

  test('every other vertical, and a template, sets no chart: nothing changes where a contact opens', async () => {
    for (const v of ['contractor', 'vet', 'bar', 'restaurant', 'fieldservice']) {
      const contacts = ((await loadVertical(v)).screens as any).contacts || {}
      expect(contacts.chart).toBeUndefined()
      expect(resolveContactsConfig({ ...contacts, hasFeature: () => true }).pageFor({ id: 'x', type: 'client' })).toBeNull()
    }
    const template = resolveContactsConfig(undefined)
    expect(template.pageFor({ id: 'x', type: 'client' })).toBeNull()
    expect(template.hides('client', 'company')).toBe(false)
    expect(template.intro).toBe('')
  })
})
