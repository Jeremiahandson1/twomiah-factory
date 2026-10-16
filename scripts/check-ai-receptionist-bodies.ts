/**
 * GUARD: the AI receptionist API, in every template that carries it, is switched by its feature and trusts no body.
 *
 * Nine templates carry the same routes/aiReceptionist.ts + services/aiReceptionist.ts pair (crm, basic, fieldservice,
 * homecare, landscaping, roof, rv, salon, vet). Until 10/16:
 *   · updateRule / upsertSettings spread the request body into .set() — a PUT carrying companyId / agencyId moved the
 *     row to another tenant, and createdAt was rewritable;
 *   · seven of the nine read rule and settings bodies raw — a create with no message was a NOT NULL 500, a trigger
 *     outside the list was stored and never fired;
 *   · home care's router had no feature gate at all, so an agency without AI Receptionist had the whole API.
 *
 * THE RULES, per template:
 *   1. POST /rules parses aiRuleCreateSchema, PUT /rules/:id aiRuleUpdateSchema, PUT /settings aiSettingsSchema —
 *      the ONE shared schema (packages/tenant-backend/src/integrations/aiReceptionistSchemas.ts) — before the service
 *      is called;
 *   2. every .set() in the service is allowedOnly(data, RULE_FIELDS | SETTINGS_FIELDS), never a spread body;
 *   3. the router is gated on ai_receptionist: app.use('*', requireEnabledFeature('ai_receptionist')) BELOW every
 *      /webhook/ route (Twilio must still reach them, signature-checked) and ABOVE every other route — or, where the
 *      template gates whole mounts in index.ts (crm-roof), its gate list maps /api/ai-receptionist to ai_receptionist.
 * The walk finds the templates by the file, so a tenth one is held to this the day it gets the router. After the
 * real walk this file mutation-tests itself.
 *
 *   bun scripts/check-ai-receptionist-bodies.ts
 */
import { readdirSync, readFileSync, existsSync } from 'fs'

const ROOT = (process.argv[2] || process.cwd()).replace(/\\/g, '/').replace(/\/$/, '')
const PARKED = new Set(['crm-automotive'])
type Src = { routes: string; service: string; index: string }

function readAll(): Map<string, Src> {
  const out = new Map<string, Src>()
  for (const t of readdirSync(`${ROOT}/templates`)) {
    if (!/^crm(-|$)/.test(t) || PARKED.has(t)) continue
    const b = `${ROOT}/templates/${t}/backend/src`
    if (!existsSync(`${b}/routes/aiReceptionist.ts`)) continue
    const rd = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : '')
    out.set(t, { routes: rd(`${b}/routes/aiReceptionist.ts`), service: rd(`${b}/services/aiReceptionist.ts`), index: rd(`${b}/index.ts`) })
  }
  return out
}

/** The text of one `app.<verb>('<path>' …)` registration, up to the next top-level registration. */
function handler(src: string, verb: string, path: string): string {
  const at = src.indexOf(`app.${verb}('${path}'`)
  if (at < 0) return ''
  const next = src.indexOf('\napp.', at + 1)
  return src.slice(at, next < 0 ? src.length : next)
}

