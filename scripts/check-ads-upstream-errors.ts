// CI guard: the Ads module never shows an operator the upstream's error payload — a provider credential failure came
// back as raw JSON in the "Preview ad copy" dialog. Only a short, plain upstream sentence is passed through; anything
// else becomes our own sentence and the body is logged for us. (Landscaping T21 H1)
//   bun scripts/check-ads-upstream-errors.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const s = readFileSync(ROOT + 'packages/tenant-backend/src/ads/ads.ts', 'utf8').replace(/\r\n/g, '\n')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

if (/`Twomiah Ads: \$\{String\(data\.error\)/.test(s)) fail('the upstream error payload must not be stringified into the message')
if (!/const safe = plain && plain\.length <= 200 && !\/\[\{\}\[\\\]\]\|api\[\\s_-\]\?key\|authentication\|credential\|token\|bearer\/i\.test\(plain\)/.test(s)) fail('only a short, plain upstream sentence may be shown (no payload, keys, credentials or tokens)')
if (!/Nothing was charged — try again in a few minutes/.test(s)) fail('the fallback message must say nothing was charged and what to do')
if (!/console\.error\('\[Ads\] upstream error', \{ path, status: res\.status, body: text\.slice\(0, 500\) \}\)/.test(s)) fail('the raw upstream body must be logged for us')
if (!/if \(res\.status === 401\) throw new AdsUpstreamError\(502, "Twomiah Ads did not accept this account's API key\."\)/.test(s)) fail("a rejected account key must still say so")
if (!/details: undefined/.test(s) && !/safe \? data\?\.details : undefined/.test(s)) fail('upstream details must not be forwarded with an unsafe message')
if (failed) { console.error(`\nads upstream errors: ${failed} check(s) FAILED`); process.exit(1) }
console.log('ads upstream errors: operators see our sentence, never the provider payload')
