// The Factory's emails greet the OWNER by first name and print the plan's NAME — for every vertical. (Run 3, 10/16)
//
//   Tester: "neither the welcome email nor the CRM-ready email greets the owner by name ('Welcome aboard!', 'Great
//   news!'). The welcome email says the plan is 'Starter10'."
//
// Every vertical's welcome and ready email is built by apps/api/src/services/email.ts, so the rules are checked across
// all of them: the owner's first name when it is known (and nothing invented when it is not — never the company name),
// the plan's display name from the one plan catalog, and no greeting anywhere in the file addressed to a company.
// Builders only: nothing is sent, nothing leaves the machine.
//   bun run tests/shared/owner-emails.test.ts
import { readFileSync } from 'node:fs'

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const E = await import(new URL('../../apps/api/src/services/email.ts', import.meta.url).href)
const { PLANS } = await import(new URL('../../packages/tenant-backend/src/plans.ts', import.meta.url).href)

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

// One industry per CRM vertical (apps/api/src/config/industryRouting.ts) — the email's product name follows it.
const VERTICALS: Array<[string, string]> = [
  // The product each is sold as (the platform's PRODUCT_META, twomiah.com/signup/<product>): a roofer is on Twomiah Roof,
  // never Twomiah Build (live test 2026-10-22 — roofing, landscaping and cannabis all fell through to the contractor's).
  ['home_care', 'Care'], ['hvac', 'Wrench'], ['roofing', 'Roof'], ['landscaping', 'Landscaping'], ['dispensary', 'Leaf'],
  ['rv_dealer', 'Roam'], ['veterinary', 'Vet'], ['salon', 'Salon'], ['restaurant', 'Events'], ['general_contractor', 'Build'],
  ['bar_and_grill', 'Bar'], ['online_store', 'Store'], ['other', 'Basic'],
]

// ── the plan's name, never its id
{
  check('starter10 is "Starter" — what the owner bought, not the id', E.planDisplayName('starter10') === 'Starter')
  for (const [id, def] of Object.entries(PLANS) as Array<[string, any]>) {
    check(`every catalog plan prints its name: ${id} → ${def.name}`, E.planDisplayName(id) === def.name, E.planDisplayName(id))
  }
  check('no plan at all reads as the default plan\'s name, not "Starter10" or blank', E.planDisplayName(null) === 'Starter' && E.planDisplayName('') === 'Starter')
  check('an id the catalog does not know is tidied, never printed raw', E.planDisplayName('pro') === 'Pro' && E.planDisplayName('growth_plus25') === 'Growth Plus', [E.planDisplayName('pro'), E.planDisplayName('growth_plus25')])
}

