// Run a CRM template's behaviour suite against the UNIFIED app (apps/unified), not the template.
//
// The step-3 "done" measure (SPEC §0): each vertical's existing suite passes on the unified app. The tests are the
// templates' own, unchanged; what changes is the sandbox they run in. Where runSuite.ts copies the template's backend
// and swaps three files, this builds a sandbox of the paths those tests import, each backed by the unified app:
//
//   db/index.ts, db/schema.ts   an in-process PGlite with the unified schema
//   setup.ts                    the unified migrations, applied exactly as a boot applies them
//   src/routes/<name>.ts        the template's router by name → the unified app, which serves the same path
//   src/middleware/*.ts         sign-in (the same x-test-user bridge as the template stub), permissions, gates
//   src/services/*.ts           the unified services the tests reach into
//   src/shared                  the shared package itself
//
// Like the template's route files, the routes are reached without the feature gate the template's index.ts put in
// front of them (createApp's testing.featureGates = false); gates inside a module stay real. The template-only contract
// test is replaced by tests/unified-contract.test.ts in each run, which reads the routes from the app itself.
//
// The sandbox lives in apps/unified/.suite/<label> so packages resolve as the app's do; it is git-ignored and removed
// after the run (KEEP=1 keeps it).
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { UNIFIED_DIVERGENCES } from './unified-divergences.ts'

export interface UnifiedSuiteOptions {
  /** Repo root, with a trailing slash. */
  root: string
  /** Directory holding the *.test.ts files, e.g. <root>/tests/crm */
  suiteDir: string
  /** The template whose route and service files the tests name, e.g. 'crm' (only its file names are read). */
  template: string
  /** The unified vertical the app runs as, e.g. 'contractor'. */
  vertical: string
  label: string
  filter?: string
  /**
   * Template route files whose exported functions (pure rules the tests assert where they live) moved into a unified
   * module: { 'snowBilling.ts': 'server/crm/landscaping/snowBilling.ts' }, the module relative to apps/unified. The
   * route file's `export function` names are re-exported from it.
   */
  routeModules?: Record<string, string>
  /**
   * Template service or util files the tests import directly, written into the sandbox by path (two levels down, e.g.
   * 'src/services/loyaltyAward.ts'): the file's source, where `@app/` is the path to apps/unified and `crmDeps` can be
   * imported from '../services/crmDeps.ts' (the app's own dependencies).
   */
  sandboxFiles?: Record<string, string>
  /**
   * Home care's own model (templates/crm-homecare): one agency per database, `agencies` and `users` with no business
   * id, signed in by headers alone (tests/harness/fixtures/middleware-auth.crm-homecare.ts). In the sandbox:
   *   · `agencies` and `users` are the unified `company` and `user`;
   *   · a row the tests write without company_id gets the database's one company — exactly how the cutover data move
   *     fills it (docs/UNIFIED_HOMECARE_PLAN.md decision 2). The app's own inserts must set it themselves; that is held
   *     by apps/unified/tests/homecare-company-id.test.ts, which reads the server code, so this default hides nothing;
   *   · x-test-user signs in with x-test-role / x-test-company (or x-test-agency), as home care's stub did.
   */
  homecare?: boolean
}

