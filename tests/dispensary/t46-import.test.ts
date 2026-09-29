// crm-dispensary — T46 N6, N7 and N20: the CSV import.
//
// N6 (high)  The customers template had no Date of Birth and no medical card column, although the
//            Import screen says it imports both and refuses under-21s. Every customer imported from
//            the shop's own template arrived with no date of birth, so the age rule had nothing to
//            check. A `dateOfBirth` header was silently ignored — "Date of Birth", "DOB",
//            "date_of_birth" and "Birthdate" all worked, and the camelCase spelling did not, so a
//            person born in 2012 imported cleanly as a lead.
// N7 (high)  The products template's OWN "Weight (g)" column was ignored — only "Weight" and
//            "Weight Grams" were read — so every flower product imported from the official template
//            had no weight and could not be sold at all. And THC 150% imported cleanly and was then
//            listed on the public menu.
// N20 (med)  "Check the file" reported valid:true and never listed what it would refuse; refusals
//            only appeared after the import had already run.
//
// N6 and N7 are one root cause: there were two column normalizers and they disagreed. The header was
// folded one way and the alias list another, so any header whose separators did not survive both
// foldings matched nothing at all.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Twomiah Leaf', slug: 'leaf-imp', email: 'imp@test.local', state: 'OH',
  enabledFeatures: ['products', 'contacts', 'orders'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-imp@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: co.id,
} as any).returning()

const importService = (await import('./src/services/import.ts')).default

const app = new Hono()
app.route('/api/import', (await import('./src/routes/import.ts')).default)

const getTemplate = async (type: string) => {
  const res = await app.request(`/api/import/template/${type}`, { headers: { 'x-test-user': owner.id } })
  return { status: res.status, text: await res.text() }
}
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }

// ── N6: the customers template carries what the screen promises ─────────────────────────────────
{
  const t = await getTemplate('contacts')
  check('N6: the customers template downloads', t.status === 200, t.status)
  const header = t.text.split('\n')[0]
  check('N6: …and has a Date of Birth column', /date of birth/i.test(header), header)
  check('N6: …and a medical card column', /medical card/i.test(header), header)

  // The shop's own template, imported unchanged, must produce a customer who can be sold to.
  const res = await importService.importContacts(t.text, co.id, {})
  check('N6: the template imports as it ships', res.imported === 1 && res.errors.length === 0, res)
  const [row] = await rows(sql`SELECT name, date_of_birth FROM contact WHERE company_id = ${co.id} AND name = 'John Smith' LIMIT 1`)
  check('N6: …and the customer arrives WITH a date of birth', !!row?.date_of_birth, row)
}

// ── N6: every spelling of the same column is the same column ────────────────────────────────────
{
  const spellings: [string, string][] = [
    ['dateOfBirth', 'Cam Elcase'],
    ['Date of Birth', 'Dee Spaced'],
    ['DOB', 'Dee Ob'],
    ['date_of_birth', 'Sue Underscore'],
    ['Birthdate', 'Bee Irthdate'],
  ]
  for (const [header, name] of spellings) {
    const csv = `Name,Email,${header}\n${name},${name.replace(/\W/g, '').toLowerCase()}@test.local,1985-04-02`
    const res = await importService.importContacts(csv, co.id, {})
    const [row] = await rows(sql`SELECT date_of_birth FROM contact WHERE company_id = ${co.id} AND name = ${name} LIMIT 1`)
    check(`N6: "${header}" is read as a date of birth`, res.imported === 1 && !!row?.date_of_birth, { header, errors: res.errors, dob: row?.date_of_birth })
  }

  // …and the age rule applies whichever spelling was used. A `dateOfBirth` header used to be dropped,
  // so this row imported as a lead with no date at all.
  const minor = await importService.importContacts('Name,Email,dateOfBirth\nTiny Tim,tim@test.local,2012-06-01', co.id, {})
  check('N6: a customer born in 2012 is refused, not imported as a lead', minor.imported === 0 && minor.errors.length === 1, minor)
  check('N6: …and told why', /21/.test(String(minor.errors[0]?.error)), minor.errors[0])
}

