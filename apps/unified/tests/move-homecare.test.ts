// The data move on a home-care agency (apps/unified/server/move/steps/homecare.ts): the live template's database built
// the way a Render boot builds it (templates/crm-homecare: its migrations in journal order, db/prune-legacy.ts, then
// db/reconcile.ts from db/schema.ts — apps/api/src/services/deploy.ts dbReconcileStep; push is skipped there,
// db/NO_DRIZZLE_PUSH), filled with an agency's rows, moved into an empty unified database, and read back — by value and
// through the queries the caregiver and office screens run.
import { test, expect, beforeAll, afterAll } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { and, eq, inArray, desc } from 'drizzle-orm'
import { is, SQL } from 'drizzle-orm'
import { getTableConfig, PgTable, PgDialect } from 'drizzle-orm/pg-core'
import { readLayout, type Query } from '../server/move/schema.ts'
import { moveTenant } from '../server/move/copy.ts'
import { homecareMove } from '../server/move/steps/homecare.ts'
import { reconcileSchema, type TableSpec } from '../../../packages/tenant-backend/src/schemaReconcile.ts'
import { auditLog, user, supportKnowledgeBase } from '../server/db/schema/index.ts'
import { activeCaregivers, caregiverPatterns, caregiverOccurrences } from '../server/data/homecareScheduling.ts'
import homecareVertical from '../verticals/homecare/settings.ts'
import { resolveTimezone } from '../server/crm/homecare/core/agencyTime.ts'
import { companyRowTimeZone } from '@twomiah/tenant-backend'

const ROOT = path.resolve(import.meta.dir, '..', '..', '..')
const TEMPLATE = path.join(ROOT, 'templates/crm-homecare/backend/db')
// The template's schema.ts imports drizzle-orm, which resolves from this app (the template has no node_modules here);
// a copy in the app's ignored scratch folder (.gitignore: .suite/) is imported, then removed.
const SCRATCH = path.join(import.meta.dir, '..', '.suite', `move-homecare-${process.pid}`)

type Db = { db: PGlite; query: Query }
const open = (): Db => { const db = new PGlite(); return { db, query: (text, params) => db.query(text, params as any[]) as any } }
async function migrate(d: Db, folder: string) {
  const journal = JSON.parse(fs.readFileSync(path.join(folder, 'meta/_journal.json'), 'utf8'))
  for (const e of journal.entries) await d.db.exec(fs.readFileSync(path.join(folder, e.tag + '.sql'), 'utf8').split('--> statement-breakpoint').join('\n'))
}

