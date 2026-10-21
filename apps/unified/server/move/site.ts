// The data move, the website's half: a premium site's own content — the SQLite file on its Render disk
// (templates/website-premium-*/db/schema.ts; every premium template has the same schema and the one migration) and the
// photo files its pages show — into the tenant's unified database and photo store. Runs after the CRM move (copy.ts +
// steps/), which made the company, its users and its contacts; the site's rows join them.
//
// One transaction on the unified database, all or nothing, and every table's rows counted in and out (copy.ts's rule).
// The site.db is opened read-only and read inside one read transaction (one snapshot). The photo files are written to
// the new store as the transaction goes; if it rolls back, they are removed again (`undoFiles`).
//
// Where each table goes (read from both sides' code):
//   settings      → website (apps/unified/server/db/schema/site.ts: the site's own columns, same names) and company
//                   (name, phone, email, address, colours, logo: site/context.ts reads them from company). The company
//                   row is the CRM's; the CRM's facts stay and a site value only fills an empty one — the same rule the
//                   trades booking step uses. Differences are reported. With identity 'site' (a premium site moved AS IT
//                   IS — the owner's "the site must not change") the site's values replace the CRM's instead, each named
//                   in the report: the site shows the company's, so any CRM value kept would change the site. The booking words, drive time and iCal token
//                   → booking_settings. crm_url / crm_ready_at end (site and CRM are one app).
//   pages         → page          posts → post          projects → portfolio_item (the CRM's `project` is a job)
//   photos        → photo (is_public, public_url, alt), files → the photo store under `photos/` (the one prefix the
//                   unified /media serves: site/admin.ts PUBLIC_PHOTO_PREFIX, site/routes.ts). Every same-origin
//                   reference in pages, posts, portfolio and settings is rewritten to the new address.
//   leads         → already in the CRM when the site's forward reached it (server-static.ts forwardLeadToCrm posts
//                   every lead to the CRM's /api/webhooks/leads): matched by email within 15 minutes and not doubled.
//                   The rest go where core/enquiry.ts puts a website enquiry: the Lead Inbox (lead, platform
//                   'website') when lead_inbox is on, else a contact of type 'lead'.
//   booking_*     → the bookings layer (db/schema/booking.ts), which is the premium site's own model; see each step.
//   page_views    → page_view     audit_log → audit_log (entity 'website')
//   email_alias   → not moved: a site paired with a CRM had its alias writes refused and the Factory reconcile reads
//                   only the CRM's (memory: site email in one place), so the CRM's rows, already moved, are the live ones.
//   users / sessions / user_tokens / calendar connections → not moved; see the report.
import { Database } from 'bun:sqlite'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Query } from './schema.ts'
import type { MoveStep } from './copy.ts'

/** One file the old site served, by the address its pages used ('/media/photos/x.jpg', '/images/logo.svg'). */
export interface SiteFile { body: Uint8Array; contentType: string }
export interface SiteFiles { get(urlPath: string): Promise<SiteFile | null> }
/** The unified photo store's writing half (server/site/admin.ts PhotoStore). */
export interface TargetStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>
  /** What a key holds already (the photos step never overwrites, nor removes, a file it did not put). */
  getObject(key: string): Promise<{ body: ArrayBuffer | Uint8Array | Buffer } | null>
  remove(key: string): Promise<void>
}

const TYPES: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.svg': 'image/svg+xml' }

/**
 * The old site's files from a directory laid out by address: <dir>/media/photos/x.jpg, <dir>/uploads/…, <dir>/images/….
 * On Render the runner builds one from the site's R2 bucket (/media/<key> is the key, services/storage.ts) and the
 * site's build/images (/images/*, server-static.ts serveStatic root ./build).
 */
export function filesFromDir(dir: string): SiteFiles {
  const root = path.resolve(dir)
  return {
    async get(urlPath) {
      const p = path.resolve(root, '.' + decodeURIComponent(urlPath))
      if (!p.startsWith(root + path.sep)) return null
      try {
        const body = fs.readFileSync(p)
        return { body, contentType: TYPES[path.extname(p).toLowerCase()] ?? 'application/octet-stream' }
      } catch { return null }
    },
  }
}

export interface SiteMoveOptions {
  /** The site's SQLite file (website/persistent/site.db on its disk). Opened read-only. */
  siteDb: string
  files: SiteFiles
  /** The unified database, inside the caller's transaction (siteMoveSteps) or this module's own (moveSite). */
  write: Query
  store: TargetStore
  /** The zone the site's hours and days off were kept in: TENANT_TIMEZONE, which deploy.ts never set — America/Chicago. */
  siteTimezone?: string
  /** True when a section type/variant ('hero/split') has a view in the unified site; others are reported. */
  knownSection?: (key: string) => boolean
  /**
   * Whose name, phone, email, address, colours and logo the business keeps where the CRM and the site differ: the CRM's
   * (the default — a site value only fills an empty one) or the site's (the site moved exactly as it looked).
   */
  identity?: 'crm' | 'site'
  /**
   * 'leads': only the site's enquiries move (into the CRM's lead inbox, or matched to the leads its forward made) — a
   * business getting a NEW site keeps every enquiry its old one took; nothing else of the old site is written.
   */
  scope?: 'all' | 'leads'
}

export interface SiteMoveReport {
  tables: { table: string; source: number; moved: number; merged: number; notMoved: number }[]
  steps: { step: string; did: string }[]
  /** Files put in the new store (key → bytes). */
  files: { key: string; bytes: number }[]
  mismatches: string[]
}

const some = (ids: unknown[]) => ids.slice(0, 10).join(', ') + (ids.length > 10 ? ` and ${ids.length - 10} more` : '')
const q = (id: string) => `"${id.replace(/"/g, '""')}"`
/** A drizzle timestamp_ms (or a stray ISO text) as the UTC wall time a unified `timestamp` holds; null stays null. */
function ts(v: unknown): string | null {
  if (v == null || v === '') return null
  const d = typeof v === 'number' ? new Date(v) : /^\d+$/.test(String(v)) ? new Date(Number(v)) : new Date(String(v))
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().replace('T', ' ').replace('Z', '')
}
const bool = (v: unknown) => v === 1 || v === true || v === '1'
const money = (cents: unknown) => (cents == null || cents === '' || !Number.isFinite(Number(cents)) ? null : (Number(cents) / 100).toFixed(2))
const jsonOf = (v: unknown, fallback: unknown) => {
  if (v == null) return fallback
  if (typeof v !== 'string') return v
  try { return JSON.parse(v) } catch { return fallback }
}
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
/** A date (YYYY-MM-DD) of an instant in a zone. */
const dateIn = (ms: number, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))

/**
 * Same-origin file addresses inside text: /media/…, /uploads/…, /images/… not preceded by a host or another path
 * ("https://x.com/images/a.jpg" is someone else's file and is left alone).
 */
const LOCAL_FILE = /(?<![\w.:/%-])\/(?:media|uploads|images)\/[A-Za-z0-9._~%/+-]+/g

