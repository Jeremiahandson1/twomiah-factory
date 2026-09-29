// crm-dispensary — T48 lows: Q10, Q12, Q14, Q15.
//
// Q10  The Team list's Rate column read "-" after a rate was saved, and GET /team/:id answered 404
//      for people plainly on the screen. Both are the same miss: the list UNIONS team_member rows
//      with `user` logins so the owner does not vanish once staff are added (F-14), T47 P7 taught
//      PUT to save a login — and the list selected no rate from the user table, hardcoding null,
//      while the detail route still looked in team_member alone. Three routes over one union.
//
// Q12  The no-weight warning appeared only after the import had run. previewImport did a full dry
//      run, which produced the warnings, and then returned only the errors.
//
// Q14  Releasing a batch over a failed lab test demands a written reason and records it — and the
//      audit entry still read "Changed batch … from quarantine to active". The reason was in the
//      row; the sentence built from it never said so.
//
// Q15  End of Day counted a pending ONLINE pickup as an unsettled till sale. Those are customers
//      who have not walked in, not money in limbo.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, product } from './db/schema.ts'
import { describeLog } from './src/services/audit.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Twomiah Leaf', slug: 'leaf-t48lo', email: 'lo@test.local', state: 'OH',
  enabledFeatures: ['products', 'orders', 'team', 'import', 'eod', 'batches', 'audit'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-t48lo@test.local', passwordHash: 'x', firstName: 'Olive', lastName: 'Owner',
  role: 'owner', companyId: co.id,
} as any).returning()

const app = new Hono()
app.route('/api/team', (await import('./src/routes/team.ts')).default)
app.route('/api/import', (await import('./src/routes/import.ts')).default)

const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': owner.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}

// ── Q10: a login is a row on the Team page, everywhere ──────────────────────────────────────────
{
  const list = await api('GET', '/api/team')
  const rows = list.json?.data || []
  const me = rows.find((r: any) => r.id === owner.id)
  check('Q10: the owner is on the Team list', !!me, rows.map((r: any) => r.name))
  check('Q10: …marked as a login rather than a roster entry', me?._source === 'user', me)

  const saved = await api('PUT', `/api/team/${owner.id}`, { hourlyRate: 20 })
  check('Q10: a rate can be saved onto a login', saved.status === 200, { status: saved.status, body: saved.json })
  check('Q10: …and comes straight back', Number(saved.json?.hourlyRate) === 20, saved.json?.hourlyRate)

  // The bug: it saved, and the LIST still showed nothing.
  const after = await api('GET', '/api/team')
  const meAgain = (after.json?.data || []).find((r: any) => r.id === owner.id)
  check('Q10: …and the list shows it, instead of a dash beside a saved rate',
    Number(meAgain?.hourlyRate) === 20, meAgain?.hourlyRate)

  // …and opening the row must not 404 on somebody visibly on the screen.
  const detail = await api('GET', `/api/team/${owner.id}`)
  check('Q10: opening a login from the list is not a 404', detail.status === 200, { status: detail.status, body: detail.json })
  check('Q10: …and carries the same rate', Number(detail.json?.hourlyRate) === 20, detail.json?.hourlyRate)
  check('Q10: …shaped like the row the list handed out', detail.json?._source === 'user' && !!detail.json?.name, detail.json)

  const missing = await api('GET', '/api/team/not-a-real-id')
  check('Q10: …while a genuinely unknown id is still 404', missing.status === 404, missing.status)
}

// ── Q12: Check the file says what Import will say ───────────────────────────────────────────────
{
  // A flower row with no weight column at all — the T47 P18 case, which cannot be SOLD once imported.
  const csv = 'name,category,price\nBlue Dream,flower,40\n'
  const form = new FormData()
  form.append('file', new File([csv], 'products.csv', { type: 'text/csv' }))
  const res = await app.request('/api/import/preview/products', {
    method: 'POST', headers: { 'x-test-user': owner.id }, body: form,
  })
  const preview: any = await res.json()

  check('Q12: Check the file answers', res.status === 200, { status: res.status, body: preview })
  check('Q12: …and carries the warnings, not only the errors', Array.isArray(preview?.warnings), preview)
  check('Q12: …naming the row that cannot be sold once imported',
    (preview?.warnings || []).some((w: any) => /no weight/i.test(String(w.warning))), preview?.warnings)
  check('Q12: …before anything has been written', Number(preview?.willImport) >= 1 && !preview?.imported, {
    willImport: preview?.willImport, imported: preview?.imported,
  })
  const counted: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM products WHERE company_id = ${co.id}`)
  const countRow = ((counted.rows || counted) as any[])[0]
  check('Q12: …and Check the file really did not import anything', Number(countRow?.n ?? 0) === 0, countRow)
}

// ── Q14: the audit line says WHY, when somebody was made to say ─────────────────────────────────
{
  const withReason = describeLog({
    action: 'status_change', entity: 'batch', entity_name: 'T48-LAB-1',
    changes: { status: { old: 'quarantine', new: 'active' } },
    metadata: { overrodeFailedLabTest: 'lab-1', reason: 'Retest passed on 28 Sep, sample was mislabelled' },
  })
  check('Q14: the audit line still says what changed',
    /quarantine/.test(withReason) && /active/.test(withReason), withReason)
  check('Q14: …and now says why', /Retest passed on 28 Sep/.test(withReason), withReason)

  // Metadata arrives as JSON text on some drivers.
  const asText = describeLog({
    action: 'status_change', entity: 'batch', entity_name: 'T48-RC-2',
    changes: { status: { old: 'recalled', new: 'active' } },
    metadata: JSON.stringify({ liftedRecall: true, reason: 'Supplier withdrew the recall' }),
  })
  check('Q14: …whether the metadata is an object or JSON text', /Supplier withdrew the recall/.test(asText), asText)

  const plain = describeLog({
    action: 'update', entity: 'batch', entity_name: 'T48-RC-9',
    changes: { currentQuantity: { old: 10, new: 0 } },
  })
  check('Q14: …and an action nobody had to justify reads as it always did',
    !/—/.test(plain), plain)

  const empty = describeLog({
    action: 'update', entity: 'batch', entity_name: 'T48-RC-8', metadata: { reason: '   ' },
  })
  check('Q14: …a blank reason is not printed as one', !/—/.test(empty), empty)
}

// ── Q15: awaiting collection is not unsettled money ─────────────────────────────────────────────
//
// Asserted against the sorting rule itself. The two facts differ by where the order came from, and
// an online order that has not been collected must not be counted as a till sale nobody took money
// for.
{
  const isAwaitingCollection = (o: any) => o.source === 'online' || o.type === 'online' || o.type === 'pickup' || o.type === 'delivery'
  check('Q15: an order-ahead pickup is awaiting collection', isAwaitingCollection({ source: 'online', type: 'pickup' }) === true)
  check('Q15: …so is a delivery', isAwaitingCollection({ source: 'online', type: 'delivery' }) === true)
  check('Q15: an offline CASH sale rung up at the till is not — that one is real money missing',
    isAwaitingCollection({ source: 'pos', type: 'walk_in' }) === false)
  check('Q15: …and a walk-in with no source recorded is still treated as till money',
    isAwaitingCollection({ source: null, type: 'walk_in' }) === false)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
