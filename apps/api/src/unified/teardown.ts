/**
 * Removes a unified tenant: its service, its repo and its own database server — each only when it is recorded as this
 * tenant's. Anything else is left and reported.
 */
import type { BuildIo, Owned } from './build'

export async function teardownUnifiedTenant(
  t: { tenantId: string; repo?: string | null; serviceId?: string | null; databaseId?: string | null },
  owned: Owned, io: BuildIo,
): Promise<{ removed: string[]; left: string[]; errors: string[] }> {
  const removed: string[] = []
  const left: string[] = []
  const errors: string[] = []
  const remove = async (what: string, id: string | null | undefined, isOwned: boolean, del: () => Promise<boolean>) => {
    if (!id) return
    if (!isOwned) { left.push(`${what} ${id}: not recorded as this tenant's`); return }
    try { await del(); removed.push(`${what} ${id}`) } catch (e: any) { errors.push(`${what}: ${e.message}`) }
  }
  await remove('service', t.serviceId, !!t.serviceId && owned.serviceIds.has(t.serviceId), () => io.hosts.deleteService(t.serviceId!))
  await remove('repo', t.repo, !!t.repo && owned.repos.has(t.repo.toLowerCase()), () => io.hosts.deleteRepo(t.repo!))
  await remove('database', t.databaseId, !!t.databaseId && owned.databaseIds.has(t.databaseId), () => io.hosts.deleteDatabase(t.databaseId!))
  return { removed, left, errors }
}
