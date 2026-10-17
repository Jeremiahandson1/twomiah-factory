// "Your CRM is ready" waits until Render has really finished. (10/16)
//
// The ready email went out the moment Render ACCEPTED the services — the first build still running, and the deploys
// that the settings changes after it start (rootDir, FRONTEND_URL, a re-registered Stripe secret) still to come. The
// owner's first click was a Render 502: a race that looks like a broken product. services/deployReadiness.ts waits
// for every service's newest deploy to be live AND every emailed URL to answer, twice, 30s apart. This plays each way
// Render behaves through it on a fake clock, and checks both senders wait before they email.
import { readFileSync } from 'node:fs'
const { waitUntilServing, readinessUrls, CONFIRM_GAP_MS, DEFAULT_TIMEOUT_MS } = await import('../../apps/api/src/services/deployReadiness.ts')

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}

// A fake Render: each service and URL follows a timeline of [fromMs, value] — the value in force at the fake time.
type Timeline<T> = [number, T][]
const at = <T,>(tl: Timeline<T>, t: number): T => tl.filter(([from]) => from <= t).pop()![1]
function world(deploys: Record<string, Timeline<string>>, urls: Record<string, Timeline<number>>) {
  let t = 0
  const calls = { status: 0, probe: 0, probeTimes: [] as number[] }
  return {
    deps: {
      latestDeployStatus: async (id: string) => { calls.status++; return at(deploys[id], t) },
      probe: async (u: string) => { calls.probe++; calls.probeTimes.push(t); return at(urls[u], t) },
      sleep: async (ms: number) => { t += ms },
      now: () => t,
    },
    calls,
    time: () => t,
  }
}
const MIN = 60_000
const API = 'https://acme-api.onrender.com/health', APP = 'https://acme-api.onrender.com/'

{
  // The ordinary signup: building for 4 minutes, live, then 502 while the instance binds, then up.
  const w = world({ be: [[0, 'build_in_progress'], [4 * MIN, 'live']] }, { [API]: [[0, 502], [5 * MIN, 200]], [APP]: [[0, 502], [5 * MIN, 200]] })
  const r = await waitUntilServing(['be'], [API, APP], w.deps)
  check('a new CRM: ready only once it is live AND answering (not while building, not on the 502)', r.ready && w.time() >= 5 * MIN + CONFIRM_GAP_MS, { r, t: w.time() })
  check('…and the URLs were not even tried while Render was still building', w.calls.probe > 0 && w.calls.probeTimes.every((t) => t >= 4 * MIN), w.calls.probeTimes)
}
{
  // The race the owner hit: live and answering — then the FRONTEND_URL change starts another deploy (rolling over).
  const w = world({ be: [[0, 'live'], [10_000, 'update_in_progress'], [3 * MIN, 'live']] }, { [API]: [[0, 200], [20_000, 502], [3 * MIN + 10_000, 200]] })
  const r = await waitUntilServing(['be'], [API], w.deps)
  check('a deploy that starts after the first "live" is waited out (the confirm check catches the rollover)', r.ready && w.time() >= 3 * MIN + 10_000, { r, t: w.time() })
}
{
  // Live but the old instance still answering, then a gap of 502 during the swap — the second check must see it.
  const w = world({ be: [[0, 'live']] }, { [API]: [[0, 200], [CONFIRM_GAP_MS, 502], [2 * MIN, 200]] })
  const r = await waitUntilServing(['be'], [API], w.deps)
  check('one 200 is not enough: a 502 on the confirm check keeps it waiting', r.ready && w.time() >= 2 * MIN, { r, t: w.time() })
}
{
  // CRM and website: the website still building after the CRM is up — the email links both.
  const SITE = 'https://acme-site.onrender.com/'
  const w = world({ be: [[0, 'live']], site: [[0, 'build_in_progress'], [6 * MIN, 'live']] }, { [API]: [[0, 200]], [SITE]: [[0, 404], [6 * MIN, 200]] })
  const r = await waitUntilServing(['be', 'site'], [API, SITE], w.deps)
  check('every service and every emailed URL — a website still building holds the email', r.ready && w.time() >= 6 * MIN, { r, t: w.time() })
}
{
  const w = world({ be: [[0, 'build_in_progress'], [2 * MIN, 'build_failed']] }, { [API]: [[0, 502]] })
  const r = await waitUntilServing(['be'], [API], w.deps)
  check('a failed build stops the wait at once (it will not fix itself) and says which', !r.ready && /build_failed/.test(r.reason) && w.time() < 3 * MIN, { r, t: w.time() })
}
{
  const w = world({ be: [[0, 'live']] }, { [API]: [[0, 503]] })
  const r = await waitUntilServing(['be'], [API], w.deps)
  check('never answering: gives up after the ceiling with ready:false (the caller treats it as a failed deploy — deployOutcome)', !r.ready && w.time() >= DEFAULT_TIMEOUT_MS && w.time() < DEFAULT_TIMEOUT_MS + 2 * MIN && /not serving/.test(r.reason), { r, t: w.time() })
}
{
  const w = world({ be: [[0, 'live']] }, { [API]: [[0, 200]] })
  const thrower = { ...w.deps, probe: async () => { throw new Error('ECONNRESET') }, latestDeployStatus: async () => 'live' }
  const r = await waitUntilServing(['be'], [API], thrower, { timeoutMs: 5 * MIN })
  check('a network error counts as not answering — it does not crash the deploy', !r.ready && r.probes[API] === 0, r)
}
check('the email\'s links become probe targets: the API by /health, pages by themselves',
  JSON.stringify(readinessUrls({ apiUrl: 'https://a.onrender.com/', deployedUrl: 'https://a.onrender.com', siteUrl: 'https://s.onrender.com' }))
    === JSON.stringify(['https://a.onrender.com/health', 'https://a.onrender.com/', 'https://s.onrender.com/']))