/** db/prune-legacy.ts: its drops and its ENSURE statements, each allowed to fail as the boot allows it. */
async function pruneLegacy(d: Db) {
  const text = fs.readFileSync(path.join(TEMPLATE, 'prune-legacy.ts'), 'utf8')
  const legacy = [...(/const LEGACY_TABLES = \[([^\]]*)\]/.exec(text)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1])
  for (const t of legacy) await d.db.exec(`DROP TABLE IF EXISTS "${t}" CASCADE`)
  const ensure = text.slice(text.indexOf('const ENSURE = ['), text.indexOf('\n]\n', text.indexOf('const ENSURE = [')))
  const statements = [...ensure.matchAll(/`([^`]*)`/g)].map((m) => m[1])
  expect(statements.length).toBeGreaterThan(10)
  for (const s of statements) { try { await d.db.exec(s) } catch { /* the boot logs and carries on */ } }
}

/** db/reconcile.ts (as tests/harness/fixtures/setup.ts inlines it): CREATE TABLE / ADD COLUMN / CREATE INDEX from schema.ts. */
async function reconcile(d: Db) {
  fs.mkdirSync(SCRATCH, { recursive: true })
  fs.copyFileSync(path.join(TEMPLATE, 'schema.ts'), path.join(SCRATCH, 'schema.ts'))
  const schema = await import(path.join(SCRATCH, 'schema.ts'))
  const dialect = new PgDialect()
  const renderDefault = (col: any): string | null => {
    if (col.default === undefined || col.default === null) return null
    const v = col.default
    if (is(v, SQL)) return dialect.sqlToQuery(v).sql
    const type = String(col.getSQLType())
    const lit = (s: string) => "'" + s.replace(/'/g, "''") + "'"
    if (typeof v === 'string') return lit(v)
    if (typeof v === 'number' || typeof v === 'boolean') return String(v)
    if (v instanceof Date) return lit(v.toISOString())
    if (Array.isArray(v) && /\[\]$/.test(type)) return lit('{' + v.map((x) => JSON.stringify(x)).join(',') + '}')
    return lit(JSON.stringify(v)) + (/^jsonb?$/.test(type) ? '::' + type : '')
  }
  const tables: TableSpec[] = []
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue
    const cfg = getTableConfig(value as any)
    const indexes = cfg.indexes.flatMap((i: any) => {
      const cols = (i.config.columns || []).map((c: any) => (c && typeof c.name === 'string' ? c.name : null))
      if (!i.config.name || cols.some((c: any) => !c)) return []
      return [{ name: i.config.name, unique: !!i.config.unique, columns: cols as string[] }]
    })
    for (const c of cfg.columns as any[]) if (c.isUnique) indexes.push({ name: c.uniqueName || `${cfg.name}_${c.name}_unique`, unique: true, columns: [c.name] })
    tables.push({
      name: cfg.name,
      columns: cfg.columns.map((c: any) => ({ name: c.name, sqlType: c.getSQLType(), notNull: !!c.notNull, primary: !!c.primary, defaultSql: renderDefault(c) })),
      primaryKey: cfg.primaryKeys.flatMap((pk: any) => pk.columns.map((c: any) => c.name)),
      indexes,
    })
  }
  await reconcileSchema({ execute: async (s: string) => (await d.db.query(s)).rows as any[] }, tables, { log: () => {} })
}

let src: Db & { layout: Awaited<ReturnType<typeof readLayout>> }
let dst: Db & { layout: Awaited<ReturnType<typeof readLayout>> }

/** Inserts a row with the given values; every other required column gets a plain value of its type. */
async function put(table: string, values: Record<string, unknown>) {
  const t = src.layout.get(table)
  if (!t) throw new Error(`no ${table} in the template database`)
  const row: Record<string, unknown> = { ...values }
  for (const k of Object.keys(row)) if (!t.columns.has(k)) throw new Error(`${table} has no ${k}`)
  for (const c of t.columns.values()) {
    if (c.name in row || c.nullable || c.hasDefault) continue
    row[c.name] = c.type.includes('timestamp') ? '2026-10-01T12:00:00Z' : c.type === 'boolean' ? false : /int|numeric|double|real/.test(c.type) ? 1 : c.type.startsWith('json') ? '{}' : c.type.startsWith('_') ? '{}' : c.type === 'date' ? '2026-10-01' : `${table}-${c.name}`
  }
  const cols = Object.keys(row)
  await src.query(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, cols.map((c) => row[c]))
}

const TUESDAY = '2026-10-20'
let report: Awaited<ReturnType<typeof moveTenant>>
let m: ReturnType<typeof homecareMove>
const GUIDES = homecareVertical.starter!.helpArticles

beforeAll(async () => {
  const s = open()
  await migrate(s, path.join(TEMPLATE, 'migrations'))
  await pruneLegacy(s)
  await reconcile(s)
  src = { ...s, layout: await readLayout(s.query) }
  const d = open()
  await migrate(d, path.join(ROOT, 'apps/unified/server/db/migrations'))
  dst = { ...d, layout: await readLayout(d.query) }

  await put('agencies', {
    id: 'ag1', name: 'Sunrise Home Care', legal_name: 'Sunrise Home Care LLC', slug: 'sunrise', state: 'WI', city: 'Eau Claire',
    primary_color: '#2563eb', license_number: 'WI-1234', npi: '1234567893', medicaid_id: 'MA-998', timezone: 'America/Chicago',
    mileage_rate: '0.655', sandata_username: 'sunrise', sandata_password_encrypted: 'enc:abc',
    // The Factory's sync wrote the settings blob alone until 10/16; Settings › Features wrote both.
    enabled_features: JSON.stringify(['evv', 'scheduling']),
    // A zone left in settings before 0021 copied it to the column: read by nothing in the template since.
    settings: JSON.stringify({ paydayVerification: true, enabledFeatures: ['scheduling', 'call_tracking'], accountLock: null, timezone: 'America/New_York' }),
  })
  const hash = '$2b$10$abcdefghijklmnopqrstuuJ0bRSb0pJbKkJtq9Pq6Yk7f8m9n0p1q'
  await put('users', { id: 'u_own', email: 'owner@sunrise.example', password_hash: hash, first_name: 'Olive', last_name: 'Owner', role: 'owner' })
  await put('users', { id: 'u_adm', email: 'office@sunrise.example', password_hash: hash, first_name: 'Ada', last_name: 'Office', role: 'admin', last_login: '2026-10-19 13:05:00' })
  await put('users', {
    id: 'cg1', email: 'carla@sunrise.example', password_hash: hash, first_name: 'Carla', last_name: 'Care', role: 'caregiver', phone: '715-555-0101',
    certifications: JSON.stringify(['CNA']), default_pay_rate: '18.50', hire_date: '2025-03-01', ivr_pin: '4821',
    latitude: '44.81135000', longitude: '-91.49849000', reset_token: 'rt1', reset_token_expires: '2026-10-21T05:30:00Z',
  })
  await put('users', { id: 'cg2', email: 'ben@sunrise.example', password_hash: hash, first_name: 'Ben', last_name: 'Helper', role: 'caregiver', is_active: true })

  await put('clients', { id: 'c1', first_name: 'Ruth', last_name: 'Client', address: '12 Elm St', city: 'Eau Claire' })
  await put('clients', { id: 'c2', first_name: 'Hal', last_name: 'Client', address: '3 Oak Ave', city: 'Altoona' })
  // Tuesdays 09:00–13:00 with Carla.
  await put('schedules', {
    id: 's1', client_id: 'c1', caregiver_id: 'cg1', title: 'Morning care', day_of_week: new Date(TUESDAY + 'T12:00:00Z').getUTCDay(),
    start_time: '2026-10-06 09:00:00', end_time: '2026-10-06 13:00:00', frequency: 'weekly', effective_date: '2026-10-06', schedule_type: 'recurring',
  })
  await put('time_entries', {
    id: 'te1', caregiver_id: 'cg1', client_id: 'c1', schedule_id: 's1', start_time: '2026-10-20 14:02:11.123456', end_time: '2026-10-20 18:01:00',
    duration_minutes: 239, is_complete: true, clock_in_location: JSON.stringify({ lat: 44.81, lng: -91.49 }),
  })
  await put('evv_visits', { id: 'ev1', time_entry_id: 'te1', client_id: 'c1', caregiver_id: 'cg1', service_date: TUESDAY, actual_start: '2026-10-20 14:02:11', actual_end: '2026-10-20 18:01:00' })
  await put('overtime_alert_log', { time_entry_id: 'te1', threshold_min: 15 })
  await put('shift_reminder_log', { schedule_id: 's1', shift_date: TUESDAY })
  await put('incidents', { id: 'inc1', client_id: 'c1', caregiver_id: 'cg1', incident_type: 'fall', date: TUESDAY, description: 'Slipped in the bathroom; no injury.', incident_number: 'IR-2026-007', reported_by_id: 'u_adm' })
  await src.query(`INSERT INTO incident_number_counters (year, last_number) VALUES (2026, 7) ON CONFLICT (year) DO UPDATE SET last_number = 7`)
  await put('client_document_templates', { id: 'dt1', key: 'sunrise_photo_release', title: 'Photo release', body: 'I agree…' })

  await put('login_activity', { id: 'la1', email: 'carla@sunrise.example', user_id: 'cg1', success: true, ip_address: '10.0.0.5', user_agent: 'Mobile Safari', created_at: '2026-10-20 13:58:00' })
  await put('login_activity', { id: 'la2', email: 'ben@sunrise.example', user_id: 'cg2', success: false, fail_reason: 'invalid_password', ip_address: '10.0.0.6', created_at: '2026-10-20 07:00:00' })
  await put('login_activity', { id: 'la3', email: 'nobody@else.example', success: false, fail_reason: 'user_not_found', created_at: '2026-10-19 23:00:00' })
  await put('audit_log', { id: 'al1', action: 'create', entity: 'lead_source', entity_id: 'ls1', company_id: 'ag1', user_id: 'u_adm', created_at: '2026-10-18 10:00:00' })

  await put('help_articles', { id: 'h1', agency_id: 'ag1', title: 'Our on-call number', content: 'After 5pm call 715-555-0199.', category: 'Office', tags: JSON.stringify(['on-call']), is_faq: true, sort_order: 1 })
  await put('help_articles', { id: 'h2', agency_id: 'ag1', title: 'Mileage', content: 'Log every trip the same day.', published: false, sort_order: 2, view_count: 4 })

  // An article the agency wrote under a guide's title: kept, and that guide not added beside it.
  await put('help_articles', { id: 'h3', agency_id: 'ag1', title: GUIDES[0].title, content: 'Our own version.', sort_order: 3 })

  await put('tracking_number', { id: 'tn1', agency_id: 'ag1', phone_number: '+17155550123', name: 'Google Ads', source: 'google', whisper_message: 'Call from Google Ads', recording_enabled: false })
  await put('tracking_number', { id: 'tn2', agency_id: 'ag1', phone_number: '+17155550124', name: 'Website' })
  await put('phone_call', { id: 'pc1', tracking_number_id: 'tn1', caller_number: '+17155550999', status: 'completed', agency_id: 'ag1' })
  await put('call_log', { id: 'cl1', agency_id: 'ag1', tracking_number_id: 'tn1', client_id: 'c2', caller_number: '+17155550999', tags: JSON.stringify(['new']) })
  await put('ai_receptionist_settings', { agency_id: 'ag1', is_enabled: true, greeting_text: 'Sunrise Home Care, how can we help?' })
  await put('ai_receptionist_rule', { id: 'ar1', agency_id: 'ag1', name: 'After hours', trigger: 'after_hours', channel: 'sms', message_template: 'We will call you back.' })

  m = homecareMove(src.layout, dst.layout)
  report = await moveTenant({ read: src.query, write: dst.query, target: dst.layout, ...m })
}, 300_000)

afterAll(() => { fs.rmSync(SCRATCH, { recursive: true, force: true }) })

const one = async (sql: string, params?: unknown[]) => (await dst.query(sql, params)).rows[0]
const all = async (sql: string, params?: unknown[]) => (await dst.query(sql, params)).rows

test('the template database is what a live agency has (migrations, prune-legacy, reconcile)', () => {
  // reconcile made the CRM activity trail and the call table that no migration creates (schema.ts auditLog, phoneCall).
  for (const t of ['audit_log', 'phone_call', 'login_activity', 'help_articles', 'agencies', 'users']) expect({ t, there: src.layout.has(t) }).toEqual({ t, there: true })
  expect(src.layout.get('tracking_number')!.columns.has('whisper_message')).toBe(true)
})

test('every table moves whole and every step reports', () => {
  expect(report.mismatches).toEqual([])
  const moved = (t: string) => report.tables.find((x) => x.table === t)?.moved
  expect(moved('clients')).toBe(2)
  expect(moved('login_activity')).toBe(3)
  expect(moved('incident_number_counters')).toBe(1)
  expect(report.tables.some((t) => t.table === 'audit_log')).toBe(false) // filled by its step, not the copy
  const did = Object.fromEntries(report.steps.map((s) => [s.step, s.did]))
  expect(did['the agency becomes the company']).toContain('company ag1 (Sunrise Home Care)')
  expect(did['the agency becomes the company']).toContain('timezone America/Chicago; settings.timezone dropped')
  expect(did["the agency's users become its users"]).toBe('4 users')
  expect(did['the audit log, with the sign-ins']).toBe('1 audit rows, 3 sign-ins')
  expect(did['help articles to the help desk']).toBe('3 articles')
  expect(did['the home-care guides']).toBe(`${GUIDES.length - 1} of ${GUIDES.length} guides added (1 already there by title)`)
  expect(did['call-tracking settings with no place']).toBe('not moved, set on 1 number(s): +17155550123')
  expect(did["every row is the agency's"]).toMatch(/all company ag1$/)
})

test('the agency is the company, its feature list whole', async () => {
  const co = await one(`SELECT id, name, legal_name, slug, state, primary_color, license_number, npi, medicaid_id, timezone, mileage_rate::text AS mileage_rate,
    sandata_username, sandata_password_encrypted, enabled_features::text AS f, settings::text AS s FROM company`)
  expect({ ...co, f: undefined, s: undefined }).toEqual({
    id: 'ag1', name: 'Sunrise Home Care', legal_name: 'Sunrise Home Care LLC', slug: 'sunrise', state: 'WI', primary_color: '#2563eb', license_number: 'WI-1234',
    npi: '1234567893', medicaid_id: 'MA-998', timezone: 'America/Chicago', mileage_rate: '0.655', sandata_username: 'sunrise', sandata_password_encrypted: 'enc:abc',
    f: undefined, s: undefined,
  })
  // The template read the union of the column and the blob; the unified app reads the column.
  expect(JSON.parse(co.f).sort()).toEqual(['call_tracking', 'evv', 'scheduling'])
  expect(JSON.parse(co.s)).toEqual({ paydayVerification: true, accountLock: null })
})

test("the agency's users are the company's, every value kept", async () => {
  const rows = await all(`SELECT id, company_id, role, email, password_hash, first_name, last_name FROM "user" ORDER BY id`)
  expect(rows.map((r: any) => [r.id, r.company_id, r.role])).toEqual([['cg1', 'ag1', 'caregiver'], ['cg2', 'ag1', 'caregiver'], ['u_adm', 'ag1', 'admin'], ['u_own', 'ag1', 'owner']])
  expect(rows.every((r: any) => r.password_hash === '$2b$10$abcdefghijklmnopqrstuuJ0bRSb0pJbKkJtq9Pq6Yk7f8m9n0p1q')).toBe(true)
  expect(await one(`SELECT certifications::text AS c, default_pay_rate::text AS r, to_char(hire_date, 'YYYY-MM-DD') AS h, ivr_pin, latitude::text AS lat, phone,
    to_char(reset_token_expires, 'YYYY-MM-DD HH24:MI:SS') AS rte FROM "user" WHERE id = 'cg1'`))
    .toEqual({ c: '["CNA"]', r: '18.50', h: '2025-03-01', ivr_pin: '4821', lat: '44.81135000', phone: '715-555-0101', rte: '2026-10-21 05:30:00' })
  expect(await one(`SELECT to_char(last_login, 'YYYY-MM-DD HH24:MI:SS') AS l FROM "user" WHERE id = 'u_adm'`)).toEqual({ l: '2026-10-19 13:05:00' })
})

test('company_id is the agency on every moved row; new ids come from the old keys', async () => {
  for (const t of ['clients', 'schedules', 'time_entries', 'evv_visits', 'incidents', 'client_document_templates', 'login_activity', 'help_articles', 'tracking_number', 'phone_call', 'call_log', 'ai_receptionist_rule', 'ai_receptionist_settings', 'overtime_alert_log', 'shift_reminder_log']) {
    const r = await one(`SELECT count(*)::int AS n, count(*) FILTER (WHERE company_id = 'ag1')::int AS ours FROM "${t}"`)
    expect({ t, ok: r.n > 0 && r.n === r.ours }).toEqual({ t, ok: true })
  }
  expect(await one(`SELECT id, is_enabled, greeting_text FROM ai_receptionist_settings`)).toEqual({ id: 'ai_receptionist_settings:ag1', is_enabled: true, greeting_text: 'Sunrise Home Care, how can we help?' })
  expect(await one(`SELECT id, year, last_number FROM incident_number_counters`)).toEqual({ id: 'incident_number_counters:2026', year: 2026, last_number: 7 })
  expect(await one(`SELECT id FROM overtime_alert_log`)).toEqual({ id: 'overtime_alert_log:te1:15' })
  expect(await one(`SELECT id FROM shift_reminder_log`)).toEqual({ id: `shift_reminder_log:s1:${TUESDAY}` })
  // Unique per database, which is one company's: carried as they were.
  expect(await one(`SELECT incident_number FROM incidents WHERE id = 'inc1'`)).toEqual({ incident_number: 'IR-2026-007' })
  expect(await one(`SELECT key FROM client_document_templates WHERE id = 'dt1'`)).toEqual({ key: 'sunrise_photo_release' })
})

test('a visit keeps its times to the microsecond, and its links', async () => {
  expect(await one(`SELECT to_char(start_time, 'YYYY-MM-DD HH24:MI:SS.US') AS s, to_char(end_time, 'YYYY-MM-DD HH24:MI:SS') AS e, duration_minutes, caregiver_id, client_id, schedule_id, clock_in_location::text AS loc
    FROM time_entries WHERE id = 'te1'`)).toEqual({ s: '2026-10-20 14:02:11.123456', e: '2026-10-20 18:01:00', duration_minutes: 239, caregiver_id: 'cg1', client_id: 'c1', schedule_id: 's1', loc: '{"lat":44.81,"lng":-91.49}' })
  expect(await one(`SELECT time_entry_id, to_char(service_date, 'YYYY-MM-DD') AS d FROM evv_visits WHERE id = 'ev1'`)).toEqual({ time_entry_id: 'te1', d: TUESDAY })
})

test('sign-ins are in the audit log as the Login Activity screen reads it', async () => {
  // The query of server/crm/homecare/office/compliance.ts GET /login-activity.
  const db = drizzle(dst.db)
  const rows = await db.select({ id: auditLog.id, email: auditLog.userEmail, action: auditLog.action, metadata: auditLog.metadata, ip: auditLog.ipAddress, first: user.firstName })
    .from(auditLog).leftJoin(user, eq(auditLog.userId, user.id))
    .where(and(eq(auditLog.companyId, 'ag1'), inArray(auditLog.action, ['login', 'login_failed']))).orderBy(desc(auditLog.createdAt))
  expect(rows).toEqual([
    { id: 'la1', email: 'carla@sunrise.example', action: 'login', metadata: { description: 'Signed in' }, ip: '10.0.0.5', first: 'Carla' },
    { id: 'la2', email: 'ben@sunrise.example', action: 'login_failed', metadata: { description: 'Wrong password', reason: 'invalid_password' }, ip: '10.0.0.6', first: 'Ben' },
    { id: 'la3', email: 'nobody@else.example', action: 'login_failed', metadata: { description: 'No login with this email', reason: 'user_not_found' }, ip: null, first: null },
  ])
  expect(await one(`SELECT entity, entity_id, to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') AS at FROM audit_log WHERE id = 'la1'`)).toEqual({ entity: 'user', entity_id: 'cg1', at: '2026-10-20 13:58:00' })
  // The template's own audit row is kept as it was.
  expect(await one(`SELECT action, entity, entity_id, company_id, user_id FROM audit_log WHERE id = 'al1'`)).toEqual({ action: 'create', entity: 'lead_source', entity_id: 'ls1', company_id: 'ag1', user_id: 'u_adm' })
})

