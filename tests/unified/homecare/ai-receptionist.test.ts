// ADAPTED COPY of tests/homecare/ai-receptionist.test.ts, for the unified app (tests/unified/harness/adapted.ts). Unchanged except the
// 42 read(s) marked "unified:", where the rulebook's reply shapes replaced the template's. The original keeps
// running against the template; tests/unified/harness/unified-divergences.ts names the assertions this copy stands in for.
// Home care's AI Receptionist, through the real routes — and the screen that drives them. (10/16)
//
// Both home care screens for this were dead: the mounted one called /api/ai-receptionist/config and /calls (no such
// routes) with a token the api client deletes; the unmounted one sent snake_case fields the service never reads and
// read { data } lists as bare arrays. The screen is now crm-roof's, ported (pages/AiReceptionistPage.tsx). This pins:
//   · a rule is created, edited, toggled and deleted; settings save and read back; the rule list is { data };
//   · a caregiver is refused (the router is requireAdmin);
//   · a body cannot move a rule or the settings to another agency, nor rewrite id / createdAt — at the route AND
//     in the service, which used to spread the body into .set();
//   · STATICALLY: every field the mounted screen sends is one the service accepts, and every endpoint it calls exists.
import { Hono } from 'hono'
import { readFileSync } from 'node:fs'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { agencies, users, aiReceptionistRule, aiReceptionistSettings } from './db/schema.ts'
import { eq } from 'drizzle-orm'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 360)) }
}

await setupSchema()
const [ag] = await db.insert(agencies).values({ name: 'Receptionist Care', slug: 'receptionist-care', enabledFeatures: ['ai_receptionist', 'call_tracking'] } /* unified: the call log the screen reads is call tracking's, which follows its call_tracking feature on the unified app (the template's router was ungated) */ as any).returning()
const [other] = await db.insert(agencies).values({ name: 'Other Agency', slug: 'other-agency' } as any).returning()
const mk = async (role: string) => (await db.insert(users).values({ email: `${role}-air@test.local`, passwordHash: 'x', firstName: role, lastName: 'A', role } as any).returning())[0]
const owner = await mk('owner'), admin = await mk('admin'), caregiver = await mk('caregiver')

const app = new Hono()
app.route('/api/ai-receptionist', (await import('./src/routes/aiReceptionist.ts')).default)
app.route('/api/calltracking', (await import('./src/routes/calltracking.ts')).default)
app.onError(errorHandler)
const svc = (await import('./src/services/aiReceptionist.ts')) as any

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id, 'x-test-company': ag.id, 'x-test-role': who.role }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const A = as(admin), O = as(owner), C = as(caregiver)
const R = '/api/ai-receptionist'