// ── the welcome and ready emails, every vertical
for (const [industry, product] of VERTICALS) {
  const tenant = { id: null, name: 'Test Home Care Co', email: 'owner@test.local', slug: 'test-co', plan: 'starter10', industry, products: ['crm', 'website'] }
  const w = E.buildWelcomeEmail(tenant, 'Jamie')
  check(`${industry}: welcome names the product "Twomiah ${product}"`, w.subject.startsWith(`Welcome to Twomiah ${product} `) && w.html.includes(`Twomiah ${product}</strong>`) && (product === 'Build' || !/Twomiah Build/.test(w.html + w.subject)), [w.subject, text(w.html).slice(0, 160)])
  if (industry !== 'online_store') {
    const ready = E.buildDeployCompleteEmail(tenant, { deployedUrl: 'https://test-co-api.onrender.com' }, null)
    check(`${industry}: ready email names the product "Twomiah ${product} CRM"`, ready.subject === `Your Twomiah ${product} CRM is ready` && (product === 'Build' || !/Twomiah Build/.test(ready.html)), ready.subject)
  }
  check(`${industry}: welcome greets the owner — "Welcome aboard, Jamie!"`, /Welcome aboard, Jamie!/.test(w.html), text(w.html).slice(0, 200))
  check(`${industry}: welcome prints the plan's name "Starter", not "Starter10"`, /Plan:\s*<\/strong>\s*Starter</.test(w.html) && !/Starter10/i.test(w.html), text(w.html))
  const r = E.buildDeployCompleteEmail(tenant, { deployedUrl: 'https://test-co-api.onrender.com' }, 'Jamie')
  check(`${industry}: ready email greets the owner — "Great news, Jamie!"`, /Great news, Jamie!/.test(r.html), text(r.html).slice(0, 200))
  const anon = E.buildWelcomeEmail(tenant, null), anonR = E.buildDeployCompleteEmail(tenant, {}, null)
  check(`${industry}: with no name known, the greeting stands alone — it never addresses the company`, /Welcome aboard!/.test(anon.html) && /Great news!/.test(anonR.html) && !/(aboard|news), Test Home Care Co/.test(anon.html + anonR.html))
}
{
  const store = E.buildDeployCompleteEmail({ name: 'Shop', email: 'o@x.test', slug: 's', industry: 'retail', products: ['crm-store'] }, { deployedUrl: 'https://s' }, 'Pat')
  check('the store\'s ready email greets the owner too', /Great news, Pat!/.test(store.html) && /store is ready/i.test(store.subject))
  const full = E.buildWelcomeEmail({ name: 'Co', email: 'a@b', plan: 'starter10', industry: 'home_care' }, '  Mary  Jo ')
  check('a first name is trimmed to the first word', /Welcome aboard, Mary!/.test(full.html), text(full.html).slice(0, 120))
  const evil = E.buildWelcomeEmail({ name: 'Co', email: 'a@b', plan: 'starter10', industry: 'home_care' }, '<img>')
  check('the name is escaped — signup text never becomes markup', /Welcome aboard, &lt;img&gt;!/.test(evil.html) && !/<img>/.test(evil.html))
  check('greeting(): "Hi Jamie," and "Hi there," — the helper every other email uses', /Hi Jamie,/.test(E.greeting('Jamie')) && /Hi there,/.test(E.greeting(null)))
}

// ── the first step is the vertical's own work: only the recurring-job verticals are told to create a job (Bar Run 1)
{
  const NO_JOBS = ['home_care', 'rv_dealer', 'veterinary', 'salon', 'restaurant', 'bar_and_grill', 'dispensary', 'online_store']
  for (const [industry] of VERTICALS) {
    const tenant = { id: null, name: 'Test Co', email: 'owner@test.local', slug: 'test-co', plan: 'starter10', industry, products: ['crm'] }
    const r = text(E.buildDeployCompleteEmail(tenant, { deployedUrl: 'https://test-co-api.onrender.com' }, 'Jamie').html)
    const saysJob = /create a job/i.test(r)
    check(`${industry}: the ready email ${NO_JOBS.includes(industry) ? 'never says "create a job"' : 'keeps "create a job"'}`, saysJob === !NO_JOBS.includes(industry), r.slice(r.indexOf('3 things'), r.indexOf('3 things') + 260))
  }
  check('a bar is pointed at its menu, taps and the Register', /menu and taps.*Register/.test(E.firstWorkStep('bar_and_grill')), E.firstWorkStep('bar_and_grill'))
}

// ── the rule across the file: no greeting addressed to a company; the signup hands the welcome the owner's name
{
  const src = readFileSync(ROOT + 'apps/api/src/services/email.ts', 'utf8')
  check('no email in services/email.ts says "Hi <company>,"', !/Hi \$\{tenant\.name\}/.test(src))
  check('no email prints a plan id through the old title-case trick', !/tenant\.plan \|\| 'starter'\)\.replace/.test(src))
  check('the CRM add-on\'s ready email greets the owner, not the company', !/'<p>Hi ' \+ \(tenant\.name/.test(readFileSync(ROOT + 'apps/api/src/services/crmAddonProvision.ts', 'utf8')))
  const intake = readFileSync(ROOT + 'apps/api/src/routes/factory/intake.ts', 'utf8')
  check('signup passes the owner\'s first name to the welcome email (no build exists yet to look it up from)', /notifyWelcome\(tenant, signupText\(body\.owner_first_name\) \?\? null\)/.test(intake))
}

console.log(`\nowner-emails: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