function judge(all: Map<string, Src>): string[] {
  const fails: string[] = []
  for (const [t, s] of all) {
    // 1. bodies parsed with the shared schema before the service call
    for (const [verb, path, schema, call] of [['post', '/rules', 'aiRuleCreateSchema', 'createRule'], ['put', '/rules/:id', 'aiRuleUpdateSchema', 'updateRule'], ['put', '/settings', 'aiSettingsSchema', 'upsertSettings']] as const) {
      const h = handler(s.routes, verb, path)
      if (!h) { fails.push(`${t}: no ${verb.toUpperCase()} ${path} on the router — the walk cannot see it`); continue }
      const p = h.indexOf(`${schema}.parse(`), c = h.indexOf(`${call}(`)
      if (p < 0) fails.push(`${t}: ${verb.toUpperCase()} ${path} does not parse ${schema} — a malformed body reaches the database`)
      else if (c >= 0 && c < p) fails.push(`${t}: ${verb.toUpperCase()} ${path} calls ${call}() before it parses ${schema}`)
    }
    // 2. the service's .set() calls are field lists
    const sets = Array.from(s.service.matchAll(/\.set\(\{([^}]*)\}/g)).map((m) => m[1])
    if (!sets.some((x) => /allowedOnly\(data, RULE_FIELDS\)/.test(x))) fails.push(`${t}: updateRule's .set() is not allowedOnly(data, RULE_FIELDS)`)
    if (!sets.some((x) => /allowedOnly\(data, SETTINGS_FIELDS\)/.test(x))) fails.push(`${t}: upsertSettings' .set() is not allowedOnly(data, SETTINGS_FIELDS)`)
    for (const x of sets) if (/\.\.\.(data|body|patch|payload)\b/.test(x)) fails.push(`${t}: a .set() in services/aiReceptionist.ts spreads ${x.match(/\.\.\.(\w+)/)![0]} — a body can move the row`)
    // 3. the feature gate
    const gate = s.routes.indexOf("app.use('*', requireEnabledFeature('ai_receptionist'))")
    const lastHook = s.routes.lastIndexOf("app.post('/webhook/")
    const firstOther = Math.min(...['get', 'post', 'put', 'delete'].map((v) => {
      let i = -1, from = 0
      for (;;) { i = s.routes.indexOf(`app.${v}('`, from); if (i < 0) return Infinity; if (!s.routes.startsWith(`app.${v}('/webhook/`, i)) return i; from = i + 1 }
    }))
    const indexGated = /\[\s*'\/api\/ai-receptionist'\s*,\s*'ai_receptionist'\s*\]/.test(s.index)
    if (gate >= 0) {
      if (gate < lastHook) fails.push(`${t}: the ai_receptionist gate is ABOVE a /webhook/ route — Twilio would be refused`)
      if (gate > firstOther) fails.push(`${t}: a non-webhook route is registered ABOVE the ai_receptionist gate — it is open with the feature off`)
    } else if (!indexGated) {
      fails.push(`${t}: /api/ai-receptionist is not gated on ai_receptionist (no requireEnabledFeature on the router, no index.ts gate entry)`)
    }
  }
  if (all.size < 9) fails.push(`only ${all.size} templates carry routes/aiReceptionist.ts — the walk is broken, not the code`)
  return fails
}

let failures = 0
const fail = (m: string) => { console.log(`FAIL: ${m}`); failures++ }
const all = readAll()
for (const f of judge(all)) fail(f)

// ═══ mutation checks on in-memory copies ═════════════════════════════════════════════════════════
const failsWith = (t: string, role: keyof Src, mutate: (s: string) => string): string[] => {
  const s = all.get(t); if (!s) return [`(no ${t})`]
  const planted = mutate(s[role]); if (planted === s[role]) return ['(the mutation did not apply)']
  return judge(new Map([...all, [t, { ...s, [role]: planted }]]))
}
const self = (name: string, got: string[], want: RegExp) => { if (!got.some((g) => want.test(g))) fail(`self-test: ${name} — got ${JSON.stringify(got).slice(0, 240)}`) }
self('crm create without the schema', failsWith('crm', 'routes', (s) => s.replace('aiRuleCreateSchema.parse(await c.req.json())', 'await c.req.json()')), /^crm: POST \/rules does not parse/)
self('salon settings without the schema', failsWith('crm-salon', 'routes', (s) => s.replace('aiSettingsSchema.parse(await c.req.json())', 'await c.req.json()')), /^crm-salon: PUT \/settings does not parse/)
self('vet service spreads the body again', failsWith('crm-vet', 'service', (s) => s.replace('.set({ ...allowedOnly(data, SETTINGS_FIELDS), updatedAt', '.set({ ...data, updatedAt')), /^crm-vet: .*SETTINGS_FIELDS|^crm-vet: a \.set\(\) .* spreads/)
self('homecare gate removed', failsWith('crm-homecare', 'routes', (s) => s.replace("app.use('*', requireEnabledFeature('ai_receptionist'))\n", '')), /^crm-homecare: \/api\/ai-receptionist is not gated/)
self('rv gate moved above the webhooks', failsWith('crm-rv', 'routes', (s) => { const g = "app.use('*', requireEnabledFeature('ai_receptionist'))\n"; return s.replace(g, '').replace("app.post('/webhook/recording/", g + "app.post('/webhook/recording/") }), /^crm-rv: the ai_receptionist gate is ABOVE/)
self('a route registered above the gate (basic)', failsWith('crm-basic', 'routes', (s) => s.replace("app.use('*', requireEnabledFeature('ai_receptionist'))", "app.get('/leak', (c) => c.json({}))\napp.use('*', requireEnabledFeature('ai_receptionist'))")), /^crm-basic: a non-webhook route is registered ABOVE/)
self('roof index gate entry removed', failsWith('crm-roof', 'index', (s) => s.replace("['/api/ai-receptionist', 'ai_receptionist'],", '')), /^crm-roof: \/api\/ai-receptionist is not gated/)

console.log(failures ? `\nai-receptionist-bodies: ${failures} problem(s)` : `ai-receptionist-bodies: ok — ${all.size} templates: shared schema on every body, field-listed .set(), ai_receptionist gate below the webhooks; 7 self-mutations caught`)
process.exit(failures ? 1 : 0)