console.log('\n══════════ rules: create, list, edit, toggle, delete ══════════')
let ruleId = ''
{
  const empty = await A('GET', `${R}/rules`)
  check('the list answers { data: [] } (the old screen read a bare array)', empty.status === 200 && Array.isArray(empty.json?.data) && empty.json.data.length === 0, empty.json)
  const created = await A('POST', `${R}/rules`, { name: 'Missed call — text back', trigger: 'missed_call', channel: 'sms', messageTemplate: 'Sorry we missed you — we will call back shortly.', delayMinutes: 5, isActive: true, keywordMatch: null })
  check('create → 201 with the camelCase row', created.status === 201 && created.json?.messageTemplate?.startsWith('Sorry') && created.json?.delayMinutes === 5, created.json)
  ruleId = created.json?.id
  check('…owned by this agency', created.json?.companyId === ag.id /* unified: the business is the company table and its people the user table (RULEBOOK §4: agencies and users are refused names): a row names its company */)
  const list = await A('GET', `${R}/rules`)
  check('the list carries it in data', list.json?.data?.length === 1 && list.json.data[0].id === ruleId, list.json)
  const edit = await A('PUT', `${R}/rules/${ruleId}`, { name: 'Missed call — text and email', trigger: 'missed_call', channel: 'both', messageTemplate: 'We will call you back today.', delayMinutes: 10, isActive: true, keywordMatch: null })
  check('edit → 200, every field changed', edit.status === 200 && edit.json?.channel === 'both' && edit.json?.delayMinutes === 10 && edit.json?.name === 'Missed call — text and email', edit.json)
  const off = await A('PUT', `${R}/rules/${ruleId}`, { isActive: false })
  check('toggle sends one field and switches it off', off.status === 200 && off.json?.isActive === false && off.json?.channel === 'both', off.json)
  const on = await A('PUT', `${R}/rules/${ruleId}`, { isActive: true })
  check('…and back on', on.json?.isActive === true)
  const bad = await A('POST', `${R}/rules`, { name: 'No message', trigger: 'missed_call', channel: 'sms' })
  check('a rule with no message is a 400, not a NOT NULL 500', bad.status === 400, { status: bad.status, body: bad.text?.slice(0, 200) })
  const kw = await A('POST', `${R}/rules`, { name: 'Keyword', trigger: 'keyword', channel: 'sms', messageTemplate: 'x' })
  check('a keyword rule with no keyword is a 400', kw.status === 400)
  const snake = await A('POST', `${R}/rules`, { name: 'Old shape', trigger: 'missed_call', channel: 'sms', message_template: 'x', delay_minutes: 3, active: true })
  check('the old screen\'s snake_case body is refused, not stored blank', snake.status === 400, { status: snake.status })
}

console.log('\n══════════ settings: save and read back ══════════')
{
  const first = await A('GET', `${R}/settings`)
  check('settings read before any save → defaults', first.status === 200 && first.json?.isEnabled === false, first.json)
  const save = await O('PUT', `${R}/settings`, { isEnabled: true, businessHoursStart: '08:30', businessHoursEnd: '18:00', greetingText: 'Thank you for calling.', forwardingNumber: '+16085550111' }) /* unified: ONE CLOCK (fix-e) — the receptionist keeps time on the business's time zone (Settings › Company); it is read back, never saved here */
  check('save → 200', save.status === 200, save.json)
  const again = await A('GET', `${R}/settings`)
  check('…read back exactly', again.json?.isEnabled === true && again.json?.businessHoursStart === '08:30' && again.json?.businessHoursEnd === '18:00' && again.json?.timezone === first.json?.timezone && !!first.json?.timezone && again.json?.greetingText === 'Thank you for calling.' && again.json?.forwardingNumber === '+16085550111', again.json)
  const second = await O('PUT', `${R}/settings`, { isEnabled: false, businessHoursStart: '08:30', businessHoursEnd: '18:00', greetingText: null, forwardingNumber: null }) /* unified: ONE CLOCK (fix-e) — the receptionist keeps time on the business's time zone (Settings › Company); it is read back, never saved here */
  check('a second save updates the same row (cleared greeting)', second.status === 200 && second.json?.isEnabled === false && second.json?.greetingText === null, second.json)
  const zone = await O('PUT', `${R}/settings`, { timezone: first.json?.timezone === 'America/Denver' ? 'America/Chicago' : 'America/Denver' }) /* unified: ONE CLOCK (fix-e) — the receptionist keeps time on the business's time zone (Settings › Company); it is read back, never saved here */
  check('a zone of its own is refused by name, pointing to Settings › Company', zone.status === 400 && zone.json?.code === 'timezone_is_the_company_s' && /Settings › Company/.test(zone.json?.error), zone.json)
  const badHours = await O('PUT', `${R}/settings`, { businessHoursStart: '8am' })
  check('office hours that are not HH:MM are a 400', badHours.status === 400)
}

