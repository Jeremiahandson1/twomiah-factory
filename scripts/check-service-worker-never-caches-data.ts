// CI guard: a service worker may keep the app SHELL. It may not keep the shop's data.
//
// ── why this guard exists ───────────────────────────────────────────────────────────────────────
//
// Nine templates shipped a byte-identical service worker (md5 cb2bc0d8…) that cached API responses
// and served them from cache whenever the network failed:
//
//     const CACHEABLE_API_ROUTES = ['/api/jobs', '/api/projects', '/api/contacts',
//                                   '/api/quotes', '/api/invoices', '/api/dashboard'];
//
// A desk with a flaky connection would be shown yesterday's invoice as though it were today's. None
// of the nine was ever registered — `serviceWorker.register` appeared nowhere in any of them — so no
// customer was ever affected. That is exactly what made it dangerous: a dead file is not a bug until
// somebody wants offline support, finds one already sitting in the template, and plugs it in.
//
// Eight were deleted (crm-automotive is PARKED and keeps its copy untouched). This guard is the part
// that stops the shape coming back, in a new file or an edited one.
//
// The rule, from the dispensary worker that DOES ship and IS registered:
//
//   · the SHELL may be cached — index.html, /assets/*, the manifest, the icons. That is what makes
//     the register open with no internet, which is the entire point of having a worker;
//   · DATA may not. At a till, a stale stock figure, a stale price or a stale invoice is worse than
//     no answer at all: it is a decision made on numbers that are not true. Work done offline is
//     queued and replayed against the live server, which re-checks it.
//
// T52 N7 is the same rule seen from the other side: that worker excluded /api/ and cached everything
// else, so /health — a server route outside /api/ — froze for 22 hours. Naming what may be kept is
// the only version of this that stays correct when someone adds a route.
//
//   bun scripts/check-service-worker-never-caches-data.ts
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// crm-automotive is PARKED (CLAUDE.md: do NOT modify), so its copy is left exactly as it is and is
// not judged here. If it is ever un-parked, delete this exemption with the same commit.
const PARKED = new Set(['crm-automotive'])

const templates = readdirSync(join(ROOT, 'templates')).filter((t) => !PARKED.has(t))
const workers: string[] = []
for (const t of templates) {
  const p = join(ROOT, 'templates', t, 'frontend/public/sw.js')
  if (existsSync(p)) workers.push(`templates/${t}/frontend/public/sw.js`)
}

for (const rel of workers) {
  const src = readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
  // Comments stripped: a worker explaining that it does NOT cache the API must not trip the rule.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

  // 1. the list that started it. Any array of /api/ paths marked cacheable is the old shape.
  if (/CACHEABLE_API_ROUTES/.test(code)) {
    fail(`${rel} declares CACHEABLE_API_ROUTES — a service worker must not keep the shop's data. Cache the app shell; let /api/ go to the network. (See templates/crm-dispensary/frontend/public/sw.js.)`)
  }

  // 2. …and the behaviour, however it is spelled: putting an /api/ response into a cache.
  for (const m of code.matchAll(/cache\.put\(([^)]*)\)/g)) {
    if (/\/api\//.test(m[1])) fail(`${rel} writes an /api/ response into a cache: ${m[0].slice(0, 90)}`)
  }
  if (/caches\.match\([^)]*\)[\s\S]{0,200}\/api\//.test(code) && !/isShell/.test(code)) {
    fail(`${rel} may be answering an /api/ request from a cache. Name what the shell is and send everything else to the network.`)
  }

  // 3. the positive form: a worker that caches at all has to say WHAT it caches, by name.
  const cachesSomething = /caches\.open\(/.test(code) && /cache\.(put|add|addAll)\(/.test(code)
  if (cachesSomething && !/isShell|SHELL_SEED|STATIC_ASSETS/.test(code)) {
    fail(`${rel} caches without naming a shell. Declare the paths that may be kept (isShell / SHELL_SEED) rather than excluding the ones that may not — an exclusion list goes stale the moment a route is added, which is how /health froze for 22 hours (T52 N7).`)
  }
}

// …and the worker that is the reference for all of this has to still be the reference.
{
  const rel = 'templates/crm-dispensary/frontend/public/sw.js'
  if (!existsSync(join(ROOT, rel))) {
    fail(`${rel} is missing — it is the shipped, registered example this rule is taken from`)
  } else {
    const src = readFileSync(join(ROOT, rel), 'utf8')
    if (!/const isShell = \(url\) =>/.test(src)) fail(`${rel} no longer names its shell (T52 N7)`)
    if (!/if \(isApi\(url\)\) return/.test(src)) fail(`${rel} no longer refuses the API outright`)
  }
}

console.log(failed
  ? `\n${failed} failure(s)`
  : `ok: ${workers.length} service worker(s), none caching the shop's data`)
process.exit(failed ? 1 : 0)