test("the agency's help articles are in the help desk's knowledge base", async () => {
  const db = drizzle(dst.db)
  const kb = await db.select({ id: supportKnowledgeBase.id, title: supportKnowledgeBase.title, published: supportKnowledgeBase.published, isFaq: supportKnowledgeBase.isFaq, tags: supportKnowledgeBase.tags, sortOrder: supportKnowledgeBase.sortOrder, viewCount: supportKnowledgeBase.viewCount })
    .from(supportKnowledgeBase).where(and(eq(supportKnowledgeBase.companyId, 'ag1'), inArray(supportKnowledgeBase.id, ['h1', 'h2']))).orderBy(supportKnowledgeBase.sortOrder)
  expect(kb).toEqual([
    { id: 'h1', title: 'Our on-call number', published: true, isFaq: true, tags: ['on-call'], sortOrder: 1, viewCount: 0 },
    { id: 'h2', title: 'Mileage', published: false, isFaq: false, tags: [], sortOrder: 2, viewCount: 4 },
  ])
})

test('a moved agency has the guides a new one gets, once each', async () => {
  expect(GUIDES.length).toBe(25)
  const count = async () => (await all(`SELECT title, count(*)::int AS n FROM support_knowledge_base WHERE company_id = 'ag1' GROUP BY title`)) as { title: string; n: number }[]
  const check = async () => {
    const rows = await count()
    expect(rows.filter((r) => r.n > 1)).toEqual([]) // no title twice
    expect(rows.length).toBe(GUIDES.length + 2) // every guide, plus the agency's two others (h1, h2; h3 holds a guide's title)
    for (const g of GUIDES) expect({ g: g.title, there: rows.some((r) => r.title === g.title) }).toEqual({ g: g.title, there: true })
  }
  await check()
  expect(await one(`SELECT id, content FROM support_knowledge_base WHERE title = $1`, [GUIDES[0].title])).toEqual({ id: 'h3', content: 'Our own version.' })
  expect(await one(`SELECT category, is_faq, published, sort_order FROM support_knowledge_base WHERE title = $1`, [GUIDES[1].title]))
    .toEqual({ category: GUIDES[1].category, is_faq: GUIDES[1].isFaq, published: true, sort_order: 2 })
  // Run again: nothing added.
  const step = m.after.find((s) => s.name === 'the home-care guides')!
  expect(await step.run({ read: src.query, write: dst.query })).toBe(`0 of ${GUIDES.length} guides added (${GUIDES.length} already there by title)`)
  await check()
})

