// "Export everything": one ZIP with every list the business has, for this business only, with no secrets in it.
import { describe, test, expect, beforeAll } from 'bun:test'
import { inflateRawSync } from 'node:zlib'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { exportPlan, isSecretColumn } from '../server/data/exportAll.ts'
import { zip } from '../server/core/zip.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let s: Awaited<ReturnType<typeof seedOwner>>
let ownerToken = '', managerToken = ''
let otherCompanyId = ''

const as = (p: string, tok: string) => t.call(p, { headers: { Authorization: `Bearer ${tok}` } })
const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string

/** The files of a ZIP, read back by its central directory (not by our writer). */
function unzip(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {}
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const count = buf.readUInt16LE(end + 10)
  let p = buf.readUInt32LE(end + 16)
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28)
    const extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const body = buf.subarray(dataAt, dataAt + size)
    out[name] = (method === 8 ? inflateRawSync(body) : body).toString('utf8')
    p += 46 + nameLen + extra + comment
  }
  return out
}

beforeAll(async () => {
  t = await bootTenant()
  s = await seedOwner(t)
  await t.db.insert(t.schema.user).values({ email: 'manager@test.example', passwordHash: await Bun.password.hash('Manager-pass-1', 'bcrypt'), firstName: 'Mae', lastName: 'Manager', role: 'manager', companyId: s.company.id } as any)
  ownerToken = await login('owner@test.example', s.password)
  managerToken = await login('manager@test.example', 'Manager-pass-1')
  const [other] = await t.db.insert(t.schema.company).values({ name: 'Other Co', slug: 'other-co' }).returning()
  otherCompanyId = other.id
  await t.db.insert(t.schema.contact).values([
    { companyId: s.company.id, name: 'Ann, "Annie" Able', email: 'ann@example.com', type: 'client' },
    { companyId: otherCompanyId, name: 'Zed Stranger', email: 'zed@elsewhere.example', type: 'client' },
  ] as any)
  const [q] = await t.db.insert(t.schema.quote).values({ companyId: s.company.id, number: 'Q-1', name: 'Deck', subtotal: '100', total: '100' } as any).returning()
  await t.db.insert(t.schema.quoteLineItem).values({ quoteId: q.id, description: 'Boards', quantity: '1', unitPrice: '100', total: '100' } as any)
  const [oq] = await t.db.insert(t.schema.quote).values({ companyId: otherCompanyId, number: 'Q-9', name: 'Stranger deck', subtotal: '5', total: '5' } as any).returning()
  await t.db.insert(t.schema.quoteLineItem).values({ quoteId: oq.id, description: 'Stranger boards', quantity: '1', unitPrice: '5', total: '5' } as any)
  await t.db.insert(t.schema.photo).values({ companyId: s.company.id, filename: 'a.jpg', originalName: 'front.jpg', caption: 'Front of house' } as any)
}, 120_000)

