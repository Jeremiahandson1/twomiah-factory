// The public signup's body is checked to its own shape before anything reads it (security review S5-7 / S5-8).
// What a stranger types must never switch on a paid Add-on Product, name a paid product, or reach source code as code.
import { test, expect, describe } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { signupEmail, signupProductList, signupFeatureList, signupSlug, imageTypeOf, NOT_PASTED_AS_TYPED, SIGNUP_HEX_RE, SIGNUP_PLAN_RE } from '../../../apps/api/src/services/signupBody'
import { getFeaturesForPlan, isPaidAddOn, FEATURE_REGISTRY } from '../../../apps/api/src/config/featureRegistry'
import { crmTemplateFor } from '../../../apps/api/src/config/industryRouting'
import { addressTokensChecked, ADDRESS_TOKENS, literalSafeText } from '../../../apps/api/src/services/generator'

const ROOT = path.resolve(import.meta.dir, '..', '..', '..')

describe('the public signup body', () => {
  test('an email is an email: nothing that is code syntax, a real host', () => {
    for (const ok of ['owner@acme.example', 'twomiah14+e2e@gmail.com', "o'brien@shop.co", 'a.b-c_d@sub.domain.org']) expect(signupEmail(' ' + ok + ' ')).toBe(ok)
    for (const bad of ['', 'no-at', 'a@b', 'a@b.c', 'x"+process.env.X+"@y.com', 'a`b@c.com', 'a${1}@c.com', 'a<b@c.com', 'a\\b@c.com', 'a b@c.com', 'a@b.com\nBcc: x@y.com', 'a@-b.com', 42, null, { a: 1 }]) expect(signupEmail(bad)).toBeNull()
    expect(signupEmail('a'.repeat(200) + '@b.com')).toBeNull()
  })

  test('products: the CRM and the website only — never a paid product', () => {
    expect(signupProductList(['crm', 'website'])).toEqual(['crm', 'website'])
    expect(signupProductList(['crm-roof'])).toEqual(['crm-roof'])
    expect(signupProductList(['crm', 'vision', 'website-premium', 'pricing', 'crm', 7, null])).toEqual(['crm'])
    expect(signupProductList('crm')).toEqual([])
    expect(signupProductList(undefined)).toEqual([])
  })

  test('features: only what the industry\'s plan includes — no paid add-on, no not-ready feature, nothing unknown', () => {
    const paid = FEATURE_REGISTRY.filter((f) => isPaidAddOn(f.id)).map((f) => f.id)
    const hidden = FEATURE_REGISTRY.filter((f) => f.hidden).map((f) => f.id)
    expect(paid.length).toBeGreaterThan(0)
    expect(hidden.length).toBeGreaterThan(0)
    for (const industry of ['roofing', 'home_care', 'salon', 'hvac', undefined]) {
      const plan = getFeaturesForPlan(crmTemplateFor(industry))
      const asked = [...plan.slice(0, 3), ...paid, ...hidden, 'no_such_feature', 9, null]
      const got = signupFeatureList(asked, industry)
      expect(got).toEqual(plan.slice(0, 3))
      for (const id of got) { expect(isPaidAddOn(id)).toBe(false); expect(hidden).not.toContain(id) }
    }
    expect(signupFeatureList([], 'roofing')).toEqual([])
    expect(signupFeatureList('contacts', 'roofing')).toEqual([])
  })

  test('the slug is letters, digits and dashes, whoever typed it', () => {
    expect(signupSlug('Acme Roofing & Sons')).toBe('acme-roofing-sons')
    expect(signupSlug('../../etc/passwd')).toBe('etc-passwd')
    expect(signupSlug('a; rm -rf /')).toBe('a-rm-rf')
    expect(signupSlug('x'.repeat(90)).length).toBeLessThanOrEqual(60)
    expect(signupSlug(undefined)).toBe('')
    expect(signupSlug({})).toBe('')
    expect(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(signupSlug('--Hello__World--'))).toBe(true)
  })

  test('a colour is a hex colour, a plan is a plan id', () => {
    expect(SIGNUP_HEX_RE.test('#FF3D00')).toBe(true)
    for (const bad of ['red', '#fff', "#FF3D00';x", '#FF3D00}</style>']) expect(SIGNUP_HEX_RE.test(bad)).toBe(false)
    expect(SIGNUP_PLAN_RE.test('starter10')).toBe(true)
    expect(SIGNUP_PLAN_RE.test("starter10' or 1=1")).toBe(false)
  })

  test('the route checks every answer before anything reads it', () => {
    const intake = fs.readFileSync(path.join(ROOT, 'apps/api/src/routes/factory/intake.ts'), 'utf8')
    const signup = intake.slice(intake.indexOf("factory.post('/public/signup'"), intake.indexOf("factory.get('/public/signup/:id/next'"))
    const firstUse = signup.indexOf('signupRefusal(')
    for (const call of ['signupEmail(body.email)', 'signupEmail(body.admin_email)', 'signupProductList(body.products)', 'signupFeatureList(body.features, body.industry)', 'SIGNUP_HEX_RE.test(', 'SIGNUP_PLAN_RE.test(']) {
      expect(signup.indexOf(call)).toBeGreaterThan(0)
      expect(signup.indexOf(call)).toBeLessThan(firstUse)
    }
    expect(signup).toMatch(/signupSlug\(body\.slug\) \|\| signupSlug\(body\.name\)/)
    expect(signup).toMatch(/engine !== 'unified' && typeof body\.admin_password === 'string' && NOT_PASTED_AS_TYPED\.test\(body\.admin_password\)/)
    // The form's own deployment model is one of two words, and a domain is only one checked as the owner's own.
    expect(signup).toMatch(/body\.deployment_model = body\.deployment_model === 'owned' \? 'owned' : 'saas'/)
    expect(signup).toMatch(/if \(body\.domainMode !== 'byod'\) body\.domain = undefined/)
  })
})

