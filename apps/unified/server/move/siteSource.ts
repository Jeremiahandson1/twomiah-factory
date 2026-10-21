// Where a moving business's website comes from (run.ts), one of two:
//   fresh    a new site — the starting website a new business gets (modules/provision.ts writeStartingSite), written
//            for the moved company once its records are in (owner, 2026-10-21: Higgs and 547 get new sites)
//   premium  the old premium site AS IT IS (owner: Amber Inn's site must not change): its database, rebuilt by the
//            Factory from the site's own admin export in the template's own SQLite layout, moved by site.ts — the
//            tested move — inside the records' transaction; its photo files read from the old site's own addresses.
// The package is a JSON file the Factory leaves in the business's own storage bucket (run.ts MOVE_SITE_KEY).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { provisionSchema, writeStartingSite, type StartingSite } from '../modules/provision.ts'
import { createDb } from '../db/client.ts'
import { company } from '../db/schema/index.ts'
import { asc } from 'drizzle-orm'
import { siteMoveSteps, type SiteFiles, type SiteMoveReport } from './site.ts'
import type { MoveStep } from './copy.ts'
import type { PhotoStore } from '../site/admin.ts'

/**
 * fresh.leadsFrom: the old site's database, rebuilt for its enquiries alone (a site whose forward to the CRM failed, or
 * that never had one, kept them only there) — they move into the CRM with the records; nothing else of it is read.
 */
export type SitePackage = { fresh: StartingSite; leadsFrom?: { siteDb: string } } | { premium: { siteDb: string; filesBase: string } }

/** Checked as the Factory's own provisioning checks a starting site; a premium package needs its database and address. */
export function parseSitePackage(j: any): SitePackage {
  if (j?.fresh) {
    const fresh = provisionSchema.shape.site.unwrap().parse(j.fresh)
    if (j.leadsFrom === undefined) return { fresh }
    if (typeof j.leadsFrom?.siteDb !== 'string' || !j.leadsFrom.siteDb) throw new Error("the old site's enquiries were named but their database is missing")
    return { fresh, leadsFrom: { siteDb: j.leadsFrom.siteDb } }
  }
  if (j?.premium) {
    const { siteDb, filesBase } = j.premium
    if (typeof siteDb !== 'string' || !siteDb) throw new Error('the premium site package has no database')
    if (!/^https:\/\/[^/]+$/.test(String(filesBase))) throw new Error('the premium site package needs the old site\'s https address')
    return { premium: { siteDb, filesBase } }
  }
  throw new Error('the site package is neither a fresh site nor a premium site')
}

/** The old site's files by the addresses its pages use (/media/…, /images/…, /uploads/…), from the old site itself. */
export function filesFromSite(base: string, fetchImpl: typeof fetch = fetch): SiteFiles {
  return {
    async get(urlPath) {
      const r = await fetchImpl(base + urlPath).catch(() => null)
      if (!r || !r.ok) return null
      return { body: new Uint8Array(await r.arrayBuffer()), contentType: (r.headers.get('content-type') || 'application/octet-stream').split(';')[0] }
    },
  }
}

/** The premium site's move as steps inside the records' transaction (site.ts siteMoveSteps), its database from the package. */
export function premiumSiteSteps(p: { siteDb: string; filesBase: string }, store: PhotoStore, fetchImpl?: typeof fetch): { steps: MoveStep[]; report: SiteMoveReport; undoFiles: () => Promise<void> } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-move-'))
  const file = path.join(dir, 'site.db')
  fs.writeFileSync(file, Buffer.from(p.siteDb, 'base64'))
  // AS IT IS: where the CRM's name, phone, address, colours or logo differ from what the site shows, the site's win —
  // the site reads them from the company (site.ts identity 'site'), and the owner's word was that it must not change.
  const move = siteMoveSteps({ siteDb: file, files: filesFromSite(p.filesBase, fetchImpl), store, identity: 'site' })
  return { steps: move.steps, report: move.report, undoFiles: move.undoFiles }
}

/** The old site's enquiries alone (site.ts scope 'leads'), as steps inside the records' transaction. No files are read. */
export function siteLeadsSteps(p: { siteDb: string }, store: PhotoStore): { steps: MoveStep[]; report: SiteMoveReport } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-leads-'))
  const file = path.join(dir, 'site.db')
  fs.writeFileSync(file, Buffer.from(p.siteDb, 'base64'))
  const move = siteMoveSteps({ siteDb: file, files: { get: async () => null }, store, scope: 'leads' })
  return { steps: move.steps, report: move.report }
}

/** A fresh site for the business the move just wrote — its own transaction, after the records are in. Returns its page count. */
export async function writeFreshSite(db: any, site: StartingSite): Promise<number> {
  return db.transaction(async (tx: any) => {
    const [co] = await tx.select({ id: company.id }).from(company).orderBy(asc(company.createdAt)).limit(1)
    if (!co) throw new Error('no business to give a site to — the records did not move')
    return writeStartingSite(tx, co.id, site)
  })
}

/** writeFreshSite on the service's own database (run.ts main). */
export async function writeFreshSiteAt(url: string, site: StartingSite): Promise<number> {
  const { db, pool } = createDb(url)
  try { return await writeFreshSite(db, site) } finally { await pool.end() }
}
