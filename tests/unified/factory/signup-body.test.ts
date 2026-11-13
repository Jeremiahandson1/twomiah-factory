// The public signup's body is checked to its own shape before anything reads it (security review S5-7 / S5-8).
// What a stranger types must never switch on a paid Add-on Product, name a paid product, or reach source code as code.
import { test, expect, describe } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { signupEmail, signupProductList, signupFeatureList, signupSlug, NOT_PASTED_AS_TYPED, SIGNUP_HEX_RE, SIGNUP_PLAN_RE } from '../../../apps/api/src/services/signupBody'
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
