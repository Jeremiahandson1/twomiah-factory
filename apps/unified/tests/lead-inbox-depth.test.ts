// The Lead Inbox, deeper (brief item 3): a Spam status that takes an enquiry out of New and every count and can be undone
// in one click, filters labelled with how many there are and a plain account of what the "New" number is made of, and
// converting an enquiry and starting the job, project or quote in one step — offering only what the trade has.
import { describe, test, expect } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import fs from 'node:fs'
import path from 'node:path'

const DAY = 86400000
async function boot(vertical: string, features = ['contacts', 'invoices', 'quotes', 'jobs', 'lead_inbox', 'dashboard']) {
  const t = await bootTenant({ vertical })
  const s = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: features, timezone: 'America/Chicago' } as any).where(eq(t.schema.company.id, s.company.id))
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken
  const as = (tok: string) => (p: string, i: any = {}) => t.call(p, { ...i, headers: { ...(i.headers || {}), Authorization: `Bearer ${tok}` } })
  const owner = as(await login('owner@test.example', s.password))
  const seat = async (role: string) => {
    await ins(t.schema.user, { companyId: s.company.id, email: `${role}@test.example`, firstName: role, lastName: 'Seat', role, passwordHash: await Bun.password.hash('Correct-horse-1', 'bcrypt') })
    return as(await login(`${role}@test.example`, 'Correct-horse-1'))
  }
  const enquiry = (companyId: string, name: string, extra: any = {}) => ins(t.schema.lead, { companyId, homeownerName: name, sourcePlatform: 'website', status: 'new', receivedAt: new Date(Date.now() - 2 * DAY), ...extra })
  return { t, ins, owner, seat, companyId: s.company.id as string, enquiry }
}
const names = (r: any) => (r.data as any[]).map((l) => l.homeownerName).sort()

describe('Spam', () => {
  test('one click files an enquiry as spam: out of the list, out of New, out of every count — and one click brings it back', async () => {
    const { owner, companyId, enquiry } = await boot('contractor')
    const keep = await enquiry(companyId, 'Real Rita')
    const junk = await enquiry(companyId, 'Buy Pills Now')

    expect((await (await owner('/api/dashboard/stats')).json()).newLeads).toBe(2)
    expect((await owner(`/api/leads/${junk.id}/status`, { method: 'PUT', json: { status: 'spam' } })).status).toBe(200)

    // The default list leaves it out; asking for Spam by name shows it; New does not hold it.
    expect(names(await (await owner('/api/leads')).json())).toEqual(['Real Rita'])
    expect(names(await (await owner('/api/leads?status=new')).json())).toEqual(['Real Rita'])
    expect(names(await (await owner('/api/leads?status=spam')).json())).toEqual(['Buy Pills Now'])
    // Counts: the dashboard tile, the strip's waiting figure, the list the tile opens, the inbox's 30-day totals.
    expect((await (await owner('/api/dashboard/stats')).json()).newLeads).toBe(1)
    expect((await (await owner('/api/dashboard-strip')).json()).leads.unanswered).toBe(1)
    expect((await (await owner('/api/dashboard/new-leads')).json()).pagination.total).toBe(1)
    const stats = await (await owner('/api/leads/stats')).json()
    expect(stats.totals).toMatchObject({ total: 1, new: 1, spam: 1 })

    // Not spam: back to New, counted again.
    expect((await owner(`/api/leads/${junk.id}/status`, { method: 'PUT', json: { status: 'new' } })).status).toBe(200)
    expect(names(await (await owner('/api/leads?status=new')).json())).toEqual(['Buy Pills Now', 'Real Rita'])
    expect((await (await owner('/api/dashboard/stats')).json()).newLeads).toBe(2)
    expect(keep.id).toBeTruthy()
  }, 90_000)

  test('a seat without leads:update is refused by the server', async () => {
    const { owner, seat, companyId, enquiry } = await boot('contractor')
    const junk = await enquiry(companyId, 'Buy Pills Now')
    const field = await seat('field')
    expect((await field(`/api/leads/${junk.id}/status`, { method: 'PUT', json: { status: 'spam' } })).status).toBe(403)
    expect((await field('/api/leads')).status).toBe(403)
    expect(names(await (await owner('/api/leads?status=new')).json())).toEqual(['Buy Pills Now'])
  }, 90_000)

  test('an unknown status is still refused, and a converted enquiry cannot be filed as spam', async () => {
    const { owner, companyId, enquiry } = await boot('contractor')
    const row = await enquiry(companyId, 'Rita', { email: 'rita@example.com' })
    expect((await owner(`/api/leads/${row.id}/status`, { method: 'PUT', json: { status: 'banana' } })).status).toBe(400)
    expect((await owner(`/api/leads/${row.id}/convert`, { method: 'POST' })).status).toBe(200)
    expect((await owner(`/api/leads/${row.id}/status`, { method: 'PUT', json: { status: 'spam' } })).status).toBe(409)
  }, 90_000)
})

describe('the inbox says how many, and what New is made of', () => {
  test('counts per status, all time, and the New figure as enquiries here plus contacts added as leads', async () => {
    const { t, owner, ins, companyId, enquiry } = await boot('contractor')
    await enquiry(companyId, 'A'); await enquiry(companyId, 'B')
    await enquiry(companyId, 'C', { status: 'contacted' })
    await enquiry(companyId, 'D', { status: 'dismissed', receivedAt: new Date(Date.now() - 60 * DAY) })
    await enquiry(companyId, 'E', { status: 'spam' })
    // A contact added as a lead that nobody has quoted, booked or billed — it is in New, though not in the inbox.
    await ins(t.schema.contact, { companyId, name: 'Added By Hand', type: 'lead' })
    const body = await (await owner('/api/leads/stats')).json()
    expect(body.counts).toEqual({ new: 2, contacted: 1, converted: 0, dismissed: 1, spam: 1 })
    expect(body.waiting).toEqual({ total: 3, inbox: 2, contacts: 1 })
    // The dashboard's tile says the same number.
    expect((await (await owner('/api/dashboard/stats')).json()).newLeads).toBe(3)
  }, 90_000)
})

const verticals = fs.readdirSync(path.join(import.meta.dir, '../verticals')).filter((v) => fs.existsSync(path.join(import.meta.dir, '../verticals', v, 'settings.ts')))
describe('every trade has Spam and the counts', () => {
  for (const v of verticals) {
    test(v, async () => {
      const s: any = (await import(`../verticals/${v}/settings.ts`)).default
      const { owner, companyId, enquiry } = await boot(s.id, ['dashboard', 'lead_inbox', 'contacts'])
      const row = await enquiry(companyId, 'Junk')
      expect((await owner(`/api/leads/${row.id}/status`, { method: 'PUT', json: { status: 'spam' } })).status).toBe(200)
      expect(names(await (await owner('/api/leads')).json())).toEqual([])
      const stats = await (await owner('/api/leads/stats')).json()
      expect(stats.counts.spam).toBe(1)
      expect(stats.waiting.total).toBe(0)
    }, 90_000)
  }
})
