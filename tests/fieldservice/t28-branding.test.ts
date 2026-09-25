// Field Service T28 M2 + L9 — the branding fields a company admin can set.
//
// The brand colour grew a hex check in T28; website and logo did not, and they are the two that reach a
// dangerous sink. company.website goes into the sidebar's "Live Website" ANCHOR, and a javascript: href
// runs on click — so an admin could leave a trap that fires for every user of that tenant. The logo goes
// into <img src> on the customer portal.
//
// L9 is the same schema: logo:null answered "Expected string, received null", so Settings could set a
// logo and never remove one.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) } }

await setupSchema()

const [co] = await db.insert(company).values({ name: 'T28 Brand', slug: 't28brand', email: 't28brand@test.local', settings: {}, enabledFeatures: ['contacts', 'jobs'] } as any).returning()
const [owner] = await db.insert(user).values({ email: 'owner-t28brand@test.local', passwordHash: 'x', firstName: 'Ada', lastName: 'Owner', role: 'owner', companyId: co.id } as any).returning()

const app = new Hono()
app.route('/api/company', (await import('./src/routes/company.ts')).default)
app.onError(errorHandler)
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}

console.log('\n── a script URL is refused, in both fields ──')
for (const field of ['website', 'logo'] as const) {
  for (const payload of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)']) {
    const r = await call('PUT', '/api/company', { [field]: payload })
    check(`${field} refuses ${payload.slice(0, 28)}`, r.status === 400, { status: r.status, error: r.json?.error })
  }
  const junk = await call('PUT', '/api/company', { [field]: 'not a url' })
  check(`${field} refuses "not a url"`, junk.status === 400, { status: junk.status, error: junk.json?.error })
}

console.log('\n── …and the ordinary things people type still work ──')
{
  const full = await call('PUT', '/api/company', { website: 'https://example.com/shop' })
  check('a full https address saves', full.status === 200, { status: full.status, error: full.json?.error })
  const bare = await call('PUT', '/api/company', { website: 'example.com' })
  check('a bare domain saves', bare.status === 200, { status: bare.status, error: bare.json?.error })
  const row = bare.json?.data ?? bare.json
  check('…stored with a scheme, so the href is well formed', String(row?.website || '').startsWith('https://'), { website: row?.website })
  const http = await call('PUT', '/api/company', { logo: 'http://cdn.example.com/logo.png' })
  check('an http logo saves', http.status === 200, { status: http.status, error: http.json?.error })
}

console.log('\n── L9: a logo can be removed again ──')
{
  await call('PUT', '/api/company', { logo: 'https://cdn.example.com/logo.png' })
  const cleared = await call('PUT', '/api/company', { logo: null })
  check('logo:null is accepted rather than 400', cleared.status === 200, { status: cleared.status, error: cleared.json?.error })
  const row = cleared.json?.data ?? cleared.json
  check('…and the logo is actually gone', !row?.logo, { logo: row?.logo })
  const blank = await call('PUT', '/api/company', { logo: '' })
  check('an empty string clears it too', blank.status === 200, { status: blank.status, error: blank.json?.error })
}

console.log('\n── the colour check that already worked still does ──')
{
  const bad = await call('PUT', '/api/company', { primaryColor: 'notahex' })
  check('a non-hex brand colour is refused', bad.status === 400, { status: bad.status, error: bad.json?.error })
  const good = await call('PUT', '/api/company', { primaryColor: '#1d4ed8' })
  check('a hex brand colour saves', good.status === 200, { status: good.status, error: good.json?.error })
}

console.log(`\nfs-t28-branding: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