export async function runUnifiedSuite(o: UnifiedSuiteOptions): Promise<number> {
  const APP = `${o.root}apps/unified`
  // One sandbox per run, so several runs can go at once.
  const SB = `${APP}/.suite/${o.label}-${process.pid}`
  const rel = '../../..' // from SB/<one dir> back to apps/unified
  rmSync(SB, { recursive: true, force: true })
  mkdirSync(`${SB}/db`, { recursive: true })
  mkdirSync(`${SB}/src/routes`, { recursive: true })
  mkdirSync(`${SB}/src/middleware`, { recursive: true })
  mkdirSync(`${SB}/src/services`, { recursive: true })
  mkdirSync(`${SB}/src/utils`, { recursive: true })
  const cleanup = () => { if (!process.env.KEEP) rmSync(SB, { recursive: true, force: true }) }
  process.on('exit', cleanup)

  const w = (p: string, s: string) => writeFileSync(`${SB}/${p}`, s.trimStart())

  // The template's own migrations, for the tests that read a data heal from them and apply it here.
  cpSync(`${o.root}templates/${o.template}/backend/db/migrations`, `${SB}/db/migrations`, { recursive: true })
  w('db/schema.ts', `export * from '${rel}/server/db/schema/index.ts'\n` + (o.homecare ? `export { company as agencies, user as users } from '${rel}/server/db/schema/index.ts'\n` : ''))
  w('db/index.ts', `
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import * as schema from './schema.ts'
export const pglite = new PGlite()
export const db = drizzle(pglite, { schema })
export type DB = typeof db
export { schema }
`)
  w('setup.ts', `
import { migrate } from 'drizzle-orm/pglite/migrator'
import { db } from './db/index.ts'
import { MIGRATIONS } from '${'..'}/../server/db/migrate.ts'
/** The unified migrations, in order, as a boot applies them. A failed one fails the suite. */
export async function setupSchema() {
  await migrate(db as any, { migrationsFolder: MIGRATIONS })${o.homecare ? `
  await oneAgency()` : ''}
}${o.homecare ? `
import { sql } from 'drizzle-orm'
/** One agency per database: a row written without company_id gets the one company (see runUnifiedSuite homecare). */
async function oneAgency() {
  await db.execute(sql.raw("CREATE OR REPLACE FUNCTION sandbox_one_company() RETURNS text LANGUAGE sql AS $$ SELECT id FROM company ORDER BY created_at, id LIMIT 1 $$"))
  const cols: any = await db.execute(sql.raw("SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'company_id' AND column_default IS NULL"))
  for (const r of (cols.rows ?? cols)) await db.execute(sql.raw('ALTER TABLE "' + r.table_name + '" ALTER COLUMN company_id SET DEFAULT sandbox_one_company()'))
}` : ''}
`)
  // The app, built once per test file, signed in by header like the template stub.
  w('src/unified.ts', `
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { refuseWhileLocked } from '@twomiah/tenant-backend'
import { createApp } from '${rel}/server/app.ts'
import { loadVertical } from '${rel}/server/core/vertical.ts'
import { db } from '../db/index.ts'
import { user, company } from '../db/schema.ts'

const objects = new Map<string, { body: Buffer; type: string }>()
const store = {
  put: async (key: string, body: Buffer, type: string) => { objects.set(key, { body, type }); return '/files/' + key },
  getObject: async (key: string) => objects.get(key) ?? null,
  remove: async (key: string) => { objects.delete(key) },
}

/** x-test-user: the user by id, exactly as tests/harness/fixtures/middleware-auth.ts does; otherwise the real check. */
const bridge = (real: any) => async (c: any, next: any) => {${o.homecare ? `
  // Home care's stub: the person is the headers, no lookup (tests/harness/fixtures/middleware-auth.crm-homecare.ts).
  const hid = c.req.header('x-test-user')
  if (hid) {
    let companyId = c.req.header('x-test-company') || c.req.header('x-test-agency')
    if (!companyId) companyId = (await db.select({ id: company.id }).from(company).orderBy(company.createdAt).limit(1))[0]?.id
    c.set('user', { userId: hid, id: hid, companyId, agencyId: companyId, email: c.req.header('x-test-email') || hid + '@test.local', role: c.req.header('x-test-role') || 'caregiver' })
    const locked = await refuseWhileLocked(c, db, company)
    if (locked) return locked
    return next()
  }` : ''}
  const id = c.req.header('x-test-user')
  if (!id) return real(c, next)
  const [found] = await db.select({ id: user.id, companyId: user.companyId, email: user.email, role: user.role, isActive: user.isActive })
    .from(user).where(eq(user.id, id)).limit(1)
  if (!found || !found.isActive) return c.json({ error: 'User not found or inactive' }, 401)
  c.set('user', { userId: found.id, companyId: found.companyId, email: found.email, role: found.role })
  const locked = await refuseWhileLocked(c, db, company)
  if (locked) return locked
  await next()
}

const vertical = await loadVertical(process.env.SUITE_VERTICAL || '${o.vertical}')
export const unified = createApp({ db, vertical, store: store as any, testing: { authenticate: bridge, featureGates: false } })
export const services: any = unified.services
/** A template router by name: the unified app, which serves the same paths. */
export const forward = () => new Hono().all('*', (c) => unified.app.fetch(c.req.raw))
`)

  // Every router file the template has, by name.
  const routeNames = readdirSync(`${o.root}templates/${o.template}/backend/src/routes`).filter((f) => f.endsWith('.ts'))
  for (const f of routeNames) {
    const src = readFileSync(`${o.root}templates/${o.template}/backend/src/routes/${f}`, 'utf8')
    const named = [...src.matchAll(/^export const (\w+)/gm)].map((m) => m[1])
    const fns = o.routeModules?.[f] ? [...src.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]) : []
    const reexport = fns.length ? `export { ${fns.join(', ')} } from '${rel}/../${o.routeModules![f]}'\n` : ''
    w(`src/routes/${f}`, `import { forward } from '../unified.ts'\nexport default forward()\n${named.map((n) => `export const ${n} = forward()\n`).join('')}${reexport}`)
  }

  w('src/middleware/auth.ts', `
import { services } from '../unified.ts'
export const authenticate = services.authenticate
const role = (...roles: string[]) => async (c: any, next: any) => {
  const u = c.get('user'); if (!u || !roles.includes(u.role)) return c.json({ error: 'Insufficient permissions' }, 403); await next()
}
export const requireAdmin = role('owner', 'admin')
export const requireManager = role('owner', 'admin', 'manager')
export const requireRole = (...r: string[]) => role(...r)
export default authenticate
`)
  w('src/middleware/permissions.ts', `
import { services } from '../unified.ts'
const p = services.permissions
export const { requirePermission, requireAnyPermission, hasPermission, getExtraPermissions, invalidateExtraPermissions, getPermissions, normalizeRole, roleLabel, ROLE_HIERARCHY, requireRole } = p
export default p
`)
  w('src/middleware/enabledFeature.ts', `
import { services } from '../unified.ts'
export const { requireEnabledFeature, isFeatureEnabled, enabledFeaturesFor, forgetFeatures } = services.features
`)
  w('src/middleware/auditWrites.ts', `
import { createWriteAuditFloor } from '@twomiah/tenant-backend'
import { entityFromPath, actionFromPath, describeRequest } from '@twomiah/tenant-backend/src/audit/writeFloor.ts'
import { db } from '../../db/index.ts'
import * as schema from '../../db/schema.ts'
import { services } from '../unified.ts'
import { requestScope } from '${rel}/../server/core/audit.ts'
export { entityFromPath, actionFromPath, describeRequest }
export const auditWrites = createWriteAuditFloor({ db, schema, log: services.audit.log, scope: requestScope } as any)
`)
  // The newer templates' name for the same write floor.
  w('src/middleware/writeAudit.ts', `export { auditWrites as writeAudit } from './auditWrites.ts'\n`)
  w('src/utils/sanitize.ts', `export * from '${rel}/../server/core/sanitize.ts'\n`)
  w('src/utils/errors.ts', `export { errorHandler } from '${rel}/../server/http/errors.ts'\nexport const notFound = (message = 'Not found') => Object.assign(new Error(message), { status: 404 })\n`)
  w('src/services/audit.ts', `
import { services } from '../unified.ts'
export { requestScope } from '${rel}/../server/core/audit.ts'
export const { log, diff, ACTIONS, ENTITIES } = services.audit
export default services.audit
`)
  w('src/services/email.ts', `
import { services } from '../unified.ts'
import { crmTemplates } from '${rel}/../server/crm/messages.ts'
import { coreTemplates, inlineButtonColours as inline } from '${rel}/../server/core/email.ts'
// The app's one email service (core senders and the CRM's named ones on the same object).
const e = services.email
export const send = (...a: any[]) => e.send(...(a as [any, any, any, any])), sendRaw = (m: any) => e.sendRaw(m)
const brand = { companyName: 'Test Company', colourOnWhite: '#c2410c' }
/** The messages as the template exposed them: one argument, the company filled in. */
export const templates: any = Object.fromEntries(Object.entries({ ...coreTemplates, ...crmTemplates }).map(([k, t]) => [k, (d: any) => (t as any)(d, brand, process.env.FRONTEND_URL || '')]))
export const inlineButtonColours = (html: string) => inline(html, brand)
export default e
`)
  for (const [name, expr] of Object.entries({ sms: 'services.crm.sms', commissionEarner: 'services.crm.commissionEarner', stripe: 'services.crm.stripeService', reviews: 'services.crm.reviews', inventory: 'services.crm.inventory', recurring: 'services.crm.recurring' })) {
    w(`src/services/${name}.ts`, `import { services } from '../unified.ts'\nconst s = ${expr}\nexport default s\n`)
  }
  // Services the CRM's own modules build (server/crm/<group>/*Service.ts), made from the app's own dependencies.
  w('src/services/crmDeps.ts', `
import { db } from '../../db/index.ts'
import { services as s } from '../unified.ts'
import logger from '${rel}/../server/core/logger.ts'
export const crmDeps: any = { db, audit: s.audit, logger, authenticate: s.authenticate, permissions: s.permissions, features: s.features, realtime: s.realtime, services: s.crm }
`)
  // The suite's own extra files (a vertical's services the tests import by the template's paths).
  for (const [p, src] of Object.entries(o.sandboxFiles || {})) {
    // Its folder (e.g. src/helpers, which the template has and the sandbox does not make above).
    mkdirSync(`${SB}/${p.slice(0, p.lastIndexOf('/'))}`, { recursive: true })
    w(p, src.split('@app/').join(`${rel}/../`))
  }
  w('src/services/import.ts', `
import { crmDeps } from './crmDeps.ts'
import { createImportService } from '${rel}/../server/crm/office/importService.ts'
const svc: any = createImportService(crmDeps)
export const { importContacts, importProjects, importJobs, importProducts, importInvoices } = svc
export default svc
`)
  w('src/services/aiReceptionist.ts', `
import { crmDeps } from './crmDeps.ts'
import { createAiReceptionistService } from '${rel}/../server/crm/comms/aiReceptionistService.ts'
export * from '${rel}/../server/crm/comms/aiReceptionistService.ts'
const svc: any = createAiReceptionistService(crmDeps)
export const { getRules, createRule, updateRule, deleteRule, getSettings, upsertSettings, transcribeRecording, transcribeExistingCall, summarizeAndGenerateReply, evaluateRules, processRecordingWebhook } = svc
export default svc
`)
  // The shared package, by the paths the template vendors it at — re-exported, never copied: a copy is a second
  // module with its own state (the account-lock cache a test clears would not be the one the app reads).
  const SHARED = `${o.root}packages/tenant-backend/src`
  const shim = (dir: string) => {
    for (const e of readdirSync(`${SHARED}/${dir}`, { withFileTypes: true })) {
      const relPath = dir ? `${dir}/${e.name}` : e.name
      if (e.isDirectory()) { mkdirSync(`${SB}/src/shared/${relPath}`, { recursive: true }); shim(relPath); continue }
      if (!/\.ts$/.test(e.name) || /\.test\.ts$/.test(e.name)) continue
      const src = readFileSync(`${SHARED}/${relPath}`, 'utf8')
      const target = `@twomiah/tenant-backend/src/${relPath}`
      w(`src/shared/${relPath}`, `export * from '${target}'\n${/export default/.test(src) ? `export { default } from '${target}'\n` : ''}`)
    }
  }
  mkdirSync(`${SB}/src/shared`, { recursive: true })
  shim('')

  const tests = readdirSync(o.suiteDir).filter((f) => f.endsWith('.test.ts') && (!o.filter || f.includes(o.filter))).sort()
  for (const f of tests) cpSync(`${o.suiteDir}/${f}`, `${SB}/${f}`)
  if (!tests.length) { console.error(`FAIL: no test files${o.filter ? ` matching "${o.filter}"` : ''} in ${o.suiteDir}`); return 1 }

  let failedFiles = 0, assertions = 0, divergentFiles = 0
  const divergences = UNIFIED_DIVERGENCES[o.label] || {}
  const failedNames: string[] = []
  console.log(`running ${tests.length} file(s) of ${o.label} against the unified app (${o.vertical})\n`)
  for (const f of tests) {
    const r = spawnSync('bun', [f], {
      cwd: SB, encoding: 'utf8', shell: true,
      env: { ...process.env, TZ: 'UTC', NODE_ENV: 'test', FACTORY_ROOT: o.root, ANTHROPIC_API_KEY: '', SUITE_TEMPLATE: o.template, SUITE_UNIFIED: '1' },
    })
    const out = ((r.stdout || '') + (r.stderr || '')).replace(/\u001b\[[0-9;]*m/g, '')
    const line = out.split(/\r?\n/).reverse().find((l) => /\d+ passed, \d+ failed/.test(l)) || ''
    const passed = Number(/(\d+) passed/.exec(line)?.[1] || 0)
    const failed = Number(/(\d+) failed/.exec(line)?.[1] || 0)
    assertions += passed
    const ok = r.status === 0 && failed === 0 && !!line
    // A documented divergence (unified-divergences.ts): accepted only if EVERY failed assertion in the file is one it
    // names (or it names the whole file). Anything else failing beside them fails the run as usual.
    const d = divergences[f]
    const failedHere = out.split(/\r?\n/).map((l) => /^\s*FAIL (.+?)(\s+[\[{]|\s*$)/.exec(l)?.[1]?.trim()).filter(Boolean) as string[]
    const covered = !!d && (!d.assertions || (!!line && failedHere.length === failed && failedHere.every((n) => d.assertions!.some((re) => re.test(n)))))
    if (!ok && covered) {
      divergentFiles++
      console.log(`div  ${f}  ${line || '(whole file)'}`)
      console.log(`     documented: ${d!.why}`)
      console.log(`     held by: ${d!.heldBy}`)
      continue
    }
    if (!ok) {
      failedFiles++; failedNames.push(f)
      console.log(`FAIL ${f}  ${line || '(no summary — the file did not finish)'}`)
      const named = out.split(/\r?\n/).filter((l) => /^\s*FAIL |^error|Error:/.test(l))
      for (const l of named.slice(0, 12)) console.log('     ' + l.trim().slice(0, 220))
      if (!named.length) for (const l of out.split(/\r?\n/).filter((l) => l.trim()).slice(-10)) console.log('     | ' + l.trim().slice(0, 220))
    } else {
      console.log(`ok   ${f}  ${line}`)
    }
  }
  console.log(`\n${o.label} on unified: ${tests.length} file(s), ${assertions} assertions, ${failedFiles} file(s) failed, ${divergentFiles} documented divergence(s)`)
  if (failedNames.length) console.log('failed: ' + failedNames.join(' '))
  return failedFiles ? 1 : 0
}
