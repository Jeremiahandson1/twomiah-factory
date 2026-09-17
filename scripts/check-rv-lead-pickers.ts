// CI guard: the RV deal pickers (Desking, F&I, Title & Reg) aren't limited to the 30 newest leads. The inbox route
// takes validated ?stages= and ?limit= (max 500, most recently active first); each picker asks for its stages.
// (RV T20: with more than 30 leads an older deal couldn't be picked)
//   bun scripts/check-rv-lead-pickers.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const r = read('templates/crm-rv/backend/src/routes/aiLeads.ts')
if (!/const PICKER_MAX = 500/.test(r)) fail('inbox must cap pickers at PICKER_MAX = 500')
if (!/stages\.some\(\(s\) => !\(LEAD_STAGES as readonly string\[\]\)\.includes\(s\)\)\)\) \{\s*return c\.json\(\{ error: [^\r\n]*\}, 400\)/.test(r)) fail('inbox must refuse unknown stages with 400')
if (!/if \(!Number\.isInteger\(limit\) \|\| limit < 1 \|\| limit > PICKER_MAX\) return c\.json\(\{ error: [^\r\n]*\}, 400\)/.test(r)) fail('inbox must refuse a bad limit with 400')
if (!/stages \? inArray\(salesLead\.stage, stages\) : undefined/.test(r)) fail('inbox must filter by the requested stages')
if (!/\.orderBy\(stages \? desc\(salesLead\.updatedAt\) : desc\(salesLead\.createdAt\)\)/.test(r)) fail('pickers must be ordered by most recent activity')
if (!/\.limit\(limit\)/.test(r) || /\.limit\(30\)/.test(r)) fail('inbox must use the requested limit, not a fixed 30')
const OPEN_SOLD = "api.get('/api/ai-leads/inbox?stages=new,contacted,demo,desking,closed_won&limit=500')"
for (const p of ['DeskingPage', 'FIPage']) if (!read(`templates/crm-rv/frontend/src/pages/rv/${p}.tsx`).includes(OPEN_SOLD)) fail(`${p} must load open and sold leads (limit 500)`)
if (!read('templates/crm-rv/frontend/src/pages/rv/TitleRegPage.tsx').includes("api.get('/api/ai-leads/inbox?stages=closed_won&limit=500')")) fail('TitleRegPage must load sold deals (limit 500)')
if (failed) { console.error(`\nrv lead pickers: ${failed} check(s) FAILED`); process.exit(1) }
console.log('rv lead pickers: Desking, F&I and Title & Reg load their stages beyond the 30 newest leads')
