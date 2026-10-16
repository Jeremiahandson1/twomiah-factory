// A rule or the AI receptionist's settings cannot be moved to another company by the request body. (10/16)
//
// updateRule and upsertSettings spread the body straight into .set(), so PUT /api/ai-receptionist/rules/:id
// carrying { companyId } moved the rule to another tenant's company, and id / createdAt were rewritable. Every
// template carries this service (crm, basic, fieldservice, homecare, landscaping, roof, rv, salon, vet); each now
// keeps RULE_FIELDS / SETTINGS_FIELDS only. Real route + the service directly, on crm; the shape on all nine.
// Twin: tests/homecare/ai-receptionist.test.ts (home care's routes and its screen).
import { Hono } from 'hono'
import { readFileSync } from 'node:fs'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, aiReceptionistRule, aiReceptionistSettings } from './db/schema.ts'
import { eq } from 'drizzle-orm'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 360)) }
}

await setupSchema()
const [co] = await db.insert(company).values({ name: 'Fields Co', slug: 'air-fields', email: 'af@test.local', settings: {}, enabledFeatures: ['ai_receptionist'] } as any).returning()
const [other] = await db.insert(company).values({ name: 'Other Co', slug: 'air-other', email: 'ao@test.local', settings: {}, enabledFeatures: ['ai_receptionist'] } as any).returning()
const [owner] = await db.insert(user).values({ email: 'owner-airf@test.local', passwordHash: 'x', firstName: 'O', lastName: 'F', role: 'owner', companyId: co.id, isActive: true } as any).returning()

const app = new Hono()
app.route('/api/ai-receptionist', (await import('./src/routes/aiReceptionist.ts')).default)
app.onError(errorHandler)
const svc = (await import('./src/services/aiReceptionist.ts')) as any
const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}

const made = await api('POST', '/api/ai-receptionist/rules', { name: 'Missed', trigger: 'missed_call', channel: 'sms', messageTemplate: 'Sorry we missed you' })
check('a rule is created', made.status === 201 && made.json?.companyId === co.id, made.json)
const id = made.json?.id
const [before] = await db.select().from(aiReceptionistRule).where(eq(aiReceptionistRule.id, id))

const r = await api('PUT', `/api/ai-receptionist/rules/${id}`, { name: 'Renamed', companyId: other.id, id: 'hijacked', createdAt: '2001-01-01T00:00:00.000Z' })
const [after] = await db.select().from(aiReceptionistRule).where(eq(aiReceptionistRule.id, id))
check('through the route: the edit lands; companyId, id and createdAt do not move', r.status === 200 && after?.name === 'Renamed' && after?.companyId === co.id && +new Date(after.createdAt) === +new Date(before.createdAt), { status: r.status, after })
await svc.updateRule(id, co.id, { delayMinutes: 9, companyId: other.id, createdAt: new Date('2001-01-01') })
const [svcAfter] = await db.select().from(aiReceptionistRule).where(eq(aiReceptionistRule.id, id))
check('in the service: updateRule keeps RULE_FIELDS only', svcAfter?.delayMinutes === 9 && svcAfter?.companyId === co.id && +new Date(svcAfter.createdAt) === +new Date(before.createdAt), svcAfter)
check('…the other company holds no rule', (await db.select().from(aiReceptionistRule).where(eq(aiReceptionistRule.companyId, other.id))).length === 0)

await api('PUT', '/api/ai-receptionist/settings', { isEnabled: true, greetingText: 'Hello' })
const s2 = await api('PUT', '/api/ai-receptionist/settings', { greetingText: 'Moved?', companyId: other.id })
const mine = await db.select().from(aiReceptionistSettings).where(eq(aiReceptionistSettings.companyId, co.id))
const theirs = await db.select().from(aiReceptionistSettings).where(eq(aiReceptionistSettings.companyId, other.id))
check('settings: the update lands and stays this company\'s', s2.status === 200 && mine[0]?.greetingText === 'Moved?' && theirs.length === 0, { mine, theirs })

console.log('\n══════════ the same shape in every template that carries this service ══════════')
const ROOT = (process.env.FACTORY_ROOT || '') + 'templates/'
for (const t of ['crm', 'crm-basic', 'crm-fieldservice', 'crm-homecare', 'crm-landscaping', 'crm-roof', 'crm-rv', 'crm-salon', 'crm-vet']) {
  const src = readFileSync(`${ROOT}${t}/backend/src/services/aiReceptionist.ts`, 'utf8')
  const sets = Array.from(src.matchAll(/\.set\(\{([^}]*)\}\)/g)).map((m) => m[1].trim())
  check(`${t}: every .set() in the service is a field list, never the raw body`, sets.length >= 2 && sets.every((s) => !/\.\.\.(data|body|patch)\b/.test(s)) && sets.some((s) => /allowedOnly\(data, RULE_FIELDS\)/.test(s)) && sets.some((s) => /allowedOnly\(data, SETTINGS_FIELDS\)/.test(s)), sets)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
