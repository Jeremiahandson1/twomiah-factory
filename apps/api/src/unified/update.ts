/**
 * Update Code for unified tenants: the unified app at a new version, pushed to the tenant's repo, and waited for
 * until the tenant's /health answers with that commit. Every tenant's repo is the same code at one version
 * (tree.ts), so updating all of them is the same step repeated — one at a time, stopping at the first that fails, so a
 * bad version reaches one business, not every business.
 *
 * Only the tenant's own repo and service are touched (services/deploy.ts checkUpdateOwnership's rule). Its settings
 * and database are not changed; the new code's migrations run at its boot, and a failed one stops that boot, so the
 * old instance keeps serving.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildTenantTree } from './tree'
import { waitForCommit, type BuildIo, type Owned, type Step } from './build'

export interface UnifiedTenantRecord {
  tenantId: string
  slug: string
  repo: string
  serviceId: string
  serviceUrl: string
}

export interface UpdateResult {
  tenantId: string
  success: boolean
  steps: Step[]
  errors: string[]
  commit?: string
}

export async function updateUnifiedTenant(
  t: UnifiedTenantRecord, owned: Owned, src: { root: string; version: string; waitMs?: number }, io: BuildIo,
): Promise<UpdateResult> {
  const steps: Step[] = []
  const errors: string[] = []
  const stop = (step: string, detail: string): UpdateResult => { steps.push({ step, status: 'error', detail }); errors.push(detail); return { tenantId: t.tenantId, success: false, steps, errors } }

  // The repo and service must be the ones recorded for this tenant, and the service must run that repo.
  if (!owned.repos.has(t.repo.toLowerCase())) return stop('ownership', `GitHub repo ${t.repo} is not recorded as this tenant's — no code was pushed`)
  if (!owned.serviceIds.has(t.serviceId)) return stop('ownership', `Render service ${t.serviceId} is not recorded as this tenant's — nothing was changed`)
  try {
    const svc = await io.hosts.getService(t.serviceId)
    const runs = String(svc.repo || '').replace(/^https:\/\/github\.com\//i, '').replace(/\.git$/, '').toLowerCase()
    if (runs !== t.repo.toLowerCase()) return stop('ownership', `service ${t.serviceId} runs ${runs || 'no repo'}, not ${t.repo} — nothing was changed`)
  } catch (e: any) { return stop('ownership', 'could not check the service (' + e.message + ') — nothing was changed') }
  steps.push({ step: 'ownership', status: 'ok' })

  const dir = path.join(os.tmpdir(), `unified-update-${t.slug}-${Date.now()}`)
  let commit: string
  try {
    buildTenantTree(src.root, dir, src.version)
    // The commands follow the code (Render keeps a service's commands from its creation otherwise).
    await io.hosts.updateServiceCommands(t.serviceId)
    commit = await io.push(t.repo, dir)
    steps.push({ step: 'push', status: 'ok', detail: `${src.version.slice(0, 9)} as ${commit.slice(0, 9)}` })
  } catch (e: any) {
    return stop('push', e.message)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }

  const live = await waitForCommit(io.hosts, io.sleep, t.serviceUrl, commit, src.waitMs ?? 20 * 60_000)
  if (!live.ok) return { ...stop('live', `${t.serviceUrl} did not answer with ${commit.slice(0, 9)} in time (still on ${live.seen ? live.seen.slice(0, 9) : 'no answer'})`), commit }
  steps.push({ step: 'live', status: 'ok', detail: t.serviceUrl + ' runs ' + commit.slice(0, 9) })
  return { tenantId: t.tenantId, success: true, steps, errors, commit }
}

/** Every tenant, in order, stopping at the first that fails; the rest are listed as not attempted. */
export async function updateAllUnifiedTenants(
  tenants: Array<{ record: UnifiedTenantRecord; owned: Owned }>, src: { root: string; version: string; waitMs?: number }, io: BuildIo,
): Promise<{ updated: UpdateResult[]; failed: UpdateResult | null; notAttempted: string[] }> {
  const updated: UpdateResult[] = []
  for (let i = 0; i < tenants.length; i++) {
    const r = await updateUnifiedTenant(tenants[i].record, tenants[i].owned, src, io)
    if (!r.success) return { updated, failed: r, notAttempted: tenants.slice(i + 1).map((x) => x.record.tenantId) }
    updated.push(r)
  }
  return { updated, failed: null, notAttempted: [] }
}
