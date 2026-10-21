/**
 * The move of a live business to the unified app (src/unified/move.ts), one stage per run. Run it ON THE FACTORY (a Render
 * one-off job on twomiah-factory-api), where the production settings are — never with a laptop's .env, which would
 * build the business's new service with whatever keys that file holds.
 *
 *   bun apps/api/src/unified/moveBusiness.ts inspect  <tenant-slug> <fresh|premium|none> [old-site-service-id]
 *   bun apps/api/src/unified/moveBusiness.ts prepare  <tenant-slug> <fresh|premium|none> [old-site-service-id]
 *   bun apps/api/src/unified/moveBusiness.ts check    <move-id>        the rehearsal: everything copied, then rolled back
 *   bun apps/api/src/unified/moveBusiness.ts move     <move-id>        ONLY with the owner's yes: suspends the old CRM, copies
 *   bun apps/api/src/unified/moveBusiness.ts switch   <move-id>        ONLY with the owner's yes: domains, records, tenant row
 *   bun apps/api/src/unified/moveBusiness.ts rollback <move-id>
 *
 * Prints its result as indented JSON, every line prefixed `MS| ` (a job's log is read line by line, and one long line
 * can be cut); never prints a secret (the facts carry names, not values). Each stage also records itself on the
 * business's tenant_moves row.
 */
import { liveMoveDeps, inspectMove, prepareMove, runMoveJob, switchMove, rollbackMove, type MoveSite } from './move'

const [stage, arg, site, oldSite] = process.argv.slice(2)
const out = (o: unknown) => { for (const line of JSON.stringify(o, null, 1).split('\n')) console.log('MS| ' + line) }
const SITES = ['fresh', 'premium', 'none']

async function main() {
  if (/claflin/i.test(arg || '')) throw new Error('not this business')
  const d = await liveMoveDeps()
  const tenantOf = async (slug: string) => {
    const { data, error } = await d.db.from('tenants').select('id').eq('slug', slug).single()
    if (error || !data) throw new Error('no tenant ' + slug)
    return data.id as string
  }
  const brief = (f: any) => ({ ...f, tenant: { id: f.tenant.id, slug: f.tenant.slug, name: f.tenant.name, industry: f.tenant.industry, domain: f.tenant.domain } })
  switch (stage) {
    case 'inspect':
    case 'prepare': {
      if (!SITES.includes(site)) throw new Error('the website: fresh, premium or none')
      const o = { site: site as MoveSite, oldSiteServiceId: oldSite || null }
      const id = await tenantOf(arg)
      if (stage === 'inspect') return out({ stage, facts: brief(await inspectMove(id, o, d)) })
      const r = await prepareMove(id, o, d)
      return out({ stage, moveId: r.moveId, success: r.success, steps: r.steps, errors: r.errors, facts: brief(r.facts) })
    }
    case 'check':
    case 'move': return out({ stage, ...(await runMoveJob(arg, stage, d)) })
    case 'switch': return out({ stage, ...(await switchMove(arg, d)) })
    case 'rollback': return out({ stage, ...(await rollbackMove(arg, d)) })
    default: throw new Error('stage: inspect, prepare, check, move, switch or rollback')
  }
}

main().then(() => process.exit(0), (e) => { out({ stage, ok: false, error: e?.message || String(e) }); process.exit(1) })