describe('export everything', () => {
  test('the owner downloads one ZIP with the lists, the website pages and the media list', async () => {
    const res = await as('/api/export-everything', ownerToken)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/zip')
    expect(res.headers.get('content-disposition')).toMatch(/test-builders-everything-\d{4}-\d{2}-\d{2}\.zip/)
    const files = unzip(Buffer.from(await res.arrayBuffer()))
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['README.txt', 'manifest.csv', 'data/contact.csv', 'data/quote.csv', 'data/quote_line_item.csv', 'data/user.csv', 'website/media.csv']))
    expect(files['data/contact.csv']).toContain('"Ann, ""Annie"" Able"')
    expect(files['website/media.csv']).toContain('Front of house')
    expect(files['manifest.csv']).toContain('data/contact.csv,contact,1')
  })

  test('only this business: the other company’s rows, and its child rows, are not in it', async () => {
    const files = unzip(Buffer.from(await (await as('/api/export-everything', ownerToken)).arrayBuffer()))
    const all = Object.values(files).join('\n')
    expect(all).not.toContain('Zed Stranger')
    expect(all).not.toContain('Stranger deck')
    expect(all).not.toContain('Stranger boards')
    expect(all).not.toContain('Other Co')
    expect(files['data/quote_line_item.csv']).toContain('Boards')
  })

  test('no password, token or secret leaves — the user file has no such column, and the hash is nowhere', async () => {
    const files = unzip(Buffer.from(await (await as('/api/export-everything', ownerToken)).arrayBuffer()))
    const header = files['data/user.csv'].split('\r\n')[0].split(',')
    expect(header).toContain('email')
    for (const col of header) expect(isSecretColumn(col)).toBe(false)
    expect(header).not.toContain('password_hash')
    const [u] = await t.db.select().from(t.schema.user).where(eq(t.schema.user.email, 'owner@test.example'))
    expect(Object.values(files).join('\n')).not.toContain(u.passwordHash)
    expect(files['manifest.csv']).toMatch(/data\/user\.csv,user,\d+,.*password_hash/)
  })

  test('only an owner or admin: a manager is refused, a visitor is signed out', async () => {
    expect((await as('/api/export-everything', managerToken)).status).toBe(403)
    expect((await t.call('/api/export-everything')).status).toBe(401)
  })

  test('each download is an audit row', async () => {
    await as('/api/export-everything', ownerToken)
    await new Promise((r) => setTimeout(r, 50))
    const rows = await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entity, 'everything'))
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].action).toBe('export')
    expect(rows[0].companyId).toBe(s.company.id)
  })

  test('every table of the schema is exported, scoped or deliberately left out', () => {
    const plan = exportPlan()
    expect(plan.filter((p) => p.how === 'unclassified')).toEqual([])
    expect(plan.length).toBe(582) // +1 website number swap (0115: call_tracking_visit); +1 stock history (0112: store_stock_moves); +1 job photo folders (0110: job_photo_folder); +4 parity tiers 2–3 (0109: store_stock_level, bid_package, bid_invite, client_update_reaction); +1 contractor parity row 12 (0095: invoice_installment); +1 contractor parity row 10c (0094: project_sign_request); +1 contractor parity row 10b (0093: project_payment); +3 contractor parity row 10a (0092: project_portal_setting, client_todo, project_task_comment); +4 contractor parity row 7b (0090: project_template_budget_line, _allowance, _selection, _dependency); +1 contractor parity row 7 (0089: project_allowance); +1 roofing parity row 26 (0086: work_order_template); +1 roofing parity row 22 (0083: roof_job_post); +1 roofing parity row 20 (0082: roof_job_status); +1 roofing parity row 19 (0081: roof_pipeline_board); +1 landscaping parity row 4 (0079: plan_takeoff); +1 landscaping parity row 27 (0078: company_budget); +1 landscaping parity row 28 (0077: recurring_route_template); +1 landscaping parity row 29 (0072: rain_day_run); +3 landscaping parity rows 12, 13, 15 (0071: visit_skip, visit_material, visit_crew_time); +2 home care parity row 23 (0065: care_qb_removal, care_books); +4 field service parity (0064: agreement_event, saved_report, ai_call_session, ai_call_turn); +12 roofing parity (0063: job_person, quote_proposal_document, quote_proposal_mark, commission_disclaimer_acceptance, inspection_report_template, job_permit, job_worksheet_approval, material_list_template, roof_money_setting, supplement_status, supplier_price_item, supplier_price_list); +17 salon parity (0062: book_block_type, book_preference, booth_rent_charge, booth_rent_period, booth_renter, intake_request, offer_code, patch_test, sale_receipt, sale_tip_split, salon_closed_period, salon_purchase_order, salon_purchase_order_line, salon_sale_seller, salon_stock_location, salon_supplier, salon_time_off); +12 restaurant-bar parity (0061: event_bank_payment, event_contract_template, event_form_campaign, event_marketing_spend, event_proposal_signer, event_report_schedule, bar_availability_date, bar_declared_tip, bar_invoice_scan, bar_tip_import, bar_tip_source, bar_tip_staff_map); 11/05 integration: +quote_template (contractor parity), +34 home care parity (0060: client_credential, client_credential_reminder, medication_dose_reminder, visit_question, visit_answer, visit_item, visit_item_log, visit_signature, visit_meal, family_request, open_shift_pickup, reward_point, reward_item, reward_redemption, family_push_subscription, family_alert_rule, alert_rule_log, open_shift_response, open_shift_message, pay_hour_audit, payroll_push, import_mapping, import_external_id, custom_field_value, migration_request, migration_file, report_definition, dashboard_layout, report_schedule, report_delivery, caregiver_survey, caregiver_survey_request, caregiver_risk_snapshot, autopay_schedule); 10/31 store parity: +store_webhooks, +store_webhook_deliveries, +store_api_keys, +store_audience_settings, +store_audience_log, +store_segments, +store_followups, +store_suppliers, +store_purchase_orders, +store_purchase_order_lines, +store_shopper_cards; 10/30: +saved_request, contractor #173, field service #169, restaurant-bar #171, store #174, landscaping #168, roofing #170, home care #172, salon #167; 10/31: +client_billing_splits
  })
})

describe('the ZIP writer', () => {
  test('writes files other tools read back byte for byte, including non-ASCII names', () => {
    const buf = zip([{ name: 'a.txt', data: 'hello' }, { name: 'dir/é.csv', data: 'x,y\r\n1,2\r\n'.repeat(1000) }])
    const back = unzip(buf)
    expect(back['a.txt']).toBe('hello')
    expect(back['dir/é.csv']).toBe('x,y\r\n1,2\r\n'.repeat(1000))
  })
})
