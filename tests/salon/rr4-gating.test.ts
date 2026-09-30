// crm-salon — RR4 M1 (the modules were never behind their switch) and L3 (a stylist could delete a
// kept formula).
//
// M1. /api/time, /api/time/clock-in, /api/expenses and /api/expenses/summary all answered 200 on a
// tenant whose 21 enabled features included neither time tracking nor expenses, while every other
// switched-off module answered 403 FEATURE_NOT_ENABLED. Both screens were in the sidebar too.
//
// It was never a salon bug. crm, crm-basic, crm-fieldservice and crm-landscaping mount the same two
// modules the same ungated way, and have for a long time — adding them to the salon only made it
// visible. The registry also did not offer either feature to crm-salon, so even an owner who wanted
// them could not have switched them on. All three of those are fixed together, because a gate on one
// side is not a gate: the API refuses it, the nav hides it, and the registry lets the owner choose.
//
// L3. Removing a kept formula asked for `contacts:update`, which a stylist holds. A kept formula is
// the salon's record of what went on a client's hair and there is no undo. Adding stays open — that
// is the stylist's job — and removing now asks for `contacts:delete`, which managers, admins and
// owners hold and stylists do not. A permission, not a rank: a shop that grants a senior stylist
// extra permissions gets the behaviour it asked for, which a minRole check would quietly override.
import { Hono } from 'hono'
import { readFileSync } from 'node:fs'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'
import { requireEnabledFeature } from './src/middleware/enabledFeature.ts'
import { authenticate } from './src/middleware/auth.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const mk = async (slug: string, features: string[]) => {
  const [co] = await db.insert(company).values({ name: 'RR4 ' + slug, slug, email: `${slug}@test.local`, state: 'OH', settings: {}, enabledFeatures: features } as any).returning()
  const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
    email: `${tag}-${slug}@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
  } as any).returning())[0]
  return { co, owner: await mkUser('owner', 'own'), manager: await mkUser('manager', 'mgr'), stylist: await mkUser('field', 'sty') }
}

// Mounted the way index.ts mounts it: the gate is middleware in front of the route, not inside it.
// The route files have no opinion about features, which is exactly why "the route looks fine" was
// never evidence.
const app = new Hono()
app.use('/api/time', authenticate, requireEnabledFeature('time_tracking'))
app.use('/api/time/*', authenticate, requireEnabledFeature('time_tracking'))
app.use('/api/expenses', authenticate, requireEnabledFeature('expense_tracking'))
app.use('/api/expenses/*', authenticate, requireEnabledFeature('expense_tracking'))
app.route('/api/time', (await import('./src/routes/time.ts')).default)
app.route('/api/expenses', (await import('./src/routes/expenses.ts')).default)
app.route('/api/clients', (await import('./src/routes/clients.ts')).default)
app.onError(errorHandler)

const call = async (who: any, method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)

// ══════════ M1 · with the features OFF — the tenant the tester was on ═══════════════════════════
{
  const { owner } = await mk('rr4-off', ['contacts', 'invoices', 'scheduling', 'team', 'dashboard'])

  for (const [method, path] of [
    ['GET', '/api/time'],
    ['GET', '/api/time/summary'],
    ['POST', '/api/time/clock-in'],
    ['GET', '/api/expenses'],
    ['GET', '/api/expenses/summary'],
  ] as Array<[string, string]>) {
    const r = await call(owner, method, path)
    check(`${method} ${path} is refused with the feature off — it used to answer 200`, r.status === 403,
      { status: r.status, body: r.json })
    check(`…and says WHY, the same way every other switched-off module does`,
      /FEATURE_NOT_ENABLED|feature/i.test(JSON.stringify(r.json)), r.json)
  }
}

// ══════════ …and with them ON. A gate has to be verified BOTH ways ══════════════════════════════
//
// A gate that refuses everything is not a working gate, it is a broken module — and that mistake
// would look identical to a pass in the block above.
{
  const { owner, stylist } = await mk('rr4-on', ['contacts', 'team', 'time_tracking', 'expense_tracking'])

  const list = await call(owner, 'GET', '/api/time')
  check('GET /api/time is allowed with time_tracking on', list.status === 200, { status: list.status, body: list.json })
  const logged = await call(stylist, 'POST', '/api/time', { hours: 2, date: yesterday, description: 'RR4 gate probe' })
  check('…and a stylist can log hours', logged.status === 200 || logged.status === 201, { status: logged.status, body: logged.json })

  const exp = await call(owner, 'GET', '/api/expenses')
  check('GET /api/expenses is allowed with expense_tracking on', exp.status === 200, { status: exp.status, body: exp.json })
  const spent = await call(stylist, 'POST', '/api/expenses', { category: 'stock', description: 'RR4 gate probe', amount: 10, date: yesterday })
  check('…and a stylist can add one', spent.status === 200 || spent.status === 201, { status: spent.status, body: spent.json })

  // One feature on and the other off must not carry each other.
  const { owner: o2 } = await mk('rr4-time-only', ['contacts', 'team', 'time_tracking'])
  check('time on, expenses off: /api/time answers', (await call(o2, 'GET', '/api/time')).status === 200, null)
  check('…and /api/expenses is still refused', (await call(o2, 'GET', '/api/expenses')).status === 403, null)
}

// ══════════ …and the wiring really is in index.ts, in every template that mounts them ═══════════
//
// The block above proves the middleware refuses. It cannot prove index.ts actually puts it in front
// of the route — which was the entire bug. This reads the source of all five.
{
  const root = (() => { const r = process.env.FACTORY_ROOT; if (!r) throw new Error('FACTORY_ROOT is not set'); return r.endsWith('/') ? r : r + '/' })()
  for (const t of ['crm', 'crm-basic', 'crm-fieldservice', 'crm-landscaping', 'crm-salon']) {
    const src = readFileSync(`${root}templates/${t}/backend/src/index.ts`, 'utf8').replace(/\r\n/g, '\n')
    check(`${t}: /api/time is gated on time_tracking`,
      /app\.use\('\/api\/time', *authenticate, *requireEnabledFeature\('time_tracking'\)\)/.test(src), null)
    check(`${t}: …including its sub-paths, which is where clock-in lives`,
      /app\.use\('\/api\/time\/\*', *authenticate, *requireEnabledFeature\('time_tracking'\)\)/.test(src), null)
    check(`${t}: /api/expenses is gated on expense_tracking`,
      /app\.use\('\/api\/expenses', *authenticate, *requireEnabledFeature\('expense_tracking'\)\)/.test(src), null)
    check(`${t}: …including its sub-paths`,
      /app\.use\('\/api\/expenses\/\*', *authenticate, *requireEnabledFeature\('expense_tracking'\)\)/.test(src), null)

    // ── and the gate is registered BEFORE its route, which is the whole of the rule ─────────────
    //
    // Hono runs handlers in registration order, so a gate declared below its route never executes:
    // the route has already answered. The first version of this fix left app.route('/api/expenses')
    // above the app.use lines in crm-salon, every assertion above passed, and the LIVE tenant went
    // on serving the expense sheet with the feature off. The sandbox could not see it either,
    // because the block higher up mounts the middleware itself rather than using index.ts.
    //
    // Presence was never the property. Order is.
    for (const [mount, feature] of [['time', 'time_tracking'], ['expenses', 'expense_tracking']] as Array<[string, string]>) {
      const gateAt = src.indexOf(`app.use('/api/${mount}', authenticate, requireEnabledFeature('${feature}')`)
      const routeAt = src.indexOf(`app.route('/api/${mount}', `)
      check(`${t}: the /api/${mount} gate is registered BEFORE the route, or it never runs`,
        gateAt !== -1 && routeAt !== -1 && gateAt < routeAt, { gateAt, routeAt })
    }

    // Both sides of the switch. A gated API with an ungated nav entry still shows the link.
    const nav = readFileSync(`${root}templates/${t}/frontend/src/shellConfig.ts`, 'utf8').replace(/\r\n/g, '\n')
    const timeItem = nav.match(/\{[^}]*to: '\/crm\/time'[^}]*\}/)?.[0] || ''
    const expItem = nav.match(/\{[^}]*to: '\/crm\/expenses'[^}]*\}/)?.[0] || ''
    check(`${t}: the Time nav entry is feature-gated too`, /features: \['time_tracking'\]/.test(timeItem), timeItem)
    check(`${t}: the Expenses nav entry is feature-gated too`, /features: \['expense_tracking'\]/.test(expItem), expItem)
  }

  // …and the registry OFFERS them to the salon, or an owner could never switch them on.
  const reg = readFileSync(`${root}packages/tenant-backend/src/featureRegistry.ts`, 'utf8')
  const timeDef = reg.match(/\{ id: 'time_tracking'[^\n]*/)?.[0] || ''
  const expDef = reg.match(/\{ id: 'expense_tracking'[^\n]*/)?.[0] || ''
  check('the registry offers time_tracking to crm-salon', /crm-salon/.test(timeDef), timeDef)
  check('the registry offers expense_tracking to crm-salon', /crm-salon/.test(expDef), expDef)
}

// ══════════ L3 · removing a kept formula is not a stylist's to do ═══════════════════════════════
{
  const { owner, manager, stylist } = await mk('rr4-l3', ['contacts', 'team'])
  const [client] = await db.insert(contact).values({
    type: 'client', name: 'RR4 Dbl', companyId: (await db.select().from(company).where((await import('drizzle-orm')).eq(company.slug, 'rr4-l3'))).at(0)!.id,
  } as any).returning()

  const added = await call(stylist, 'POST', `/api/clients/${client.id}/formulas`, { formula: '5N + 20vol', label: 'RR4 kept' })
  check('a stylist can still ADD a formula — that is the job', added.status === 200 || added.status === 201,
    { status: added.status, body: added.json })
  const list = (added.json?.formulas || []) as any[]
  const fid = list[0]?.id
  check('…and it is on the card', !!fid, added.json)

  if (fid) {
    const byStylist = await call(stylist, 'DELETE', `/api/clients/${client.id}/formulas/${fid}`)
    check('a stylist REMOVING one is refused — it used to answer 200', byStylist.status === 403,
      { status: byStylist.status, body: byStylist.json })

    const stillThere = await call(manager, 'GET', `/api/clients/${client.id}/formulas`)
    const kept = (stillThere.json?.formulas || stillThere.json?.data || stillThere.json || []) as any[]
    check('…and the formula is still on the card', Array.isArray(kept) && kept.some((f: any) => f.id === fid), kept)

    const byManager = await call(manager, 'DELETE', `/api/clients/${client.id}/formulas/${fid}`)
    check('a manager can remove it', byManager.status === 200, { status: byManager.status, body: byManager.json })
  }

  // The owner path, because a rule that only a manager can exercise strands a one-person salon.
  const again = await call(owner, 'POST', `/api/clients/${client.id}/formulas`, { formula: '7N + 10vol', label: 'RR4 kept 2' })
  const fid2 = (again.json?.formulas || [])[0]?.id
  if (fid2) {
    const byOwner = await call(owner, 'DELETE', `/api/clients/${client.id}/formulas/${fid2}`)
    check('and so can the owner', byOwner.status === 200, { status: byOwner.status, body: byOwner.json })
  }
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
