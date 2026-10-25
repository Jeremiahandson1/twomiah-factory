// The data move's steps for the trades CRMs: the contractor template (`templates/crm`) and the bar (`templates/crm-bar`),
// which share almost every table. copy.ts moves every table both layouts have; these are what it cannot do alone.
//
// The template's LIVE database is not its migrations alone: every boot runs `db/prune-legacy.ts` (drops
// quickbooks_connection, adds raw-SQL columns as bare `numeric`) and `db/reconcile.ts` (adds schema.ts's tables and
// columns, but no foreign keys and no column-level UNIQUE), then a best-effort `drizzle-kit push --force`
// (apps/api/src/services/deploy.ts dbReconcileStep). So which columns and rules a tenant has depends on which of those
// ever finished. Nothing here assumes a column exists: every step asks the old layout first, and the rules the new
// layout enforces are compared against the old database's at run time, not listed by hand.
//
//   before: 1. narrowing conversions — a value that would not fit refuses the move; one that would be rounded is reported
//           2. hold the rules the old database never kept (unique indexes, foreign keys, NOT NULL), so the copy can land
//   after:  3. invoice numbers — the live duplicates healed as unified migration 0008 / the vet's 0034 describe
//           4. links that point at nothing (a foreign key the old database never had) — cleared, or the move refuses
//           5. required values the old database left empty — filled by what the template itself read them as
//           6. every other held one-per rule — a duplicate refuses the move
//           7. the held rules put back (each re-validates every row)
//           8. booking: settings → booking_settings / booking_hours / company; bookable_service → booking_service;
//              online_booking → booking (+ job.booking_id)
//           9. QuickBooks — qb_integration moves with the copy; the removed quickbooks_connection is reported, not copied
//          10. columns the unified app dropped — checked, never silently lost
//
// A step returns one line for the report. A step that refuses throws; copy.ts then rolls the new database back whole.
import crypto from 'node:crypto'
import { isSafeConversion, type Layout, type MovePlan, type Query } from '../schema.ts'
import type { Fill, MoveStep } from '../copy.ts'

export type TradesVertical = 'crm' | 'crm-bar'

export interface TradesMove {
  fill: Fill
  before: MoveStep[]
  after: MoveStep[]
}

const q = (id: string) => `"${id.replace(/"/g, '""')}"`
/** At most ten ids, then how many more: a report line names rows without becoming the rows. */
const some = (ids: unknown[]) => ids.slice(0, 10).join(', ') + (ids.length > 10 ? ` and ${ids.length - 10} more` : '')

/**
 * `ai_receptionist_settings.id`: the template keyed the table by company (one row each, `company_id` unique); the
 * unified table has the standard id with `company_id` unique (docs/CUTOVER_LEDGER.md step 3, "a moved row is given an
 * id"). Derived from the company, so a second run of the move gives the same id.
 */
export const tradesFill: Fill = (table, column, row) =>
  table === 'ai_receptionist_settings' && column === 'id' ? (row ? `ars_${row.company_id}` : '') : undefined

// ─── The rules the old database never kept ──────────────────────────────────────────────────────────────────────────

interface HeldFk { table: string; column: string; name: string; def: string; refTable: string; refColumn: string; onDelete: string; nullable: boolean }
interface HeldUnique { table: string; name: string; columns: string[]; def: string; constraint: boolean }
interface HeldNotNull { table: string; column: string }
interface Held { fks: HeldFk[]; uniques: HeldUnique[]; notNull: HeldNotNull[] }

const ON_DELETE: Record<string, string> = { a: 'no action', r: 'restrict', c: 'cascade', n: 'set null', d: 'set default' }

