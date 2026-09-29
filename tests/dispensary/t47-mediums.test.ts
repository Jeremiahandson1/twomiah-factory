// crm-dispensary — T47 P6, P7, P11. Three screens that could not save what they showed.
//
// P6  The Orders "Online" tab sends type=online and found nothing, because an order placed on the
//     public menu is a PICKUP or a DELIVERY carrying source 'online' — "online" is where an order came
//     from, not what kind it is. Analytics counted 0 online with three online orders that day.
// P7  Team → Edit → Save answered "Team member not found" for every member. The Team list unions
//     team_member rows with `user` logins (so the owner does not vanish once staff are added) and PUT
//     only ever looked in team_member. On a shop where staff have logins — most shops — nothing on
//     that page could be edited. Payroll reads COALESCE(u.hourly_rate, tm.hourly_rate, 0), so every
//     rate stayed null and every gross pay came out $0.
// P11 GET /security/mfa/backup-codes REPLACED the owner's recovery codes on every call. Opening the
//     address — a refresh, a prefetch, a link out of the logs — silently invalidated the ten codes
//     they had printed and put in a drawer.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, product } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Twomiah Leaf', slug: 'leaf-t47md', email: 'md@test.local', state: 'OH',
  enabledFeatures: ['products', 'orders', 'team', 'security', 'analytics', 'scheduling'],
} as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-t47md@test.local`, passwordHash: 'x', firstName: tag, lastName: 'Staff', role, companyId: co.id,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const bud = await mkUser('budtender', 'sam')

const [cust] = await db.insert(contact).values({ name: 'Ordering Olive', type: 'customer', companyId: co.id } as any).returning()
const [flower] = await db.insert(product).values({
  name: 'Blue Dream', companyId: co.id, category: 'flower', price: '35', weightGrams: '3.5',
  stockQuantity: 100, taxCategory: 'cannabis', trackInventory: true,
} as any).returning()

const app = new Hono()
app.route('/api/orders', (await import('./src/routes/orders.ts')).default)
app.route('/api/team', (await import('./src/routes/team.ts')).default)
app.route('/api/security', (await import('./src/routes/security.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)

const as = (u: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': u.id, 'x-test-company': co.id, 'x-test-role': u.role },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const api = as(owner)
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }

// ═════════════ P6 · "online" is where an order came from, not what kind it is ════════════════════
{
  // An order-ahead order: a PICKUP, placed on the public menu.
  const made = await api('POST', '/api/orders', {
    items: [{ productId: flower.id, quantity: 1 }], orderType: 'pickup', contactId: cust.id,
  })
  const id = (made.json?.data || made.json)?.id
  await db.execute(sql`UPDATE orders SET source = 'online' WHERE id = ${id}`)

  // …and an ordinary walk-in beside it.
  await api('POST', '/api/orders', { items: [{ productId: flower.id, quantity: 1 }], orderType: 'walk_in' })

  const online = await api('GET', '/api/orders?type=online')
  const found = (online.json?.data || []) as any[]
  check('P6: the Online tab finds the order-ahead order — it used to find nothing', found.length === 1, found.length)
  check('P6: …and it is the pickup that came from the menu', found[0]?.id === id, { got: found[0]?.id, want: id })

  const bySource = await api('GET', '/api/orders?source=online')
  check('P6: …and source can be asked for directly', (bySource.json?.data || []).length === 1, (bySource.json?.data || []).length)

  const walkIns = await api('GET', '/api/orders?type=walk_in')
  check('P6: …while walk_in still means walk_in', (walkIns.json?.data || []).every((o: any) => o.type === 'walk_in'))

  const all = await api('GET', '/api/orders')
  check('P6: …and an unfiltered list still has both', (all.json?.data || []).length === 2, (all.json?.data || []).length)
}

// ══════════════════ P7 · the Team page can edit the people it lists ═════════════════════════════
{
  const list = await api('GET', '/api/team')
  const listed = (list.json?.data || []) as any[]
  check('P7: the Team list includes the logins', listed.some((m) => m.id === bud.id), listed.map((m) => m.name))

  const before = await api('PUT', `/api/team/${bud.id}`, { name: 'Sam Staff', hourlyRate: 18.5 })
  check('P7: …and saving one works — it answered "Team member not found" for every member', before.status === 200,
    { status: before.status, body: before.json })

  const [account] = await rows(sql`SELECT hourly_rate, first_name FROM "user" WHERE id = ${bud.id}`)
  check('P7: …the rate lands on the LOGIN, which is where payroll reads it first',
    Math.round(Number(account?.hourly_rate) * 100) === 1850, account?.hourly_rate)

  // The Team dialog posts the whole form every time, empty strings and all. Refusing that would
  // break the screen this is fixing.
  const wholeForm = await api('PUT', `/api/team/${bud.id}`, {
    name: 'Sam Staff', email: bud.email, phone: '', role: 'budtender', department: '', hourlyRate: 19,
  })
  check('P7: …and the dialog\'s own payload, blank fields included, is accepted', wholeForm.status === 200, wholeForm.json)

  // …but a field a login genuinely does not have is refused rather than silently dropped.
  const nonsense = await api('PUT', `/api/team/${bud.id}`, { department: 'Back of house' })
  check('P7: a field a login does not carry is refused, not swallowed', nonsense.status === 400, nonsense.json)
  check('P7: …naming it', /department/.test(String(nonsense.json?.error)), nonsense.json?.error)

  // Two things nobody should do to themselves on a staff screen.
  const selfRole = await api('PUT', `/api/team/${owner.id}`, { role: 'budtender' })
  check('P7: you cannot change your own role', selfRole.status === 400, selfRole.json)
  const selfOff = await api('PUT', `/api/team/${owner.id}`, { active: false })
  check('P7: …or deactivate yourself', selfOff.status === 400, selfOff.json)

  const stranger = await api('PUT', '/api/team/not-a-person', { name: 'X' })
  check('P7: an id belonging to nobody is still a 404', stranger.status === 404, stranger.status)
}

// ══════════════════ P7b · another tenant's login is not ours to edit ═════════════════════════════
{
  const [rival] = await db.insert(company).values({ name: 'Rival', slug: 'leaf-t47md2', email: 'r@test.local', enabledFeatures: ['team'] } as any).returning()
  const theirs = (await db.insert(user).values({
    email: 'theirs-t47md@test.local', passwordHash: 'x', firstName: 'T', lastName: 'Heirs', role: 'budtender', companyId: rival.id,
  } as any).returning())[0]
  const reach = await api('PUT', `/api/team/${theirs.id}`, { hourlyRate: 99 })
  check('P7: a login in another company cannot be edited from here', reach.status === 404, reach.status)
  const [untouched] = await rows(sql`SELECT hourly_rate FROM "user" WHERE id = ${theirs.id}`)
  check('P7: …and is untouched', untouched?.hourly_rate === null, untouched?.hourly_rate)
}

// ═══════════════ P11 · reading recovery codes does not destroy them ══════════════════════════════
{
  const made = await api('POST', '/api/security/mfa/backup-codes', { confirm: true })
  check('P11: codes are generated by a POST', made.status === 200, made.json)
  check('P11: …ten of them, shown once', (made.json?.codes || []).length === 10, made.json?.codes?.length)

  const [stored] = await rows(sql`SELECT backup_codes FROM mfa_devices WHERE user_id = ${owner.id} AND type = 'backup_codes'`)
  const first = Array.isArray(stored?.backup_codes) ? stored.backup_codes : JSON.parse(stored?.backup_codes || '[]')

  // The whole bug: opening the address used to replace them.
  const read1 = await api('GET', '/api/security/mfa/backup-codes')
  const read2 = await api('GET', '/api/security/mfa/backup-codes')
  check('P11: reading tells you how many are on file', read1.json?.remaining === 10, read1.json)
  check('P11: …and gives away no code', !('codes' in (read1.json || {})), Object.keys(read1.json || {}))
  check('P11: …and says what generating again would cost', /replaces|stops working/i.test(String(read1.json?.hint)), read1.json?.hint)

  const [after] = await rows(sql`SELECT backup_codes FROM mfa_devices WHERE user_id = ${owner.id} AND type = 'backup_codes'`)
  const now = Array.isArray(after?.backup_codes) ? after.backup_codes : JSON.parse(after?.backup_codes || '[]')
  check('P11: READING TWICE LEFT THE CODES ALONE — this is the whole finding',
    JSON.stringify(now) === JSON.stringify(first), { before: first.length, after: now.length, same: JSON.stringify(now) === JSON.stringify(first) })
  check('P11: …and there is still exactly one set', (await rows(sql`SELECT id FROM mfa_devices WHERE user_id = ${owner.id} AND type = 'backup_codes'`)).length === 1)

  // Replacing them is destructive, so it has to be meant.
  const unconfirmed = await api('POST', '/api/security/mfa/backup-codes', {})
  check('P11: regenerating without confirming is refused', unconfirmed.status === 400, unconfirmed.json)
  check('P11: …warning that the existing set dies', /stop working|replaces/i.test(String(unconfirmed.json?.error)), unconfirmed.json?.error)
  const [stillThere] = await rows(sql`SELECT backup_codes FROM mfa_devices WHERE user_id = ${owner.id} AND type = 'backup_codes'`)
  const stillNow = Array.isArray(stillThere?.backup_codes) ? stillThere.backup_codes : JSON.parse(stillThere?.backup_codes || '[]')
  check('P11: …and the refusal changed nothing', JSON.stringify(stillNow) === JSON.stringify(first))

  const replaced = await api('POST', '/api/security/mfa/backup-codes', { confirm: true })
  check('P11: …while a confirmed one does replace them', replaced.status === 200 && (replaced.json?.codes || []).length === 10)
  const [final] = await rows(sql`SELECT backup_codes FROM mfa_devices WHERE user_id = ${owner.id} AND type = 'backup_codes'`)
  const finalCodes = Array.isArray(final?.backup_codes) ? final.backup_codes : JSON.parse(final?.backup_codes || '[]')
  check('P11: …with a genuinely new set', JSON.stringify(finalCodes) !== JSON.stringify(first))
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