test("the agency's clock: the column kept; with none, settings.timezone dropped and the template's zone kept", async () => {
  const fresh = open()
  await migrate(fresh, path.join(ROOT, 'apps/unified/server/db/migrations'))
  const layout = await readLayout(fresh.query)
  const company = async (state: string | null) => {
    await src.query(`UPDATE agencies SET timezone = NULL, state = $1, settings = $2 WHERE id = 'ag1'`, [state, JSON.stringify({ timezone: 'America/New_York' })])
    const step = homecareMove(src.layout, layout).before[0]
    await fresh.query('BEGIN')
    try {
      const did = await step.run({ read: src.query, write: fresh.query })
      const row = (await fresh.query(`SELECT timezone, state, settings::text AS settings FROM company`)).rows[0] as any
      return { did, row, shared: companyRowTimeZone(row), homecare: resolveTimezone(row) }
    } finally { await fresh.query('ROLLBACK') }
  }
  try {
    // A state the two rules agree on: no zone written; both read Wisconsin's, not the settings' New York.
    const wi = await company('WI')
    expect({ tz: wi.row.timezone, settings: JSON.parse(wi.row.settings), shared: wi.shared, homecare: wi.homecare })
      .toEqual({ tz: null, settings: {}, shared: 'America/Chicago', homecare: 'America/Chicago' })
    expect(wi.did).toContain('timezone not set (America/Chicago from state WI, as before); settings.timezone dropped')
    // No state: the template's default was Chicago, the shared rule's UTC — so the column is set to Chicago.
    const none = await company(null)
    expect({ tz: none.row.timezone, shared: none.shared, homecare: none.homecare }).toEqual({ tz: 'America/Chicago', shared: 'America/Chicago', homecare: 'America/Chicago' })
    // A territory only the template's table knows.
    const pr = await company('PR')
    expect({ tz: pr.row.timezone, shared: pr.shared, homecare: pr.homecare }).toEqual({ tz: 'America/Puerto_Rico', shared: 'America/Puerto_Rico', homecare: 'America/Puerto_Rico' })
  } finally {
    await src.query(`UPDATE agencies SET timezone = 'America/Chicago', state = 'WI', settings = $1 WHERE id = 'ag1'`, [JSON.stringify({ paydayVerification: true, enabledFeatures: ['scheduling', 'call_tracking'], accountLock: null, timezone: 'America/New_York' })])
    await fresh.db.close()
  }
}, 120_000)