/** Unique indexes (not primary keys) by table, normalised so the same rule under another name compares equal. */
async function uniqueIndexes(query: Query) {
  const rows = (await query(`SELECT t.relname AS tbl, ic.relname AS name, pg_get_indexdef(i.indexrelid) AS def,
      (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum) AS cols,
      i.indnatts AS natts, con.conname IS NOT NULL AS is_constraint, pg_get_constraintdef(con.oid) AS condef
    FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    LEFT JOIN pg_constraint con ON con.conindid = i.indexrelid AND con.contype = 'u'
    WHERE n.nspname = 'public' AND i.indisunique AND NOT i.indisprimary`)).rows
  const norm = (def: string) => def.replace(/^CREATE UNIQUE INDEX \S+ ON (ONLY )?(public\.)?/, '').replace(/"/g, '').replace(/USING btree /, '')
  return rows.map((r: any) => ({ table: r.tbl as string, name: r.name as string, def: r.def as string, key: norm(r.def), cols: (r.cols ?? []) as string[], complete: (r.cols ?? []).length === Number(r.natts), constraint: !!r.is_constraint, condef: r.condef as string | null }))
}

async function foreignKeys(query: Query) {
  return (await query(`SELECT con.conname AS name, t.relname AS tbl, a.attname AS col, rt.relname AS ref_tbl, ra.attname AS ref_col,
      pg_get_constraintdef(con.oid) AS def, con.confdeltype AS on_delete, array_length(con.conkey, 1) AS n
    FROM pg_constraint con JOIN pg_class t ON t.oid = con.conrelid JOIN pg_class rt ON rt.oid = con.confrelid
    JOIN pg_namespace ns ON ns.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
    JOIN pg_attribute ra ON ra.attrelid = con.confrelid AND ra.attnum = con.confkey[1]
    WHERE con.contype = 'f' AND ns.nspname = 'public'`)).rows as any[]
}

/** Which of the new layout's rules the copy would break on old rows: the ones the old database did not enforce. */
async function rulesToHold(read: Query, write: Query, source: Layout, target: Layout, plan: MovePlan): Promise<Held> {
  const copied = new Map(plan.tables.map((t) => [t.table, new Set(t.columns.filter((c) => c.how !== 'left behind').map((c) => c.column))]))
  const held: Held = { fks: [], uniques: [], notNull: [] }

  const oldUniques = new Set((await uniqueIndexes(read)).map((u) => u.key))
  for (const u of await uniqueIndexes(write)) {
    const cols = copied.get(u.table)
    if (!cols || oldUniques.has(u.key)) continue
    // A rule over columns the copy leaves empty (or an expression over them) cannot be broken by old rows.
    if (u.complete && !u.cols.every((c) => cols.has(c))) continue
    if (!u.complete) throw new Error(`${u.table}: the unique rule ${u.name} is over an expression; this move has no way to check old rows against it`)
    held.uniques.push({ table: u.table, name: u.name, columns: u.cols, def: u.constraint ? u.condef! : u.def, constraint: u.constraint })
  }

  for (const fk of await foreignKeys(write)) {
    const cols = copied.get(fk.tbl)
    if (!cols?.has(fk.col)) continue
    if (source.get(fk.tbl)?.foreignKeys.some((x) => x.column === fk.col && x.refTable === fk.ref_tbl)) continue
    if (Number(fk.n) !== 1) throw new Error(`${fk.tbl}: the foreign key ${fk.name} spans several columns; this move has no rule for its orphans`)
    held.fks.push({ table: fk.tbl, column: fk.col, name: fk.name, def: fk.def, refTable: fk.ref_tbl, refColumn: fk.ref_col, onDelete: fk.on_delete, nullable: !!target.get(fk.tbl)?.columns.get(fk.col)?.nullable })
  }

  for (const t of plan.tables) {
    const st = source.get(t.table)!, tt = target.get(t.table)!
    for (const c of t.columns) {
      if (c.how === 'left behind') continue
      if (st.columns.get(c.column)?.nullable && !tt.columns.get(c.column)?.nullable) held.notNull.push({ table: t.table, column: c.column })
    }
  }
  return held
}

/** The primary key column to name rows by in a report (every moved table has a single-column id). */
const keyOf = (target: Layout, table: string) => target.get(table)?.primaryKey[0] ?? 'id'

// ─── Required values the template left empty: what the template itself read them as ────────────────────────────────

/**
 * table.column → the SQL that fills a NULL the old database allowed, run on the new database's row. Each is what the
 * template's own code made of the empty value, so the app reads the same thing after the move:
 */
const FILLS: Record<string, { sql: string; why: string }> = {
  // templates/crm/backend/src/services/takeoffs.ts writes `mat.unitPrice || 0` and reads `Number(mat.unit_price || 0)`.
  'assembly_material.unit_price': { sql: `0`, why: 'read as 0 by the takeoff calculator' },
  // …which then stores the material's price as given (possibly empty) and the total as measured × (price || 0).
  'takeoff_calculated_material.unit_price': { sql: `0`, why: 'read as 0 by the takeoff calculator' },
  'takeoff_calculated_material.total_price': { sql: `COALESCE(total_quantity, 0) * COALESCE(unit_price, 0)`, why: 'measured quantity × price, the calculator\'s own sum' },
  // packages/tenant-backend/src/recurring/recurring.ts: total = (quantity || 1) * (unitPrice || 0).
  'recurring_line_item.total': { sql: `round((CASE WHEN COALESCE(quantity, 0) = 0 THEN 1 ELSE quantity END) * COALESCE(unit_price, 0), 2)`, why: 'quantity × unit price, the recurring service\'s own sum' },
  // packages/tenant-backend/src/integrations/reviews.ts sends on `request.channel || settings.reviewChannel || 'both'`.
  'review_request.channel': { sql: `COALESCE((SELECT NULLIF(c.settings::jsonb ->> 'reviewChannel', '') FROM company c WHERE c.id = review_request.company_id), 'both')`, why: 'the company\'s review channel, which the template sent an empty one on' },
  // No code reads it; the only time the row knows is when it was made (the unified default, now(), would claim an edit).
  'tracking_number.updated_at': { sql: `created_at`, why: 'set to when the number was added' },
  // ── crm-bar ──
  // packages/tenant-backend/src/integrations/sms.ts refuses a text only when `optedOutSms` is truthy: empty = not opted out.
  'contact.opted_out_sms': { sql: `false`, why: 'not opted out, as the SMS service read an empty value' },
  // docs/CUTOVER_LEDGER.md step 3 (verticals): "job.job_type defaults to 'service' (basic, bar) in the database".
  'job.job_type': { sql: `'service'`, why: 'the bar\'s job type default (ledger, migration 0006)' },
}

// ─── The steps ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The steps for one trades tenant. `source`/`target`/`plan` are the ones handed to moveTenant. */
export function tradesMove(o: { vertical: TradesVertical; source: Layout; target: Layout; plan: MovePlan }): TradesMove {
  const { source, target, plan, vertical } = o
  const has = (table: string, column?: string) => !!source.get(table) && (!column || source.get(table)!.columns.has(column))
  let held: Held = { fks: [], uniques: [], notNull: [] }

  const before: MoveStep[] = [
    {
      // copy.ts casts each value to the new column's type. Most conversions are renames or widenings (isSafeConversion);
      // the rest are the bare `numeric` columns prune-legacy.ts adds (recurring_line_item.total, the bar's takeoff
      // measurements) going into numeric(p,s). A value too big for the new column would fail the cast mid-copy; one with
      // more decimals is rounded by it. Both are found here, before anything is written.
      name: 'narrowing conversions',
      run: async ({ read }) => {
        const notes: string[] = []
        for (const t of plan.tables) for (const c of t.columns) {
          if (c.how !== 'convert' || isSafeConversion(c.from, c.to)) continue
          const m = /^numeric\((\d+),(\d+)\)$/.exec(c.to)
          if (!m || !/^numeric/.test(c.from)) throw new Error(`${t.table}.${c.column}: ${c.from} → ${c.to} is a conversion this move has no rule for`)
          const [p, s] = [+m[1], +m[2]], key = keyOf(target, t.table), col = q(c.column)
          const over = (await read(`SELECT ${q(key)}::text AS id FROM ${q(t.table)} WHERE abs(${col}) >= 10::numeric ^ ${p - s} ORDER BY 1`)).rows
          if (over.length) throw new Error(`${t.table}.${c.column}: ${over.length} value(s) too large for ${c.to} (rows ${some(over.map((r: any) => r.id))}); the move cannot carry them`)
          const rounded = (await read(`SELECT ${q(key)}::text AS id, ${col}::text AS was, round(${col}, ${s})::text AS now FROM ${q(t.table)} WHERE ${col} <> round(${col}, ${s}) ORDER BY 1`)).rows
          if (rounded.length) notes.push(`${t.table}.${c.column}: ${rounded.length} value(s) rounded to ${s} places (${some(rounded.map((r: any) => `${r.id} ${r.was}→${r.now}`))})`)
        }
        return notes.length ? notes.join('; ') : 'none needed rounding'
      },
    },
    {
      name: 'hold the rules the old database never kept',
      run: async ({ read, write }) => {
        held = await rulesToHold(read, write, source, target, plan)
        for (const f of held.fks) await write(`ALTER TABLE ${q(f.table)} DROP CONSTRAINT ${q(f.name)}`)
        for (const u of held.uniques) await write(u.constraint ? `ALTER TABLE ${q(u.table)} DROP CONSTRAINT ${q(u.name)}` : `DROP INDEX ${q(u.name)}`)
        for (const n of held.notNull) await write(`ALTER TABLE ${q(n.table)} ALTER COLUMN ${q(n.column)} DROP NOT NULL`)
        return `held ${held.uniques.length} unique rule(s), ${held.fks.length} foreign key(s), ${held.notNull.length} NOT NULL(s) until the rows are checked`
      },
    },
  ]

  const after: MoveStep[] = [
    {
      // Unified migration 0008 makes two live invoices sharing a number impossible; the ledger leaves the heal of old
      // duplicates to the move. From the vet's 0034 (templates/crm-vet/backend/db/migrations/0034_*.sql), only drafts are
      // ever renumbered (nobody has seen a draft's number). Per company and number among LIVE (non-void) invoices: one
      // that is sent, part-paid or paid keeps the number — the customer holds it — and every draft sharing it is
      // renumbered, whatever their ages (the lead's decision, 2026-10-20; 0034 kept the oldest and so refused an older
      // draft beside a newer sent bill); all drafts → the oldest (created_at, id) keeps it; two or more non-drafts → the
      // move refuses, naming them — a human decides. New numbers are INV-nnnnn above the company's highest
      // ever issued: the highest INV-<digits> AND company.settings.docSeq.INV, the forward-only mark the shared
      // nextNumber keeps (packages/tenant-backend/src/invoicing/money.ts) — 0034 read only the rows still there, which
      // would re-issue a number whose invoice was deleted. The mark is advanced past them so the app never issues one again.
      name: 'invoice numbers: live duplicates',
      run: async ({ write }) => {
        if (!held.uniques.some((u) => u.table === 'invoice' && u.columns.join(',') === 'company_id,number')) return 'the old database already kept one number per live invoice'
        // Each group of live invoices sharing a number: a non-draft keeps it (the customer holds it) and every draft is
        // renumbered whatever its age; all drafts → the oldest keeps it. Two non-drafts: no honest heal, the move refuses.
        const live = (await write(`SELECT id, company_id, number, status FROM invoice i WHERE status <> 'void'
            AND EXISTS (SELECT 1 FROM invoice o WHERE o.company_id = i.company_id AND o.number = i.number AND o.status <> 'void' AND o.id <> i.id)
            ORDER BY company_id, number, created_at, id`)).rows as any[]
        const groups = new Map<string, any[]>()
        for (const r of live) groups.set(`${r.company_id}\u0000${r.number}`, [...(groups.get(`${r.company_id}\u0000${r.number}`) ?? []), r])
        const clash: string[] = [], dupes: any[] = []
        for (const g of groups.values()) {
          const sent = g.filter((r) => r.status !== 'draft')
          if (sent.length > 1) { clash.push(`${g[0].number}: ${sent.map((r) => `${r.id} ${r.status}`).join(', ')}`); continue }
          const keeper = sent[0] ?? g[0]
          dupes.push(...g.filter((r) => r !== keeper))
        }
        if (clash.length) throw new Error(`invoice numbers: ${clash.length} number(s) are held by more than one live invoice that is not a draft, so renumbering any would change a bill a client holds (${some(clash)}). Void or renumber them in the old app, then move again.`)
        const byCompany = new Map<string, any[]>()
        for (const d of dupes) byCompany.set(d.company_id, [...(byCompany.get(d.company_id) ?? []), d])
        const lines: string[] = []
        for (const [companyId, rows] of byCompany) {
          const high = Number((await write(`SELECT GREATEST(
              COALESCE((SELECT max(substring(number FROM '^INV-(\\d+)$')::bigint) FROM invoice WHERE company_id = $1), 0),
              COALESCE((SELECT CASE WHEN (settings::jsonb -> 'docSeq' ->> 'INV') ~ '^[0-9]+$' THEN (settings::jsonb -> 'docSeq' ->> 'INV')::bigint END FROM company WHERE id = $1), 0)) AS high`, [companyId])).rows[0].high)
          let n = high
          for (const r of rows) {
            n += 1
            const number = `INV-${String(n).padStart(5, '0')}`
            await write(`UPDATE invoice SET number = $1, updated_at = now() WHERE id = $2`, [number, r.id])
            lines.push(`${r.id} ${r.number}→${number}`)
          }
          await write(`UPDATE company SET settings = (COALESCE(settings::jsonb, '{}'::jsonb) || jsonb_build_object('docSeq',
              COALESCE(settings::jsonb -> 'docSeq', '{}'::jsonb) || jsonb_build_object('INV', $1::bigint)))::json WHERE id = $2`, [n, companyId])
        }
        return lines.length ? `${lines.length} duplicate draft(s) renumbered (${some(lines)})` : 'no live duplicates'
      },
    },
    {
      // A foreign key the new layout has and the old database did not: the old rows may point at a row that was deleted.
      // Such a link says nothing, so when the column may be empty it is cleared and the row kept (every row still moves,
      // copy.ts's count check holds). When it may not be empty there is no honest value: the move refuses, naming the rows.
      name: 'links that point at nothing',
      run: async ({ write }) => {
        const cleared: string[] = []
        for (const f of held.fks) {
          const key = keyOf(target, f.table)
          const orphans = (await write(`SELECT ${q(key)}::text AS id, ${q(f.column)}::text AS v FROM ${q(f.table)} t
              WHERE ${q(f.column)} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${q(f.refTable)} r WHERE r.${q(f.refColumn)} = t.${q(f.column)}) ORDER BY 1`)).rows as any[]
          if (!orphans.length) continue
          if (!f.nullable) throw new Error(`${f.table}.${f.column}: ${orphans.length} row(s) point at a ${f.refTable} that no longer exists and the column may not be empty (rows ${some(orphans.map((r) => r.id))}); the new app would have removed them with it (on delete ${ON_DELETE[f.onDelete] ?? f.onDelete}). Remove or re-link them in the old app, then move again.`)
          await write(`UPDATE ${q(f.table)} t SET ${q(f.column)} = NULL WHERE ${q(f.column)} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${q(f.refTable)} r WHERE r.${q(f.refColumn)} = t.${q(f.column)})`)
          cleared.push(`${f.table}.${f.column} ${orphans.length} (rows ${some(orphans.map((r) => r.id))})`)
        }
        return cleared.length ? `cleared links to deleted rows: ${cleared.join('; ')}` : 'none'
      },
    },
    {
      name: 'required values the old database left empty',
      run: async ({ write }) => {
        const filled: string[] = []
        // A fill that reads another column runs after that column's own (takeoff_calculated_material's total reads its price).
        const order = [...held.notNull].sort((a, b) => Number(a.column === 'total_price') - Number(b.column === 'total_price'))
        for (const n of order) {
          const key = keyOf(target, n.table)
          const empty = (await write(`SELECT ${q(key)}::text AS id FROM ${q(n.table)} WHERE ${q(n.column)} IS NULL ORDER BY 1`)).rows as any[]
          if (!empty.length) continue
          const fill = FILLS[`${n.table}.${n.column}`]
          if (!fill) throw new Error(`${n.table}.${n.column}: ${empty.length} row(s) are empty and the new app requires a value (rows ${some(empty.map((r) => r.id))}); this move has no rule for what they mean`)
          await write(`UPDATE ${q(n.table)} SET ${q(n.column)} = ${fill.sql} WHERE ${q(n.column)} IS NULL`)
          filled.push(`${n.table}.${n.column} ${empty.length}: ${fill.why}`)
        }
        return filled.length ? filled.join('; ') : 'none'
      },
    },
    {
      // Every other unique rule the old database did not keep: no heal rule is known, so a duplicate refuses the move.
      name: 'one-per rules',
      run: async ({ write }) => {
        for (const u of held.uniques) {
          if (u.table === 'invoice' && u.columns.join(',') === 'company_id,number') continue
          const where = (/ WHERE (.*)$/.exec(u.def)?.[1]) ?? null
          const key = keyOf(target, u.table)
          const dupes = (await write(`SELECT ${u.columns.map(q).join(', ')}, array_agg(${q(key)}::text ORDER BY ${q(key)}) AS ids FROM ${q(u.table)}
              WHERE ${u.columns.map((c) => `${q(c)} IS NOT NULL`).join(' AND ')}${where && !u.constraint ? ` AND (${where})` : ''}
              GROUP BY ${u.columns.map(q).join(', ')} HAVING count(*) > 1`)).rows as any[]
          if (dupes.length) throw new Error(`${u.table}: ${dupes.length} group(s) of rows share ${u.columns.join(' + ')}, which the new app allows once (${some(dupes.map((d) => `[${d.ids.join(', ')}]`))}). Merge or remove the extras in the old app, then move again.`)
        }
        return `checked ${held.uniques.length} unique rule(s)`
      },
    },
    {
      name: 'put the held rules back',
      run: async ({ write }) => {
        for (const u of held.uniques) await write(u.constraint ? `ALTER TABLE ${q(u.table)} ADD CONSTRAINT ${q(u.name)} ${u.def}` : u.def)
        for (const n of held.notNull) await write(`ALTER TABLE ${q(n.table)} ALTER COLUMN ${q(n.column)} SET NOT NULL`)
        for (const f of held.fks) await write(`ALTER TABLE ${q(f.table)} ADD CONSTRAINT ${q(f.name)} ${f.def}`)
        return `restored ${held.uniques.length + held.notNull.length + held.fks.length} rule(s); every moved row satisfies them`
      },
    },
    ...bookingSteps(has),
    {
      // qb_integration (one row per company) is a table both layouts have, so the copy already moved it. Its tokens are
      // stored as they came from Intuit in both apps — packages/tenant-backend/src/integrations/quickbooks.ts reads and
      // writes them as-is, and nothing in crm or crm-bar uses ENCRYPTION_KEY (the unified build makes a new one,
      // apps/api/src/unified/build.ts tenantEnv, which therefore does not matter here). They belong to the Factory's one
      // Intuit app (QBO_CLIENT_ID / QBO_CLIENT_SECRET, apps/api/src/services/quickbooksEnv.ts quickbooksTenantEnv), so
      // the connection keeps working on the new service as long as its integration settings come from that function.
      //
      // quickbooks_connection is the table the template stopped using on 2026-09-12 (e8ba1d0a2: "crm-family QuickBooks
      // wrote to a table its own boot prune drops") and drops at every boot (db/prune-legacy.ts). Where it survives, its
      // rows are a connection nothing has refreshed since, for an Intuit environment (sandbox or production) nobody
      // recorded; it is not copied — the owner connects QuickBooks again in Settings → Integrations.
      name: 'QuickBooks',
      run: async ({ read, write }) => {
        const out: string[] = []
        if (target.has('qb_integration')) {
          const moved = (await write(`SELECT count(*)::int AS n, count(*) FILTER (WHERE realm_id IS NOT NULL AND refresh_token IS NOT NULL)::int AS live, count(*) FILTER (WHERE sync_enabled)::int AS sync FROM qb_integration`)).rows[0]
          out.push(moved.n ? `${moved.live} of ${moved.n} connection(s) moved with their tokens (sync on: ${moved.sync}); they need the Factory's QBO_* settings on the new service` : 'no QuickBooks connection')
        }
        if (has('quickbooks_connection')) {
          const old = (await read(`SELECT count(*)::int AS n FROM quickbooks_connection`)).rows[0].n
          if (old) out.push(`${old} row(s) in the removed quickbooks_connection table not moved (unused since 2026-09-12, environment unknown): the owner reconnects QuickBooks in Settings → Integrations`)
        }
        return out.join('; ') || 'no QuickBooks connection'
      },
    },
    {
      // Columns the unified layout does not have, each read from the old database:
      //   recurring_line_item.amount — the line total's first name (migration 0000). Every writer since has written
      //     `total` (packages/tenant-backend/src/recurring/recurring.ts; its history writes `total` back to March), so
      //     `amount` is its default 0. A row carrying anything else is reported. `total` itself is checked against the
      //     service's own sum, quantity × unit price.
      //   takeoff_item.unit_cost / total_cost / company_id — the field-service lineage's columns (prune-legacy.ts:
      //     "fieldservice-lineage migrations created this table with the old cost columns"); the takeoff service has
      //     never written them (its INSERT names neither, since 7a7ebcd49) and scopes items through their sheet ("takeoff_item
      //     has no company_id", T32). Costs live on takeoff_calculated_material. Non-default rows are reported.
      name: 'columns the new app dropped',
      run: async ({ read }) => {
        const out: string[] = []
        if (has('recurring_line_item', 'amount')) {
          const odd = (await read(`SELECT id::text AS id, amount::text AS amount, total::text AS total FROM recurring_line_item
              WHERE amount <> 0 AND (total IS NULL OR round(total, 2) <> amount) ORDER BY 1`)).rows as any[]
          out.push(odd.length ? `recurring_line_item.amount: ${odd.length} row(s) hold a figure the line's total does not (${some(odd.map((r) => `${r.id} amount ${r.amount} total ${r.total ?? 'empty'}`))}) — not moved; check those lines` : 'recurring_line_item.amount: nothing but its default')
        }
        if (has('recurring_line_item', 'total') && has('recurring_line_item', 'unit_price')) {
          const off = (await read(`SELECT id::text AS id, total::text AS total FROM recurring_line_item
              WHERE total IS NOT NULL AND round(total, 2) <> round((CASE WHEN COALESCE(quantity, 0) = 0 THEN 1 ELSE quantity END) * COALESCE(unit_price, 0), 2) ORDER BY 1`)).rows as any[]
          if (off.length) out.push(`recurring_line_item.total: ${off.length} row(s) differ from quantity × unit price (${some(off.map((r) => `${r.id} ${r.total}`))}) — moved as stored`)
        }
        for (const col of ['unit_cost', 'total_cost']) if (has('takeoff_item', col)) {
          const n = (await read(`SELECT id::text AS id FROM takeoff_item WHERE COALESCE(${q(col)}, 0) <> 0 ORDER BY 1`)).rows as any[]
          out.push(n.length ? `takeoff_item.${col}: ${n.length} row(s) carry a figure no screen wrote (${some(n.map((r) => r.id))}) — not moved` : `takeoff_item.${col}: nothing but its default`)
        }
        if (has('takeoff_item', 'company_id') && has('takeoff_item', 'sheet_id') && has('takeoff_sheet')) {
          const n = (await read(`SELECT ti.id::text AS id FROM takeoff_item ti LEFT JOIN takeoff_sheet ts ON ts.id = ti.sheet_id
              WHERE ti.company_id IS NOT NULL AND ti.company_id IS DISTINCT FROM ts.company_id ORDER BY 1`)).rows as any[]
          out.push(n.length ? `takeoff_item.company_id: ${n.length} row(s) name a company their sheet does not (${some(n.map((r) => r.id))}) — the new app goes by the sheet` : 'takeoff_item.company_id: empty or its sheet\'s')
        }
        // ── crm-bar ── user.location_id: added by the bar's migration 0005 ("assign techs … to specific locations"); no
        // code in the bar ever reads or writes it, and schema.ts has no such column on user. The unified app keeps a branch
        // on team_member (the roster), not on the sign-in seat, so it has no home here.
        if (vertical === 'crm-bar' && has('user', 'location_id')) {
          const n = (await read(`SELECT id::text AS id FROM "user" WHERE location_id IS NOT NULL ORDER BY 1`)).rows as any[]
          out.push(n.length ? `user.location_id: ${n.length} seat(s) carry a branch no screen set (${some(n.map((r) => r.id))}) — not moved; the owner sets branches on the team roster` : 'user.location_id: never set')
        }
        return out.join('; ') || 'none present'
      },
    },
  ]

  return { fill: tradesFill, before, after }
}

// ─── Booking ────────────────────────────────────────────────────────────────────────────────────────────────────────
//
// The CRMs' booking (packages/tenant-backend/src/booking/service.ts over booking_settings, bookable_service,
// online_booking) → the bookings layer (apps/unified/server/db/schema/booking.ts, server/booking/engine.ts).

/** apps/unified/server/booking/engine.ts slugify, and its address rule SLUG_RE. */
const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
/** apps/unified/server/booking/engine.ts newToken: the customer's private link. */
const newToken = () => crypto.randomBytes(24).toString('base64url')
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const isHm = (s: unknown) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
const minutes = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m }
const num = (v: unknown, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d }
const STATUSES = new Set(['pending', 'confirmed', 'cancelled', 'completed', 'no_show'])

