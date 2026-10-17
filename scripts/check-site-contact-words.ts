// CI guard: a site's contact form asks in that business's words. (Found beside Bar Run 2, 10/17)
//
// Every premium site template was copied from the contractor's, and its contact form kept the contractor's question
// — "What you're working on", posted as name="project" — and its error, "Tell us a bit about your project". A vet
// client, a home-care family or a food-truck customer was asked about their project. Only the building trades
// (contractor, roofing, landscaping) keep it; every other template asks for a message, which every lead route reads.
//   bun scripts/check-site-contact-words.ts
import { readFileSync, readdirSync, existsSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const PROJECT_TRADES = new Set(['website-premium-contractor', 'website-premium-roofing', 'website-premium-landscaping'])
const templates = readdirSync(ROOT + 'templates').filter((t) => t.startsWith('website-premium-'))
let walked = 0
for (const t of templates) {
  const formPath = `templates/${t}/views/sections/contact/form-info.ejs`
  if (!existsSync(ROOT + formPath)) continue
  walked++
  const form = read(formPath).replace(/<%#[\s\S]*?%>/g, '')
  const server = read(`templates/${t}/server-static.ts`)
  const asksMessage = /name="message"/.test(form)
  if (!/body\.message/.test(server)) fail(`${t}: the lead route does not read body.message`)
  if (PROJECT_TRADES.has(t)) continue
  if (/working on/i.test(form)) fail(`${t}: the contact form still asks "What you're working on"`)
  if (/name="project"|id="cf-project"/.test(form)) fail(`${t}: the contact form still posts a "project" field`)
  if (!asksMessage) fail(`${t}: the contact form has no message field`)
  if (/your project/i.test(server.slice(server.indexOf('const message ='), server.indexOf('const message =') + 600))) fail(`${t}: the lead route still answers "…your project"`)
}
if (walked < 11) fail(`expected at least 11 premium site contact forms, walked ${walked} — has the form moved?`)
const fs = read('templates/website-fieldservice/views/contact.ejs')
if (/Project Details|about your project/i.test(fs)) fail('website-fieldservice: the contact form still asks for "Project Details"')

if (failed) { console.error(`\n${failed} contact-form check(s) failed`); process.exit(1) }
console.log(`site contact words: ${walked} premium forms walked; only the building trades ask about a project`)