// ── both senders wait before they email — and the signup's feature sync waits too
const read = (p: string) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))
const route = read('apps/api/src/routes/factory/deploy.ts')
const runDeploy = route.slice(route.indexOf('export async function runDeploy'), route.indexOf('\n}\n', route.indexOf('export async function runDeploy')))
const iWait = runDeploy.indexOf('await waitUntilServing('), iSync = runDeploy.indexOf("'/api/internal/sync-features'"), iMail = runDeploy.indexOf('notifyDeployComplete(')
check('runDeploy waits before the feature sync and before the ready email', iWait > 0 && iSync > iWait && iMail > iWait, { iWait, iSync, iMail })
// 10/17 (Amber Inn): the email used to follow the deploy's URLs "rather than never" — it now follows ONLY a wait that
// passed (deployOutcome); tests/shared/deploy-ownership.test.ts checks the not-ready side.
check('…and the email is sent only on the wait result, so it is never sent unwaited',
  /if \(\(result\.success \|\| result\.deployedUrl \|\| result\.apiUrl\) && webServiceIds\.length\) \{\s*readiness = await waitUntilServing\(/.test(runDeploy)
    && /outcome = deployOutcome\(readiness\)/.test(runDeploy) && /if \(outcome\.sendReadyEmail\) \{[\s\S]{0,1200}notifyDeployComplete\(/.test(runDeploy))
check('…and not on the database, which has no deploys to wait for', /filter\(\(\[role\]\) => role !== 'database'\)/.test(runDeploy))
// Run 4: "The CRM returned 502 for ~2–3 minutes after the Factory showed the tenant Active; the Factory showed no
// website address." Active was written with the URLs, before the wait; the website's address only after it.
const iActive = runDeploy.indexOf("update({ status: 'active' })"), iSite = runDeploy.indexOf('optionalUpdate.website_url = result.siteUrl')
check('the tenant is marked Active only after the readiness wait — on the same result the email follows', iActive > iWait && iActive < iMail, { iWait, iActive, iMail })
check('…and the URLs saved before the wait no longer carry the status',
  /const criticalUpdate: Record<string, any> = \{\}/.test(runDeploy) && (runDeploy.match(/status: 'active'/g) || []).length === 1)
check('the website address is saved BEFORE the wait, like the CRM\'s URL — not up to 30 minutes later', iSite > 0 && iSite < iWait, { iSite, iWait })
check('nothing else in the Factory marks a tenant Active early', (route.match(/status: 'active'/g) || []).length === 1)
const addon = read('apps/api/src/services/crmAddonProvision.ts')
const aWait = addon.indexOf('await waitUntilServing('), aMail = addon.indexOf("'Your Twomiah CRM is ready'")
check('adding a CRM to a website customer waits before its own "CRM is ready" email', aWait > 0 && aMail > aWait, { aWait, aMail })

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
