// Writes tests/unified/<suite>/<file>: a copy of a template suite file with only the reads named below changed, where
// the rulebook's reply shapes replaced the template's. Each change must match exactly once or the run stops.
// Re-run after adding an entry: bun tests/unified/harness/adapt.ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/')

const ADAPT: Record<string, [string, string, string][]> = {
  // suite/file → changes. The suite is a directory of tests/ (crm, fieldservice …); the copy goes to tests/unified/<suite>/.
  'crm/calltracking-fields.test.ts': [
    ['const num = Array.isArray(nums.json) ? nums.json[0] : null', 'const num = nums.json?.data?.[0] ?? null', 'the numbers are a list reply'],
  ],
  'crm/comments-gate.test.ts': [
    ["Array.isArray(own.json?.activities)", "Array.isArray(own.json?.data)", 'the feed is a list reply: its entries are data, not activities'],
  ],
  'crm/t32-job-costing.test.ts': [
    ["(Array.isArray(r.json) ? r.json : [])", "(r.json?.data ?? [])", 'by-category is a list reply'],
    ["(Array.isArray(all.json) ? all.json : [])", "(all.json?.data ?? [])", 'by-category is a list reply'],
    ["(Array.isArray(done.json) ? done.json : [])", "(done.json?.data ?? [])", 'by-category is a list reply'],
  ],
  'crm/t32-po-commitment.test.ts': [
    ["/723\\.72/.test(JSON.stringify(over.json)) && over.json?.remaining === 0", "/723\\.72/.test(over.json?.error) && /only 0\\.00 is left/.test(over.json?.error) && over.json?.code === 'exceeds_purchase_order'", 'a refusal carries its figures in its sentence, not extra fields'],
    ["isMoney(over.json?.overBy, 5000), over.json?.overBy)", "/This bill is 5000\\.00, 5000\\.00 over/.test(over.json?.error), over.json?.error)", 'the over-by figure is in the sentence'],
    ["/allowOverage/.test(JSON.stringify(over.json)), over.json?.override)", "/Record it anyway/.test(over.json?.error), over.json?.error)", 'the way through is in the sentence (and the bills screen offers it)'],
    ["nudge.json?.remaining === 600 && isMoney(nudge.json?.orderTotal, 1000)", "/is for 1000\\.00/.test(nudge.json?.error) && /only 600\\.00 is left/.test(nudge.json?.error)", 'figures in the sentence'],
  ],
  'crm/t32-site-records.test.ts': [
    ["dupe.json?.existingId === first.json?.id, { existingId: dupe.json?.existingId })", "dupe.json?.code === 'daily_log_already_filed', dupe.json)", 'a refusal carries a code, not the existing row\'s id (no screen read it)'],
  ],
  'crm/t43-side-endpoints.test.ts': [
    ["(Array.isArray(crewFeed.json) ? crewFeed.json : [])", "(crewFeed.json?.data ?? [])", 'the activity feed is a list reply'],
    ["(Array.isArray(booksFeed.json) ? booksFeed.json : [])", "(booksFeed.json?.data ?? [])", 'the activity feed is a list reply'],
    ["(Array.isArray(ownerFeed.json) ? ownerFeed.json : [])", "(ownerFeed.json?.data ?? [])", 'the activity feed is a list reply'],
  ],
  'fieldservice/t32-job-costing.test.ts': [
    ["check('this template really has no vendor_bill table — the branch under test is the live one',", "check('the unified schema has bills; with none recorded the figures below are the same as without them',", 'the unified schema has vendor bills for every vertical; none are recorded here, so the costing is the same'],
    ['  schema.vendorBill === undefined, Object.keys', '  schema.vendorBill !== undefined, Object.keys', 'the bills table exists in the unified schema'],
    ['(Array.isArray(t.json) ? t.json : [])', '(t.json?.data ?? [])', 'by-category is a list reply'],
  ],
  'fieldservice/t30-search-money.test.ts': [
    ["const typesOf = (rows: any) => (Array.isArray(rows) ? rows : rows?.results || []).map((r: any) => r.type)", "const typesOf = (rows: any) => (Array.isArray(rows) ? rows : rows?.results || rows?.data || []).map((r: any) => r.type)", 'quick search and recent are list replies'],
  ],
}

for (const [key, changes] of Object.entries(ADAPT)) {
  const [suite, file] = key.split('/')
  const OUT = ROOT + 'tests/unified/' + suite + '/'
  mkdirSync(OUT, { recursive: true })
  let s = readFileSync(ROOT + 'tests/' + suite + '/' + file, 'utf8')
  for (const [from, to, why] of changes) {
    const n = s.split(from).length - 1
    if (n !== 1) throw new Error(`${file}: expected the pattern once, found ${n}: ${from}`)
    s = s.replace(from, `${to} /* unified: ${why} */`)
  }
  const header = `// ADAPTED COPY of tests/${suite}/${file}, for the unified app (tests/unified/harness/adapted.ts). Unchanged except the\n// ${changes.length} read(s) marked "unified:", where the rulebook's reply shapes replaced the template's. The original keeps\n// running against the template; tests/unified/harness/unified-divergences.ts names the assertions this copy stands in for.\n`
  writeFileSync(OUT + file, header + s)
  console.log(key, changes.length)
}