function bookingSteps(has: (table: string, column?: string) => boolean): MoveStep[] {
  /** The template's slot length per company (service.ts normalizeSettings: `num(row.slotDurationMinutes, 60) || 60`). */
  const slotFor = new Map<string, number>()
  /** Companies given the "Online booking" service, by its id. */
  const generic = new Map<string, string>()

  return [
    {
      // booking_settings is in both layouts, so the copy moved enabled, max_days_out, timezone, require_address and the
      // two notify switches. The rest, each from what the template did with it:
      //   lead_time_days → lead_time_minutes × 1440 (the template refused a slot before now + days × 24h; the unified
      //     engine refuses one before now + minutes).
      //   working_hours {monday: {start, end, enabled}} → one booking_hours row per open day, user_id null ("anyone").
      //     A bad time read as 09:00 / 17:00, as the template's slot list did; a closed or empty day has no row.
      //   welcome_message → hero_title (the widget's heading: `title: row.welcomeMessage || 'Book an appointment'`).
      //   confirmation_message → thanks_message (the widget's words after a booking).
      //   logo / primary_color → the company's, only where the company has none: the widget showed
      //     `company.logo || settings.logo` and `company.primaryColor || settings.primaryColor` (booking/routes.ts), and
      //     the unified booking pages are the website's, which take both from the company (server/site/context.ts).
      //   slot_duration_minutes → each service's slot_step_minutes (next step), the grid the template stepped by.
      //   concurrent_bookings above 1 has no equal: the template let that many bookings overlap whatever the service;
      //     the unified engine books one at a time per person ("anyone" hours: one at a time), and a service's capacity
      //     counts only a class's own bookings at one start. Reported: the owner sets hours per person instead.
      name: 'booking settings',
      run: async ({ read, write }) => {
        if (!has('booking_settings')) return 'no booking settings'
        const cols = ['id', 'company_id', 'lead_time_days', 'slot_duration_minutes', 'working_hours', 'concurrent_bookings', 'welcome_message', 'confirmation_message', 'logo', 'primary_color'].filter((c) => has('booking_settings', c))
        const rows = (await read(`SELECT ${cols.map((c) => `${q(c)}::text AS ${q(c)}`).join(', ')} FROM booking_settings ORDER BY company_id`)).rows as any[]
        const out: string[] = []
        for (const r of rows) {
          slotFor.set(r.company_id, num(r.slot_duration_minutes, 60) || 60)
          const set: string[] = [], params: unknown[] = []
          const put = (col: string, v: unknown) => { params.push(v); set.push(`${q(col)} = $${params.length}`) }
          if (r.lead_time_days != null) put('lead_time_minutes', Math.round(num(r.lead_time_days, 1)) * 1440)
          if (r.welcome_message?.trim()) put('hero_title', r.welcome_message)
          if (r.confirmation_message?.trim()) put('thanks_message', r.confirmation_message)
          if (set.length) { params.push(r.company_id); await write(`UPDATE booking_settings SET ${set.join(', ')} WHERE company_id = $${params.length}`, params) }

          let hours = 0
          if (r.working_hours) {
            let wh: any = {}
            try { wh = JSON.parse(r.working_hours); if (typeof wh === 'string') wh = JSON.parse(wh) } catch { wh = {} }
            for (const [dow, day] of DAYS.entries()) {
              const d = wh?.[day]
              if (!d?.enabled) continue
              const start = minutes(isHm(d.start) ? d.start : '09:00'), end = minutes(isHm(d.end) ? d.end : '17:00')
              if (start >= end) continue
              await write(`INSERT INTO booking_hours (id, company_id, user_id, day_of_week, start_minute, end_minute) VALUES ($1, $2, NULL, $3, $4, $5)`, [`bh_${r.id}_${dow}`, r.company_id, dow, start, end])
              hours++
            }
            // The widget's week is the owner's own booking hours — closed days and all — not the opening hours
            // (booking/engine.ts weekOf 'own').
            await write(`UPDATE booking_settings SET hours_set_at = now() WHERE company_id = $1`, [r.company_id])
          }
          const brand: string[] = []
          if (r.logo?.trim()) {
            const u = (await write(`UPDATE company SET logo = $1 WHERE id = $2 AND COALESCE(trim(logo), '') = '' RETURNING id`, [r.logo, r.company_id])).rows
            if (u.length) brand.push('logo')
          }
          if (r.primary_color?.trim()) {
            const u = (await write(`UPDATE company SET primary_color = $1 WHERE id = $2 AND COALESCE(trim(primary_color), '') = '' RETURNING id`, [r.primary_color, r.company_id])).rows
            if (u.length) brand.push('colour')
          }
          const crowd = num(r.concurrent_bookings, 1) > 1 ? `; it took ${r.concurrent_bookings} bookings at once, which the new engine does with hours per person — the owner sets them in Bookings → Settings` : ''
          out.push(`${r.company_id}: ${hours} open day(s), notice ${r.lead_time_days ?? '—'} day(s)${set.length ? ', wording' : ''}${brand.length ? `, the company's ${brand.join(' and ')} from the widget's` : ''}${crowd}`)
        }
        return out.join('; ') || 'no booking settings'
      },
    },
    {
      // bookable_service → booking_service, ids kept (so the bookings' service_id carries over):
      //   the address (slug) from the name, as the unified engine makes one (unique per company: -2, -3 … when taken);
      //   price 0 → none: 0 is the column's default, and the widget never showed a price (it showed name, length and
      //     deposit); a price the owner did set moves;
      //   the deposit only when the template took one: `depositRequired && depositAmount > 0` (booking/catalog.ts
      //     fromWidgetRow); an amount with the switch off was never charged and is not moved;
      //   start times step by the company's slot length (the template's grid); one customer at a time.
      // A company with booking settings and no active service took bookings for no service at all (the widget offered
      // the bare slot, named "Online booking" in its emails); every unified booking is for a service, so that company is
      // given one, "Online booking", the slot's length, and its bookings without a service point at it.
      name: 'booking services',
      run: async ({ read, write }) => {
        const rows = has('bookable_service') ? (await read(`SELECT id, company_id, name, description, duration_minutes::text AS duration, price::text AS price,
            deposit_required, deposit_amount::text AS deposit, active, sort_order, created_at::text AS created_at, updated_at::text AS updated_at
            FROM bookable_service ORDER BY company_id, sort_order, name, id`)).rows as any[] : []
        const taken = new Map<string, Set<string>>()
        const slugFor = (companyId: string, name: string) => {
          const used = taken.get(companyId) ?? new Set<string>()
          taken.set(companyId, used)
          const base = slugify(name) || 'service'
          let slug = base
          for (let i = 2; used.has(slug); i++) slug = `${base.slice(0, 64 - String(i).length - 1).replace(/-+$/, '')}-${i}`
          used.add(slug)
          return slug
        }
        const notes: string[] = []
        for (const r of rows) {
          const deposit = r.deposit_required && num(r.deposit) > 0 ? r.deposit : null
          if (!r.deposit_required && num(r.deposit) > 0) notes.push(`${r.id} had a ${r.deposit} deposit switched off (not moved)`)
          await write(`INSERT INTO booking_service (id, company_id, slug, name, description, duration_minutes, price, deposit_amount, slot_step_minutes, capacity, active, sort_order, created_at, updated_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10, $11, $12::timestamp, $13::timestamp)`,
            [r.id, r.company_id, slugFor(r.company_id, r.name), r.name, r.description, num(r.duration, 60) || 60, num(r.price) > 0 ? r.price : null, deposit,
              slotFor.get(r.company_id) ?? 60, r.active, r.sort_order, r.created_at, r.updated_at])
        }
        for (const [companyId, slot] of slotFor) {
          if (rows.some((r) => r.company_id === companyId && r.active)) continue
          const id = `bsvc_online_${companyId}`
          await write(`INSERT INTO booking_service (id, company_id, slug, name, duration_minutes, slot_step_minutes, capacity, active, sort_order) VALUES ($1, $2, $3, 'Online booking', $4, $4, 1, true, 0)`,
            [id, companyId, slugFor(companyId, 'online-booking'), slot])
          generic.set(companyId, id)
          notes.push(`${companyId} booked without services: given "Online booking" (${slot} min)`)
        }
        return `${rows.length} service(s) moved${notes.length ? '; ' + notes.join('; ') : ''}`
      },
    },
    {
      // online_booking → booking, ids kept:
      //   start_at = scheduled_date: the template stored the UTC instant of the local time chosen (service.ts
      //     `scheduledDate: start`, start = zonedWallTimeToUtc(date, time, tz)); the unified start_at holds UTC too.
      //   end_at = start + the service's length, or the slot length without one — the template's own rule when it took the
      //     booking (`service?.durationMinutes || settings.slotDurationMinutes`); it never stored an end.
      //   status, deposit_status, payment_intent_id, deposit_paid_at as they are (the same words in both engines), so a
      //     deposit still owed is still held and the payment's webhook (depositPaid, by payment_intent_id) still lands;
      //     deposit_amount 0 (the column default when none was owed) → none.
      //   customer name / email / phone; notes → customer_notes; source 'public' (only the widget made these rows).
      //   token: a new private link. The unified booking has no code or reference column; the ONLY way a customer reaches
      //     a booking is booking.token (engine.ts byToken, booking/pages.ts /booking/:token), and that link can reschedule
      //     and cancel. The template's confirmation_code is six characters from a 32-letter alphabet, made for a read-only
      //     lookup (`GET /public/:slug/lookup/:code`); as a token anyone could guess their way to cancelling someone's
      //     booking. So it is not carried, and the report says how many customers hold a code that no longer finds anything.
      //   job_id → job.booking_id: the unified job points at the booking it was made from (SPEC §4.7).
      // The template stored no address on the booking (it went onto the contact), so customer_address stays empty.
      name: 'bookings',
      run: async ({ read, write }) => {
        if (!has('online_booking')) return 'no bookings'
        const svcLen = has('bookable_service') ? new Map(((await read(`SELECT id, duration_minutes::text AS d FROM bookable_service`)).rows as any[]).map((r) => [r.id, num(r.d, 60) || 60])) : new Map<string, number>()
        const rows = (await read(`SELECT id, company_id, job_id, contact_id, service_id, customer_name, customer_email, customer_phone, scheduled_date::text AS start_at, notes,
            status, confirmation_code, deposit_amount::text AS deposit, deposit_status, payment_intent_id, deposit_paid_at::text AS paid_at, created_at::text AS created_at, updated_at::text AS updated_at
            FROM online_booking ORDER BY created_at, id`)).rows as any[]
        let linked = 0, codes = 0, toGeneric = 0
        const odd: string[] = [], shared: string[] = []
        for (const r of rows) {
          let serviceId = r.service_id
          if (!serviceId && generic.has(r.company_id)) { serviceId = generic.get(r.company_id)!; toGeneric++ }
          const len = (r.service_id && svcLen.get(r.service_id)) || slotFor.get(r.company_id) || 60
          if (!STATUSES.has(r.status)) odd.push(`${r.id} ${r.status}`)
          if (r.confirmation_code) codes++
          await write(`INSERT INTO booking (id, company_id, service_id, contact_id, start_at, end_at, customer_name, customer_email, customer_phone, customer_notes, status, source, token,
                deposit_amount, deposit_status, payment_intent_id, deposit_paid_at, created_at, updated_at)
              VALUES ($1, $2, $3, $4, $5::timestamp, $5::timestamp + make_interval(mins => $6::int), $7, $8, $9, $10, $11, 'public', $12, $13, $14, $15, $16::timestamp, $17::timestamp, $18::timestamp)`,
            [r.id, r.company_id, serviceId, r.contact_id, r.start_at, len, r.customer_name, r.customer_email, r.customer_phone, r.notes, r.status, newToken(),
              num(r.deposit) > 0 ? r.deposit : null, r.deposit_status, r.payment_intent_id, r.paid_at, r.created_at, r.updated_at])
          if (r.job_id) {
            const j = (await write(`UPDATE job SET booking_id = $1 WHERE id = $2 RETURNING id`, [r.id, r.job_id])).rows
            if (j.length) linked++
          }
        }
        // Two bookings made for one job: the job keeps the later one (it can name one); say so.
        if (has('online_booking', 'job_id')) {
          const many = (await read(`SELECT job_id, array_agg(id ORDER BY created_at, id) AS ids FROM online_booking WHERE job_id IS NOT NULL GROUP BY job_id HAVING count(*) > 1`)).rows as any[]
          for (const m of many) shared.push(`job ${m.job_id} ← ${m.ids.join(', ')}`)
        }
        return `${rows.length} booking(s) moved, ${linked} job(s) linked to theirs${toGeneric ? `, ${toGeneric} without a service put on "Online booking"` : ''}` +
          (codes ? `; ${codes} confirmation code(s) not carried — the new app finds a booking only by its private link (which can cancel), and a six-character code is too guessable to be one; those customers' old codes no longer look a booking up` : '') +
          (odd.length ? `; status the new engine does not use: ${some(odd)}` : '') +
          (shared.length ? `; one job, several bookings (the job names the last): ${some(shared)}` : '')
      },
    },
  ]
}
