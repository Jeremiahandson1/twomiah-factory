// CI guard: a staff session token is only ever sent by code that recovers when it has expired.
//
// 10/14: an owner left onboarding open, came back, pressed Save on Branded Email and got "Token expired". The step
// called fetch() with 'Bearer ' + localStorage.getItem('token') — the token as it was when the page loaded, and no
// retry. The api client refreshes an expired token and retries the call; thirteen shared screens and about a hundred
// and fifty crm-roof calls went around it. Roof's AuthContext refreshes on a 12-minute timer, which a sleeping laptop
// or a background tab does not run, so the same thing happened there on the first click after the lid opened.
//
// The rule is the property, not a list of files: anywhere in a CRM frontend (or packages/tenant-ui) that builds a
// `Bearer …` header must, in the same file, answer a 401 by refreshing (refreshAccessToken, or the store client's tryRefresh) and trying again — which is
// what the api clients, the auth contexts and the shared Documents page's byte fetch do. A screen gets the bearer by
// calling the client: api.raw(path, init) for a Response, api.get/post/… for JSON.
//
// The one other bearer is the customer portal's: a separate, long-lived portalToken with no refresh to call.
// crm-homecare and crm-automotive are parked and not reworked here.
//   bun scripts/check-no-hand-sent-bearer.ts
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const walk = (d: string): string[] => !existsSync(ROOT + d) ? [] : readdirSync(ROOT + d).flatMap((n) => {
  if (n === 'node_modules' || n === 'dist') return []
  const p = `${d}/${n}`
  return statSync(ROOT + p).isDirectory() ? walk(p) : /\.(tsx?|jsx?)$/.test(n) ? [p] : []
})

const PARKED = new Set(['crm-homecare', 'crm-automotive'])
const roots = ['packages/tenant-ui/src', ...readdirSync(ROOT + 'templates')
  .filter((t) => /^crm(-|$)/.test(t) && !PARKED.has(t))
  .map((t) => `templates/${t}/frontend/src`)
  .filter((d) => existsSync(ROOT + d))]

const BEARER = /Bearer \$\{|['"]Bearer ['"] *\+/
let files = 0, builders = 0, refreshers = 0
for (const f of roots.flatMap(walk)) {
  files++
  const src = readFileSync(ROOT + f, 'utf8').replace(/\r\n/g, '\n')
  const lines = src.split('\n')
  const hits = lines.map((l, i) => ({ l, i })).filter(({ l }) => BEARER.test(l) && !/^\s*(\/\/|\*)/.test(l))
  if (!hits.length) continue
  builders++
  // The customer portal's own token is not the staff session — but only when the value in the header IS that token:
  // `Bearer ${v}` where v was read from localStorage 'portalToken' just above. Being near the word is not enough.
  const isPortal = ({ l, i }: { l: string; i: number }) => {
    const v = l.match(/Bearer \$\{(\w+)\}/)?.[1]
    if (!v) return false
    const above = lines.slice(Math.max(0, i - 6), i).join('\n')
    return new RegExp(`const ${v} = localStorage\\.getItem\\('portalToken'\\)`).test(above)
  }
  const staff = hits.filter((h) => !isPortal(h))
  if (!staff.length) continue
  // A 401 that leads straight into a refresh — not merely both words somewhere in the file.
  const recovers = /status === 401[^\n]*(\n[^\n]*){0,3}?(refreshAccessToken|tryRefresh)\(/.test(src)
  if (recovers) { refreshers++; continue }
  for (const { l, i } of staff) fail(`${f}:${i + 1} sends the session token by hand and never refreshes it — call the api client (api.raw / api.get …) instead:  ${l.trim().slice(0, 120)}`)
}

// The clients the screens are pointed at must have raw(): the shared one, and the two templates with their own.
for (const [f, re] of [
  ['packages/tenant-ui/src/api/client.ts', /async raw\(endpoint: string/],
  ['templates/crm-roof/frontend/src/services/api.ts', /async raw\(endpoint/],
  ['templates/crm-dispensary/frontend/src/services/api.ts', /async raw\(endpoint/],
] as const) {
  const src = existsSync(ROOT + f) ? readFileSync(ROOT + f, 'utf8') : ''
  if (!re.test(src)) fail(`${f} has no raw() — the screens that need a Response have nowhere to go but fetch()`)
  else if (!/return this\.handleResponse(<T>)?\(await this\.raw\(endpoint, options\)\)/.test(src)) fail(`${f}: request() must be raw() + handleResponse, one path — two copies of the refresh drift apart`)
}

if (failed) { console.error(`\nhand-sent bearer: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`hand-sent bearer: ${files} file(s) in ${roots.length} frontend(s); ${builders} build a Bearer header, ${refreshers} of them refresh on a 401, the rest are the portal's own token`)
