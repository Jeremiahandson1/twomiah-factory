// The rulebook's checks catch what they claim to: each test plants one violation in a fresh copy of the app and
// expects that rule, and only that rule, to fire. Two cases plant lookalikes that must NOT fire.
import { describe, test, expect } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkUnified } from '../../../scripts/check-unified-rules.ts'

const APP = path.resolve(import.meta.dir, '..')
const REPO = path.resolve(APP, '..', '..')

function copy(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-rules-'))
  fs.cpSync(APP, dir, { recursive: true, filter: (src) => !src.includes(`${path.sep}node_modules`) })
  fs.symlinkSync(fs.realpathSync(path.join(APP, 'node_modules')), path.join(dir, 'node_modules'), 'junction')
  return dir
}

function plant(edit: (dir: string) => void, drift = false) {
  const dir = copy()
  try {
    edit(dir)
    return checkUnified(dir, { drift, repoRoot: REPO })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

const write = (dir: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
  fs.writeFileSync(path.join(dir, rel), text)
}
const append = (dir: string, rel: string, text: string) => fs.appendFileSync(path.join(dir, rel), text)
const rules = (v: { rule: string }[]) => [...new Set(v.map((x) => x.rule))]
const STANDARD_ID = "  id: text('id').primaryKey().$defaultFn(() => createId()),\n"

describe('the clean app', () => {
  test('passes every check, schema drift included', () => {
    expect(plant(() => {}, true)).toEqual([])
  })
})

describe('each rule fires on its violation', () => {
  test('§1 a JavaScript source file', () => {
    expect(rules(plant((d) => write(d, 'server/core/legacy.js', 'export const x = 1\n')))).toEqual(['§1 language'])
  })

  test('§2 raw SQL outside server/data/', () => {
    expect(rules(plant((d) => write(d, 'server/core/report.ts', "import { sql } from 'drizzle-orm'\nexport const q = sql`SELECT 1`\n")))).toEqual(['§2 raw SQL'])
  })

  test('§2 a .execute( call outside server/data/', () => {
    expect(rules(plant((d) => write(d, 'server/core/report.ts', 'export const q = (db: any) => db.execute(1)\n')))).toEqual(['§2 raw SQL'])
  })

  test('§2 raw SQL inside server/data/ is allowed', () => {
    expect(plant((d) => write(d, 'server/data/report.ts', "import { sql } from 'drizzle-orm'\nexport const q = sql`SELECT 1`\n"))).toEqual([])
  })

  test('§3 a reply that bypasses reply.ts, under any name', () => {
    expect(rules(plant((d) => write(d, 'server/core/h.ts', 'export const h = (ctx: any) => ctx.json({ ok: 1 })\n')))).toEqual(['§3 reply shape'])
  })

  test('§3 reading a response (no arguments) and a comment mentioning c.json( are not replies', () => {
    expect(plant((d) => write(d, 'server/core/h.ts', '// c.json({ looks: "like a reply" })\nexport const read = async (r: Response) => await r.json()\n'))).toEqual([])
  })

  test('§4 a table named users', () => {
    expect(rules(plant((d) => append(d, 'server/db/schema/core.ts', `\nexport const people = pgTable('users', {\n${STANDARD_ID}})\n`)))).toEqual(['§4 names'])
  })

  test('§2 a camelCase column name', () => {
    expect(rules(plant((d) => append(d, 'server/db/schema/core.ts', `\nexport const thing = pgTable('thing', {\n${STANDARD_ID}  firstName: text('firstName'),\n})\n`)))).toEqual(['§2 naming'])
  })

  test('§2 a jsonb column', () => {
    expect(rules(plant((d) => append(d, 'server/db/schema/core.ts', `\nexport const thing = pgTable('thing', {\n${STANDARD_ID}  data: jsonb('data'),\n})\n`)))).toEqual(['§2 column types'])
  })

  test('§2 a timestamp with a time zone', () => {
    expect(rules(plant((d) => append(d, 'server/db/schema/core.ts', `\nexport const thing = pgTable('thing', {\n${STANDARD_ID}  at: timestamp('at', { withTimezone: true }),\n})\n`)))).toEqual(['§2 column types'])
  })

  test('§5 a primary key that is not the standard id', () => {
    expect(rules(plant((d) => append(d, 'server/db/schema/core.ts', `\nexport const thing = pgTable('thing', {\n  id: text('id').primaryKey(),\n})\n`)))).toEqual(['§5 ids'])
  })

  test('§6 a router mounted by hand', () => {
    expect(rules(plant((d) => write(d, 'server/core/m.ts', "export const m = (app: any, r: any) => app.route('/api/x', r)\n")))).toEqual(['§6 mounting'])
  })

  test('§6 composing a router at its own root is allowed', () => {
    expect(plant((d) => write(d, 'server/core/m.ts', ["import { Hono } from 'hono'", "export const m = (inner: any) => new Hono().route('/', inner)", ''].join(String.fromCharCode(10))))).toEqual([])
  })

  test('§6 an /api route declared by hand', () => {
    expect(rules(plant((d) => write(d, 'server/core/m.ts', "export const m = (app: any) => app.post('/api/x', () => null)\n")))).toEqual(['§6 mounting'])
  })

  test('§6 the admin screens calling a route are not declaring one', () => {
    expect(plant((d) => write(d, 'web/src/x.ts', "export const x = (api: any) => api.get('/api/site/pages')\n"))).toEqual([])
  })

  test('§7 drizzle-kit push in a script', () => {
    expect(rules(plant((d) => {
      const p = path.join(d, 'package.json')
      const pkg = JSON.parse(fs.readFileSync(p, 'utf8'))
      pkg.scripts['db:push'] = 'bunx drizzle-kit push'
      fs.writeFileSync(p, JSON.stringify(pkg, null, 2))
    }))).toEqual(['§7 migrations'])
  })

  test('§7 a schema change with no migration', () => {
    const v = plant((d) => {
      const p = path.join(d, 'server/db/schema/core.ts')
      fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace("  website: text('website'),", "  website: text('website'),\n  motto: text('motto'),"))
    }, true)
    expect(rules(v)).toEqual(['§7 migrations'])
    expect(v[0].detail).toContain('no migration records')
  })

  test('§8 a file in a vertical that is not settings or an add-on', () => {
    expect(rules(plant((d) => write(d, 'verticals/contractor/extra.ts', 'export const x = 1\n')))).toEqual(['§8 verticals'])
  })

  test('§8 an engine file copied into a vertical add-on', () => {
    expect(rules(plant((d) => write(d, 'verticals/contractor/addons/logger.ts', fs.readFileSync(path.join(d, 'server/core/logger.ts'), 'utf8'))))).toEqual(['§8 verticals'])
  })

  test('§8 a shared package file copied into a vertical add-on', () => {
    const src = path.join(REPO, 'packages/tenant-backend/src/auth/totp.ts')
    expect(rules(plant((d) => write(d, 'verticals/contractor/addons/totp.ts', fs.readFileSync(src, 'utf8'))))).toEqual(['§8 verticals'])
  })

  test('§8 one vertical importing another', () => {
    expect(rules(plant((d) => {
      write(d, 'verticals/salon/settings.ts', "export default { id: 'salon' }\n")
      write(d, 'verticals/contractor/addons/x.ts', "import salon from '../../salon/settings.ts'\nexport const y = salon\n")
    }))).toEqual(['§8 verticals'])
  })
})
