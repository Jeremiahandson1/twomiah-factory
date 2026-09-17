// CI guard: the RV AI Lead Responder only offers units that can be sold. The unit a lead asked about goes to the model
// with availableNow and, when it isn't available, its status and no price; the instructions forbid offering an
// unavailable unit; alternatives come only from available units; the inbox and page show the status.
// (RV T19 H3: a test-ride offer for a Gold Wing already sold)
//   bun scripts/check-rv-ai-leads-availability.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const r = read('templates/crm-rv/backend/src/routes/aiLeads.ts')
if (!/const availableNow = interest\?\.status === 'available'/.test(r)) fail('draft must decide availability from unit.status === available')
const interested = r.slice(r.indexOf('const interestedIn = interest ?'), r.indexOf('const ctx = {'))
const [availBranch, unavailBranch] = interested.split(/\r?\n\s*: \{/)
if (!/availableNow: true/.test(availBranch || '') || !/price: interest\.internetPrice/.test(availBranch || '')) fail('an available unit must go to the model with its price and availableNow: true')
if (!unavailBranch || !/availableNow: false/.test(unavailBranch) || !/status: UNIT_STATUS_NOTE\[interest\.status\]/.test(unavailBranch) || /price/.test(unavailBranch)) fail('an unavailable unit must go with availableNow: false, its status note, and NO price')
if (!/interestedIn,\r?\n\s*alsoAvailable,/.test(r) || /interestedIn: interest \?/.test(r)) fail('the model context must use the availability-aware interestedIn')
if (!/"interestedIn\.availableNow" is false[\s\S]*do NOT offer a test ride, visit, price or financing on it/.test(r)) fail('the instructions must forbid offering an unavailable unit')
if (!/eq\(unit\.status, 'available'\)/.test(r.slice(r.indexOf('let pool'), r.indexOf('const alsoAvailable')))) fail('alternatives must come only from available units')
if (!/unitStatus: unit\.status/.test(r.slice(r.indexOf("app.get('/inbox'"), r.indexOf("app.post('/draft'")))) fail('the lead inbox must return unitStatus')

const page = read('templates/crm-rv/frontend/src/pages/rv/AILeadResponderPage.tsx')
if (!/function unavailableLabel\(l: Lead\)/.test(page) || (page.match(/unavailableLabel\(selected\)/g) || []).length < 1 || (page.match(/unavailableLabel\(l\)/g) || []).length < 2) fail('the Responder page must label leads whose unit is not available')

if (failed) { console.error(`\nrv ai leads availability: ${failed} check(s) FAILED`); process.exit(1) }
console.log('rv ai leads availability: unavailable units go to the model with their status and no price, are never offered, and are labelled on the page')