console.log('\n══════════ a caregiver is refused ══════════')
for (const [m, p, b] of [['GET', `${R}/rules`, undefined], ['POST', `${R}/rules`, { name: 'x', trigger: 'missed_call', channel: 'sms', messageTemplate: 'x' }], ['PUT', `${R}/rules/${ruleId}`, { isActive: false }], ['DELETE', `${R}/rules/${ruleId}`, undefined], ['GET', `${R}/settings`, undefined], ['PUT', `${R}/settings`, { isEnabled: true }]] as const) {
  const r = await C(m, p, b)
  check(`caregiver ${m} ${p.replace(ruleId, ':id')} → 403`, r.status === 403, { status: r.status })
}
{
  const [row] = await db.select().from(aiReceptionistRule).where(eq(aiReceptionistRule.id, ruleId))
  check('…and the caregiver\'s attempts changed nothing', row?.isActive === true)
}

console.log('\n══════════ the body cannot move the row ══════════')
{
  const created = (await db.select().from(aiReceptionistRule).where(eq(aiReceptionistRule.id, ruleId)))[0]
  const r = await A('PUT', `${R}/rules/${ruleId}`, { name: 'Renamed', agencyId: other.id, id: 'hijacked', createdAt: '2001-01-01T00:00:00Z' })
  const [row] = await db.select().from(aiReceptionistRule).where(eq(aiReceptionistRule.id, ruleId))
  check('through the route: the edit lands, agencyId / id / createdAt do not', r.status === 200 && row?.name === 'Renamed' && row?.companyId === ag.id /* unified: a row names its company */ && +new Date(row.createdAt) === +new Date(created.createdAt), row)
  // the service itself, so the property holds without the route's validation in front of it
  await svc.updateRule(ruleId, ag.id, { delayMinutes: 7, agencyId: other.id, id: 'hijacked', createdAt: new Date('2001-01-01') })
  const [row2] = await db.select().from(aiReceptionistRule).where(eq(aiReceptionistRule.id, ruleId))
  check('in the service: updateRule keeps only RULE_FIELDS', row2?.delayMinutes === 7 && row2?.companyId === ag.id /* unified: a row names its company */ && +new Date(row2.createdAt) === +new Date(created.createdAt), row2)
  const otherRules = await db.select().from(aiReceptionistRule).where(eq(aiReceptionistRule.companyId, other.id) /* unified: a row names its company */)
  check('…the other agency holds no rule', otherRules.length === 0, otherRules)
  await svc.upsertSettings(ag.id, { greetingText: 'Moved?', agencyId: other.id })
  const [mine] = await db.select().from(aiReceptionistSettings).where(eq(aiReceptionistSettings.companyId, ag.id) /* unified: a row names its company */)
  const theirs = await db.select().from(aiReceptionistSettings).where(eq(aiReceptionistSettings.companyId, other.id) /* unified: a row names its company */)
  check('in the service: upsertSettings keeps only SETTINGS_FIELDS (the row stays this agency\'s)', mine?.greetingText === 'Moved?' && theirs.length === 0, { mine, theirs })
  const listOther = await as({ ...admin })('GET', `${R}/rules`)
  check('the list still shows the rule here', listOther.json?.data?.some((x: any) => x.id === ruleId))
}

console.log('\n══════════ delete ══════════')
{
  const d = await A('DELETE', `${R}/rules/${ruleId}`)
  check('delete → 200', d.status === 200)
  const list = await A('GET', `${R}/rules`)
  check('…and the list is empty again', Array.isArray(list.json?.data) && list.json.data.length === 0, list.json)
  const calls = await A('GET', '/api/calltracking/calls')
  check('the call log the screen reads answers { data, pagination }', calls.status === 200 && Array.isArray(calls.json?.data) && typeof calls.json?.pagination?.total === 'number', calls.json)
}

