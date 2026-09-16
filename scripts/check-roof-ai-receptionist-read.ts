// CI guard: crm-roof AI Receptionist page must read the envelopes its endpoints actually return.
//  1) GET /api/ai-receptionist/rules returns { data } — the page read data.rules, so the list said
//     "No rules yet" and Total/Active Rules showed 0 even after a rule saved (201).
//  2) GET /api/calltracking/calls returns { data, pagination } of raw call_log rows — the page read
//     data.calls (Recent Calls always 0) and rendered non-existent type/from_number columns.
//  3) updateRule must whitelist editable columns: the Active toggle PUTs the whole row back, and a JSON
//     createdAt string crashes drizzle's timestamp mapper (value.toISOString) → 500.
//   bun scripts/check-roof-ai-receptionist-read.ts
import { readFileSync } from 'node:fs'
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const read = (p: string) => strip(readFileSync(new URL(`../templates/crm-roof/${p}`, import.meta.url), 'utf8'))
const page = read('frontend/src/pages/roofing/AIReceptionistPage.tsx')
const route = read('backend/src/routes/aiReceptionist.ts')
const calls = read('backend/src/services/calltracking.ts')
const svc = read('backend/src/services/aiReceptionist.ts')

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// (1) rules envelope
if (!/c\.json\(\{\s*data:\s*rules\s*\}\)/.test(route)) fail('GET /rules envelope changed — update the page reader and this guard together')
if (/\.rules\b/.test(page)) fail('page must not read a .rules key (the endpoint returns { data })')
if (!/setRules\([^)]*\.data\b/.test(page)) fail('loadRules must unwrap the { data } envelope')

// (2) calls envelope + raw column names
if (!/return \{ data: callData, pagination:/.test(calls)) fail('getCalls envelope changed — update the page reader and this guard together')
if (/\.calls\b/.test(page)) fail('page must not read a .calls key (the endpoint returns { data, pagination })')
if (!/pagination\?\.total/.test(page)) fail('Recent Calls must come from pagination.total, not the first page length')
if (/call\.(type|from_number|to_number)\b/.test(page)) fail('call rows are raw call_log columns — use direction/caller_number, not type/from_number/to_number')

// (3) updateRule whitelist
const upd = svc.match(/export async function updateRule[\s\S]*?\r?\n\}\r?\n/)?.[0] || ''
if (!upd) fail('updateRule not found')
else if (/\.set\(\{\s*\.\.\.data\b/.test(upd)) fail('updateRule must not spread the raw body into .set() (createdAt string → 500; id/companyId rewritable)')

if (failed) { console.error(`\nroof AI receptionist read path: ${failed} check(s) FAILED`); process.exit(1) }
console.log('roof AI receptionist: page unwraps rules/calls envelopes; updateRule sets only editable columns')
