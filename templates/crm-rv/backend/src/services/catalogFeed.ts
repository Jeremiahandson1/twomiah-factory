/**
 * Catalog Feed — scheduled distributor/OEM price & cost sync.
 *
 * Pulls a dealer's parts price file (Parts Unlimited / Tucker / WPS / OEM export)
 * from a URL on a schedule, upserts the catalog (price/cost/availability), and
 * refreshes the cost of any stocked item linked to those catalog parts. This is
 * the "parts pricing going forward" rail — the dealer's catalog stays current from
 * the distributors they buy from, not from the old DMS.
 */
import { db } from '../../db/index.ts'
import { catalogFeed, catalogPart, inventoryItem } from '../../db/schema.ts'
import { and, eq, sql } from 'drizzle-orm'
import wpsFeed from './wpsFeed.ts'

const SYNC_INTERVAL = 6 * 60 * 60 * 1000 // every 6h

// Normalized field → possible column names (case/space/_ insensitive). First match wins.
const ALIASES: Record<string, string[]> = {
  partNumber: ['partnumber', 'partno', 'part', 'partnum', 'sku', 'itemnumber', 'item', 'number'],
  name: ['description', 'name', 'desc', 'itemdescription', 'product', 'partdescription'],
  oem: ['oem', 'brand', 'make', 'manufacturer', 'mfg', 'line', 'vendor'],
  category: ['category', 'type', 'group', 'class', 'dept', 'department'],
  price: ['listprice', 'list', 'retail', 'price', 'msrp', 'sell', 'sellprice', 'unitprice'],
  cost: ['dealercost', 'dealerprice', 'cost', 'net', 'yourcost', 'unitcost', 'jobbercost'],
  msrp: ['msrp', 'map'],
  availability: ['availability', 'available', 'stockstatus', 'status'],
  fitment: ['fitment', 'fits', 'application', 'models', 'model', 'fit'],
}

const PRESETS: Record<string, Record<string, string[]>> = {
  generic: {},
  parts_unlimited: { cost: ['dealernet', 'dealercost', 'cost', 'net'], price: ['suggestedretail', 'retail', 'list', 'price'] },
  tucker: { cost: ['dealercost', 'cost', 'net'], price: ['msrp', 'retail', 'list', 'price'] },
  wps: { cost: ['dealerprice', 'cost', 'net'], price: ['listprice', 'retail', 'price'] },
}

const norm = (s: string) => String(s || '').toLowerCase().replace(/[\s_#.\-]+/g, '')

function aliasesFor(provider: string): Record<string, string[]> {
  const preset = PRESETS[provider] || {}
  const merged: Record<string, string[]> = {}
  for (const f of Object.keys(ALIASES)) merged[f] = [...(preset[f] || []), ...ALIASES[f]]
  return merged
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let field = '', row: string[] = [], inQ = false
  text = text.replace(/^﻿/, '')
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQ) { if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else inQ = false } else field += ch }
    else if (ch === '"') inQ = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (ch === '\r') { /* skip */ }
    else field += ch
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  if (rows.length < 2) return []
  const headers = rows[0]
  return rows.slice(1).filter(r => r.some(c => c.trim())).map(r => {
    const o: Record<string, string> = {}
    headers.forEach((h, i) => { o[h] = r[i] ?? '' })
    return o
  })
}