describe('what a public form is sent', () => {
  test('a picture is what its bytes say, and an SVG is a drawing, never a page', () => {
    const pad = Buffer.alloc(16, 1)
    expect(imageTypeOf(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), pad]))).toBe('image/jpeg')
    expect(imageTypeOf(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), pad]))).toBe('image/png')
    expect(imageTypeOf(Buffer.concat([Buffer.from('GIF89a'), pad]))).toBe('image/gif')
    expect(imageTypeOf(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), pad]))).toBe('image/webp')
    expect(imageTypeOf(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>'))).toBe('image/svg+xml')
    expect(imageTypeOf(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>'))).toBe('image/svg+xml')
    for (const bad of [
      '<html><body><script>alert(1)</script></body></html>',
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)">x</a></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body/></foreignObject></svg>',
      'MZ this is a program, not a picture', '',
    ]) expect(imageTypeOf(Buffer.from(bad))).toBeNull()
  })

  test('the intake route stores a file as what its bytes are, and takes an email that is one', () => {
    const intake = fs.readFileSync(path.join(ROOT, 'apps/api/src/routes/factory/intake.ts'), 'utf8')
    const route = intake.slice(intake.indexOf("factory.post('/public/intake'"), intake.indexOf("factory.post('/public/preview'"))
    expect(route).toMatch(/signupEmail\(getStr\('contactEmail', 200\)\)/)
    expect(route).not.toMatch(/uploadIntakeAsset\([^)]*\.type \|\| 'application\/octet-stream'/)
    expect(route).toMatch(/uploadIntakeAsset\(buf, body\.logo\.name \|\| 'logo', logoKind\.type, slug\)/)
    expect(route).toMatch(/uploadIntakeAsset\(buf, candidate\.name \|\| 'photo', photoKind\.type, slug\)/)
  })

  test('an email the Factory sends carries outside words as text, never as markup', async () => {
    const E = await import('../../../apps/api/src/services/email')
    const evil = '<img src=x onerror=alert(1)><a href="https://evil.example">Click</a>'
    const welcome = E.buildWelcomeEmail({ name: evil, email: 'o@acme.example', plan: 'starter10', industry: 'roofing' }, evil)
    expect(welcome.html).not.toContain('<img src=x')
    expect(welcome.html).not.toContain('<a href="https://evil.example">')
    expect(welcome.html).toContain('&lt;img src=x')
    const ready = E.buildDeployCompleteEmail({ name: evil, slug: 'acme', email: 'o@acme.example', industry: 'roofing', products: ['crm', 'website'] }, { deployedUrl: 'https://acme.onrender.com/"><script>x</script>', siteUrl: 'https://acme.twomiah.app' }, null)
    expect(ready.html).not.toContain('<script>x</script>')
    expect(ready.html).not.toContain('<img src=x')
    // No template in the file pastes a business's name, a ticket's words or an intake's answers in as they came.
    const src = fs.readFileSync(path.join(ROOT, 'apps/api/src/services/email.ts'), 'utf8')
    for (const raw of ['<strong>${tenant.name}</strong>', '<strong>${data.businessName}</strong>', '${error}</p>', "+ data.contactEmail +", '${ticket.description.substring(0, 500)}', '${message.body.substring(0, 1000)}', '${data.notes.substring(0, 2000).replace']) {
      expect(src).not.toContain(raw)
    }
    expect(src).toMatch(/function kv\(label: string, value: string\): string \{\s*return kvHtml\(label, escHtml\(value\)\)/)
  })
})