test("the caregiver's screens answer from the moved rows", async () => {
  const db = drizzle(dst.db)
  // The scheduler's caregiver pickers: both caregivers, stored as 'caregiver', are the field seat.
  expect((await activeCaregivers(db, 'ag1', null)).map((c) => c.id)).toEqual(['cg2', 'cg1']) // by first name: Ben, Carla
  // Carla's phone: her pattern with the client's address, and Tuesday's visit in this week.
  const mine = await caregiverPatterns(db, 'ag1', 'cg1', TUESDAY, true)
  expect(mine.map((s) => ({ id: s.id, start: s.startTime, end: s.endTime, client: s.clientFirstName, address: s.clientAddress }))).toEqual([{ id: 's1', start: '09:00:00', end: '13:00:00', client: 'Ruth', address: '12 Elm St' }])
  const week = await caregiverOccurrences(db, 'ag1', 'cg1', '2026-10-19', '2026-10-25')
  expect(week.map((o) => [o.date, o.startTime, o.endTime, o.clientId])).toEqual([[TUESDAY, '09:00:00', '13:00:00', 'c1']])
  // Another company sees none of it.
  expect(await caregiverPatterns(db, 'other', 'cg1', TUESDAY, true)).toEqual([])
})

test('a database that is not one agency is refused, and the new database is left as it was', async () => {
  const before = await one(`SELECT count(*)::int AS n FROM "user"`)
  await put('agencies', { id: 'ag2', name: 'Second', slug: 'second' })
  try {
    await expect(moveTenant({ read: src.query, write: dst.query, target: dst.layout, ...homecareMove(src.layout, dst.layout) })).rejects.toThrow('Refused: the database has 2 agencies')
  } finally { await src.query(`DELETE FROM agencies WHERE id = 'ag2'`) }
  await src.query(`UPDATE users SET role = 'scheduler' WHERE id = 'cg2'`)
  try {
    await expect(moveTenant({ read: src.query, write: dst.query, target: dst.layout, ...homecareMove(src.layout, dst.layout) })).rejects.toThrow('roles the unified app does not know (scheduler)')
  } finally { await src.query(`UPDATE users SET role = 'caregiver' WHERE id = 'cg2'`) }
  await src.query(`UPDATE help_articles SET agency_id = 'elsewhere' WHERE id = 'h2'`)
  try {
    await expect(moveTenant({ read: src.query, write: dst.query, target: dst.layout, ...homecareMove(src.layout, dst.layout) })).rejects.toThrow("rows that are not the agency's (help_articles.agency_id: 1)")
  } finally { await src.query(`UPDATE help_articles SET agency_id = 'ag1' WHERE id = 'h2'`) }
  expect(await one(`SELECT count(*)::int AS n FROM "user"`)).toEqual(before)
}, 120_000)
