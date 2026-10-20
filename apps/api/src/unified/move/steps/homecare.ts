// The data move's home-care steps: a live crm-homecare tenant's database (templates/crm-homecare, one agency per
// database) into its new unified database. The copy (../copy.ts) moves every table both layouts have; these steps do
// what the layouts alone can't (docs/CUTOVER_LEDGER.md "Cutover data steps for home care", docs/UNIFIED_HOMECARE_PLAN.md
// decisions 1 and 2):
//
//   before  the agency → company (decision 1), the agency's users → user with its company_id, after refusing a
//           database that isn't one agency's;
//   fill    company_id = the agency's id on every table that gains it (decision 2), and an id where the unified table
//           has one the template's didn't (keyed by the template's own primary key, so a second run gives the same ids);
//   after   the template's audit_log and its login_activity → the unified audit_log (the compliance monitor's Login
//           Activity reads the audit log: server/crm/homecare/office/compliance.ts), help_articles → the help desk's
//           support_knowledge_base (server/crm/comms/support.ts reads it; nothing reads the unified help_articles) with
//           the home-care guides a new agency gets at signup, the
//           call-tracking settings the unified app has no place for, said in the report, and the check that every row
//           carrying company_id is the agency's.
//
//   const m = homecareMove(oldLayout, newLayout)
//   await moveTenant({ read, write, target: newLayout, ...m })
//
// incidents.incident_number and client_document_templates.key are unique per database in the unified layout too, which
// is one company's — they move as they are.
import { randomUUID } from 'node:crypto'
import { planMove, type Layout, type MovePlan, type Query, type Table } from '../schema.ts'
import type { Fill, MoveStep } from '../copy.ts'
// What a new agency is given at signup, and the two clocks, from the code that runs them (no copies here).
import homecareVertical from '../../../../../unified/verticals/homecare/settings.ts'
import { BASE_STARTER, starterArticleRows } from '../../../../../unified/server/core/starter.ts'
import { resolveTimezone, isValidTimezone } from '../../../../../unified/server/crm/homecare/core/agencyTime.ts'
import { companyRowTimeZone } from '../../../../../../packages/tenant-backend/src/time/businessDay.ts'

const q = (id: string) => `"${id.replace(/"/g, '""')}"`

/**
 * The role words a moved user may carry: the unified rungs (packages/tenant-backend/src/auth/permissions.ts
 * BASE_ROLE_PERMISSIONS) and home care's `caregiver`, which the app maps to the field rung when it reads it
 * (apps/unified/verticals/homecare/settings.ts roleMapping; the home-care queries ask role IN ('caregiver', 'field')).
 * The stored word is kept. The template's own seats were owner, admin and caregiver.
 */
const KNOWN_ROLES = new Set(['owner', 'admin', 'manager', 'field', 'viewer', 'user', 'caregiver'])

/**
 * Tables the steps fill themselves because the unified table gains rows the old one didn't have (the copy holds every
 * table's count to the old one's): audit_log takes the old audit_log's rows and every login_activity row.
 */
const MERGED = ['audit_log']

/** The template's sign-in failure codes (routes/auth.ts logAuthEvent) in the unified sign-in's words (auth/auth.ts). */
const FAIL_WORDS: Record<string, string> = {
  invalid_password: 'Wrong password',
  account_inactive: 'Sign-in refused — this login has been revoked',
  user_not_found: 'No login with this email',
}

/** A column read as text: a timestamp with a zone at UTC (as the copy reads it), everything else as its text. */
function asText(col: string, type: string): string {
  return type === 'timestamp with time zone' ? `to_char(${q(col)} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS ${q(col)}` : `${q(col)}::text AS ${q(col)}`
}
const castType = (t: string) => (t.startsWith('_') ? `${t.slice(1)}[]` : t)