describe('the templates generator never pastes an address as code', () => {
  const base = Object.fromEntries(ADDRESS_TOKENS.map((k) => [k, 'ok']))
  test('ordinary values pass untouched', () => {
    const t = { ...base, '{{COMPANY_EMAIL}}': 'info@acme.com', '{{COMPANY_PHONE}}': '(715) 555-0100', '{{SITE_URL}}': 'https://acme-site.onrender.com', '{{PRIMARY_COLOR}}': '#FF3D00' }
    expect(addressTokensChecked(t)).toBe(t)
  })
  test('a value holding code syntax stops the build, naming the field', () => {
    for (const bad of ["a'+process.env.JWT_SECRET+'@b.com", 'a"@b.com', 'a`@b.com', 'a${x}@b.com', '<%= 1 %>', 'a\\@b.com', 'a@b.com\nx']) {
      expect(() => addressTokensChecked({ ...base, '{{ADMIN_EMAIL}}': bad })).toThrow(/ADMIN_EMAIL/)
    }
    expect(() => addressTokensChecked({ ...base, '{{PRIMARY_COLOR}}': "red;}</style><script>" })).toThrow(/PRIMARY_COLOR/)
  })
  test('a city in the service-area markup is text, never markup', () => {
    const gen = fs.readFileSync(path.join(ROOT, 'apps/api/src/services/generator.ts'), 'utf8')
    expect(gen).toMatch(/'\{\{SERVICE_AREA_LINKS\}\}': uniqueAreas\.map\(\(a\) => `<li><a href="\/service-area\/\$\{encodeURIComponent\(a\)\}">\$\{literalSafeText\(a\)\}<\/a><\/li>`\)/)
    expect(gen).toMatch(/'\{\{SERVICE_AREA_ITEMS\}\}': uniqueAreas\.map\(\(a\) => `<li>\$\{literalSafeText\(a\)\}<\/li>`\)/)
    expect(literalSafeText('<% process.exit() %>')).not.toMatch(/[<>]/)
    expect(NOT_PASTED_AS_TYPED.test('correct horse battery staple!')).toBe(false)
    expect(NOT_PASTED_AS_TYPED.test("pa'ss")).toBe(true)
  })
})

describe('a failed build never hands out a credential (S5-10)', () => {
  test('the push\'s auth header and anything shaped like a credential stay out of error text', async () => {
    const { argsForError, withoutCredentials } = await import('../../../apps/api/src/lib/redact')
    const token = 'ghp_' + 'a'.repeat(36)
    const header = 'http.extraHeader=Authorization: Basic ' + Buffer.from('x-access-token:' + token).toString('base64')
    const printed = argsForError(['-c', header, 'push', 'origin', 'main', '--force'])
    expect(printed).toBe('-c http.extraHeader=[hidden] push origin main --force')
    expect(printed).not.toContain(Buffer.from('x-access-token:' + token).toString('base64'))
    expect(withoutCredentials('fatal: Authorization: Basic eC1hY2Nlc3MtdG9rZW46Z2hwXw== rejected')).not.toContain('eC1hY2Nlc3M')
    expect(withoutCredentials('remote: bad token ' + token)).not.toContain(token)
    expect(withoutCredentials('could not connect to postgresql://app_user:s3cr3tpw@dpg-abc.oregon-postgres.render.com/db')).not.toContain('s3cr3tpw')
    expect(withoutCredentials('https://x-access-token:' + token + '@github.com/o/r.git')).not.toContain(token)
    expect(withoutCredentials('an ordinary message: build failed at step 3')).toBe('an ordinary message: build failed at step 3')
  })

  test('every git failure in the deploy prints its arguments through argsForError, and the customer\'s email carries no error', () => {
    const deploy = fs.readFileSync(path.join(ROOT, 'apps/api/src/services/deploy.ts'), 'utf8')
    expect(deploy).not.toMatch(/args\.join\(' '\)/)
    expect((deploy.match(/argsForError\(args\)/g) || []).length).toBeGreaterThanOrEqual(3)
    const email = fs.readFileSync(path.join(ROOT, 'apps/api/src/services/email.ts'), 'utf8')
    const failed = email.slice(email.indexOf('export async function notifyDeployFailed('), email.indexOf('export async function notifyNewTicket('))
    // The error goes to staff (notifyProvisionFailure), with credentials taken out; the customer's body never names it.
    expect(failed).toMatch(/notifyProvisionFailure\(tenant, 'Deploy', error\)/)
    expect(failed.slice(failed.indexOf('const body'))).not.toMatch(/\berror\b/)
    expect(email).toMatch(/kv\('Error', withoutCredentials\(detail\)\.slice\(0, 500\)\)/)
  })
})
