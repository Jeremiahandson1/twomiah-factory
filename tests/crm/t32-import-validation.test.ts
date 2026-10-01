// T32 M10 — "CSV import still stores invalid data."
//
// Four rows were imported. "still-not-an-email" was stored in the email column, and the type
// "banana" was stored as "other" — a value the contacts API's own enum REFUSES
// (DEFAULT_CONTACT_TYPES is lead, client, subcontractor, vendor). `errors: []`.
//
// Two faults in one: data the form would have rejected went in through the back door, and the import
// said nothing about either decision — so the person who ran it has no way to know which rows need
// looking at.
//
// The duplicate row WAS correctly matched to the existing contact, which is asserted here too, so
// the fix cannot break the part that worked.
import { eq, sql } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, contact } = await import('./db/schema.ts')
const { importContacts } = await import('./src/services/import.ts')

const [co] = await db.insert(company).values({
  name: 'Import Co', slug: 'import-co', email: 'i@test.local', state: 'OH', settings: {},
  enabledFeatures: ['contacts'],
} as any).returning()

// Already on file, so the duplicate row has something to match.
await db.insert(contact).values({ companyId: co.id, name: 'Existing Person', email: 'existing@test.local', type: 'client' } as any).returning()

const CSV = [
  'name,email,type,phone',
  'Good Row,good@test.local,client,555-0100',
  'Bad Email,still-not-an-email,vendor,555-0101',
  'Odd Type,odd@test.local,banana,555-0102',
  'Existing Person,existing@test.local,client,555-0103',
].join('\n')

const res: any = await importContacts(CSV, co.id, {})

// ══════════ what the import says it did ════════════════════════════════════════════════════════
{
  /**
   * All four rows land. The duplicate is MATCHED and updated — filling in fields the existing record
   * did not have — which is the deliberate behaviour and the part the report confirmed was right
   * ("The duplicate row was correctly matched to the existing contact"). My first version of this
   * assertion expected it to be skipped; that was my expectation, not the product's, and the
   * distinction that matters is that it does not create a SECOND contact.
   */
  check('all four rows are processed', res.imported === 4, { imported: res.imported, skipped: res.skipped })
  check('…the duplicate is matched and updated, not inserted again',
    (res.records || []).some((r: any) => r.line === 5 && r.action === 'updated'),
    (res.records || []).map((r: any) => `${r.line}:${r.action}`))
  check('…no row FAILED, because none of these rows is unusable', (res.errors || []).length === 0, res.errors)
  check('…but it no longer reports "errors: []" and nothing else — the changes it made are stated',
    (res.warnings || []).length >= 2, res.warnings)
}

// ══════════ the email the API would have refused ═══════════════════════════════════════════════
{
  const [row] = await db.select().from(contact).where(eq(contact.name, 'Bad Email'))
  check('the contact is still imported', !!row, null)
  check('…and "still-not-an-email" is NOT in the email column', !row?.email,
    { email: row?.email })
  check('…with a warning naming the row and the value',
    (res.warnings || []).some((w: any) => w.line === 3 && /still-not-an-email/.test(w.warning)), res.warnings)
  check('…and the rest of the row survived', row?.phone === '555-0101' && row?.type === 'vendor',
    { phone: row?.phone, type: row?.type })
}

// ══════════ the type the API's own enum refuses ════════════════════════════════════════════════
{
  const [row] = await db.select().from(contact).where(eq(contact.name, 'Odd Type'))
  check('the contact is still imported', !!row, null)
  check('…and the type is NOT "other", which POST /api/contacts would reject', row?.type !== 'other', { type: row?.type })
  check('…it is a lead, the same default a missing type gets', row?.type === 'lead', { type: row?.type })
  check('…with a warning naming the row and the value it did not recognise',
    (res.warnings || []).some((w: any) => w.line === 4 && /banana/.test(w.warning)), res.warnings)

  // Nothing anywhere should now carry the invalid type.
  const others: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM contact WHERE type = 'other'`)
  check('…and no contact in the table has type "other"', Number((others.rows || others)[0]?.n) === 0, (others.rows || others)[0])
}

// ══════════ the rows that were always fine ═════════════════════════════════════════════════════
{
  const [good] = await db.select().from(contact).where(eq(contact.name, 'Good Row'))
  check('a good row is unchanged', good?.email === 'good@test.local' && good?.type === 'client',
    { email: good?.email, type: good?.type })
  const dupes: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM contact WHERE email = 'existing@test.local'`)
  check('the duplicate detection that already worked still works', Number((dupes.rows || dupes)[0]?.n) === 1, (dupes.rows || dupes)[0])
}

// ══════════ a recognised variant is still mapped, not warned about ═════════════════════════════
{
  const r: any = await importContacts(['name,type', 'Spelled Out,Customer (retail)', 'Plain,subcontractor'].join('\n'), co.id, {})
  const [cust] = await db.select().from(contact).where(eq(contact.name, 'Spelled Out'))
  check('"Customer (retail)" still maps to client', cust?.type === 'client', { type: cust?.type })
  check('…with no warning, because nothing was lost', (r.warnings || []).length === 0, r.warnings)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
