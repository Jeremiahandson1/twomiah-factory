// Field Service T30 L-SMS — "A business rule should not be a 502. The server also accepted toPhone '123'
// … and stored a failed message record."
//
// Two different things were wearing the same status code:
//
//   the wallet is empty   Nothing is attempted — no carrier call, no thread, no row. 502 means an upstream
//                         server answered badly, which points whoever reads the log at Twilio, and Twilio
//                         was never asked. 402 Payment Required says what it is and what fixes it.
//   the carrier refused   Something WAS attempted and came back bad. That is a 502 and stays one.
//
// And "123" is not a phone number: formatPhoneE164 turns any digits into "+123" and hands it over, so a
// typo spent a send, wrote a failed message into a customer's thread, and came back 502. The form checks
// for ten digits; the API, which is the one that can be called directly, did not.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, smsMessage, smsConversation } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'
import { isDialablePhone } from './src/shared/integrations/twilio.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) } }

await setupSchema()

const [co] = await db.insert(company).values({ name: 'T30 SMS Co', slug: 't30sms', email: 't30sms@test.local', settings: {}, enabledFeatures: ['two_way_texting', 'contacts'] } as any).returning()
const [owner] = await db.insert(user).values({ email: 'owner-t30sms@test.local', passwordHash: 'x', firstName: 'Ola', lastName: 'Owner', role: 'owner', companyId: co.id } as any).returning()
const [cust] = await db.insert(contact).values({ type: 'client', name: 'T30 SMS Customer', email: 'sms-t30@test.local', phone: '608-555-0166', companyId: co.id } as any).returning()

const app = new Hono()
app.route('/api/sms', (await import('./src/routes/sms.ts')).default)
app.onError(errorHandler)
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const rows = async () => (await db.select().from(smsMessage)).length
const threads = async () => (await db.select().from(smsConversation)).length

console.log('\n── what can be dialled ──')
{
  check('a ten-digit number', isDialablePhone('608-555-0166') && isDialablePhone('(608) 555-0166') && isDialablePhone('6085550166'))
  check('…with the country code', isDialablePhone('+1 608 555 0166') && isDialablePhone('16085550166'))
  check('an international number in E.164', isDialablePhone('+442079460958'))
  check('"123" is not a phone number — the reported case', !isDialablePhone('123'), { got: isDialablePhone('123') })
  check('…nor is a short string of digits', !isDialablePhone('5550166'), { got: isDialablePhone('5550166') })
  check('…nor empty, nor letters', !isDialablePhone('') && !isDialablePhone('call me'))
  check('…and +12 is too short to be international', !isDialablePhone('+12'), { got: isDialablePhone('+12') })
}

console.log('\n── the API refuses a number it cannot dial, and spends nothing doing it ──')
{
  const before = await rows(), beforeThreads = await threads()
  const r = await call('POST', '/api/sms/send', { toPhone: '123', message: 'T30 probe' })
  check('a 400, not a 502 — this is a typo, not a carrier problem', r.status === 400, { status: r.status, body: r.json })
  check('…and the message says what to type instead', /phone number/i.test(String(r.json?.error || '')), { error: r.json?.error })
  check('no message row was written', (await rows()) === before, { before, after: await rows() })
  check('…and no thread was opened on a number that does not exist', (await threads()) === beforeThreads, { beforeThreads, after: await threads() })
}

console.log('\n── a real number still gets through the validator ──')
{
  // The point of this case is that the phone validator does not swallow a VALID number. It used to
  // be observed through the carrier: with no Twilio credentials in the sandbox the call failed, and
  // a 502 proved the number had got that far.
  //
  // A shop with no number set up is now refused BEFORE anything is attempted (FULL0929 F8), which
  // is the same rule the empty-wallet case has always followed — "a refused send is not a send: no
  // thread is opened and no message row is written" (T16 N2). So the observable changes and the
  // intent does not: a valid number must earn a DIFFERENT refusal from the typo above — a setup
  // problem, naming what to go and do — rather than being turned away as unreadable.
  const before = await rows(), beforeThreads = await threads()
  const r = await call('POST', '/api/sms/send', { contactId: cust.id, message: 'T30 real number' })
  check('a dialable number gets past the validator', r.status !== 400, { status: r.status, body: r.json })
  check('…and is refused for the real reason: texting is not set up here',
    /not set up|wallet|paused/i.test(String(r.json?.error || '')), { status: r.status, error: r.json?.error })
  check('…not as an unreadable number', !/not a phone number/i.test(String(r.json?.error || '')), { error: r.json?.error })
  check('…and nothing was attempted, so no message row and no thread', (await rows()) === before && (await threads()) === beforeThreads,
    { rows: await rows(), threads: await threads() })
}

console.log(`\nfs-t30-sms-refusal: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
