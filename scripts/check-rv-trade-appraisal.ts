// CI guard: the RV AI Trade Appraisal refuses an impossible year and unknown category / condition before calling the
// AI. (RV T19 L4: year 1800 / 3000 valued at about $21,000; "banana" accepted)
//   bun scripts/check-rv-trade-appraisal.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const r = readFileSync(join(ROOT, 'templates/crm-rv/backend/src/routes/aiTrade.ts'), 'utf8')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const h = r.slice(r.indexOf("app.post('/appraise'"))
if (!/Number\.isInteger\(body\.year\) && body\.year >= 1900 && body\.year <= maxYear/.test(h)) fail('year must be a whole number from 1900 to next year')
if (!/!CATEGORIES\.includes\(body\.category\)\) return c\.json/.test(h)) fail('category must be one of the unit categories')
if (!/!CONDITIONS\.includes\(body\.condition\)\) return c\.json/.test(h)) fail('condition must be one of the listed conditions')
if (h.indexOf("fetch('https://api.anthropic.com") < h.indexOf('CONDITIONS.includes(body.condition)')) fail('validation must come before the AI call')
if (failed) { console.error(`\nrv trade appraisal: ${failed} check(s) FAILED`); process.exit(1) }
console.log('rv trade appraisal: year, category and condition are validated before the AI is asked')
