// Roof reports for contractors (owner 11/12: "open roof reports to contractors with 10 free"): measurement_reports is
// offered to the contractor CRM (featureRegistry.ts), a new contractor starts with ten free reports as a roofer does
// (verticals/contractor/settings.ts starter), and its server answers the report addresses (CrmSettings.roofReports,
// server/crm/roof/reports roofReportMounts). A trade not offered the switch has neither.
import { describe, test, expect } from 'bun:test'
import { withinOffer } from '@twomiah/tenant-backend'
import { bootTenant } from './harness.ts'

const KEY = 'factory-key-for-contractor-roof-reports'

const provisionInto = async (t: Awaited<ReturnType<typeof bootTenant>>, features: string[]) => {
  process.env.FACTORY_SYNC_KEY = KEY
  const hash = await Bun.password.hash('Owner-pass-1-long', 'bcrypt')
  return t.call('/api/internal/provision', {
    method: 'POST',
    headers: { 'X-Factory-Key': KEY },
    json: {
      company: { name: 'Lund Exteriors', slug: 'lund-exteriors', phone: '555-0100', city: 'Eau Claire', state: 'WI', timezone: 'America/Chicago' },
      owner: { email: 'owner@lund.example', passwordHash: hash, firstName: 'Pat', lastName: 'Lund' },
      features,
      industry: 'General Contractor',
    },
  })
}

describe('roof reports for contractors', () => {
  test('offered to contractors and roofers, no other trade', () => {
    expect(withinOffer('crm', ['measurement_reports'])).toEqual(['measurement_reports'])
    expect(withinOffer('crm-roof', ['measurement_reports'])).toEqual(['measurement_reports'])
    for (const other of ['crm-homecare', 'crm-salon', 'crm-store', 'crm-bar']) expect(withinOffer(other, ['measurement_reports'])).toEqual([])
  })

  test('a new contractor starts with ten free reports and the switch on, and its server answers the report addresses', async () => {
    const t = await bootTenant({ vertical: 'contractor' })
    expect((await provisionInto(t, ['contacts', 'jobs', 'quotes', 'measurement_reports'])).status).toBe(201)
    const [co] = await t.db.select().from(t.schema.company)
    expect(co.reportCredits).toBe(10)
    expect(co.enabledFeatures).toContain('measurement_reports')
    // Mounted: a sign-in is asked, not "no such address".
    for (const path of ['/api/measurements', '/api/roof-reports', '/api/roof-reports/credits']) expect({ path, status: (await t.call(path)).status }).toEqual({ path, status: 401 })
    // Roofing's other parts are not: the estimator and the storm tools stay roofing's.
    expect((await t.call('/api/estimator/config/lund-exteriors')).status).toBe(404)
  }, 60_000)

  test('a salon is not offered the switch and has no report addresses', async () => {
    const t = await bootTenant({ vertical: 'salon' })
    expect((await provisionInto(t, ['contacts', 'measurement_reports'])).status).toBe(201)
    const [co] = await t.db.select().from(t.schema.company)
    expect(co.enabledFeatures).not.toContain('measurement_reports')
    expect((await t.call('/api/measurements')).status).toBe(404)
  }, 60_000)
})
