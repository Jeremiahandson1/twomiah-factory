/**
 * Inventory importer — pulls a dealer's EXISTING DMS inventory feed (the same
 * CSV/XML they already syndicate to RV Trader / RVUSA) and writes it to
 * data/inventory.json in the SAME normalized shape as the crm-rv `unit` table —
 * so when the dealer later converts to our CRM, the flip is a straight copy.
 *
 * File-based (the standard website has no Postgres). Config lives in
 * data/inventory-config.json: { enabled, provider, feedUrl, format, mapping? }.
 * Runs on a schedule (startSchedule) + can be triggered manually (runImport).
 *
 * Provider presets just add column aliases on top of a broad generic map, so a
 * new DMS usually works with `provider: "generic"` and no custom mapping.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import appPaths from '../config/paths.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = appPaths.data
const inventoryFile = path.join(dataDir, 'inventory.json')
const configFile = path.join(dataDir, 'inventory-config.json')

const SYNC_INTERVAL = 3 * 60 * 60 * 1000 // every 3h

// ─── Normalized field → possible external column names (case/space/_ insensitive) ──
// Keys are our crm-rv `unit` field names. Order matters: first match wins.
const GENERIC_ALIASES: Record<string, string[]> = {
  stockNumber: ['stocknumber', 'stockno', 'stock', 'stk', 'stocknum', 'stocknumber#'],
  vin: ['vin', 'vinnumber', 'serialnumber', 'serial', 'serialno'],
  hin: ['hin', 'hullid', 'hullidnumber'],
  condition: ['condition', 'newused', 'newvsused', 'usagetype', 'conditiontype'],
  category: ['category', 'type', 'unittype', 'bodytype', 'vehicletype', 'producttype', 'class'],
  year: ['year', 'modelyear', 'yr'],
  make: ['make', 'manufacturer', 'brand', 'mfg'],
  modelName: ['model', 'modelname', 'modelno'],
  trim: ['trim', 'floorplan', 'series', 'package'],
  status: ['status', 'availability', 'available', 'instock', 'webstatus'],
  msrp: ['msrp', 'listprice', 'retailprice', 'retail', 'mfgprice'],
  listedPrice: ['internetprice', 'webprice', 'sellingprice', 'saleprice', 'price', 'ourprice', 'askingprice', 'salesprice'],
  cost: ['cost', 'dealercost', 'invoice'],
  description: ['description', 'comments', 'notes', 'details', 'webcomments', 'adcopy'],
  photos: ['photos', 'images', 'imageurls', 'photourls', 'pictures', 'imageurl', 'photo', 'media'],
  floorplanImg: ['floorplanimage', 'floorplanimg', 'floorplanurl'],
  exteriorColor: ['exteriorcolor', 'extcolor', 'color', 'colour', 'exterior'],
  interiorColor: ['interiorcolor', 'intcolor', 'interior'],
  rvClass: ['rvclass', 'class', 'motorhomeclass'],
  towableType: ['towabletype', 'trailertype'],
  lengthFt: ['length', 'lengthft', 'overalllength', 'lengthfeet'],
  sleeps: ['sleeps', 'sleepingcapacity', 'sleepcount'],
  slideOuts: ['slideouts', 'slides', 'slideout'],
  gvwr: ['gvwr', 'grossweight'],
  dryWeight: ['dryweight', 'unloadedweight', 'shipweight'],
  hitchWeight: ['hitchweight', 'tongueweight'],
  chassis: ['chassis'],
  fuelType: ['fueltype', 'fuel'],
  engine: ['engine', 'enginedescription'],
  engineCc: ['enginecc', 'displacementcc', 'cc'],
  mileage: ['mileage', 'miles', 'odometer'],
  hours: ['hours', 'enginehours', 'usehours'],
  transmission: ['transmission', 'trans'],
  drivetrain: ['drivetrain', 'drive', 'driveline'],
  // marine
  beamFt: ['beam', 'beamft'],
  draftFt: ['draft', 'draftft'],
  hullMaterial: ['hullmaterial', 'hull'],
  engineType: ['enginetype', 'propulsion'],
  engineCount: ['enginecount', 'numengines', 'engines'],
  engineHp: ['enginehp', 'horsepower', 'hp', 'totalhp'],
  fuelCapacityGal: ['fuelcapacity', 'fuelcapacitygal', 'fueltank'],
  maxPersons: ['maxpersons', 'capacity', 'personcapacity'],
}

const PRESETS: Record<string, Record<string, string[]>> = {
  generic: {},
  // Lightspeed exports tend to use these column names; they just extend generic.
  lightspeed: {
    stockNumber: ['stocknumber', 'stock'],
    listedPrice: ['websiteprice', 'internetprice', 'sellingprice', 'price'],
    category: ['majorunittype', 'unittype', 'category', 'type'],
    modelName: ['modelname', 'model'],
    photos: ['imageurllist', 'images', 'photos'],
  },
  motility: {
    stockNumber: ['stocknumber', 'stockno'],
    listedPrice: ['internetprice', 'saleprice', 'price'],
    category: ['producttype', 'category', 'type'],
    photos: ['imageurls', 'photos'],
  },
  dx1: {
    stockNumber: ['stocknumber', 'stockid'],
    listedPrice: ['saleprice', 'price', 'internetprice'],
    category: ['vehicletype', 'category'],
    photos: ['images', 'photos', 'imageurls'],
  },
  blackpurl: {
    stockNumber: ['stocknumber', 'stock'],
    listedPrice: ['sellingprice', 'price'],
    category: ['unittype', 'category'],
    photos: ['images', 'photos'],
  },
}

const NUMERIC_INT = new Set(['year', 'sleeps', 'slideOuts', 'gvwr', 'dryWeight', 'hitchWeight', 'engineCc', 'mileage', 'hours', 'engineCount', 'engineHp', 'fuelCapacityGal', 'maxPersons'])
const DECIMAL = new Set(['msrp', 'listedPrice', 'cost', 'lengthFt', 'beamFt', 'draftFt'])

function norm(s: string): string { return String(s || '').toLowerCase().replace(/[\s_#.-]+/g, '') }

function aliasesFor(provider: string): Record<string, string[]> {
  const preset = PRESETS[provider] || {}
  const merged: Record<string, string[]> = {}
  for (const field of Object.keys(GENERIC_ALIASES)) {
    merged[field] = [...(preset[field] || []), ...GENERIC_ALIASES[field]]
  }
  return merged
}

function normalizeCategory(v: string): string {
  const s = norm(v)
  if (!s) return 'motorhome'
  if (/(classa|classb|classc|motorhome|motorcoach|diesel|gas)/.test(s)) return 'motorhome'
  if (/(traveltrailer|fifthwheel|5thwheel|toyhauler|popup|trailer|towable|destination)/.test(s)) return 'towable'
  if (/(sidebyside|sxs|utv)/.test(s)) return 'utv'
  if (/atv/.test(s)) return 'atv'
  if (/(motorcycle|bike|scooter|cruiser)/.test(s)) return 'motorcycle'
  if (/(pwc|jetski|waverunner|personalwatercraft)/.test(s)) return 'pwc'
  if (/(snowmobile|sled)/.test(s)) return 'snowmobile'
  if (/(boat|pontoon|vessel|marine)/.test(s)) return 'boat'
  return 'motorhome'
}

function normalizeCondition(v: string): string {
  const s = norm(v)
  if (/consign/.test(s)) return 'consignment'
  if (/(used|preowned|pre-owned|secondhand)/.test(s)) return 'used'
  return /new/.test(s) ? 'new' : 'used'
}

function normalizeStatus(v: string): string {
  const s = norm(v)
  if (/sold/.test(s)) return 'sold'
  if (/pending/.test(s)) return 'pending'
  if (/(onorder|incoming)/.test(s)) return 'on_order'
  return 'available'
}

function cleanNumber(v: any): string {
  return String(v ?? '').replace(/[^0-9.]/g, '')
}

// ─── CSV parser (handles quoted fields with embedded commas/newlines) ──────────
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let field = '', row: string[] = [], inQuotes = false
  text = text.replace(/^﻿/, '') // strip BOM
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false }
      else field += ch
    } else if (ch === '"') inQuotes = true
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

// ─── XML parser (record-oriented feeds: <item>/<unit>/<vehicle>/<inventory>) ───
function parseXml(text: string): Record<string, string>[] {
  // find the repeating record tag
  const recordTag = (text.match(/<(item|unit|vehicle|listing|inventoryitem|rv)\b/i) || [])[1]
  if (!recordTag) return []
  const re = new RegExp(`<${recordTag}\\b[^>]*>([\\s\\S]*?)</${recordTag}>`, 'gi')
  const out: Record<string, string>[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const body = m[1]
    const o: Record<string, string> = {}
    const tagRe = /<([A-Za-z0-9_]+)\b[^>]*>([\s\S]*?)<\/\1>/g
    let t: RegExpExecArray | null
    while ((t = tagRe.exec(body))) {
      const val = t[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()
      if (!o[t[1]]) o[t[1]] = val
      // collect repeated <image>/<photo> into a |-joined list
      else if (/image|photo/i.test(t[1])) o[t[1]] += '|' + val
    }
    out.push(o)
  }
  return out
}

function mapRow(raw: Record<string, string>, aliases: Record<string, string[]>): any {
  // build a normalized-key lookup of the raw row
  const lookup: Record<string, string> = {}
  for (const k of Object.keys(raw)) lookup[norm(k)] = raw[k]

  const unit: any = { source: 'dms_import' }
  for (const field of Object.keys(aliases)) {
    for (const alias of aliases[field]) {
      const v = lookup[norm(alias)]
      if (v != null && String(v).trim() !== '') { unit[field] = String(v).trim(); break }
    }
  }
  if (!unit.stockNumber && !unit.vin) return null // need an identity

  unit.category = normalizeCategory(unit.category || unit.rvClass || unit.towableType || '')
  unit.condition = normalizeCondition(unit.condition || '')
  unit.status = normalizeStatus(unit.status || 'available')
  unit.photos = unit.photos
    ? String(unit.photos).split(/[|,;]\s*/).map((s: string) => s.trim()).filter(Boolean)
    : []
  for (const f of NUMERIC_INT) if (unit[f]) { const n = parseInt(cleanNumber(unit[f]), 10); unit[f] = Number.isFinite(n) ? n : undefined }
  for (const f of DECIMAL) if (unit[f]) unit[f] = cleanNumber(unit[f]) || undefined
  unit.id = unit.stockNumber || unit.vin
  return unit
}

