// "Ask for the customer's address" is the business's own switch. (T59)
//
// It was the vertical's fixed answer — trades always, salon / vet / showcase never — so a mobile groomer
// never got the address it drives to and a drop-off shop was forced to ask. Now booking_settings has
// require_address: true / false is the owner's answer, null keeps the vertical's. This checks, on this
// template, that the default is unchanged, that flipping it reaches the public widget AND the server's
// own refusal, and that null hands it back.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user } = await import('./db/schema.ts')
const [co] = await db.insert(company).values({ name: 'Address Co', slug: 'address-t59', email: 'a59@test.local', settings: {}, enabledFeatures: ['online_booking', 'jobs', 'contacts'] } as any).returning()
const [owner] = await db.insert(user).values({ email: 'owner-a59@test.local', passwordHash: 'x', firstName: 'O', lastName: 'A', role: 'owner', companyId: co.id, isActive: true } as any).returning()

const app = new Hono()
app.route('/api/booking', (await import('./src/routes/booking.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const call = async (method: string, path: string, body?: unknown, auth = false) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (auth) Object.assign(headers, { 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' })
  const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const hours = Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => [d, { start: '08:00', end: '18:00', enabled: true }]))
const on = await call('PUT', '/api/booking/settings', { enabled: true, leadTimeHours: 0, slotDurationMinutes: 60, workingHours: hours }, true)
check('booking is switched on', on.status === 200, { status: on.status, body: on.text.slice(0, 200) })
const DEFAULT: boolean = on.json?.requireAddress
console.log(`  (this template's own default: requireAddress = ${DEFAULT})`)

let day = 8
const book = async (withAddress: boolean) => {
  const date = new Date(Date.now() + day++ * 864e5).toISOString().slice(0, 10)
  return call('POST', `/api/booking/public/${co.slug}`, {
    date, time: '10:00', firstName: 'Ana', lastName: `Booker${day}`, email: `ana${day}-a59@test.local`, phone: '555-0110',
    ...(withAddress ? { address: '7 Elm St', city: 'Dayton', state: 'OH', zip: '45402' } : {}),
  })
}
const widget = async () => (await call('GET', `/api/booking/public/${co.slug}`)).json?.settings?.requireAddress

console.log('\n══════════ the default is the vertical\'s, unchanged ══════════')
{
  check('the widget is told the same default', (await widget()) === DEFAULT, { widget: await widget(), DEFAULT })
  const r = await book(false)
  check(DEFAULT ? 'with the default ON, a booking with no address is refused' : 'with the default OFF, a booking with no address is taken',
    DEFAULT ? r.status === 400 && /Address is required/.test(r.text) : (r.status === 200 || r.status === 201), { status: r.status, body: r.text.slice(0, 200) })
}

console.log('\n══════════ the owner flips it ══════════')
{
  const flip = await call('PUT', '/api/booking/settings', { requireAddress: !DEFAULT }, true)
  check('the switch saves', flip.status === 200 && flip.json?.requireAddress === !DEFAULT, { status: flip.status, requireAddress: flip.json?.requireAddress })
  check('…and the PUBLIC widget is told', (await widget()) === !DEFAULT, { widget: await widget() })
  const noAddr = await book(false)
  check(!DEFAULT ? 'now ON: no address is refused by the server, not just the form' : 'now OFF: no address is taken',
    !DEFAULT ? noAddr.status === 400 && /Address is required/.test(noAddr.text) : (noAddr.status === 200 || noAddr.status === 201), { status: noAddr.status, body: noAddr.text.slice(0, 200) })
  const withAddr = await book(true)
  check('a booking WITH an address is always taken', withAddr.status === 200 || withAddr.status === 201, { status: withAddr.status, body: withAddr.text.slice(0, 200) })
}

console.log('\n══════════ null hands it back ══════════')
{
  const back = await call('PUT', '/api/booking/settings', { requireAddress: null }, true)
  check('null saves', back.status === 200, { status: back.status })
  check('…and the default is in force again', back.json?.requireAddress === DEFAULT && (await widget()) === DEFAULT, { saved: back.json?.requireAddress, widget: await widget(), DEFAULT })
  const junk = await call('PUT', '/api/booking/settings', { requireAddress: 'yes please' }, true)
  check('a non-boolean is ignored, not stored', junk.status === 200 && junk.json?.requireAddress === DEFAULT, { status: junk.status, requireAddress: junk.json?.requireAddress })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
