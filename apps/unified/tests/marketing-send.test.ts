// Email Marketing's "Send now", end to end through the real server (live, 2026-10-22): a campaign sent to two contacts
// answered "Sent to 0 of 2 contacts (2 failed)" and the campaign row showed the raw database error
//   insert or update on table "email_recipient" violates foreign key constraint "email_recipient_campaign_id_email_campaign_id_fk"
// email_recipient.campaign_id pointed at email_campaign, a table nothing writes; the module sends `campaign` rows.
//   · a campaign made through the API and sent to two contacts is recorded sent, once per contact, for more than one trade;
//   · a send that fails says so in a sentence — on the reply and on the campaign row — never the raw error.
// Email is not delivered from a test: with no provider the app's sendRaw logs the message and answers success
// (server/core/email.ts, dev mode); NODE_ENV=production makes the same call refuse, which is the failure case here.
import { describe, test, expect } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

async function tenant(vertical: string) {
  const t = await bootTenant({ vertical })
  const seeded = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'email_marketing'] } as any).where(eq(t.schema.company.id, seeded.company.id))
  const res = await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })
  const token = (await res.json() as any).accessToken as string
  const owner = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
  for (const [name, email] of [['Ann Able', 'ann@test.example'], ['Bob Baker', 'bob@test.example']]) {
    await t.db.insert(t.schema.contact).values({ companyId: seeded.company.id, name, email, type: 'client' } as any)
  }
  return { t, owner }
}

const RAW = /violates|foreign key|constraint|email_recipient|insert or update|No email provider/i

describe('Send now', () => {
  for (const vertical of ['contractor', 'salon']) {
    test(`${vertical}: two contacts, both recorded sent`, async () => {
      const { t, owner } = await tenant(vertical)
      const made = await owner('/api/marketing/campaigns', { method: 'POST', json: { name: 'Spring offer', subject: 'Hello {{firstName}}', body: '<p>Spring is here.</p>', audienceType: 'all' } })
      expect(made.status).toBe(201)
      const campaign = await made.json() as any
      const sent = await owner(`/api/marketing/campaigns/${campaign.id}/send`, { method: 'POST' })
      expect(sent.status).toBe(200)
      const r = await sent.json() as any
      expect([r.sent, r.audience, r.failed, r.status]).toEqual([2, 2, 0, 'sent'])
      const recipients = (await (await owner(`/api/marketing/campaigns/${campaign.id}/recipients`)).json() as any).data
      expect(recipients.map((x: any) => [x.email, x.status]).sort()).toEqual([['ann@test.example', 'sent'], ['bob@test.example', 'sent']])
      expect(recipients.every((x: any) => !!x.sent_at)).toBe(true)
      const row = await (await owner(`/api/marketing/campaigns/${campaign.id}`)).json() as any
      expect([row.status, row.recipientCount, row.lastError ?? null]).toEqual(['sent', 2, null])
    }, 120_000)
  }

  test('a send that fails is told in words, on the reply and on the campaign row', async () => {
    const { owner } = await tenant('contractor')
    const campaign = await (await owner('/api/marketing/campaigns', { method: 'POST', json: { name: 'Fall offer', subject: 'Hi', body: '<p>Hi</p>', audienceType: 'all' } })).json() as any
    const was = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    let r: any
    try { r = await (await owner(`/api/marketing/campaigns/${campaign.id}/send`, { method: 'POST' })).json() }
    finally { process.env.NODE_ENV = was }
    expect([r.sent, r.failed, r.status]).toEqual([0, 2, 'failed'])
    expect(r.message).toContain('None of these emails could be sent.')
    expect(r.message).not.toMatch(RAW)
    const row = await (await owner(`/api/marketing/campaigns/${campaign.id}`)).json() as any
    expect(row.status).toBe('failed')
    expect(row.lastError).toBe(r.message)
    expect(row.lastError).not.toMatch(RAW)
  }, 120_000)
})