function parseXml(text: string): Record<string, string>[] {
  const tag = (text.match(/<(item|part|record|row|product)\b/i) || [])[1]
  if (!tag) return []
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi')
  const out: Record<string, string>[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const o: Record<string, string> = {}
    const tagRe = /<([A-Za-z0-9_]+)\b[^>]*>([\s\S]*?)<\/\1>/g
    let t: RegExpExecArray | null
    while ((t = tagRe.exec(m[1]))) { const v = t[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim(); if (!o[t[1]]) o[t[1]] = v }
    out.push(o)
  }
  return out
}

const cleanNum = (v: any) => String(v ?? '').replace(/[^0-9.]/g, '')

function mapRow(raw: Record<string, string>, aliases: Record<string, string[]>, defaultOem?: string) {
  const lookup: Record<string, string> = {}
  for (const k of Object.keys(raw)) lookup[norm(k)] = raw[k]
  const out: any = {}
  for (const field of Object.keys(aliases)) {
    for (const alias of aliases[field]) {
      const v = lookup[norm(alias)]
      if (v != null && String(v).trim() !== '') { out[field] = String(v).trim(); break }
    }
  }
  if (!out.partNumber) return null
  return {
    partNumber: out.partNumber,
    name: out.name || out.partNumber,
    oem: out.oem || defaultOem || 'Unspecified',
    category: out.category || 'Parts',
    price: cleanNum(out.price) || cleanNum(out.msrp) || '0',
    cost: cleanNum(out.cost) || null,
    msrp: cleanNum(out.msrp) || null,
    availability: out.availability || 'Order from OEM',
    fitment: out.fitment || null,
  }
}

async function getRawConfig(companyId: string) {
  const [cfg] = await db.select().from(catalogFeed).where(eq(catalogFeed.companyId, companyId)).limit(1)
  return cfg || null
}

/** Public config — never returns the raw API token. */
export async function getConfig(companyId: string) {
  const cfg = await getRawConfig(companyId)
  if (!cfg) return { enabled: false, provider: 'generic', feedUrl: '', hasApiToken: false, format: 'csv', defaultOem: '', lastSyncAt: null, lastCount: 0, lastError: null }
  const { apiToken, ...rest } = cfg as any
  return { ...rest, hasApiToken: !!apiToken }
}

export async function saveConfig(companyId: string, body: any) {
  const values: any = {
    enabled: !!body.enabled,
    provider: String(body.provider || 'generic'),
    feedUrl: String(body.feedUrl || '').trim() || null,
    format: ['csv', 'xml'].includes(body.format) ? body.format : 'csv',
    defaultOem: String(body.defaultOem || '').trim() || null,
    updatedAt: new Date(),
  }
  // Only overwrite the API token when a new non-empty value is supplied (blank = keep existing).
  if (body.apiToken !== undefined && String(body.apiToken).trim() !== '') {
    values.apiToken = String(body.apiToken).trim()
  }
  const [existing] = await db.select({ id: catalogFeed.id }).from(catalogFeed).where(eq(catalogFeed.companyId, companyId)).limit(1)
  if (existing) {
    await db.update(catalogFeed).set(values).where(eq(catalogFeed.id, existing.id))
  } else {
    await db.insert(catalogFeed).values({ companyId, ...values })
  }
  return getConfig(companyId) // masked
}

export async function runFeedImport(companyId: string, force = false): Promise<{ ok: boolean; imported?: number; costsUpdated?: number; pages?: number; error?: string; skipped?: boolean }> {
  const cfg: any = await getRawConfig(companyId)
  if (!cfg || (!force && !cfg.enabled)) return { ok: true, skipped: true }

  // API distributor (WPS) — pull via its Data Depot API on the dealer's own token, not a flat file.
  if (cfg.provider === 'wps') {
    if (!cfg.apiToken) return { ok: false, error: 'No WPS API token configured' }
    const r = await wpsFeed.pullWps(companyId, cfg.apiToken)
    await db.update(catalogFeed).set({
      lastSyncAt: new Date(), lastCount: r.imported || 0,
      lastError: r.ok ? null : (r.error || 'WPS sync failed'), updatedAt: new Date(),
    }).where(eq(catalogFeed.companyId, companyId))
    return r
  }

  if (!cfg.feedUrl) return { ok: false, error: 'No feed URL configured' }
  try {
    const res = await fetch(cfg.feedUrl, { signal: AbortSignal.timeout(45000) })
    if (!res.ok) return { ok: false, error: 'Feed fetch failed: HTTP ' + res.status }
    const text = await res.text()
    const fmt = (cfg.format || (text.trim().startsWith('<') ? 'xml' : 'csv')).toLowerCase()
    const rows = fmt === 'xml' ? parseXml(text) : parseCsv(text)
    const aliases = aliasesFor(cfg.provider || 'generic')
    const parts = rows.map(r => mapRow(r, aliases, cfg.defaultOem || undefined)).filter(Boolean) as any[]

    let imported = 0
    const CHUNK = 500
    for (let i = 0; i < parts.length; i += CHUNK) {
      const batch = parts.slice(i, i + CHUNK).map(p => ({
        companyId, partNumber: p.partNumber, name: p.name, oem: p.oem, category: p.category,
        price: p.price, cost: p.cost, msrp: p.msrp, availability: p.availability, fitment: p.fitment,
        source: 'feed:' + (cfg.provider || 'generic'),
      }))
      if (!batch.length) continue
      await db.insert(catalogPart).values(batch).onConflictDoUpdate({
        target: [catalogPart.companyId, catalogPart.partNumber, catalogPart.oem],
        set: {
          price: sql`excluded.price`, cost: sql`excluded.cost`, msrp: sql`excluded.msrp`,
          availability: sql`excluded.availability`, name: sql`excluded.name`,
          category: sql`excluded.category`, fitment: sql`excluded.fitment`,
          source: sql`excluded.source`, updatedAt: new Date(),
        },
      })
      imported += batch.length
    }

    // Refresh the cost of any stocked item linked to these catalog parts.
    const upd: any = await db.execute(sql`
      UPDATE inventory_item ii SET unit_cost = cp.cost, updated_at = now()
      FROM catalog_part cp
      WHERE ii.catalog_part_id = cp.id AND cp.company_id = ${companyId} AND cp.cost IS NOT NULL
    `)
    const costsUpdated = Number(upd?.rowCount ?? upd?.count ?? 0)

    await db.update(catalogFeed).set({ lastSyncAt: new Date(), lastCount: imported, lastError: null, updatedAt: new Date() }).where(eq(catalogFeed.companyId, companyId))
    console.log(`[CatalogFeed] ${companyId}: imported ${imported} parts, refreshed ${costsUpdated} stocked costs`)
    return { ok: true, imported, costsUpdated }
  } catch (err: any) {
    const error = err?.message || String(err)
    await db.update(catalogFeed).set({ lastError: error, updatedAt: new Date() }).where(eq(catalogFeed.companyId, companyId)).catch(() => {})
    return { ok: false, error }
  }
}

export function startSchedule() {
  const tick = async () => {
    try {
      const enabled = await db.select({ companyId: catalogFeed.companyId }).from(catalogFeed).where(eq(catalogFeed.enabled, true))
      for (const { companyId } of enabled) { await runFeedImport(companyId).catch(() => {}) }
    } catch { /* ignore — DB may not be ready */ }
  }
  setTimeout(tick, 120_000) // first run shortly after boot
  setInterval(tick, SYNC_INTERVAL)
  console.log(`[CatalogFeed] price-feed sync scheduled every ${SYNC_INTERVAL / 3600000}h`)
}

export default { getConfig, saveConfig, runFeedImport, startSchedule }