/** Every row of an old table (the given columns, as text), a page at a time, in primary-key order. */
async function* readRows(read: Query, t: Table, cols: string[], page = 500): AsyncGenerator<Record<string, string | null>[]> {
  const order = (t.primaryKey.length ? t.primaryKey : cols).map(q).join(', ')
  const list = cols.map((c) => asText(c, t.columns.get(c)!.type)).join(', ')
  for (let offset = 0; ; offset += page) {
    const rows = (await read(`SELECT ${list} FROM ${q(t.name)} ORDER BY ${order} LIMIT ${page} OFFSET ${offset}`)).rows
    if (!rows.length) return
    yield rows
    if (rows.length < page) return
  }
}

/** Inserts rows (column → text) into a new table, each value cast to its column's type. */
async function insertRows(write: Query, t: Table, rows: Record<string, string | null>[]): Promise<void> {
  if (!rows.length) return
  const cols = Object.keys(rows[0])
  for (const c of cols) if (!t.columns.has(c)) throw new Error(`${t.name} has no column ${c}`)
  const per = Math.max(1, Math.floor(60000 / cols.length))
  for (let i = 0; i < rows.length; i += per) {
    const params: unknown[] = []
    const tuples = rows.slice(i, i + per).map((r) => `(${cols.map((c) => { params.push(r[c] ?? null); return `$${params.length}::text::${castType(t.columns.get(c)!.type)}` }).join(', ')})`)
    await write(`INSERT INTO ${q(t.name)} (${cols.map(q).join(', ')}) VALUES ${tuples.join(', ')}`, params)
  }
}

export interface HomecareMove {
  plan: MovePlan
  fill: Fill
  before: MoveStep[]
  after: MoveStep[]
}