/** The new store key for an old address. Everything lands under photos/, the one prefix the unified /media serves. */
function keyFor(urlPath: string): string {
  const p = urlPath.replace(/^\/+/, '')
  if (p.startsWith('media/photos/')) return p.slice('media/'.length)
  if (p.startsWith('uploads/photos/')) return p.slice('uploads/'.length)
  if (p.startsWith('media/')) return 'photos/site/' + p.slice('media/'.length)
  return 'photos/site/' + p
}

export interface SiteMove {
  steps: MoveStep[]
  report: SiteMoveReport
  /** Removes the files this move put in the new store (call when the transaction rolled back). */
  undoFiles(): Promise<void>
}

/**
 * The website move as steps for copy.ts's moveTenant (`after`, so the CRM and the site land in ONE transaction), or for
 * moveSite below. Each step writes with `write` from its io; the site.db is read through its own snapshot.
 */
export function siteMoveSteps(o: Omit<SiteMoveOptions, 'write'>): SiteMove {
  const tz = o.siteTimezone ?? 'America/Chicago'
  const report: SiteMoveReport = { tables: [], steps: [], files: [], mismatches: [] }
  const put: string[] = []
  let sqlite: Database | null = null
  const all = (sql: string): any[] => {
    if (!sqlite) {
      sqlite = new Database(o.siteDb, { readonly: true })
      sqlite.exec('BEGIN') // one snapshot for every read below
    }
    return sqlite.query(sql).all() as any[]
  }
  const has = (table: string) => all(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${table}'`).length > 0
  const rows = (table: string, order = 'rowid') => (has(table) ? all(`SELECT * FROM "${table}" ORDER BY ${order}`) : [])
  const close = () => { if (sqlite) { try { sqlite.exec('ROLLBACK') } catch {} sqlite.close(); sqlite = null } }

  // Shared between steps.
  let companyId = ''
  const userOf = new Map<string, string>() // site user id → CRM user id
  const siteUserEmail = new Map<string, string>()
  const urlMap = new Map<string, string>() // old address (local path or absolute photo url) → new public address
  const serviceOf = new Map<string, string>() // site service id → unified service id
  const seriesOf = new Map<string, string>()
  const bookingOf = new Map<string, string>()
  /** Rows each target table should have gained, for the count check. */
  const gained = new Map<string, number>()
  const before = new Map<string, number>()
  const TARGETS = ['website', 'page', 'post', 'portfolio_item', 'photo', 'lead', 'contact', 'booking_settings', 'booking_hours', 'booking_blackout', 'booking_zone',
    'booking_service', 'booking_series', 'booking', 'booking_waitlist', 'booking_ban', 'booking_webhook', 'page_view', 'audit_log']
  const gain = (t: string, n = 1) => gained.set(t, (gained.get(t) ?? 0) + n)
  const tally = (table: string, source: number, moved: number, merged = 0) => {
    const notMoved = source - moved - merged
    report.tables.push({ table, source, moved, merged, notMoved })
  }

  /** The site's id when the table doesn't have it yet; otherwise a new one (said in the step's report). */
  const clashes: string[] = []
  async function idFor(write: Query, table: string, id: string): Promise<string> {
    const taken = async (x: string) => (await write(`SELECT 1 FROM ${q(table)} WHERE id = $1`, [x])).rows.length > 0
    if (!(await taken(id))) return id
    let n = 'site_' + id
    while (await taken(n)) n = 'site_' + crypto.randomUUID()
    clashes.push(`${table} ${id}→${n}`)
    return n
  }

  const rewriteText = (s: string): string => {
    let out = s.replace(LOCAL_FILE, (m) => urlMap.get(m) ?? m)
    for (const [from, to] of urlMap) if (/^https?:\/\//.test(from) && out.includes(from)) out = out.split(from).join(to)
    return out
  }
  const rewrite = (v: any): any => (typeof v === 'string' ? rewriteText(v) : Array.isArray(v) ? v.map(rewrite) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rewrite(x)])) : v)
  const rewriteJsonText = (v: unknown, fallback: unknown) => JSON.stringify(rewrite(jsonOf(v, fallback)))
  const opt = (v: unknown) => (v == null ? null : rewriteText(String(v)))

  const steps: MoveStep[] = [
    {
      // The company the CRM move made (a tenant's database holds one) and the site's own settings row. The CRM's
      // company facts are kept; an empty one takes the site's (address: the site's one line "street, city, state" is
      // what site/context.ts prints back from address/city/state, so it goes into address when all three are empty).
      name: 'site: company',
      run: async ({ write }) => {
        for (const t of TARGETS) before.set(t, Number((await write(`SELECT count(*)::int AS n FROM ${q(t)}`)).rows[0].n))
        const cos = (await write(`SELECT id, name, phone, email, address, city, state, logo, primary_color, secondary_color FROM company`)).rows
        if (cos.length !== 1) throw new Error(`The unified database has ${cos.length} companies; the site move needs the one the CRM move made`)
        const co = cos[0]
        companyId = co.id
        if (o.scope === 'leads') return `company ${companyId}; the old site's enquiries only — the business gets a new site`
        const settings = rows('settings', 'updated_at DESC')
        const s = settings[0]
        if (!s) return 'the site has no settings row'
        const filled: string[] = [], differ: string[] = []
        const siteWins = o.identity === 'site'
        const fill = async (col: string, siteVal: unknown, label: string) => {
          const v = siteVal == null ? '' : String(siteVal).trim()
          if (!v) return
          const cur = co[col] == null ? '' : String(co[col]).trim()
          if (!cur) { await write(`UPDATE company SET ${q(col)} = $1 WHERE id = $2`, [v, companyId]); filled.push(label) }
          else if (cur !== v && siteWins) { await write(`UPDATE company SET ${q(col)} = $1 WHERE id = $2`, [v, companyId]); differ.push(`${label}: the site's "${v}" replaced the CRM's "${cur}"`) }
          else if (cur !== v) differ.push(`${label}: the CRM's "${cur}" kept, the site had "${v}"`)
        }
        await fill('name', s.company_name, 'name')
        await fill('phone', s.phone, 'phone')
        await fill('email', s.email, 'email')
        await fill('secondary_color', s.secondary_color, 'secondary colour')
        await fill('primary_color', s.primary_color, 'primary colour')
        // The logo is settled after the photos step (its address may be rewritten); remembered here.
        const siteAddr = String(s.address ?? '').trim()
        if (siteAddr) {
          const crmLine = [co.address, co.city, co.state].filter((p: any) => p && String(p).trim()).join(', ')
          // The site prints address, city and state joined by ", " (site/context.ts addressLine): the site's line goes in
          // as "street, city, state" when it splits back to exactly itself, else whole as the street — either way the
          // site prints the same line.
          const parts = siteAddr.split(', ')
          const [street, city, state] = parts.length === 3 && parts.every((p) => p && p.trim() === p) ? parts : [siteAddr, null, null]
          const setAddr = () => write(`UPDATE company SET address = $1, city = $2, state = $3 WHERE id = $4`, [street, city, state, companyId])
          if (!crmLine) { await setAddr(); filled.push('address') }
          // The same address with a ZIP on the end ("…, WI" and "…, WI 54703"): the CRM's fields say it already, and the
          // split would put "WI 54703" in its state — kept, and the one difference the site will show is said.
          else if (crmLine !== siteAddr && siteWins && new RegExp('^' + crmLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\d{5}(-\\d{4})?$').test(siteAddr)) {
            differ.push(`address: the CRM's "${crmLine}" kept — the site printed it with its ZIP ("${siteAddr}"); the new site prints it without`)
          }
          else if (crmLine !== siteAddr && siteWins) { await setAddr(); differ.push(`address: the site's "${siteAddr}" replaced the CRM's "${crmLine}"`) }
          else if (crmLine !== siteAddr) differ.push(`address: the CRM's "${crmLine}" kept, the site had "${siteAddr}"`)
        }
        // Site sign-ins → the app's one set of users (the CRM's), by email. initDb.ts made the site's first admin from
        // ADMIN_EMAIL (the company email the Factory passed) with its own password; further admins were added by hand.
        const crmUsers = new Map((await write(`SELECT id, lower(email) AS email FROM "user" WHERE company_id = $1`, [companyId])).rows.map((r: any) => [r.email, r.id]))
        const unmatched: string[] = [], twoFactor: string[] = []
        for (const u of rows('users')) {
          siteUserEmail.set(u.id, String(u.email))
          const m = crmUsers.get(String(u.email).toLowerCase())
          if (m) userOf.set(u.id, m); else unmatched.push(`${u.email} (${u.role})`)
          if (u.totp_enabled_at) twoFactor.push(u.email)
        }
        if (settings.length > 1) differ.push(`${settings.length} settings rows; the latest moved`)
        return `company ${companyId}` + (filled.length ? `; filled from the site: ${filled.join(', ')}` : '') + (differ.length ? `; ${differ.join('; ')}` : '') +
          `; site sign-ins: ${userOf.size} matched a CRM user by email` +
          (unmatched.length ? `, ${unmatched.length} not (${some(unmatched)}) — no account made: the owner invites them from Settings › Users so they get a role and their own password` : '') +
          (twoFactor.length ? `; two-factor on the site (${some(twoFactor)}) does not carry — they sign in with their CRM password and turn it on again` : '')
      },
    },
    {
      // Photos first, so every address the content uses is known before it is written. Each photo row's file, and
      // every other same-origin file a page, post, project or setting names, is copied to `photos/…` in the new store.
      name: 'site: photos',
      run: async ({ write }) => {
        const src = rows('photos', 'created_at')
        const texts: string[] = []
        for (const p of rows('pages')) texts.push(String(p.sections ?? ''))
        for (const p of rows('posts')) texts.push(String(p.body ?? ''), String(p.cover_image_url ?? ''))
        for (const p of rows('projects')) texts.push(String(p.body ?? ''), String(p.cover_image_url ?? ''), String(p.photos ?? ''))
        for (const s of rows('settings')) texts.push(String(s.logo_url ?? ''), String(s.favicon_url ?? ''))
        // Where each needed file is read from, by its new key.
        const wanted = new Map<string, string[]>() // new key → the old addresses it may be read at
        const want = (k: string, from: string) => { const l = wanted.get(k) ?? []; if (!l.includes(from)) l.push(from); wanted.set(k, l) }
        for (const t of texts) for (const m of t.match(LOCAL_FILE) ?? []) { const k = keyFor(m); want(k, m); urlMap.set(m, '/media/' + k) }
        const photoKey = new Map<string, string>()
        const external: string[] = []
        for (const p of src) {
          const url = String(p.url ?? '')
          const sk = p.storage_key ? String(p.storage_key) : ''
          const local = url.match(LOCAL_FILE)?.[0] === url ? url : ''
          const read = sk ? '/media/' + sk.replace(/^\/+/, '') : local
          if (!read) { external.push(p.id); continue }
          const k = keyFor(read)
          photoKey.set(p.id, k)
          want(k, read)
          if (local) want(k, local)
          urlMap.set(url, '/media/' + k)
        }
        const missing: string[] = [], notInline: string[] = []
        const found = new Map<string, SiteFile>()
        for (const [key, froms] of wanted) {
          // A photo row's file by its R2 key (/media/<key>, services/storage.ts), or where a local-disk upload was served.
          let f: SiteFile | null = null, from = froms[0]
          for (const a of froms) { f = await o.files.get(a); if (f) { from = a; break } }
          if (!f) { missing.push(froms.join(' or ')); continue }
          found.set(key, f)
          if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(f.contentType)) notInline.push(`${from} (${f.contentType})`)
          // A file already in the store is never overwritten, and never the move's to remove: the business keeps ONE
          // bucket (the old site's and CRM's — run.ts on a moved service is given the old service's R2 settings), so
          // the key may hold the very file the old site still serves. The same bytes: left as they are. Others: refused.
          const there = await o.store.getObject(key)
          if (there) {
            if (!Buffer.from(there.body as ArrayBuffer).equals(Buffer.from(f.body))) throw new Error(`the photo store already holds a different file at ${key}; the move will not overwrite it`)
          } else {
            await o.store.put(key, Buffer.from(f.body), f.contentType)
            put.push(key)
          }
          report.files.push({ key, bytes: f.body.byteLength })
        }
        // A file that could not be read keeps its old address everywhere (it was already missing on the old site).
        for (const [from, to] of [...urlMap]) if (!found.has(to.slice('/media/'.length))) urlMap.delete(from)
        let moved = 0
        for (const p of src) {
          const key = photoKey.get(p.id)
          if (!key) continue
          const f = found.get(key)
          const id = await idFor(write, 'photo', p.id)
          await write(`INSERT INTO photo (id, company_id, filename, original_name, mime_type, size, width, height, tags, is_public, public_url, alt, created_at)
              VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8::json, true, $9, $10, $11::timestamp)`,
            [id, companyId, key, p.content_type || f?.contentType || 'image/jpeg', p.bytes ?? f?.body.byteLength ?? null, p.width, p.height, JSON.stringify(p.tag ? [p.tag] : []), '/media/' + key, p.alt, ts(p.created_at) ?? ts(Date.now())])
          moved++
        }
        gain('photo', moved)
        tally('photos', src.length, moved)
        return `${moved} of ${src.length} photo row(s), ${found.size} file(s) copied to the photo store` +
          (external.length ? `; ${external.length} row(s) name a file on another site and no stored copy (${some(external)}): not in the library, the pages still link it` : '') +
          (missing.length ? `; ${missing.length} file(s) the old site named but could not be read (${some(missing)}): their addresses are left as they were` : '') +
          (notInline.length ? `; ${notInline.length} file(s) are not photos the new /media shows in a page (${some(notInline)}): it sends them as downloads` : '')
      },
    },
    {
      // settings → website: the columns are the site's own, same names (db/schema/site.ts). The logo and favicon may
      // have been rewritten by the photos step; the logo then fills the company's when it has none.
      name: 'site: website settings',
      run: async ({ write }) => {
        const s = rows('settings', 'updated_at DESC')[0]
        if (!s) { tally('settings', 0, 0); return 'no settings row' }
        const exists = (await write(`SELECT id FROM website WHERE company_id = $1`, [companyId])).rows[0]
        const vals = [s.tagline, s.seo_title, s.seo_description, rewriteJsonText(s.nav, []), rewriteJsonText(s.photo_credits, []), rewriteJsonText(s.content_gaps, []), rewriteJsonText(s.service_areas, []),
          s.inventory_feed_url, s.contact_cta_label || 'Get in touch', s.accent_color, opt(s.favicon_url), s.google_tag_manager_id, s.google_analytics_id, s.google_ads_id, s.facebook_pixel_id,
          s.microsoft_clarity_id, s.customizer_token, ts(s.updated_at) ?? ts(Date.now())]
        const cols = ['tagline', 'seo_title', 'seo_description', 'nav', 'photo_credits', 'content_gaps', 'service_areas', 'inventory_feed_url', 'contact_cta_label', 'accent_color', 'favicon_url',
          'google_tag_manager_id', 'google_analytics_id', 'google_ads_id', 'facebook_pixel_id', 'microsoft_clarity_id', 'customizer_token', 'updated_at']
        const cast = (c: string) => (['nav', 'photo_credits', 'content_gaps', 'service_areas'].includes(c) ? '::json' : c === 'updated_at' ? '::timestamp' : '')
        if (exists) {
          await write(`UPDATE website SET ${cols.map((c, i) => `${q(c)} = $${i + 1}${cast(c)}`).join(', ')} WHERE id = $${cols.length + 1}`, [...vals, exists.id])
        } else {
          await write(`INSERT INTO website (id, company_id, ${cols.map(q).join(', ')}) VALUES ($1, $2, ${cols.map((c, i) => `$${i + 3}${cast(c)}`).join(', ')})`, [crypto.randomUUID(), companyId, ...vals])
          gain('website')
        }
        tally('settings', 1, 1)
        let logo = ''
        const siteLogo = opt(s.logo_url)?.trim()
        if (siteLogo) {
          const cur = (await write(`SELECT logo FROM company WHERE id = $1`, [companyId])).rows[0].logo
          if (!cur || !String(cur).trim()) { await write(`UPDATE company SET logo = $1 WHERE id = $2`, [siteLogo, companyId]); logo = `; the company had no logo, so the site's (${siteLogo}) is it now` }
          else if (String(cur).trim() !== siteLogo && o.identity === 'site') { await write(`UPDATE company SET logo = $1 WHERE id = $2`, [siteLogo, companyId]); logo = `; logo: the site's (${siteLogo}) replaced the CRM's "${cur}"` }
          else if (String(cur).trim() !== siteLogo) logo = `; logo: the CRM's "${cur}" kept, the site showed "${siteLogo}"`
        }
        const dropped = [s.crm_url && 'crm_url', s.crm_ready_at && 'crm_ready_at'].filter(Boolean)
        return `${exists ? 'updated' : 'made'} the website row` + logo + (dropped.length ? `; ${dropped.join(', ')} end (site and CRM are one app)` : '')
      },
    },
    {
      name: 'site: pages, posts, portfolio',
      run: async ({ write }) => {
        const out: string[] = []
        const unknown = new Set<string>()
        const pages = rows('pages', 'nav_order, slug')
        for (const p of pages) {
          const sections = rewrite(jsonOf(p.sections, []))
          if (o.knownSection && Array.isArray(sections)) for (const s of sections) { const k = `${s?.type}/${s?.variant ?? 'default'}`; if (s?.type && !o.knownSection(k)) unknown.add(k) }
          await write(`INSERT INTO page (id, company_id, slug, title, sections, meta_title, meta_description, is_published, nav_order, created_at, updated_at)
              VALUES ($1, $2, $3, $4, $5::json, $6, $7, $8, $9, $10::timestamp, $11::timestamp)`,
            [await idFor(write, 'page', p.id), companyId, p.slug, p.title, JSON.stringify(sections), p.meta_title, p.meta_description, bool(p.is_published), p.nav_order ?? 0, ts(p.created_at), ts(p.updated_at)])
        }
        gain('page', pages.length); tally('pages', pages.length, pages.length)
        out.push(`${pages.length} page(s)`)
        if (unknown.size) out.push(`section(s) the unified site has no view for yet, skipped when the page renders until it does: ${[...unknown].sort().join(', ')}`)

        const posts = rows('posts', 'created_at')
        for (const p of posts) {
          await write(`INSERT INTO post (id, company_id, slug, title, excerpt, body, cover_image_url, status, meta_title, meta_description, published_at, created_at, updated_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamp, $12::timestamp, $13::timestamp)`,
            [await idFor(write, 'post', p.id), companyId, p.slug, p.title, p.excerpt, rewriteText(String(p.body ?? '')), opt(p.cover_image_url), p.status, p.meta_title, p.meta_description, ts(p.published_at), ts(p.created_at), ts(p.updated_at)])
        }
        gain('post', posts.length); tally('posts', posts.length, posts.length)
        out.push(`${posts.length} post(s)`)

        const projects = rows('projects', 'sort_order, created_at')
        for (const p of projects) {
          await write(`INSERT INTO portfolio_item (id, company_id, slug, title, location, summary, body, cover_image_url, photos, status, sort_order, meta_title, meta_description, published_at, created_at, updated_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::json, $10, $11, $12, $13, $14::timestamp, $15::timestamp, $16::timestamp)`,
            [await idFor(write, 'portfolio_item', p.id), companyId, p.slug, p.title, p.location, p.summary, rewriteText(String(p.body ?? '')), opt(p.cover_image_url), rewriteJsonText(p.photos, []),
              p.status, p.sort_order ?? 0, p.meta_title, p.meta_description, ts(p.published_at), ts(p.created_at), ts(p.updated_at)])
        }
        gain('portfolio_item', projects.length); tally('projects', projects.length, projects.length)
        out.push(`${projects.length} portfolio item(s)`)
        return out.join('; ')
      },
    },
    {
      // Each site lead was also posted to the CRM (forwardLeadToCrm → the CRM's /api/webhooks/leads, which made a Lead
      // Inbox row or a 'lead' contact), so most are in the CRM already and moved with it. One counts as there when the
      // CRM has a lead or contact with its email made within 15 minutes of it; the site inbox's own status and notes
      // are added to that row. The rest (the forward failed, or the site predates the CRM) are recorded the way
      // core/enquiry.ts records a website enquiry today. Spam is not made into a contact.
      name: 'site: leads',
      run: async ({ write }) => {
        const src = rows('leads', 'created_at')
        const inbox = (await write(`SELECT enabled_features::jsonb ? 'lead_inbox' AS on FROM company WHERE id = $1`, [companyId])).rows[0].on === true
        const STATUS: Record<string, string> = { new: 'new', replied: 'contacted', closed: 'dismissed', spam: 'dismissed' }
        let matched = 0, toLead = 0, toContact = 0
        const spam: string[] = []
        for (const l of src) {
          const at = ts(l.created_at)!
          const email = String(l.email ?? '').trim()
          const siteInbox = { status: l.status, notes: l.notes ?? null }
          const hitLead = email ? (await write(`SELECT id FROM lead WHERE company_id = $1 AND lower(email) = lower($2) AND abs(extract(epoch FROM received_at - $3::timestamp)) <= 900 ORDER BY abs(extract(epoch FROM received_at - $3::timestamp)) LIMIT 1`, [companyId, email, at])).rows[0] : undefined
          const hitContact = !hitLead && email ? (await write(`SELECT id FROM contact WHERE company_id = $1 AND lower(email) = lower($2) AND abs(extract(epoch FROM created_at - $3::timestamp)) <= 900 ORDER BY abs(extract(epoch FROM created_at - $3::timestamp)) LIMIT 1`, [companyId, email, at])).rows[0] : undefined
          if (hitLead || hitContact) {
            matched++
            if (l.status !== 'new' || l.notes) {
              if (hitLead) await write(`UPDATE lead SET raw_payload = (COALESCE(raw_payload::jsonb, '{}'::jsonb) || jsonb_build_object('siteInbox', $1::jsonb))::json WHERE id = $2`, [JSON.stringify(siteInbox), hitLead.id])
              else if (l.notes) await write(`UPDATE contact SET notes = concat_ws(E'\\n\\n', notes, $1::text) WHERE id = $2`, ['Website inbox notes: ' + l.notes, hitContact.id])
            }
            continue
          }
          if (inbox) {
            await write(`INSERT INTO lead (id, source_platform, homeowner_name, email, phone, description, status, raw_payload, received_at, company_id, created_at, updated_at)
                VALUES ($1, 'website', $2, $3, $4, $5, $6, $7::json, $8::timestamp, $9, $8::timestamp, $8::timestamp)`,
              [await idFor(write, 'lead', l.id), String(l.name).slice(0, 200), email || null, l.phone, l.message, STATUS[l.status] ?? 'new',
                JSON.stringify({ name: l.name, email, phone: l.phone, message: l.message, source: l.source, siteInbox }), at, companyId])
            gain('lead'); toLead++
          } else if (l.status === 'spam') {
            spam.push(l.id)
          } else {
            await write(`INSERT INTO contact (id, type, name, email, phone, source, notes, company_id, created_at, updated_at) VALUES ($1, 'lead', $2, $3, $4, $5, $6, $7, $8::timestamp, $8::timestamp)`,
              [await idFor(write, 'contact', l.id), l.name, email || null, l.phone, l.source || 'website', [l.message, l.notes && 'Website inbox notes: ' + l.notes].filter(Boolean).join('\n\n'), companyId, at])
            gain('contact'); toContact++
          }
        }
        tally('leads', src.length, toLead + toContact, matched)
        return `${src.length} lead(s): ${matched} already in the CRM (its forward reached it), ${toLead} into the Lead Inbox, ${toContact} as lead contacts` +
          (spam.length ? `; ${spam.length} marked spam on the site and the Lead Inbox is off, so not made into contacts (${some(spam)})` : '')
      },
    },
    {
      // The site's booking engine is the model the unified one was built from (db/schema/booking.ts header), and the
      // one the public website booked through, so for the booking pages its settings win where both have one:
      //   settings.booking_hero_title/subtitle/confirm_cta/thanks_message → booking_settings hero_title/hero_subtitle/
      //     confirm_cta/thanks_message; booking_default_drive_time_minutes → drive_time_minutes; booking_ical_feed_token
      //     → ical_feed_token (the token moves; the feed's address does not — see 'site: not moved').
      //   booking_availability_rules → booking_hours (active ones; minutes from midnight in the site's zone). They
      //     replace the "anyone" hours the CRM move made from the CRM widget's working_hours.
      //   booking_blackouts → booking_blackout; booking_service_zones → booking_zone (zip_list → a list; the centre
      //     and radius were never read and the unified table has none).
      name: 'site: booking settings, hours, days off, zones',
      run: async ({ write }) => {
        const out: string[] = []
        const s = rows('settings', 'updated_at DESC')[0] ?? {}
        const rules = rows('booking_availability_rules', 'day_of_week, start_minute')
        const active = rules.filter((r) => bool(r.is_active))
        const anySite = active.length > 0 || rows('booking_services').length > 0
        let bs = (await write(`SELECT * FROM booking_settings WHERE company_id = $1`, [companyId])).rows[0]
        if (!bs && anySite) {
          await write(`INSERT INTO booking_settings (id, company_id, timezone) VALUES ($1, $2, $3)`, [crypto.randomUUID(), companyId, tz])
          gain('booking_settings')
          bs = (await write(`SELECT * FROM booking_settings WHERE company_id = $1`, [companyId])).rows[0]
          out.push(`booking settings made (zone ${tz})`)
        }
        if (bs) {
          const set: string[] = [], params: unknown[] = [], replaced: string[] = []
          const take = (col: string, v: unknown) => {
            if (v == null || String(v).trim() === '') return
            if (bs[col] != null && bs[col] !== 0 && String(bs[col]) !== String(v)) replaced.push(`${col} "${bs[col]}"`)
            if (String(bs[col] ?? '') === String(v)) return
            params.push(v); set.push(`${q(col)} = $${params.length}`)
          }
          take('hero_title', s.booking_hero_title)
          take('hero_subtitle', s.booking_hero_subtitle)
          take('confirm_cta', s.booking_confirm_cta)
          take('thanks_message', s.booking_thanks_message)
          if (Number(s.booking_default_drive_time_minutes) > 0) take('drive_time_minutes', Number(s.booking_default_drive_time_minutes))
          if (s.booking_ical_feed_token) take('ical_feed_token', s.booking_ical_feed_token)
          if (set.length) { params.push(bs.id); await write(`UPDATE booking_settings SET ${set.join(', ')} WHERE id = $${params.length}`, params) }
          if (set.length) out.push(`the site's ${set.length} booking setting(s)${replaced.length ? ` (replacing the CRM widget's ${replaced.join(', ')})` : ''}`)
          if (active.length && bs.timezone !== tz) out.push(`the booking zone is ${bs.timezone} but the site kept its hours in ${tz} — the owner checks the hours in Bookings › Settings`)
        }

        const unmatchedUser = new Set<string>()
        const userFor = (id: unknown) => { if (!id) return null; const m = userOf.get(String(id)); if (!m) unmatchedUser.add(siteUserEmail.get(String(id)) ?? String(id)); return m ?? null }
        if (active.length) {
          const gone = (await write(`DELETE FROM booking_hours WHERE company_id = $1 AND user_id IS NULL RETURNING day_of_week, start_minute, end_minute`, [companyId])).rows
          gain('booking_hours', -gone.length)
          if (gone.length) out.push(`the CRM widget's ${gone.length} "anyone" opening window(s) replaced by the site's (${some(gone.map((g: any) => `${g.day_of_week}:${g.start_minute}-${g.end_minute}`))})`)
          for (const r of active) {
            await write(`INSERT INTO booking_hours (id, company_id, user_id, day_of_week, start_minute, end_minute, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7::timestamp)`,
              [await idFor(write, 'booking_hours', r.id), companyId, userFor(r.user_id), r.day_of_week, r.start_minute, r.end_minute, ts(r.created_at)])
          }
          gain('booking_hours', active.length)
        }
        tally('booking_availability_rules', rules.length, active.length)
        if (rules.length > active.length) out.push(`${rules.length - active.length} switched-off hour rule(s) not moved (the unified hours have no off switch)`)
        out.push(`${active.length} opening window(s)`)

        const blackouts = rows('booking_blackouts', 'date')
        let bMoved = 0
        const bSkipped: string[] = []
        for (const b of blackouts) {
          // A team member's day off whose person has no account would become a day the whole business is closed.
          if (b.user_id && !userOf.has(b.user_id)) { bSkipped.push(`${b.date} (${siteUserEmail.get(b.user_id) ?? b.user_id})`); continue }
          await write(`INSERT INTO booking_blackout (id, company_id, user_id, date, start_minute, end_minute, reason, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamp)`,
            [await idFor(write, 'booking_blackout', b.id), companyId, b.user_id ? userOf.get(b.user_id) : null, b.date, b.start_minute, b.end_minute, b.reason, ts(b.created_at)])
          bMoved++
        }
        gain('booking_blackout', bMoved); tally('booking_blackouts', blackouts.length, bMoved)
        out.push(`${bMoved} day(s) off` + (bSkipped.length ? `; ${bSkipped.length} of a person with no account not moved (${some(bSkipped)})` : ''))

        const zones = rows('booking_service_zones')
        let zMoved = 0
        const zSkipped: string[] = [], radius: string[] = []
        for (const z of zones) {
          if (z.center_lat || z.center_lng || z.radius_miles) radius.push(z.id)
          const u = userOf.get(z.user_id)
          if (!u) { zSkipped.push(siteUserEmail.get(z.user_id) ?? z.user_id); continue }
          const zips = String(z.zip_list ?? '').split(',').map((x) => x.trim()).filter(Boolean)
          await write(`INSERT INTO booking_zone (id, company_id, user_id, zips, created_at) VALUES ($1, $2, $3, $4::json, $5::timestamp)`, [await idFor(write, 'booking_zone', z.id), companyId, u, JSON.stringify(zips), ts(z.created_at)])
          zMoved++
        }
        gain('booking_zone', zMoved); tally('booking_service_zones', zones.length, zMoved)
        if (zones.length) out.push(`${zMoved} service zone(s)` + (zSkipped.length ? `; ${zSkipped.length} of a person with no account not moved (${some(zSkipped)})` : '') +
          (radius.length ? `; ${radius.length} had a centre/radius the site stored but never checked (not moved)` : ''))
        if (unmatchedUser.size) out.push(`hours of ${some([...unmatchedUser])} (no account) moved as "anyone"`)
        return out.join('; ')
      },
    },
    {
      // booking_services → booking_service. The CRM move made the CRM widget's services (steps/trades.ts); one with the
      // same name (case and spacing aside) is the same service: ONE row stays — the CRM's id (its bookings point at
      // it), with the site's booking rules, address (/book/<slug>) and words, since the site's is the one the public
      // website offered. Money: cents → dollars (the unified money columns).
      name: 'site: booking services',
      run: async ({ write }) => {
        const src = rows('booking_services', 'display_order, name')
        const existing = (await write(`SELECT id, slug, name, description, active FROM booking_service WHERE company_id = $1`, [companyId])).rows as any[]
        const byName = new Map(existing.map((e) => [norm(e.name), e]))
        const slugs = new Set(existing.map((e) => e.slug))
        const merged: string[] = [], reslug: string[] = []
        let moved = 0
        for (const s of src) {
          const vals = [s.name, s.description, s.duration_minutes, money(s.price_cents), money(s.deposit_amount_cents), s.deposit_percent, s.buffer_before_minutes ?? 0, s.buffer_after_minutes ?? 0,
            s.slot_granularity_minutes ?? 30, s.capacity_per_slot ?? 1, s.tip_presets_percent == null ? null : JSON.stringify(jsonOf(s.tip_presets_percent, null)), s.rebook_interval_days, s.display_order ?? 0]
          const hit = byName.get(norm(s.name))
          if (hit) {
            let slug = hit.slug
            if (s.slug !== hit.slug && !slugs.has(s.slug)) { slugs.delete(hit.slug); slug = s.slug; slugs.add(slug) }
            await write(`UPDATE booking_service SET name = $1, description = COALESCE($2, description), duration_minutes = $3, price = $4::numeric, deposit_amount = $5::numeric, deposit_percent = $6,
                buffer_before_minutes = $7, buffer_after_minutes = $8, slot_step_minutes = $9, capacity = $10, tip_presets = $11::json, rebook_interval_days = $12, sort_order = $13,
                active = $14, slug = $15, updated_at = $16::timestamp WHERE id = $17`,
              [...vals, bool(s.is_active) || hit.active === true, slug, ts(s.updated_at), hit.id])
            serviceOf.set(s.id, hit.id)
            merged.push(`"${s.name}" → ${hit.id}`)
            continue
          }
          let slug = s.slug
          for (let i = 2; slugs.has(slug); i++) slug = `${s.slug}-${i}`
          if (slug !== s.slug) reslug.push(`${s.slug}→${slug}`)
          slugs.add(slug)
          const id = await idFor(write, 'booking_service', s.id)
          await write(`INSERT INTO booking_service (id, company_id, slug, name, description, duration_minutes, price, deposit_amount, deposit_percent, buffer_before_minutes, buffer_after_minutes,
                slot_step_minutes, capacity, tip_presets, rebook_interval_days, sort_order, active, created_at, updated_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8::numeric, $9, $10, $11, $12, $13, $14::json, $15, $16, $17, $18::timestamp, $19::timestamp)`,
            [id, companyId, slug, ...vals, bool(s.is_active), ts(s.created_at), ts(s.updated_at)])
          serviceOf.set(s.id, id)
          moved++
        }
        gain('booking_service', moved); tally('booking_services', src.length, moved, merged.length)
        return `${src.length} service(s): ${moved} added, ${merged.length} the same as one the CRM move made, kept once (${some(merged)})` +
          (reslug.length ? `; address taken by another service, so renamed: ${some(reslug)}` : '')
      },
    },
    {
      // booking_series → booking_series, bookings → booking, booking_waitlist → booking_waitlist. The site's bookings
      // were never sent to the CRM (only its leads were), so none is in the CRM's bookings already. Kept as they are:
      //   start/end (UTC instants), the customer's details, status (the same five words), the private link
      //   (confirmation_token, 24 random bytes — booking.token; the site's /booking/<token> page is the unified one's
      //   too, so a customer's link keeps working once the domain points at the new app).
      //   source: public_form → public, admin_manual → staff, series → series.
      //   money cents → dollars; deposit_status null → none; the reminder stamps (review by email or text → one
      //   review_request_sent_at, so neither goes again); the calendar event id with its provider.
      //   contact: the CRM contact with the customer's email, when there is one (the unified engine links one).
      //   a series' 'biweekly' is every 2 × interval weeks (lib/booking-recurrence.ts steps 14 days × interval);
      //   until_date (an instant) → the date in the site's zone.
      name: 'site: bookings',
      run: async ({ write }) => {
        const contactOf = new Map<string, string>()
        for (const r of (await write(`SELECT DISTINCT ON (lower(email)) lower(email) AS e, id FROM contact WHERE company_id = $1 AND email IS NOT NULL ORDER BY lower(email), created_at`, [companyId])).rows) contactOf.set(r.e, r.id)
        const contactFor = (e: unknown) => contactOf.get(String(e ?? '').trim().toLowerCase()) ?? null
        const provider = new Map<string, string>()
        for (const c of rows('booking_calendar_connections')) provider.set(c.user_id, c.provider)
        const noUser: string[] = []
        const userFor = (id: unknown) => { if (!id) return null; const m = userOf.get(String(id)); if (!m) noUser.push(String(id)); return m ?? null }
        const out: string[] = []

        const series = rows('booking_series', 'created_at')
        for (const s of series) {
          const svc = serviceOf.get(s.service_id)
          if (!svc) throw new Error(`booking_series ${s.id} names service ${s.service_id}, which the site does not have`)
          const id = await idFor(write, 'booking_series', s.id)
          seriesOf.set(s.id, id)
          const weekly = s.frequency !== 'monthly'
          const interval = (s.interval_count ?? 1) * (s.frequency === 'biweekly' ? 2 : 1)
          await write(`INSERT INTO booking_series (id, company_id, service_id, contact_id, frequency, interval_count, first_start_at, occurrences_count, until_date, customer_name, customer_email,
                customer_phone, customer_address, customer_zip, customer_notes, assigned_user_id, status, token, cancelled_at, created_at, updated_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7::timestamp, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::timestamp, $20::timestamp, $21::timestamp)`,
            [id, companyId, svc, contactFor(s.customer_email), weekly ? 'weekly' : 'monthly', interval, ts(s.first_start_at), s.occurrences_count, s.until_date == null ? null : dateIn(Number(s.until_date), tz),
              s.customer_name, s.customer_email, s.customer_phone, s.customer_address, s.customer_zip, s.customer_notes, userFor(s.assigned_user_id), s.status, s.confirmation_token,
              ts(s.cancelled_at), ts(s.created_at), ts(s.updated_at)])
        }
        gain('booking_series', series.length); tally('booking_series', series.length, series.length)
        out.push(`${series.length} series`)

        const SOURCE: Record<string, string> = { public_form: 'public', admin_manual: 'staff', series: 'series' }
        const bookings = rows('bookings', 'start_at')
        const odd: string[] = [], openDeposit: string[] = [], linked: string[] = []
        for (const b of bookings) {
          const svc = serviceOf.get(b.service_id)
          if (!svc) throw new Error(`booking ${b.id} names service ${b.service_id}, which the site does not have`)
          if (!['confirmed', 'cancelled', 'completed', 'no_show'].includes(b.status)) odd.push(`${b.id} ${b.status}`)
          if (b.deposit_status === 'pending' && b.status === 'confirmed') openDeposit.push(b.id)
          const contact = contactFor(b.customer_email)
          if (contact) linked.push(b.id)
          const id = await idFor(write, 'booking', b.id)
          bookingOf.set(b.id, id)
          await write(`INSERT INTO booking (id, company_id, service_id, contact_id, series_id, series_index, start_at, end_at, customer_name, customer_email, customer_phone, customer_address, customer_zip,
                customer_notes, status, assigned_user_id, source, source_path, source_referrer, source_variant, token, deposit_amount, deposit_status, payment_intent_id, tip_amount,
                reminder_email_sent_at, reminder_sms_sent_at, rebook_reminder_sent_at, review_request_sent_at, external_event_id, external_provider, cancelled_at, cancelled_reason, created_at, updated_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7::timestamp, $8::timestamp, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22::numeric, $23, $24, $25::numeric,
                $26::timestamp, $27::timestamp, $28::timestamp, $29::timestamp, $30, $31, $32::timestamp, $33, $34::timestamp, $35::timestamp)`,
            [id, companyId, svc, contact, b.series_id ? seriesOf.get(b.series_id) ?? null : null, b.series_index, ts(b.start_at), ts(b.end_at), b.customer_name, b.customer_email, b.customer_phone,
              b.customer_address, b.customer_zip, b.customer_notes, b.status, userFor(b.assigned_user_id), SOURCE[b.source] ?? 'public', b.source_path, b.source_referrer, b.source_variant,
              b.confirmation_token, money(b.deposit_amount_cents), b.deposit_status ?? 'none', b.deposit_payment_intent_id, money(b.tip_amount_cents),
              ts(b.reminder_24h_sent_at), ts(b.reminder_24h_sms_sent_at), ts(b.rebook_reminder_sent_at), ts(b.review_request_sent_at ?? b.review_request_sms_sent_at),
              b.external_calendar_event_id, b.external_calendar_event_id ? provider.get(b.assigned_user_id) ?? null : null, ts(b.cancelled_at), b.cancelled_reason, ts(b.created_at), ts(b.updated_at)])
        }
        gain('booking', bookings.length); tally('bookings', bookings.length, bookings.length)
        out.push(`${bookings.length} booking(s), ${linked.length} linked to the CRM contact with their email`)
        if (openDeposit.length) out.push(`${openDeposit.length} with a deposit checkout still open (${some(openDeposit)}): Stripe tells the OLD site's /api/webhooks/stripe-deposit when one is paid, so the owner checks Stripe and marks it paid`)
        if (odd.length) out.push(`status the site did not use: ${some(odd)}`)

        const WAIT: Record<string, string> = { open: 'open', notified: 'notified', converted: 'booked', expired: 'expired' }
        const wait = rows('booking_waitlist', 'created_at')
        for (const w of wait) {
          const svc = serviceOf.get(w.service_id)
          if (!svc) throw new Error(`booking_waitlist ${w.id} names service ${w.service_id}, which the site does not have`)
          await write(`INSERT INTO booking_waitlist (id, company_id, service_id, customer_name, customer_email, customer_phone, customer_zip, preferred_from, preferred_to, notes, status, notified_at, booking_id, created_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::timestamp, $13, $14::timestamp)`,
            [await idFor(write, 'booking_waitlist', w.id), companyId, svc, w.customer_name, w.customer_email, w.customer_phone, w.customer_zip, w.preferred_from, w.preferred_to, w.notes,
              WAIT[w.status] ?? 'open', ts(w.notified_at), w.converted_booking_id ? bookingOf.get(w.converted_booking_id) ?? null : null, ts(w.created_at)])
        }
        gain('booking_waitlist', wait.length); tally('booking_waitlist', wait.length, wait.length)
        out.push(`${wait.length} waitlist entr(ies)`)
        const nu = [...new Set(noUser)].map((id) => siteUserEmail.get(id) ?? id)
        if (nu.length) out.push(`assigned to a person with no account (${some(nu)}): left unassigned`)
        return out.join('; ')
      },
    },
    {
      // booking_bans → booking_ban; booking_webhooks → booking_webhook (the same signature: X-Twomiah-Signature
      // sha256 HMAC of the body with the secret, lib/webhooks.ts and booking/webhooks.ts, so receivers keep verifying).
      name: 'site: booking bans and webhooks',
      run: async ({ write }) => {
        const bans = rows('booking_bans', 'created_at')
        for (const b of bans) {
          await write(`INSERT INTO booking_ban (id, company_id, email, phone, reason, added_by_user_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7::timestamp)`,
            [await idFor(write, 'booking_ban', b.id), companyId, b.email ? String(b.email).toLowerCase() : null, b.phone ? String(b.phone).replace(/\D/g, '') : null, b.reason, b.added_by_user_id ? userOf.get(b.added_by_user_id) ?? null : null, ts(b.created_at)])
        }
        gain('booking_ban', bans.length); tally('booking_bans', bans.length, bans.length)
        const hooks = rows('booking_webhooks', 'created_at')
        for (const h of hooks) {
          const events = String(h.events ?? '*').split(',').map((e) => e.trim()).filter(Boolean)
          await write(`INSERT INTO booking_webhook (id, company_id, url, secret, events, active, last_delivery_at, last_status, failure_count, created_at) VALUES ($1, $2, $3, $4, $5::json, $6, $7::timestamp, $8, $9, $10::timestamp)`,
            [await idFor(write, 'booking_webhook', h.id), companyId, h.url, h.secret, JSON.stringify(events.length ? events : ['*']), bool(h.is_active), ts(h.last_delivery_at), h.last_status, h.failure_count ?? 0, ts(h.created_at)])
        }
        gain('booking_webhook', hooks.length); tally('booking_webhooks', hooks.length, hooks.length)
        return `${bans.length} ban(s), ${hooks.length} webhook(s)`
      },
    },
    {
      name: 'site: page views and audit log',
      run: async ({ write }) => {
        const views = rows('page_views', 'day, path')
        let added = 0
        for (const v of views) {
          const r = (await write(`INSERT INTO page_view (id, company_id, day, path, count) VALUES ($1, $2, $3, $4, $5)
              ON CONFLICT (company_id, day, path) DO UPDATE SET count = page_view.count + EXCLUDED.count RETURNING (xmax = 0) AS inserted`,
            [crypto.randomUUID(), companyId, v.day, v.path, v.count ?? 0])).rows[0]
          if (r.inserted) added++
        }
        gain('page_view', added); tally('page_views', views.length, views.length)
        // The site's audit rows: action as it wrote it ('login', 'patch /pages/home'), its target ('pages/home') as the
        // entity id, under the entity 'website' so the audit screen tells them from the app's own.
        const audit = rows('audit_log', 'created_at')
        for (const a of audit) {
          await write(`INSERT INTO audit_log (id, action, entity, entity_id, metadata, ip_address, user_agent, created_at, user_id, user_email, company_id)
              VALUES ($1, $2, 'website', $3, $4::json, $5, $6, $7::timestamp, $8, $9, $10)`,
            [await idFor(write, 'audit_log', a.id), a.action, a.target, a.meta == null ? null : JSON.stringify(jsonOf(a.meta, { raw: a.meta })), a.ip, a.user_agent, ts(a.created_at),
              a.user_id ? userOf.get(a.user_id) ?? null : null, a.user_email ?? (a.user_id ? siteUserEmail.get(a.user_id) ?? null : null), companyId])
        }
        gain('audit_log', audit.length); tally('audit_log', audit.length, audit.length)
        return `${views.length} day×page count(s), ${audit.length} audit row(s)`
      },
    },
    {
      // What stays behind, said plainly.
      name: 'site: not moved',
      run: async ({ write }) => {
        const out: string[] = []
        const aliases = rows('email_alias', 'local_part')
        const crm = new Set((await write(`SELECT local_part FROM email_alias`)).rows.map((r: any) => r.local_part))
        const onlySite = aliases.filter((a) => !crm.has(a.local_part)).map((a) => `${a.local_part}@ → ${a.forward_to ?? a.routing_mode}`)
        tally('email_alias', aliases.length, 0, aliases.length - onlySite.length)
        if (aliases.length) out.push(`email aliases: the CRM's (moved with it) are the live ones${onlySite.length ? `; the site's table also held ${some(onlySite)}, which the Factory's reconcile (CRM only) had already removed — the owner adds any still wanted in Settings › Email` : ''}`)
        const sessions = rows('sessions').length, tokens = rows('user_tokens').length
        tally('users', rows('users').length, 0, userOf.size)
        tally('sessions', sessions, 0)
        tally('user_tokens', tokens, 0)
        out.push(`site sign-ins: the app has one set of users (the CRM's); ${sessions} site session(s) and ${tokens} reset/verify link(s) end — everyone signs in again with their CRM login`)
        const cals = rows('booking_calendar_connections')
        tally('booking_calendar_connections', cals.length, 0)
        if (cals.length) out.push(`${cals.length} calendar connection(s) not moved (${some(cals.map((c) => `${c.provider} ${c.external_account_email ?? ''} for ${siteUserEmail.get(c.user_id) ?? c.user_id}`.trim()))}): the unified app has the table but no calendar sync yet, its watch channel posts to the old site, and its tokens would have to be re-encrypted for the new table — the person connects the calendar again once sync is built`)
        const ri = rows('settings')[0]
        // The old feed was /api/ical/bookings.ics?token=… (server-static.ts); the unified one is the booking module's
        // /feed/:token (modules/booking.ts), so the same token sits at a new address.
        if (ri?.booking_ical_feed_token) out.push('the calendar feed keeps its token, but its address changed (the old /api/ical/bookings.ics?token=… is not served by the new app): whoever subscribed adds the new feed link from Bookings › Settings')
        return out.join('; ') || 'nothing'
      },
    },
    {
      // The counts, read back inside the same transaction: each table gained exactly what the steps wrote.
      name: 'site: counts',
      // What the website move added to the tables the records copy also counts (copy.ts's final check).
      added: () => gained,
      run: async ({ write }) => {
        close()
        for (const t of TARGETS) {
          const n = Number((await write(`SELECT count(*)::int AS n FROM ${q(t)}`)).rows[0].n)
          const want = (before.get(t) ?? 0) + (gained.get(t) ?? 0)
          if (n !== want) report.mismatches.push(`${t}: ${want} expected, ${n} there`)
        }
        for (const t of report.tables) if (t.notMoved < 0) report.mismatches.push(`${t.table}: more written than read`)
        if (report.mismatches.length) throw Object.assign(new Error(`The site move did not match: ${report.mismatches.join('; ')}`), { report })
        return report.tables.map((t) => `${t.table} ${t.moved}${t.merged ? `+${t.merged} merged` : ''}/${t.source}`).join(', ') + (clashes.length ? `; ids already taken, given new ones: ${some(clashes)}` : '')
      },
    },
  ]

  // Each step's report line, as copy.ts keeps them; the reading snapshot closes if a step throws.
  const chosen = o.scope === 'leads' ? steps.filter((s) => ['site: company', 'site: leads', 'site: counts'].includes(s.name)) : steps
  const wrapped: MoveStep[] = chosen.map((s) => ({
    name: s.name,
    added: s.added,
    run: async (io) => {
      try {
        const did = await s.run(io)
        report.steps.push({ step: s.name, did })
        return did
      } catch (e) { close(); throw e }
    },
  }))
  return {
    steps: wrapped,
    report,
    undoFiles: async () => { for (const k of put.splice(0)) await o.store.remove(k).catch(() => {}) },
  }
}

/** The website move on its own: one transaction on the unified database; on any failure nothing is kept (rows or files). */
export async function moveSite(o: SiteMoveOptions): Promise<SiteMoveReport> {
  const m = siteMoveSteps(o)
  await o.write('BEGIN')
  try {
    for (const s of m.steps) await s.run({ read: async () => { throw new Error('the site move reads the site.db, not a Postgres source') }, write: o.write })
    await o.write('COMMIT')
    return m.report
  } catch (e) {
    await o.write('ROLLBACK').catch(() => {})
    await m.undoFiles()
    throw e
  }
}