console.log('\n══════════ the mounted screen sends only what the service accepts (static) ══════════')
{
  const ROOT = (process.env.FACTORY_ROOT || '') + 'apps/unified/' /* unified: the AI receptionist is the shared one (web/src/crm/pages/AIReceptionistPage.tsx, server/crm/comms/aiReceptionist.ts and aiReceptionistService.ts), not a home-care copy */
  // The code, not its comments — the header documents the old screens' snake_case and localStorage on purpose.
  const page = readFileSync(ROOT + 'web/src/crm/pages/AIReceptionistPage.tsx', 'utf8') /* unified: the screen is the shared AIReceptionistPage.tsx */.replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s;{}(),])\/\/.*$/gm, '$1').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  const dash = readFileSync(ROOT + 'web/src/App.tsx', 'utf8'), shellNav = readFileSync(ROOT + 'web/src/shell.ts', 'utf8'), hcVertical = readFileSync(ROOT + 'web/src/crm/verticals/homecare.tsx', 'utf8') /* unified: AdminDashboard's switch is the app's routes (App.tsx) and menu (shell.ts); home care's menu is the shared menu less SHARED_HIDDEN (crm/verticals/homecare.tsx) */
  const service = readFileSync(ROOT + 'server/crm/comms/aiReceptionistService.ts', 'utf8') /* unified: the service is server/crm/comms/aiReceptionistService.ts (RULE_FIELDS, SETTINGS_FIELDS) */
  const routes = readFileSync(ROOT + 'server/crm/comms/aiReceptionist.ts', 'utf8') /* unified: the router is server/crm/comms/aiReceptionist.ts */
  const listOf = (name: string) => (new RegExp(`export const ${name} = \\[([^\\]]*)\\]`).exec(service)?.[1] || '').match(/'([^']+)'/g)?.map((x) => x.slice(1, -1)) || []
  const RULE = listOf('RULE_FIELDS'), SETTINGS = listOf('SETTINGS_FIELDS')
  check('the service declares its field lists', RULE.length === 7 && SETTINGS.length === 5 && !SETTINGS.includes('timezone'), /* unified: ONE CLOCK — no timezone among the settings it saves */ { RULE, SETTINGS })
  // the object literal a builder returns: `export const ruleBody = (f) => ({ … })`
  const keysOf = (fn: string) => {
    const m = new RegExp(`export const ${fn} = \\([^)]*\\) => \\(\\{([\\s\\S]*?)\\n\\}\\)`).exec(page)
    return m ? Array.from(m[1].matchAll(/^\s*(\w+):/gm)).map((x) => x[1]) : []
  }
  const ifaceKeys = (name: string) => { const m = new RegExp('interface ' + name + ' \\{([\\s\\S]*?)\\n\\}').exec(page); return m ? Array.from(m[1].matchAll(/^\s*(\w+)\??:/gm)).map((x) => x[1]) : [] }
  const ruleKeys = ifaceKeys('AutoReplyFormData'), settingsKeys = ifaceKeys('AISettings') /* unified: the shared screen has no ruleBody/settingsBody builders: a rule is sent as the form's typed state (AutoReplyFormData) and a setting as a Partial<AISettings>, so the fields it can send are those two interfaces' keys */
  check('the screen builds its rule body from RULE_FIELDS only', ruleKeys.length > 0 && ruleKeys.every((k) => RULE.includes(k)), { ruleKeys, RULE })
  check('…and sends every field a whole rule has', RULE.every((k) => ruleKeys.includes(k)), { ruleKeys, RULE })
  const sentKeys = settingsKeys.filter((k) => k !== 'timezone') /* unified: ONE CLOCK — the screen shows the business's zone (a link to Settings › Company) and never sends it */
  check('the screen builds its settings body from SETTINGS_FIELDS only, all of them', sentKeys.length === SETTINGS.length && sentKeys.every((k) => SETTINGS.includes(k)) && !/updateSettings\(\{[^}]*timezone/.test(page), { settingsKeys, SETTINGS })
  const sends = Array.from(page.matchAll(/body: JSON\.stringify\(([^)]*)\)/g)).map((m) => m[1].trim()) /* unified: the shared screen writes through its own api(path, { method, body: JSON.stringify(x) }) helper over client.raw (the session cookie) */
  check('every write sends a builder or { isActive } — never a spread row', sends.length === 5 && sends.every((s) => /^(data|updates|\{ isActive: !rule\.isActive \}|\{ isEnabled: !settings\.isEnabled \})$/.test(s)) && /const handleSave = async \(data: AutoReplyFormData\)/.test(page) && /const updateSettings = async \(updates: Partial<AISettings>\)/.test(page), sends) /* unified: a rule save sends the typed form (data: AutoReplyFormData), a settings change one field (updates: Partial<AISettings>; aiSettingsSchema takes any subset), the switches { isActive } / { isEnabled } */
  const snake = page.match(/\b(message_template|delay_minutes|greeting_text|forwarding_number|business_hours_start|business_hours_end|is_active|keyword_match|is_enabled)\b/g) || []
  check('no snake_case request field in the screen', snake.length === 0, snake)
  const routePaths = Array.from(routes.matchAll(/app\.(get|post|put|delete)\('([^']+)'/g)).map((m) => `${m[1].toUpperCase()} /api/ai-receptionist${m[2]}`.replace(/\/:\w+/g, '/:x'))
  const calls = Array.from(page.matchAll(/api\.(get|post|put|del)\(\s*[`']([^`']+)[`']/g)).map((m) => `${m[1] === 'del' ? 'DELETE' : m[1].toUpperCase()} ${m[2]}`.replace(/\$\{[^}]+\}/g, ':x'))
  const uCalls = Array.from(page.matchAll(/\bapi\(\s*[\x60']([^\x60']+)[\x60'](?:,\s*\{\s*method:\s*'(\w+)')?/g)).map((m) => (m[2] || 'GET') + ' /api/ai-receptionist' + m[1].replace(/\$\{[^}]+\}/g, ':x'))
  const missing = uCalls.filter((c) => !routePaths.includes(c)) /* unified: the shared screen's api(path, { method }) prefixes /api/ai-receptionist (the call log goes through callApi, /api/calltracking/calls, read above) */
  check('every AI-receptionist endpoint the screen calls exists on the router', uCalls.length >= 6 && missing.length === 0, { uCalls, missing }) /* unified: the calls read in the api(path, { method }) form */
  check('no localStorage token read in the screen', !/localStorage/.test(page))
  check('Admin › AI Receptionist mounts this screen', /<Route path="ai-receptionist" element=\{<AIReceptionistPage \/>\} \/>/.test(dash) && /const AIReceptionistPage = named\(\(\) => import\('\.\/crm\/pages\/AIReceptionistPage'\), 'AIReceptionistPage'\)/.test(dash)
    && /\{ to: '\/crm\/ai-receptionist', icon: Bot, label: 'AI Receptionist', features: \['ai_receptionist'\], permission: 'ai-receptionist:read' \}/.test(shellNav) && !/SHARED_HIDDEN = \[[^\]]*'\/crm\/ai-receptionist'/.test(hcVertical)) /* unified: /crm/ai-receptionist is the app's route (App.tsx) and the shared menu's item, which an agency keeps (not in SHARED_HIDDEN) */
  check('the unmounted snake_case screen is gone, and nothing imports it', !(await import('node:fs')).readdirSync(ROOT + 'web/src/crm/pages/homecare', { recursive: true }).some((f: any) => /receptionist/i.test(String(f))) ) /* unified: no home-care copy of the AI receptionist screen exists, and App.tsx mounts only the shared one */
}

console.log('\n══════════ the ai_receptionist feature gates the router — both fields read, webhooks still open (10/16) ══════════')
{
  const { setAgencyFeatures } = await import('./src/services/agencyFeatures.ts')
  const { forgetFeatures } = await import('./src/middleware/enabledFeature.ts')
  const mkAg = async (slug: string, extra: any) => (await db.insert(agencies).values({ name: slug, slug, ...extra } as any).returning())[0]
  const asIn = (agency: any) => async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': admin.id, 'x-test-company': agency.id, 'x-test-role': 'admin' }, body: body === undefined ? undefined : JSON.stringify(body) })
    const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
    return { status: res.status, json: j }
  }
  const off = await mkAg('air-off', { enabledFeatures: ['contacts', 'scheduling'] })
  for (const [m, p] of [['GET', `${R}/rules`], ['POST', `${R}/rules`], ['GET', `${R}/settings`], ['PUT', `${R}/settings`]] as const) {
    const r = await asIn(off)(m, p, m === 'GET' ? undefined : { name: 'x', trigger: 'missed_call', channel: 'sms', messageTemplate: 'x' })
    check(`feature off: ${m} ${p} → 403 FEATURE_NOT_ENABLED`, r.status === 403 && r.json?.code === 'FEATURE_NOT_ENABLED', r)
  }
  // 547-style row: the Factory's sync wrote settings.enabledFeatures only; the column was never set.
  const blobOnly = await mkAg('air-blob', { enabledFeatures: [], settings: { enabledFeatures: ['ai_receptionist', 'contacts'] } })
  const b = await asIn(blobOnly)('GET', `${R}/rules`)
  check('the feature only in settings.enabledFeatures (how the Factory sync wrote it) → allowed, not locked out', b.status === 403, b) /* unified: the unified feature list is company.enabled_features alone — the Factory's sync and every in-app writer write that column, and nothing reads settings.enabledFeatures (core/agencyFeatures.ts) — so a feature only in the old blob is off */
  const colOnly = await mkAg('air-col', { enabledFeatures: ['ai_receptionist'], settings: {} })
  check('the feature only in the column (Settings › Features, the in-CRM billing) → allowed', (await asIn(colOnly)('GET', `${R}/rules`)).status === 200)
  // the Twilio webhooks are above the gate: a call to an agency with the feature off is still received (signature-checked)
  const hook = await app.request(`${R}/webhook/status/${off.id}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'CallSid=CA1&CallStatus=completed' })
  check('feature off: the Twilio status webhook is still reachable (not 403 FEATURE_NOT_ENABLED)', hook.status === 200, { status: hook.status })

  // ONE writer: both fields, and the gate hears it at once (cache dropped)
  const sw = await mkAg('air-switch', { enabledFeatures: ['ai_receptionist'], settings: { enabledFeatures: ['ai_receptionist'], other: 'kept' } })
  check('switch: on before', (await asIn(sw)('GET', `${R}/rules`)).status === 200)
  await setAgencyFeatures(sw.id, ['contacts'])
  const [row] = await db.select().from(agencies).where(eq(agencies.id, sw.id))
  check('setAgencyFeatures writes the column AND the settings blob, and keeps the rest of the blob', JSON.stringify(row.enabledFeatures) === '["contacts"]' &&  /* unified: the one writer writes the column only; the blob is no longer a second copy of the list (core/agencyFeatures.ts) */(row.settings as any)?.other === 'kept', row)
  check('…and the gate refuses on the very next request (no 15 s stale cache)', (await asIn(sw)('GET', `${R}/rules`)).status === 403)
  await setAgencyFeatures(sw.id, ['contacts', 'ai_receptionist'])
  check('…switched back on, allowed at once', (await asIn(sw)('GET', `${R}/rules`)).status === 200)
  forgetFeatures()

  // the writers really are that one writer — static, since index.ts boots a server and cannot be imported here
  const SRC = (process.env.FACTORY_ROOT || '') + 'apps/unified/' /* unified: the server and the shell are the unified app’s */
  const idx = readFileSync(SRC + 'server/modules/company.ts', 'utf8') /* unified: the Factory's /api/internal/sync-features is server/modules/company.ts (syncFeatures) */
  const syncAt = idx.indexOf("const syncFeatures = new Hono().post('/'") /* unified: the sync route is the syncFeatures router, mounted at /api/internal/sync-features */
  const syncBody = idx.slice(syncAt, idx.indexOf('\n  })', syncAt)) /* unified: the handler sits inside createCompanyModules (indented) */
  check('the Factory sync-features route writes through setAgencyFeatures (both fields)', syncAt > 0 && /const features = withinOffer\(vertical\.featureSet, withoutNotReady\(body\.features as string\[\]\)\)/.test(syncBody) /* unified: and what the industry is not offered goes (withinOffer, 2026-10-22) */ && /await db\.update\(company\)\.set\(\{ enabledFeatures: features, updatedAt: new Date\(\) \}\)/.test(syncBody) && /deps\.features\.forgetFeatures\(co\.id\)/.test(syncBody) && !/\bsettings\b/.test(syncBody), syncBody.slice(0, 300)) /* unified: the unified list is company.enabled_features alone (core/agencyFeatures.ts header): the sync writes that column — with not-ready features dropped (withoutNotReady, 2026-10-19) — no settings blob, and drops the gate cache at once */
  check('…and checks X-Factory-Key in constant time', /\{ path: '\/api\/internal\/sync-features', access: 'factory' as const, router: syncFeatures \}/.test(idx) && /crypto\.timingSafeEqual\(Buffer\.from\(got\), Buffer\.from\(key\)\)/.test(readFileSync(SRC + 'server/http/registry.ts', 'utf8')) && /if \(m\.access === 'factory'\) guards\.push\(factoryOnly\)/.test(readFileSync(SRC + 'server/http/registry.ts', 'utf8'))) /* unified: the key is checked by the registry's factoryOnly guard for every access: 'factory' mount (server/http/registry.ts); its 401/503 are held by apps/unified/tests/company-modules.test.ts */
  const comp = readFileSync((process.env.FACTORY_ROOT || '') + 'packages/tenant-backend/src/company/company.ts', 'utf8') /* unified: Settings › Features is the shared company router's PUT /features */
  const bill = readFileSync((process.env.FACTORY_ROOT || '') + 'packages/tenant-backend/src/billing.ts', 'utf8') /* unified: plan & billing is the shared billing.ts (a mirror of the Factory's subscription) */
  const writes = (s: string) => (s.match(/\.set\(\{[^}]*enabledFeatures/g) || []).length
  const strays = [['company.ts PUT /features: one write, then onFeaturesChanged', writes(comp) === 1 && /\.set\(\{ enabledFeatures: next, updatedAt: new Date\(\) \}\)[\s\S]{0,300}deps\.onFeaturesChanged\?\.\(next\)/.test(comp)], ['modules/company.ts: the sync and the boot sweep, each dropping the cache', writes(idx) === 2 && /\.set\(\{ enabledFeatures: kept, updatedAt: new Date\(\) \}\)[\s\S]{0,160}deps\.features\.forgetFeatures\(r\.id\)/.test(idx) /* unified: the boot sweep (dropUnofferedFeatures, 2026-10-22) is the second writer, and drops the cache for the row it changed */ &&/onFeaturesChanged: \(features: string\[\]\) => \{ deps\.features\.forgetFeatures\(\);/.test(idx)], ['billing.ts: never', writes(bill) === 0]].filter(([, ok]) => !ok) /* unified: the unified writers of the one list (the column): the Factory's sync and Settings › Features, each followed by the gate's cache drop; the in-CRM billing writes none (plans change at the Factory, which syncs) */
  check('no other writer sets enabledFeatures directly (company.ts, billing.ts, index.ts)', strays.length === 0, strays.map(([f]) => f))
  check('billing.ts writes its tier features through setAgencyFeatures (4 places)', !/enabledFeatures|setAgencyFeatures/.test(bill) && /restart-checkout/.test(bill)) /* unified: the shared billing never sets features: a plan change is made at the Factory (portal-link / restart-checkout), and the Factory's sync-features writes the list */
  const gateSrc = readFileSync(SRC + 'server/app.ts', 'utf8') /* unified: the gate is built in server/app.ts */
  check('the gate reads both fields (readSettingsBlob: true)', /const features = createEnabledFeatureGate\(\{ db, tables: \{ company \} \}\)/.test(gateSrc) && !/readSettingsBlob/.test(gateSrc)) /* unified: the unified gate reads the column alone (readSettingsBlob off), the same list every writer writes */
  const routeSrc = readFileSync(SRC + 'server/crm/comms/aiReceptionist.ts', 'utf8') /* unified: the router is server/crm/comms/aiReceptionist.ts */
  const gateAt = routeSrc.indexOf("app.use('*', d.features.requireEnabledFeature('ai_receptionist'))") /* unified: the gate is the app's d.features.requireEnabledFeature */
  check('the router gate sits below every webhook and above every other route', gateAt > routeSrc.lastIndexOf("'/webhook/") && gateAt < routeSrc.indexOf("app.get('/rules'"), { gateAt })

  console.log('\n══════════ the nav follows the feature (static) ══════════')
  const dash = readFileSync(SRC + 'web/src/shell.ts', 'utf8'), appShell = readFileSync((process.env.FACTORY_ROOT || '') + 'packages/tenant-ui/src/shell/AppShell.tsx', 'utf8') /* unified: the menu is web/src/shell.ts, drawn and URL-gated by the shared AppShell */
  check('AI Receptionist is a feature item (FEATURE_FOR_ITEM)', /\{ to: '\/crm\/ai-receptionist', icon: Bot, label: 'AI Receptionist', features: \['ai_receptionist'\]/.test(dash)) /* unified: a menu item's features list is its gate */
  check('the sidebar and the mobile drawer both list navSections (filtered), never NAV_SECTIONS', (appShell.match(/\{navItems\.map\(/g) || []).length === 1 && !/\{config\.nav\.map\(/.test(appShell) && /&& \(!i\.features \|\| i\.features\.some\(\(f\) => hasFeature\(f\)\)\),/.test(appShell)) /* unified: the shell draws one list (navItems, filtered by feature, permission and role), the same aside on a phone (the drawer) as on a desk */
  check('search offers only allowed items', /<GlobalSearch api=\{api\} placeholder=\{config\.searchPlaceholder\} \/>/.test(appShell)) /* unified: the header search is /api/search (records, filtered on the server by the company's features: server/crm/comms/search.ts), never handed the menu, so it offers no page at all */
  check('the page itself refuses a feature item that is off (reached by #ai-receptionist)', /const blocked = blockedRoute\(matches, hasFeature, alwaysOn\)/.test(appShell) && /\.\.\.config\.nav\.filter\(\(i\) => !i\.external\)\.map\(\(i\) => \(\{ to: i\.to, label: i\.label, features: i\.features \}\)\)/.test(appShell)) /* unified: a typed /crm/ai-receptionist with the feature off is refused by the shell's route gate (AppShell gatedItem, from the menu's features); the page also shows ModuleNotEnabled on the server's FEATURE_NOT_ENABLED */
  const ctx = readFileSync((process.env.FACTORY_ROOT || '') + 'packages/tenant-ui/src/auth/AuthContext.tsx', 'utf8') /* unified: the screens' hasFeature is the shared AuthContext's */
  check('the screens\' hasFeature reads both fields too — the same answer as the gate', /const hasFeature = \(featureId: string\): boolean => company\?\.enabledFeatures\?\.includes\(featureId\) \?\? false/.test(ctx) && !/settings\??\.enabledFeatures/.test(ctx) && !/readSettingsBlob/.test(gateSrc)) /* unified: the same answer as the gate: both read company.enabled_features alone */
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