function readConfig(): any {
  try { return JSON.parse(fs.readFileSync(configFile, 'utf8')) } catch { return { enabled: false } }
}

function readInventory(): any[] {
  try { const v = JSON.parse(fs.readFileSync(inventoryFile, 'utf8')); return Array.isArray(v) ? v : [] } catch { return [] }
}

export async function runImport(force = false): Promise<{ ok: boolean; imported?: number; error?: string; skipped?: boolean }> {
  const cfg = readConfig()
  if (!force && !cfg.enabled) return { ok: true, skipped: true }
  if (!cfg.feedUrl) return { ok: false, error: 'No feedUrl configured' }
  try {
    // feedUrl is normally the dealer's HTTPS DMS feed; a non-http value is
    // treated as a local file path (bundled sample / mounted feed drop).
    let text: string
    if (/^https?:\/\//i.test(cfg.feedUrl)) {
      const res = await fetch(cfg.feedUrl, { signal: AbortSignal.timeout(45000) })
      if (!res.ok) return { ok: false, error: 'Feed fetch failed: HTTP ' + res.status }
      text = await res.text()
    } else {
      const p = path.isAbsolute(cfg.feedUrl) ? cfg.feedUrl : path.join(__dirname, '..', cfg.feedUrl)
      text = fs.readFileSync(p, 'utf8')
    }
    const fmt = (cfg.format || (text.trim().startsWith('<') ? 'xml' : 'csv')).toLowerCase()
    const rows = fmt === 'xml' ? parseXml(text) : parseCsv(text)
    const aliases = aliasesFor(cfg.provider || 'generic')
    const imported = rows.map(r => mapRow(r, aliases)).filter(Boolean)

    // Preserve manually-entered units; replace DMS-sourced ones with the fresh feed.
    const manual = readInventory().filter((u: any) => u.source && u.source !== 'dms_import')
    const merged = [...manual, ...imported.map((u: any) => ({ ...u, importedAt: new Date().toISOString() }))]
    fs.writeFileSync(inventoryFile, JSON.stringify(merged, null, 2))
    console.log(`[Inventory] Imported ${imported.length} units from ${cfg.provider || 'generic'} feed (${manual.length} manual kept)`)
    return { ok: true, imported: imported.length }
  } catch (err: any) {
    console.error('[Inventory] Import failed:', err?.message)
    return { ok: false, error: err?.message }
  }
}

export function startSchedule() {
  const cfg = readConfig()
  if (!cfg.enabled || !cfg.feedUrl) {
    console.log('[Inventory] No DMS feed configured — importer idle')
    return
  }
  setTimeout(() => { runImport().catch(() => {}) }, 90_000) // first run shortly after boot
  setInterval(() => { runImport().catch(() => {}) }, SYNC_INTERVAL)
  console.log(`[Inventory] DMS feed sync scheduled every ${SYNC_INTERVAL / 3600000}h (${cfg.provider || 'generic'})`)
}
