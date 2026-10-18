// ADAPTED COPY of tests/crm/comments-gate.test.ts, for the unified app (tests/unified/harness/adapted.ts). Unchanged except the
// 1 read(s) marked "unified:", where the rulebook's reply shapes replaced the template's. The original keeps
// running against the template; tests/unified/harness/unified-divergences.ts names the assertions this copy stands in for.
// The comments router had no permission check on any route: any signed-in seat could post, edit and react, and read
// every record's comments and the company-wide activity feed. Nothing in the product calls it — no screen, no mobile
// client — so no round ever drove it. Now each route asks the question of the record the comment is on.
//
// Asserted through the real router, for owner / admin / manager / field / viewer, on three kinds of record:
//   · each answer is exactly what that seat's permissions say (the matrix, read from the template's own
//     hasPermission) — a 2xx when it holds the permission, a 403 when it does not;
//   · and a refusal WRITES NOTHING: the comment table is counted after every refused post, edit, react and delete;
//   · anchors that do not depend on the matrix: a viewer cannot post (the reported fault); a field seat cannot read
//     comments on an invoice; the feed is the owner's and admin's; another company's comment is a 404, not a reaction.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user } = await import('./db/schema.ts')
const { hasPermission } = await import('./src/middleware/permissions.ts') as any

const [co] = await db.insert(company).values({ name: 'Gate Co', slug: 'gate-co-comments', email: 'gate@test.local', state: 'OH', settings: {}, enabledFeatures: [] } as any).returning()
const [other] = await db.insert(company).values({ name: 'Other Co', slug: 'other-co-comments', email: 'other@test.local', state: 'OH', settings: {}, enabledFeatures: [] } as any).returning()
const seat = async (role: string, companyId = co.id) => (await db.insert(user).values({ email: `${role}-${companyId.slice(0, 6)}@gate.local`, passwordHash: 'x', firstName: role, lastName: 'Seat', role, companyId, isActive: true } as any).returning())[0]
const seats: Record<string, any> = {}
for (const r of ['owner', 'admin', 'manager', 'field', 'viewer']) seats[r] = await seat(r)
const outsider = await seat('owner', other.id)