export function homecareMove(source: Layout, target: Layout): HomecareMove {
  const full = planMove(source, target)
  const plan: MovePlan = { ...full, tables: full.tables.filter((t) => !MERGED.includes(t.table)), order: full.order.filter((t) => !MERGED.includes(t)) }
  const need = (layout: Layout, name: string, side: string) => {
    const t = layout.get(name)
    if (!t) throw new Error(`The ${side} database has no ${name} table; this is not a home-care move`)
    return t
  }
  const agencies = need(source, 'agencies', 'old'), users = need(source, 'users', 'old')
  const company = need(target, 'company', 'new'), user = need(target, 'user', 'new')

  // What fill supplies, by rule. company_id: wherever the unified table has it and the template's doesn't (decision 2;
  // nullable ones too — phone_call's was the agency's, nullable, in the template). id: wherever the plan needs one.
  const companyFilled = new Set(plan.tables.filter((t) => target.get(t.table)!.columns.has('company_id') && !source.get(t.table)!.columns.has('company_id')).map((t) => t.table))
  const idFrom = new Map(plan.tables.filter((t) => t.needs.includes('id')).map((t) => [t.table, source.get(t.table)!.primaryKey]))
  const unfilled = plan.tables.flatMap((t) => t.needs.filter((n) => !(n === 'company_id' && companyFilled.has(t.table)) && !(n === 'id' && idFrom.has(t.table))).map((n) => `${t.table}.${n}`))
  if (unfilled.length) throw new Error(`The move has no value for ${unfilled.join(', ')} (required in the unified layout, absent from the template's)`)
  for (const [table, pk] of idFrom) if (!pk.length) throw new Error(`${table} has no primary key in the template to make its unified id from`)

  let agencyId: string | null = null
  const agency = () => {
    if (!agencyId) throw new Error('The agency is not known yet (the before steps run first)')
    return agencyId
  }

  const fill: Fill = (table, column, row) => {
    if (column === 'company_id' && companyFilled.has(table)) return row ? agency() : ''
    if (column === 'id' && idFrom.has(table)) {
      if (!row) return ''
      // The template's primary key, which the unified table keeps as a unique key: ai_receptionist_settings by agency,
      // incident_number_counters by year, shift_reminder_log by schedule and day, overtime_alert_log by entry and threshold.
      const parts = idFrom.get(table)!.map((k) => {
        if (k === 'agency_id') return agency()
        const v = row[k]
        if (v == null) throw new Error(`${table}.${k} is empty; its unified id is made from it`)
        return v
      })
      return `${table}:${parts.join(':')}`
    }
    return undefined
  }

  const before: MoveStep[] = [
    {
      name: 'the agency becomes the company',
      run: async ({ read, write }) => {
        // One agency per database is what the whole move rests on (every company_id is its id).
        const ids = (await read(`SELECT id FROM agencies ORDER BY id`)).rows.map((r) => String(r.id))
        if (ids.length !== 1) throw new Error(`Refused: the database has ${ids.length} agencies; a home-care move needs exactly one`)
        agencyId = ids[0]

        // Every business id the template already stored must be this agency's (its shared modules wrote company_id,
        // its call tracking agency_id); one that isn't would be another business's row in this company.
        const stray: string[] = []
        for (const [name, t] of source) {
          for (const col of ['agency_id', 'company_id']) {
            if (!t.columns.has(col)) continue
            const n = Number((await read(`SELECT count(*)::int AS n FROM ${q(name)} WHERE ${q(col)} IS NOT NULL AND ${q(col)} <> $1`, [agencyId])).rows[0].n)
            if (n) stray.push(`${name}.${col}: ${n}`)
            // A copied company_id that is empty where the unified column requires one.
            if (col === 'company_id' && target.get(name)?.columns.get('company_id')?.nullable === false) {
              const e = Number((await read(`SELECT count(*)::int AS n FROM ${q(name)} WHERE company_id IS NULL`)).rows[0].n)
              if (e) stray.push(`${name}.company_id empty: ${e}`)
            }
          }
        }
        if (stray.length) throw new Error(`Refused: rows that are not the agency's (${stray.join('; ')})`)

        const roles = (await read(`SELECT DISTINCT role FROM users ORDER BY role`)).rows.map((r) => String(r.role))
        const unknown = roles.filter((r) => !KNOWN_ROLES.has(r))
        if (unknown.length) throw new Error(`Refused: users with roles the unified app does not know (${unknown.join(', ')})`)

        // Every column of the agency has its place on company (decision 1 added the ones it lacked); one that doesn't
        // would be lost, so the move stops and says which.
        const homeless = [...agencies.columns.keys()].filter((c) => !company.columns.has(c))
        if (homeless.length) throw new Error(`Refused: agencies columns with no place on company: ${homeless.join(', ')}`)
        const [row] = (await read(`SELECT ${[...agencies.columns.keys()].map((c) => asText(c, agencies.columns.get(c)!.type)).join(', ')} FROM agencies`)).rows

        // The feature list: the template read the union of enabled_features and settings.enabledFeatures
        // (src/middleware/enabledFeature.ts readSettingsBlob); the unified app reads the column alone
        // (server/crm/homecare/core/agencyFeatures.ts), so the union goes into the column and leaves the settings.
        const parse = (v: string | null): unknown => { try { return v == null ? null : JSON.parse(v) } catch { return null } }
        const s = parse(row.settings)
        const settings: Record<string, unknown> = s && typeof s === 'object' && !Array.isArray(s) ? { ...(s as Record<string, unknown>) } : {}
        const col = parse(row.enabled_features)
        const column: unknown[] = Array.isArray(col) ? col : []
        const blob: unknown[] = Array.isArray(settings.enabledFeatures) ? settings.enabledFeatures : []
        const features = [...new Set([...column, ...blob].filter((f): f is string => typeof f === 'string'))]
        delete settings.enabledFeatures

        // The agency's clock, as the agency saw it. The template read agencies.timezone, else AGENCY_TIMEZONE (which the
        // Factory never sets), else its state's zone, else America/Chicago (services/agencyTime.ts; the unified home-care
        // code keeps that rule, core/agencyTime.ts). settings.timezone was read by nothing after 0021 copied it into the
        // column, but the shared modules' rule reads it when the column is empty, then the state's zone, then UTC
        // (packages/tenant-backend/src/time/businessDay.ts companyRowTimeZone). So it goes; and where the shared rule
        // would still land elsewhere (no state, a territory), the column is set to the zone the agency was on.
        let timezone = row.timezone
        const hadSettingsZone = 'timezone' in settings
        delete settings.timezone
        let tz = `timezone ${timezone}`
        if (!isValidTimezone(timezone)) {
          const was = resolveTimezone({ timezone: null, state: row.state })
          const shared = companyRowTimeZone({ timezone: null, settings, state: row.state })
          if (shared !== was) { timezone = was; tz = `timezone ${was} (the template's for state ${row.state || 'none'}; set, as the shared rule would read ${shared})` }
          else tz = `timezone not set (${was} from state ${row.state}, as before)`
        }
        if (hadSettingsZone) tz += '; settings.timezone dropped'

        await insertRows(write, company, [{ ...row, timezone, enabled_features: JSON.stringify(features), settings: JSON.stringify(settings) }])
        return `company ${agencyId} (${row.name}): ${agencies.columns.size} columns, ${features.length} features (${blob.filter((f) => !column.includes(f)).length} from settings), ${tz}`
      },
    },
    {
      name: "the agency's users become its users",
      run: async ({ read, write }) => {
        const homeless = [...users.columns.keys()].filter((c) => !user.columns.has(c))
        if (homeless.length) throw new Error(`Refused: users columns with no place on user: ${homeless.join(', ')}`)
        // Ids kept, so every reference to a user still resolves; password hashes, names and roles as stored.
        let n = 0
        for await (const rows of readRows(read, users, [...users.columns.keys()])) {
          await insertRows(write, user, rows.map((r) => ({ ...r, company_id: agency() })))
          n += rows.length
        }
        return `${n} users`
      },
    },
  ]

  const after: MoveStep[] = [
    {
      name: 'the audit log, with the sign-ins',
      run: async ({ read, write }) => {
        const auditLog = need(target, 'audit_log', 'new')
        let kept = 0, logins = 0
        // The template's own audit_log (its shared modules': leads, background-check files, two-factor), as it is.
        const old = source.get('audit_log')
        if (old) {
          const homeless = [...old.columns.keys()].filter((c) => !auditLog.columns.has(c))
          if (homeless.length) throw new Error(`Refused: audit_log columns with no place: ${homeless.join(', ')}`)
          for await (const rows of readRows(read, old, [...old.columns.keys()])) { await insertRows(write, auditLog, rows); kept += rows.length }
        }
        // login_activity → audit_log rows shaped as the unified sign-in writes them (packages/tenant-backend/src/auth/
        // auth.ts logAuth): action login / login_failed, entity user, the email as entity name and actor, the reason as
        // metadata.description, which the Login Activity screen shows (office/compliance.ts). Ids kept.
        const la = source.get('login_activity')
        if (la) {
          for await (const rows of readRows(read, la, [...la.columns.keys()])) {
            await insertRows(write, auditLog, rows.map((r) => {
              const ok = r.success === 'true'
              const description = ok ? 'Signed in' : (r.fail_reason ? FAIL_WORDS[r.fail_reason] ?? r.fail_reason : 'Sign-in failed')
              return {
                id: r.id, action: ok ? 'login' : 'login_failed', entity: 'user', entity_id: r.user_id, entity_name: r.email,
                metadata: JSON.stringify(ok || !r.fail_reason ? { description } : { description, reason: r.fail_reason }),
                ip_address: r.ip_address, user_agent: r.user_agent, created_at: r.created_at,
                user_id: r.user_id, user_name: r.email, user_email: r.email, company_id: agency(),
              }
            }))
            logins += rows.length
          }
        }
        const n = Number((await write(`SELECT count(*)::int AS n FROM audit_log`)).rows[0].n)
        if (n !== kept + logins) throw new Error(`audit_log: ${kept} + ${logins} moved, ${n} in the new database`)
        return `${kept} audit rows, ${logins} sign-ins`
      },
    },
    {
      name: 'help articles to the help desk',
      run: async ({ read, write }) => {
        const help = source.get('help_articles'), kb = target.get('support_knowledge_base')
        if (!help) return 'no help_articles in the old database'
        if (!kb) throw new Error('The new database has no support_knowledge_base for the agency\'s help articles')
        // Column for column (title, content, category, tags, FAQ, published, order, views, dates); the template kept no
        // author, so created_by_id stays empty. Ids kept. help_articles itself is copied too, but nothing reads it.
        const cols = [...help.columns.keys()].filter((c) => c !== 'agency_id' && c !== 'company_id')
        const homeless = cols.filter((c) => !kb.columns.has(c))
        if (homeless.length) throw new Error(`Refused: help_articles columns with no place on support_knowledge_base: ${homeless.join(', ')}`)
        let n = 0
        for await (const rows of readRows(read, help, cols)) { await insertRows(write, kb, rows.map((r) => ({ ...r, company_id: agency() }))); n += rows.length }
        return `${n} articles`
      },
    },
    {
      name: 'the home-care guides',
      run: async ({ write }) => {
        // What a new agency's Help holds on day one (verticals/homecare/settings.ts HOMECARE_STARTER), written by the same
        // function signup uses (server/core/starter.ts starterArticleRows). An article is known by its title (the starter
        // has no other key): one the agency already has is left as it is, so a second run adds nothing.
        const kb = need(target, 'support_knowledge_base', 'new')
        const have = new Set((await write(`SELECT title FROM support_knowledge_base WHERE company_id = $1`, [agency()])).rows.map((r) => String(r.title)))
        const rows = starterArticleRows(homecareVertical.starter ?? BASE_STARTER, agency())
        const add = rows.filter((a) => !have.has(a.title))
        await insertRows(write, kb, add.map((a) => ({
          id: randomUUID(), title: a.title, content: a.content, category: a.category, tags: JSON.stringify(a.tags),
          is_faq: String(a.isFaq), sort_order: String(a.sortOrder), company_id: a.companyId,
        })))
        return `${add.length} of ${rows.length} guides added${rows.length > add.length ? ` (${rows.length - add.length} already there by title)` : ''}`
      },
    },
    {
      name: 'call-tracking settings with no place',
      run: async ({ read }) => {
        // tracking_number.whisper_message and recording_enabled (0006_add_ai_receptionist) have no column in the unified
        // app (server/data/calltracking.ts left them out of edits). Nothing in the template read them either — its
        // services/calltracking.ts only wrote them — so no call behaves differently; the values set are named here.
        const t = source.get('tracking_number')
        if (!t || (!t.columns.has('whisper_message') && !t.columns.has('recording_enabled'))) return 'none'
        const conds = [t.columns.has('whisper_message') ? `COALESCE(whisper_message, '') <> ''` : null, t.columns.has('recording_enabled') ? `recording_enabled = false` : null].filter(Boolean)
        const rows = (await read(`SELECT id, phone_number FROM tracking_number WHERE ${conds.join(' OR ')} ORDER BY id`)).rows
        return rows.length ? `not moved, set on ${rows.length} number(s): ${rows.map((r) => r.phone_number).join(', ')}` : 'none set'
      },
    },
    {
      name: "every row is the agency's",
      run: async ({ write }) => {
        const id = agency()
        const co = (await write(`SELECT id FROM company`)).rows.map((r) => String(r.id))
        if (co.length !== 1 || co[0] !== id) throw new Error(`company holds ${co.join(', ') || 'nothing'}, not the agency ${id}`)
        const wrong: string[] = []
        let rows = 0, tables = 0
        for (const [name, t] of target) {
          if (!t.columns.has('company_id')) continue
          const r = (await write(`SELECT count(*)::int AS n, count(*) FILTER (WHERE company_id IS DISTINCT FROM $1)::int AS bad FROM ${q(name)}`, [id])).rows[0]
          if (Number(r.bad)) wrong.push(`${name}: ${r.bad}`)
          if (Number(r.n)) { rows += Number(r.n); tables++ }
        }
        if (wrong.length) throw new Error(`Rows not the agency's: ${wrong.join('; ')}`)
        return `${rows} rows in ${tables} tables, all company ${id}`
      },
    },
  ]

  return { plan, fill, before, after }
}
