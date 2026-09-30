// crm-dispensary — T52 N7: the service worker must not freeze a live server answer.
//
// /health is a server route and it lives OUTSIDE /api/. The worker excluded /api/ and cached
// everything else, cache-first, so /health went into the shell cache and stayed there. A tester
// checking whether a deploy had landed got a response about 22 hours stale — an uptime for a process
// that had been replaced — and only a cache-busted request told the truth. Any method that reads
// /health to tell whether the new build is live was quietly broken, which is the method everyone
// uses, including the one in every brief this project writes.
//
// The prefix list was never the rule; it was a guess at the rule. The worker exists so the register
// opens with no internet, and the only thing that needs is the built shell. So the shell is named
// and everything else goes to the network — a server route added next year is live by default
// rather than silently frozen. Being wrong that way costs a round trip; being wrong the other way
// serves a till numbers that are not true.
//
// This reads the shipped worker rather than running a browser: there is no service-worker runtime in
// this harness, and the file is plain JS whose decisions are in one function. It is the same shape
// as tests/salon/contrast-batch.test.ts, which reads template source for the same reason.
const FACTORY_ROOT = (() => {
  const r = process.env.FACTORY_ROOT
  if (!r) throw new Error('FACTORY_ROOT is not set — run this through tests/dispensary/harness/run.ts')
  return r.endsWith('/') ? r : r + '/'
})()

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

const SW = FACTORY_ROOT + 'templates/crm-dispensary/frontend/public/sw.js'
const src = (await Bun.file(SW).text()).replace(/\r\n/g, '\n')

// Lift the worker's own decision function out and run it. Re-implementing it here would test a copy.
const isShell: (url: URL) => boolean = (() => {
  const m = src.match(/const isShell = \(url\) => \{[\s\S]*?\n\}/)
  if (!m) throw new Error('isShell is no longer in sw.js — if the shell rule moved, this test has to follow it')
  // eslint-disable-next-line no-new-func
  return new Function(`${m[0]}; return isShell`)() as any
})()
const path = (p: string) => new URL(p, 'https://leaf.example.com')

// ══════════ the finding ═════════════════════════════════════════════════════════════════════════
{
  check('/health is NOT cacheable — it used to be, for 22 hours at a time', isShell(path('/health')) === false, '/health')
  check('…and neither is anything under /api/', isShell(path('/api/orders')) === false, '/api/orders')
  check('…nor /media, which is customer data and not the shell', isShell(path('/media/abc123.jpg')) === false, '/media')
}

// ══════════ a server route added later is live by default ═══════════════════════════════════════
//
// This is the whole point of naming the shell instead of naming the exclusions. None of these paths
// exists today; all of them would have been frozen by the old rule.
{
  for (const p of ['/health', '/healthz', '/ready', '/metrics', '/version', '/status', '/webhooks/stripe', '/receipt/123']) {
    check(`a server route at ${p} goes to the network`, isShell(path(p)) === false, p)
  }
}

// ══════════ …and the shell is still cached, or the register does not open offline ═══════════════
//
// It would be easy to "fix" staleness by caching nothing, and every assertion above would pass on a
// worker that no longer does its job at all.
{
  check('the app root is cached', isShell(path('/')) === true, '/')
  check('index.html is cached', isShell(path('/index.html')) === true, '/index.html')
  check('the fingerprinted bundle is cached', isShell(path('/assets/index-1IpSlq-v.js')) === true, '/assets/…js')
  check('…and its stylesheet', isShell(path('/assets/index-CWgWVMw1.css')) === true, '/assets/…css')
  check('the web app manifest is cached', isShell(path('/manifest.json')) === true, '/manifest.json')
  check('the favicon is cached', isShell(path('/favicon.svg')) === true, '/favicon.svg')
}

// ══════════ the worker still refuses the API in its own words ═══════════════════════════════════
{
  check('the fetch handler still returns early for /api/', /if \(isApi\(url\)\) return/.test(src), null)
  check('…and now returns early for anything that is not the shell', /if \(!isShell\(url\)\) return/.test(src), null)
}

// ══════════ the cache name moved, or the tills already running keep their stale copy ════════════
//
// A worker that fixes the rule and keeps the cache name leaves every register that already has a
// poisoned /health exactly as it was: activate only drops caches whose name is not the current one.
{
  const name = src.match(/const SHELL_CACHE = '([^']+)'/)?.[1] || ''
  check('the shell cache name is no longer the one holding the stale /health', !/-v2'?$/.test(name), name)
  check('…and activate still drops every cache that is not the current one',
    /names\.filter\(\(n\) => n !== SHELL_CACHE\)/.test(src), null)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
