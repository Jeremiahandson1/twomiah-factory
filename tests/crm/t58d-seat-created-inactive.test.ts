// T58d — "isActive:false being ignored."
//
// It was. `POST /api/company/users` declared email, password, firstName, lastName, phone and role,
// and nothing else — and zod strips what it does not declare. So a request asking for a SUSPENDED
// seat got a 201 and a fully working login. Nothing refused it and nothing reported it: the 201 that
// came back did not even include isActive, so there was no way to tell from the response.
//
// The edit route three handlers down has honoured isActive all along — it is what Revoke access
// uses. This is the same field being real on one door and discarded on the other, which is the rule
// about create and edit agreeing, read the other way round.
//
// The seat cap is the half worth testing hardest. It counts users who can SIGN IN, because that is
// what a plan charges for — so creating a suspended account must not be refused on a full plan.
// Getting that backwards would make the one safe thing an admin can do (add someone, switched off,
// ready for Monday) impossible exactly when they need it.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user } = await import('./db/schema.ts')
const { eq } = await import('drizzle-orm')

const [co] = await db.insert(company).values({
  name: 'Seat Cap', slug: 'seat-cap', email: 'sc@test.local', state: 'OH', settings: {},
  enabledFeatures: ['team'],
} as any).returning()

const mk = async (role: string, tag: string, isActive = true) => (await db.insert(user).values({
  email: `${tag}-sc@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id, isActive,
} as any).returning())[0]

const owner = await mk('owner', 'owner')

const app = new Hono()
app.route('/api/company', (await import('./src/routes/company.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const asOwner = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const storedActive = async (email: string) =>
  (await db.select().from(user).where(eq(user.email, email)).limit(1))[0]?.isActive

// ══════════ 1. a seat asked for INACTIVE is created inactive ════════════════════════════════════
{
  const made = await asOwner('POST', '/api/company/users', {
    email: 'suspended-sc@test.local', password: 'LongEnough123', firstName: 'Sus', lastName: 'Pended',
    role: 'manager', isActive: false,
  })
  check('creating a suspended seat is accepted', made.status === 201, made)
  check('…and the STORED row is inactive', (await storedActive('suspended-sc@test.local')) === false,
    { stored: await storedActive('suspended-sc@test.local') })
  check('…and the response says so, so the caller can tell', made.json?.isActive === false, made.json)
}

// ══════════ 2. the default is unchanged — a seat with no isActive is active ═════════════════════
{
  const made = await asOwner('POST', '/api/company/users', {
    email: 'normal-sc@test.local', password: 'LongEnough123', firstName: 'Nor', lastName: 'Mal', role: 'manager',
  })
  check('a seat created with no isActive is still active', made.status === 201 && (await storedActive('normal-sc@test.local')) === true, made)
}

// ══════════ 3. an INACTIVE seat is not refused by a full plan ═══════════════════════════════════
//
// Two active users exist by now (owner + the one above). A cap of 2 is therefore full.
{
  await db.update(company).set({ settings: { seatLimit: 2 } } as any).where(eq(company.id, co.id))

  const refused = await asOwner('POST', '/api/company/users', {
    email: 'overflow-sc@test.local', password: 'LongEnough123', firstName: 'Over', lastName: 'Flow', role: 'manager',
  })
  check('an ACTIVE seat is refused when the plan is full', refused.status === 403, refused)
  check('…and the refusal says how many seats and how many are used',
    /2/.test(String(refused.json?.error)) && refused.json?.seatLimit === 2, refused.json)

  const allowed = await asOwner('POST', '/api/company/users', {
    email: 'parked-sc@test.local', password: 'LongEnough123', firstName: 'Par', lastName: 'Ked',
    role: 'manager', isActive: false,
  })
  check('an INACTIVE seat is ALLOWED when the plan is full — it takes no seat', allowed.status === 201, allowed)
  check('…and it really is inactive', (await storedActive('parked-sc@test.local')) === false)
}

// ══════════ 4. switching it on afterwards still honours the cap ═════════════════════════════════
//
// Otherwise "create inactive, then activate" is a way around the thing the cap exists for.
{
  const parked = (await db.select().from(user).where(eq(user.email, 'parked-sc@test.local')).limit(1))[0]
  const on = await asOwner('PUT', `/api/company/users/${parked.id}`, { isActive: true })
  // The edit route does not enforce the seat cap today. Record which it is rather than assume: if it
  // allows this, the cap is a create-time check only, and that is worth knowing out loud.
  console.log(`  note  activating a parked seat on a full plan answered ${on.status} — the cap is enforced on create${on.status === 200 ? ' only' : ' and on edit'}`)
  check('activating a parked seat gives a definite answer, not a 500', on.status < 500, on)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
