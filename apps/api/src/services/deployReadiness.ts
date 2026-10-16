// "Your CRM is ready" only once it really is.
//
// deployCustomer returns as soon as Render has ACCEPTED the services — the first build is still running, and the
// settings it changes afterwards (rootDir, FRONTEND_URL, a re-registered Stripe secret) each start another deploy.
// The ready email went out at that moment, so the owner's first click was a Render 502 page: a race, but it looks
// broken. The feature sync to the new CRM fired at the same moment and could fail with "CRM may still be starting".
//
// Ready means, for every web service: its LATEST deploy is `live` (nothing newer building or rolling over), and every
// URL the email links answers 2xx — twice, CONFIRM_GAP_MS apart, because Render reports `live` while the previous
// instance can still be the one answering (and a new service answers 502 until its instance binds the port).
// A deploy that FAILS stops the wait at once (it will not fix itself; the caller's normal paths take over).
// After `timeoutMs` the caller gets ready:false and decides — runDeploy sends the email anyway rather than never.

export type DeployState = { serviceId: string; status: string }
export type ReadinessDeps = {
  latestDeployStatus: (serviceId: string) => Promise<string>   // Render's status of the newest deploy, or 'unknown'
  probe: (url: string) => Promise<number>                       // HTTP status, 0 on a network error/timeout
  sleep: (ms: number) => Promise<void>
  now: () => number
}

export const POLL_MS = 20_000
export const CONFIRM_GAP_MS = 30_000
export const DEFAULT_TIMEOUT_MS = 30 * 60_000

const LIVE = 'live'
// Render's terminal failures: the newest deploy will not become live by waiting.
const FAILED = new Set(['build_failed', 'update_failed', 'pre_deploy_failed', 'canceled'])

export type ReadinessResult = { ready: boolean; reason: string; waitedMs: number; services: DeployState[]; probes: Record<string, number> }

export async function waitUntilServing(
  serviceIds: string[],
  urls: string[],
  deps: ReadinessDeps,
  opts: { timeoutMs?: number; pollMs?: number; confirmGapMs?: number } = {},
): Promise<ReadinessResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const pollMs = opts.pollMs ?? POLL_MS
  const confirmGapMs = opts.confirmGapMs ?? CONFIRM_GAP_MS
  const start = deps.now()
  const waited = () => deps.now() - start
  let services: DeployState[] = []
  let probes: Record<string, number> = {}

  const check = async (): Promise<'ok' | 'wait' | 'failed'> => {
    services = await Promise.all(serviceIds.map(async (serviceId) => ({ serviceId, status: await deps.latestDeployStatus(serviceId).catch(() => 'unknown') })))
    if (services.some((s) => FAILED.has(s.status))) return 'failed'
    if (!services.every((s) => s.status === LIVE)) return 'wait'
    probes = Object.fromEntries(await Promise.all(urls.map(async (u) => [u, await deps.probe(u).catch(() => 0)] as const)))
    return Object.values(probes).every((s) => s >= 200 && s < 300) ? 'ok' : 'wait'
  }

  while (waited() < timeoutMs) {
    const first = await check()
    if (first === 'failed') return { ready: false, reason: 'a deploy failed: ' + services.filter((s) => FAILED.has(s.status)).map((s) => `${s.serviceId}=${s.status}`).join(', '), waitedMs: waited(), services, probes }
    if (first === 'ok') {
      // Confirm: still live with nothing newer, still answering, after the gap — the rollover window.
      await deps.sleep(confirmGapMs)
      const second = await check()
      if (second === 'ok') return { ready: true, reason: 'live and answering twice ' + confirmGapMs / 1000 + 's apart', waitedMs: waited(), services, probes }
      if (second === 'failed') return { ready: false, reason: 'a deploy failed: ' + services.filter((s) => FAILED.has(s.status)).map((s) => `${s.serviceId}=${s.status}`).join(', '), waitedMs: waited(), services, probes }
      continue // something started rolling over between the two checks — keep waiting
    }
    await deps.sleep(pollMs)
  }
  return { ready: false, reason: `not serving after ${Math.round(timeoutMs / 60_000)} min`, waitedMs: waited(), services, probes }
}

// The URLs the ready email links, as their probe targets: the API by its /health, every page by itself.
export function readinessUrls(urls: { apiUrl?: string | null; deployedUrl?: string | null; siteUrl?: string | null }): string[] {
  const trim = (u: string) => u.replace(/\/+$/, '')
  const out = new Set<string>()
  if (urls.apiUrl) out.add(trim(urls.apiUrl) + '/health')
  if (urls.deployedUrl) out.add(trim(urls.deployedUrl) + '/')
  if (urls.siteUrl) out.add(trim(urls.siteUrl) + '/')
  return [...out]
}