const app = new Hono()
app.route('/api/comments', (await import('./src/routes/comments.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const count = async () => Number((((await db.execute(sql`SELECT COUNT(*)::int AS n FROM comment WHERE company_id = ${co.id}`)) as any).rows || [])[0]?.n ?? (await db.execute(sql`SELECT COUNT(*)::int AS n FROM comment WHERE company_id = ${co.id}`) as any)[0]?.n)
const holds = (role: string, perm: string) => hasPermission(role, perm, [])

// one comment per record kind, written by the owner, so every seat has something to read, edit, react to, delete
const RECORDS = [['job', 'jobs'], ['invoice', 'invoices'], ['contact', 'contacts']] as const
const seeded: Record<string, string> = {}
for (const [type] of RECORDS) {
  const r = await as(seats.owner)('POST', `/api/comments/${type}/rec-1`, { content: `owner note on a ${type}` })
  check(`owner posts on a ${type} (201)`, r.status === 201, r.text.slice(0, 160))
  seeded[type] = r.json?.id
}

// ── the matrix: every seat, every kind of record, every route ──────────────────────────────────────
for (const [role, who] of Object.entries(seats)) {
  for (const [type, resource] of RECORDS) {
    const read = holds(role, `${resource}:read`), write = holds(role, `${resource}:update`)
    const g = await as(who)('GET', `/api/comments/${type}/rec-1`)
    check(`${role} reads ${type} comments: ${read ? 'allowed' : 'refused'} (${resource}:read) → ${g.status}`, read ? g.status === 200 : g.status === 403, g.text.slice(0, 120))
    const ga = await as(who)('GET', `/api/comments/activity/${type}/rec-1`)
    check(`${role} reads ${type} activity: ${read ? 'allowed' : 'refused'} → ${ga.status}`, read ? ga.status === 200 : ga.status === 403, ga.text.slice(0, 120))

    const before = await count()
    const p = await as(who)('POST', `/api/comments/${type}/rec-1`, { content: `${role} on a ${type}` })
    const after = await count()
    check(`${role} posts on a ${type}: ${write ? 'allowed' : 'refused'} (${resource}:update) → ${p.status}`, write ? p.status === 201 && after === before + 1 : p.status === 403 && after === before, { status: p.status, before, after })
    if (write && p.json?.id) {
      const e = await as(who)('PUT', `/api/comments/${p.json.id}`, { content: 'edited' })
      check(`${role} edits their own ${type} comment (200)`, e.status === 200 && e.json?.content === 'edited', e.text.slice(0, 120))
      const d = await as(who)('DELETE', `/api/comments/${p.json.id}`)
      check(`${role} deletes their own ${type} comment (204)`, d.status === 204 && (await count()) === before, { status: d.status })
    }
    const rx = await as(who)('POST', `/api/comments/${seeded[type]}/react`, { reaction: 'like' })
    check(`${role} reacts on a ${type} comment: ${write ? 'allowed' : 'refused'} → ${rx.status}`, write ? rx.status === 200 : rx.status === 403, rx.text.slice(0, 120))
    if (write && rx.status === 200) await as(who)('POST', `/api/comments/${seeded[type]}/react`, { reaction: 'like' }) // toggle back
    // someone else's comment: only company:update may remove it
    const mod = holds(role, 'company:update')
    const b2 = await count()
    const del = role === 'owner' ? null : await as(who)('DELETE', `/api/comments/${seeded[type]}`)
    if (del) {
      const a2 = await count()
      if (mod) {
        check(`${role} (company:update) removes the owner's ${type} comment (204)`, del.status === 204 && a2 === b2 - 1, { status: del.status })
        const re = await as(seats.owner)('POST', `/api/comments/${type}/rec-1`, { content: `owner note on a ${type}` }); seeded[type] = re.json?.id
      } else {
        check(`${role} cannot remove the owner's ${type} comment (${del.status}) — and it is still there`, (del.status === 403 || del.status === 404) && a2 === b2, { status: del.status, b2, a2 })
      }
    }
  }
  const feed = await as(who)('GET', '/api/comments/activity/feed')
  const trail = await as(who)('GET', `/api/comments/activity/user/${seats.owner.id}`)
  const audit = holds(role, 'audit:read')
  check(`${role}: the company-wide feed and a person's trail — ${audit ? 'allowed' : 'refused'} (audit:read) → ${feed.status}, ${trail.status}`, audit ? feed.status === 200 && trail.status === 200 : feed.status === 403 && trail.status === 403, { feed: feed.status, trail: trail.status })
}

// ── anchors that do not lean on the matrix ─────────────────────────────────────────────────────────
{
  const b = await count()
  const r = await as(seats.viewer)('POST', '/api/comments/job/rec-1', { content: 'a viewer writing' })
  check('THE REPORT: a viewer cannot post a comment (403), and nothing is written', r.status === 403 && (await count()) === b, { status: r.status })
  const f = await as(seats.field)('GET', '/api/comments/invoice/rec-1')
  check('a field seat cannot read the comments on an invoice (no invoices:read)', f.status === 403 && !holds('field', 'invoices:read'), f.status)
  const m = await as(seats.manager)('GET', '/api/comments/activity/feed')
  check('the company-wide feed is not a manager\'s (audit:read is owner/admin)', m.status === 403, m.status)
  const own = await as(seats.owner)('GET', '/api/comments/activity/feed')
  check('…and is the owner\'s', own.status === 200 && Array.isArray(own.json?.data) /* unified: the feed is a list reply: its entries are data, not activities */, own.text.slice(0, 120))
  const u = await as(seats.manager)('POST', '/api/comments/not-a-resource/x', { content: 'x' })
  check('a record type no permission names is refused below the owner (fails closed)', u.status === 403, u.status)
  const bad = await as(seats.owner)('GET', '/api/comments/Robert%27);DROP/x')
  check('a record type that is not a name is a 400', bad.status === 400, bad.status)
  const x = await as(outsider)('POST', `/api/comments/${seeded.job}/react`, { reaction: 'like' })
  const xr = Number(((await db.execute(sql`SELECT COUNT(*)::int AS n FROM comment_reaction WHERE comment_id = ${seeded.job}`)) as any).rows?.[0]?.n ?? 0)
  check('another company\'s owner reacting to this company\'s comment gets a 404 — and no reaction lands', x.status === 404 && xr === 0, { status: x.status, xr })
  const xe = await as(outsider)('PUT', `/api/comments/${seeded.job}`, { content: 'hijack' })
  check('…nor can they edit it', xe.status === 404, xe.status)
}

// ── the same file in every template that mounts it ─────────────────────────────────────────────────
{
  const { readFileSync } = await import('node:fs')
  const ROOT = (() => { const r = process.env.FACTORY_ROOT; if (!r) throw new Error('FACTORY_ROOT is not set'); return r.endsWith('/') ? r : r + '/' })()
  const norm = (s: string) => s.replace(/\r\n/g, '\n')
  const base = norm(readFileSync(ROOT + 'templates/crm/backend/src/routes/comments.ts', 'utf8'))
  for (const t of ['crm-basic', 'crm-fieldservice', 'crm-landscaping', 'crm-restaurant', 'crm-rv', 'crm-salon', 'crm-vet']) {
    check(`${t}: the comments router is the gated one`, norm(readFileSync(`${ROOT}templates/${t}/backend/src/routes/comments.ts`, 'utf8')) === base)
  }
  check('no route in it is left without a permission question', (base.match(/^app\.(get|post|put|delete)\(/gm) || []).length === (base.match(/^app\.(get|post|put|delete)\([^\n]*\n(?:[^\n]*\n){0,8}?[^\n]*(?:may\(c, |refuse\()/gm) || []).length)
}

console.log(`\ncomments gate: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
