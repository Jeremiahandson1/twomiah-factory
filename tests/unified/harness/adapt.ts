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
  'restaurant/t62-event-money.test.ts': [
    ["&& list.json?.moneyWithheld === true, row)", ", row)", "the events list is a list reply ({ data, pagination }): its rows carry no quote or deposit, and it sends no moneyWithheld (no screen read it there; the event page and the dashboard still say it)"],
  ],
  'landscaping/t62-route-money.test.ts': [
    ["priced.status === 403 && priced.json?.field === 'pricePerVisit'", "priced.status === 403 && !!priced.json?.fields?.pricePerVisit", 'a refusal names its box in fields (RULEBOOK §3), not a field key'],
  ],
  'basic/t38-activity-routes-reachable.test.ts': [
    ['Array.isArray(r.json?.activities) && !!r.json?.pagination', 'Array.isArray(r.json?.data) && !!r.json?.pagination', 'the feed is a list reply: its entries are data'],
    ['const actions = (r.json?.activities || [])', 'const actions = (r.json?.data || [])', 'the feed is a list reply'],
    ["(r.json?.activities || []).length === 3 && r.json.activities.every((a: any) => 'first_name' in a)", "(r.json?.data || []).length === 3 && r.json.data.every((a: any) => 'firstName' in a)", 'list reply, and keys are camelCase (RULEBOOK §2)'],
    ['{ count: (r.json?.activities || []).length, keys: Object.keys((r.json?.activities || [])[0] || {}) }', '{ count: (r.json?.data || []).length, keys: Object.keys((r.json?.data || [])[0] || {}) }', 'the feed is a list reply'],
    ["const r = await api('GET', `/api/comments/activity/user/${owner.id}`)", "const r = await api('GET', `/api/comments/activity/user/${owner.id}`).then((x) => ({ ...x, json: x.json?.data }))", "one person's activity is a list reply"],
    ["rows.length > 0 && !('first_name' in rows[0])", "rows.length > 0 && !('firstName' in rows[0])", 'keys are camelCase'],
    ["const r = await api('GET', '/api/comments/activity/job/job-1')", "const r = await api('GET', '/api/comments/activity/job/job-1').then((x) => ({ ...x, json: x.json?.data }))", "a record's activity is a list reply"],
    ["rows.length > 0 && 'first_name' in rows[0], Object.keys", "rows.length > 0 && 'firstName' in rows[0], Object.keys", 'keys are camelCase'],
    ["const r = await api('GET', '/api/comments/activity/feed-not-the-feed')", "const r = await api('GET', '/api/comments/activity/feed-not-the-feed').then((x) => ({ ...x, json: x.json?.data }))", 'a comment thread is a list reply'],
    ["const decoy = await api('GET', '/api/comments/activity/feed-decoy-check')", "const decoy = await api('GET', '/api/comments/activity/feed-decoy-check').then((x) => ({ ...x, json: x.json?.data }))", 'a comment thread is a list reply'],
  ],
  'vet/t62-billed-visit-delete.test.ts': [
    ["r.json?.code === 'visit_already_invoiced' && r.json?.invoiceId === sentInv.id, r)", "r.json?.code === 'visit_already_invoiced' && String(r.json?.error).includes(sentInv.number), r)", 'a refusal is { error, code } (RULEBOOK §3): the invoice is named by its number in the sentence, not an invoiceId field (no screen read it)'],
  ],
  'bar/bar-register.test.ts': [
    ['noPinYet.json.needsManager === true', "noPinYet.json.code === 'NEEDS_MANAGER'", 'a refusal is { error, code } (RULEBOOK §3): "a manager has to OK this" is code NEEDS_MANAGER, not a needsManager field'],
    ['ask.json.needsManager === true', "ask.json.code === 'NEEDS_MANAGER'", 'code NEEDS_MANAGER, not a needsManager field'],
    ['bp.json.needsManager === true', "bp.json.code === 'NEEDS_MANAGER'", 'code NEEDS_MANAGER, not a needsManager field'],
    ['vc.json.needsManager === true', "vc.json.code === 'NEEDS_MANAGER'", 'code NEEDS_MANAGER, not a needsManager field'],
    ['bart.json.needsManager === true', "bart.json.code === 'NEEDS_MANAGER'", 'code NEEDS_MANAGER, not a needsManager field'],
  ],
  'salon/appt-list.test.ts': [
    ["check('…but not an unbounded one — the handler clamps to 500', silly.json?.pagination?.limit === 500, silly.json?.pagination)", "check('…but not an unbounded one — the app refuses it', silly.status === 400 && silly.json?.code === 'invalid_pagination', silly.json)", 'an over-cap limit is refused by the app-wide paging guard (the stronger form the test describes), before the handler'],
    ["zero.status === 200 && rowsOf(zero).length >= 1 && rowsOf(zero).length <= 500, { status: zero.status, n: rowsOf(zero).length })", "zero.status === 400 && zero.json?.code === 'invalid_pagination', { status: zero.status, body: zero.json })", 'nonsense paging is refused by the paging guard rather than repaired'],
    ["check('…and is deliberately NOT paged — the window is the bound', win.json?.pagination === undefined, win.json?.pagination)", "check('…and is deliberately NOT paged — the window is the bound', win.json?.pagination?.page === 1 && win.json?.pagination?.total === 140 && win.json?.pagination?.pages === 1, win.json?.pagination)", 'a list reply always carries pagination (RULEBOOK §3): the window is one page holding every row'],
  ],
  'salon/t27-lows.test.ts': [
    ['const titles = (r: any) => (Array.isArray(r.json) ? r.json : []).map((a: any) => a.title)', 'const titles = (r: any) => (r.json?.data ?? []).map((a: any) => a.title)', 'the knowledge base is a list reply'],
  ],
  'salon/t27-mediums.test.ts': [
    ["console.log('\\n── N7 / N11: booking settings refuse nonsense ──')", "console.log('\\n── N7 / N11: not run — they drive the CRM booking module the unified app replaces ──'); if (false)","N7 and N11 drive the template's /api/booking/settings (lead_time_days, primaryColor), replaced by the one booking engine (server/booking)"],
    ["check('N6: the good row imports', res.imported === 1,", "check('N6: the good row imports', res.imported === 3 && res.warnings.length === 2,", "the CSV import keeps the base CRM's later rule (T32 M10): a row with a bad email or an unknown type is imported — the email dropped, the type a lead — and each change is reported in warnings, never silently stored"],
    ["res.errors.some((e: any) => /not a valid email/i.test(e.error)), res.errors)", "res.warnings.some((w: any) => /is not an email address/.test(w.warning)), res.warnings)", 'the bad email is reported and not stored (T32 M10)'],
    ["res.errors.some((e: any) => /not a contact type/i.test(e.error)), res.errors)", "res.warnings.some((w: any) => /is not one of/.test(w.warning)), res.warnings)", 'the unknown type is reported and becomes a lead, never "other" (T32 M10)'],
  ],
  'salon/lyr.test.ts': [
    ["number: `INV-${String(200 + visitNo).padStart(5, '0')}`,", "number: `LYR-${String(200 + visitNo).padStart(5, '0')}`,", "the fixture hand-writes bill numbers; in the INV- series the app also issues (max + 1) they collided with the bills the book raised, which the unified app's live-number guard refuses — so the fixture's own bills take a series of their own"],
    ["/INV-/.test(String(r.json?.error))", "/LYR-/.test(String(r.json?.error))", "the bill it names is the fixture's, now in the LYR- series"],
    ["await Bun.file(new URL('./src/routes/loyalty.ts', import.meta.url)).text()", "await Bun.file(new URL('../../server/crm/salon/loyalty.ts', import.meta.url)).text()", "the loyalty router is the unified app's (server/crm/salon/loyalty.ts; the sandbox sits in apps/unified/.suite)"],
  ],
  'salon/t28.test.ts': [
    ["console.log('\\n── H1: configuring online booking is company setup, and needs company:update ──')", "console.log('\\n── H1: not run — it drives the CRM booking module the unified app replaces ──'); if (false)","H1 drives the template's /api/booking/settings, replaced by the one booking engine (server/booking)"],
    ["console.log('\\n── H2: online booking only takes services ticked \"Bookable online\" ──')", "console.log('\\n── H2: not run — it drives the CRM booking module the unified app replaces ──'); if (false)","H2 drives the template's public booking API (/api/booking/public), replaced by the one booking engine"],
    ["console.log('\\n── L6: a fully booked day leaves the date picker ──')", "console.log('\\n── L6: not run — it drives the CRM booking module the unified app replaces ──'); if (false)","L6 drives the template's public booking dates and slots, replaced by the one booking engine"],
  ],
}
// The bar's copies of files it took whole: crm-basic's activity routes and crm-restaurant's events money. Byte-identical
// below their first line, so the same reads change.
ADAPT['bar/t38-activity-routes-reachable.test.ts'] = ADAPT['basic/t38-activity-routes-reachable.test.ts']
ADAPT['bar/t62-event-money.test.ts'] = ADAPT['restaurant/t62-event-money.test.ts']

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