// ── N7: the products template's own weight column ───────────────────────────────────────────────
{
  const t = await getTemplate('products')
  check('N7: the products template downloads', t.status === 200, t.status)
  check('N7: …and still uses the "Weight (g)" header it always did', /weight \(g\)/i.test(t.text.split('\n')[0]), t.text.split('\n')[0])

  const res = await importService.importProducts(t.text, co.id, {})
  check('N7: the template imports as it ships', res.imported === 1 && res.errors.length === 0, res)
  const [row] = await rows(sql`SELECT name, weight_grams FROM products WHERE company_id = ${co.id} AND name = 'Blue Dream' LIMIT 1`)
  check('N7: …and the flower arrives WITH its weight, so it can be sold', Number(row?.weight_grams) === 3.5, row)
}

{
  // The other spellings a shop might export must keep working.
  for (const [header, name, sku] of [['Weight', 'W Plain', 'W-1'], ['Weight Grams', 'W Grams', 'W-2'], ['weight_g', 'W Underscore', 'W-3'], ['Net Weight (g)', 'W Net', 'W-4']] as const) {
    const csv = `Name,SKU,Category,Price,${header}\n${name},${sku},flower,35,3.5`
    const res = await importService.importProducts(csv, co.id, {})
    const [row] = await rows(sql`SELECT weight_grams FROM products WHERE company_id = ${co.id} AND sku = ${sku} LIMIT 1`)
    check(`N7: "${header}" is read as the weight`, res.imported === 1 && Number(row?.weight_grams) === 3.5, { header, errors: res.errors, weight: row?.weight_grams })
  }
}

{
  // THC 150% reached the public menu. A percentage cannot exceed the whole.
  const over = await importService.importProducts('Name,SKU,Category,Price,THC%\nImpossible Kush,IK-1,flower,40,150', co.id, {})
  check('N7: THC 150% is refused', over.imported === 0 && over.errors.length === 1, over)
  check('N7: …and named as the impossible figure it is', /150/.test(String(over.errors[0]?.error)) && /between 0 and 100/.test(String(over.errors[0]?.error)), over.errors[0])

  const cbdOver = await importService.importProducts('Name,SKU,Category,Price,CBD%\nToo Much CBD,TM-1,flower,40,120', co.id, {})
  check('N7: …and CBD 120% likewise', cbdOver.imported === 0 && cbdOver.errors.length === 1, cbdOver)

  const ok = await importService.importProducts('Name,SKU,Category,Price,THC%,CBD%\nFine Kush,FK-1,flower,40,22.5,0.5', co.id, {})
  check('N7: an ordinary potency still imports', ok.imported === 1 && ok.errors.length === 0, ok)

  const none: any[] = await rows(sql`SELECT id FROM products WHERE company_id = ${co.id} AND name = 'Impossible Kush'`)
  check('N7: …and the impossible one never reached the catalogue at all', none.length === 0, none)
}

// ── N20: the check shows what it would refuse, before anything is written ───────────────────────
{
  const csv = [
    'Name,Email,Date of Birth',
    'Good Adult,good@test.local,1985-04-02',
    'Too Young,young@test.local,2012-06-01',
    'Bad Email,not-an-email,1990-01-01',
  ].join('\n')

  const preview = await importService.previewImport(csv, 'contacts', co.id)
  check('N20: the check reads the file', preview.valid === true, preview)
  check('N20: …and says how many rows would actually import', preview.willImport === 1, { willImport: preview.willImport })
  check('N20: …and how many would be refused', preview.willSkip === 2, { willSkip: preview.willSkip })
  check('N20: …listing each one with its line and its reason',
    Array.isArray(preview.errors) && preview.errors.length === 2 && preview.errors.every((e: any) => e.line && e.error),
    preview.errors)
  check('N20: …naming the under-21 row', preview.errors.some((e: any) => /21/.test(String(e.error))), preview.errors)
  check('N20: …and the bad email', preview.errors.some((e: any) => /email/i.test(String(e.error))), preview.errors)

  // Checking a file must not import any of it.
  const written: any[] = await rows(sql`SELECT id FROM contact WHERE company_id = ${co.id} AND name IN ('Good Adult', 'Too Young', 'Bad Email')`)
  check('N20: …and writes nothing while it does so', written.length === 0, written)

  // A file the import cannot read at all still fails the structural check, as before.
  const shapeless = await importService.previewImport('Colour,Size\nred,large', 'contacts', co.id)
  check('N20: a file with no name column is still refused outright', shapeless.valid === false, shapeless)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
