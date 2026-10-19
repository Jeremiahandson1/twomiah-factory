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
  'crm/quote-email.test.ts': [
    ["!JSON.stringify(d).includes('210') && !JSON.stringify(d).includes('unitCost')", "!JSON.stringify(d).includes('210.00') && !JSON.stringify(d).includes('30.00') && !JSON.stringify(d).includes('unitCost')", "the costs are 210.00 and 30.00: looking for the bare digits 210 also matched the random ids and links in the email's data (CI, 2026-10-19), so the check now looks for the cost figures themselves"],
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
// Home care, payroll group: r3pay.test.ts is below, with the clients group's templateShape reading.
// Home care, hr group (staff.test.ts also drives the payroll group's Gusto preview and payday verification).
ADAPT['homecare/staff.test.ts'] = [
  ["const text = await res.text(); let json: any = text; try { json = JSON.parse(text) } catch {}", "const text = await res.text(); let json: any = text; try { json = JSON.parse(text) } catch {}; if (json && Array.isArray(json.data) && json.pagination) json = json.data", 'a list reply is { data, pagination } (RULEBOOK §3): this copy reads its rows, as the screens will'],
  ["Array.isArray(carolRow?.passed_checks) && carolRow.passed_checks.includes('criminal')", "Array.isArray(carolRow?.passedChecks) && carolRow.passedChecks.includes('criminal')", 'the compliance report is camelCase (RULEBOOK §2): passedChecks'],
  ["u.email === 'jamie.applicant@example.test' && u.role === 'caregiver', u)", "u.email === 'jamie.applicant@example.test' && u.role === 'field', u)", "a new caregiver's seat is the unified role field (moved tenants keep caregiver; both read as a caregiver)"],
  ["row && Number(row.regular_hours) === 46 && Number(row.overtime_hours) === 5 && Number(row.total_hours) === 51, row)", "row && Number(row.regularHours) === 46 && Number(row.overtimeHours) === 5 && Number(row.totalHours) === 51, row)", "the Gusto preview's rows are camelCase (RULEBOOK §2)"],
  ["Number(row?.weekend_hours) === 6, row?.weekend_hours)", "Number(row?.weekendHours) === 6, row?.weekendHours)", "the Gusto preview's rows are camelCase"],
  ["Number(row?.gross_pay) === 1070, row?.gross_pay)", "Number(row?.grossPay) === 1070, row?.grossPay)", "the Gusto preview's rows are camelCase"],
  ["Number(row?.shift_count) === 6, row?.shift_count)", "Number(row?.shiftCount) === 6, row?.shiftCount)", "the Gusto preview's rows are camelCase"],
  ["pv.json.warnings?.unresolved_reviews === 1 && pv.json.warnings?.clock_entries_without_review === 1", "pv.json.warnings?.unresolvedReviews === 1 && pv.json.warnings?.clockEntriesWithoutReview === 1", "the Gusto preview's warnings are camelCase"],
  ["Number(r15?.gross_pay) === 712.5, r15)", "Number(r15?.grossPay) === 712.5, r15)", "the Gusto preview's rows are camelCase"],
  // The Wisconsin bar list is the law in the code (server/crm/homecare/core/disqualifiers.ts), not seeded table rows.
  ["const rows = await db.select().from(caregiverDisqualifiers)", "const rows = (await import('../../server/crm/homecare/core/disqualifiers.ts')).DISQUALIFIERS as any[]", "the bar list is code (core/disqualifiers.ts): a new agency's table was empty, so a disqualifying record read as review"],
  // Switching one statute off was a database edit no screen or route ever offered; the list is the law in the code now.
  ["await db.update(caregiverDisqualifiers).set({ isActive: false }).where(eq(caregiverDisqualifiers.id, 'wi-943-20'))", "// (no switch: the bar list is code)", 'no statute can be switched off: the list is code'],
  ["const off = await e({ hasRecord: true, findings: 'theft' }, 'WI')", "", 'no statute can be switched off: the list is code'],
  ["check('a switched-off disqualifier no longer matches', off.matches.every((m) => m.statute !== 'Wis. Stat. § 943.20'), off.matches)", "", 'no statute can be switched off: the list is code'],
  ["await db.update(caregiverDisqualifiers).set({ isActive: true }).where(eq(caregiverDisqualifiers.id, 'wi-943-20'))", "", 'no statute can be switched off: the list is code'],
]
// Home care, visits group (evv.test.ts also drives the clients group's evv-week / evv-units and the billing group's
// referral sources and payers).
const VISITS_TEMPLATE_SHAPE = "const snakeKey = (k: string) => k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase())\nconst templateShape = (v: any): any => Array.isArray(v) ? v.map(templateShape) : (v && typeof v === 'object') ? ((Array.isArray(v.data) && v.pagination) ? templateShape(v.data) : Object.fromEntries(Object.entries(v).flatMap(([k, x]) => { const s = templateShape(x); return snakeKey(k) === k ? [[k, s]] : [[k, s], [snakeKey(k), s]] }))) : v"
const VISITS_TEMPLATE_SHAPE_WHY = "templateShape reads a unified reply in the template's shape: a list reply ({ data, pagination }, RULEBOOK §3) as its rows, and every camelCase key (RULEBOOK §2) also under its snake_case name — the values are the server's, unchanged"
ADAPT['homecare/evv.test.ts'] = [
  ["const rowsOf = (r: any): any[] => (r && Array.isArray(r.rows) ? r.rows : [])", "const rowsOf = (r: any): any[] => (r && Array.isArray(r.rows) ? r.rows : [])\n" + VISITS_TEMPLATE_SHAPE, VISITS_TEMPLATE_SHAPE_WHY],
  ["const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}", "const t = await res.text(); let j: any = t; try { j = templateShape(JSON.parse(t)) } catch {}", 'each reply read through templateShape'],
  ["r.status === 403 && r.json?.error === 'Admin access required'", "r.status === 403 && ['Permission denied', 'Admin access required'].includes(r.json?.error)", "the office's paths are gated by permissions (requirePermission: evv:delete for Sandata, the clients' and payers' care-clients writes), whose refusal is 'Permission denied'; the clients group's evv-week still answers the home-care office refusal ('Admin access required')"],
]
ADAPT['homecare/visits.test.ts'] = [
  ["const q1 = async (s: any) => (await q(s))[0]", "const q1 = async (s: any) => (await q(s))[0]\n" + VISITS_TEMPLATE_SHAPE, VISITS_TEMPLATE_SHAPE_WHY],
  ["\n  let j: any = t; try { j = JSON.parse(t) } catch {}", "\n  let j: any = t; try { j = templateShape(JSON.parse(t)) } catch {}", 'each reply read through templateShape'],
  ["JSON.stringify(body) })\r\n    const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}", "JSON.stringify(body) })\r\n    const t = await res.text(); let j: any = t; try { j = templateShape(JSON.parse(t)) } catch {}", "the Schedule Hub's replies read through templateShape"],
  ["who.role } })\r\n    const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}", "who.role } })\r\n    const t = await res.text(); let j: any = t; try { j = templateShape(JSON.parse(t)) } catch {}", "the client list's replies read through templateShape"],
  ["Array.isArray(office.json?.clients) && office.json.clients.length >= 5", "Array.isArray(office.json) && office.json.length >= 5", "the office's client list is a list reply ({ data, pagination }, RULEBOOK §3; the template answered { clients, … }): templateShape reads its rows (the clients group's list)"],
]
ADAPT['homecare/caregiver-visit.test.ts'] = [
  ["const q = async (s: any) => { const r: any = await db.execute(s); return (r?.rows ?? r) as any[] }", "const q = async (s: any) => { const r: any = await db.execute(s); return (r?.rows ?? r) as any[] }\n" + VISITS_TEMPLATE_SHAPE, VISITS_TEMPLATE_SHAPE_WHY],
  ["const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}", "const t = await res.text(); let j: any = t; try { j = templateShape(JSON.parse(t)) } catch {}", 'each reply read through templateShape'],
  ["again.status === 409 && again.json?.swap?.id === first.json.id", "again.status === 409 && again.json?.code === 'swap_pending'", "a refusal is { error, code } (RULEBOOK §3): the open swap is named by code swap_pending, not carried as a swap field (the scheduling group's shift swaps)"],
]
// Home care, office group.
ADAPT['homecare/incidents.test.ts'] = [
  ["const q = async (query: any): Promise<any[]> => ((await db.execute(query)) as any).rows",
    "const q = async (query: any): Promise<any[]> => ((await db.execute(query)) as any).rows\nconst snakeKey = (k: string) => k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase())\nconst templateShape = (v: any): any => Array.isArray(v) ? v.map(templateShape) : (v && typeof v === 'object') ? ((Array.isArray(v.data) && v.pagination) ? templateShape(v.data) : Object.fromEntries(Object.entries(v).flatMap(([k, x]) => { const s = templateShape(x); return snakeKey(k) === k ? [[k, s]] : [[k, s], [snakeKey(k), s]] }))) : v",
    "templateShape reads a unified reply in the template's shape: a list reply ({ data, pagination }, RULEBOOK §3) as its rows, and every camelCase key (RULEBOOK §2) also under its snake_case name — the values are the server's, unchanged"],
  ["const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}", "const t = await res.text(); let j: any = t; try { j = templateShape(JSON.parse(t)) } catch {}", 'each reply read through templateShape'],
  ["r.json?.error === 'Admin access required'", "r.json?.error === 'Permission denied'", "the office's paths are gated by care-compliance permissions (requirePermission), whose refusal is 'Permission denied'"],
  ["// ── 3. the migration's backfill, run against old-shape rows", "if (false) // ── 3. not run on the unified app: the template's migration 0019 backfill", "section 3 replays the template's migration 0019 data heal (old severities, statuses and numbers) against old-shape rows; the unified schema is migration 0007, and moved tenants' rows arrive through the cutover data move. A new number continuing above the existing ones is nextIncidentNumber's GREATEST(MAX + 1), held by apps/unified/tests/homecare-office.test.ts"],
  ["data.otherMembers.map((m: any) => `${m.first_name} ${m.last_name}`)", "data.otherMembers.map((m: any) => `${m.firstName} ${m.lastName}`)", "the packet's rows are camelCase (server/data/homecareIncidents.ts)"],
  ["data.otherMembers.find((m: any) => m.first_name === 'Dee')", "data.otherMembers.find((m: any) => m.firstName === 'Dee')", 'camelCase rows'],
  ["dee?.first_s === `${m}/${d}/${y}` && dee?.last_s === `${m}/${d}/${y}`", "dee?.firstS === `${m}/${d}/${y}` && dee?.lastS === `${m}/${d}/${y}`", 'camelCase rows'],
]
// The office group's other files. OFFICE_SHAPE reads each reply of a file that drives several groups' routes through
// templateShape (as above), defined where it is used.
const OFFICE_SHAPE: [string, string, string] = ["let j: any = t; try { j = JSON.parse(t) } catch {}",
  "let j: any = t; try { const snakeKey = (k: string) => k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase()); const templateShape = (v: any): any => Array.isArray(v) ? v.map(templateShape) : (v && typeof v === 'object') ? ((Array.isArray(v.data) && v.pagination) ? templateShape(v.data) : Object.fromEntries(Object.entries(v).flatMap(([k, x]) => { const s = templateShape(x); return snakeKey(k) === k ? [[k, s]] : [[k, s], [snakeKey(k), s]] }))) : v; j = templateShape(JSON.parse(t)) } catch {}",
  "each reply read in the template's shape: a list reply ({ data, pagination }, RULEBOOK §3) as its rows, and every camelCase key (RULEBOOK §2) also under its snake_case name — the values are the server's, unchanged"]
const HC_TABLES = 'the business is the company table and its people the user table (RULEBOOK §4: agencies and users are refused names)'
ADAPT['homecare/fixes.test.ts'] = [
  OFFICE_SHAPE,
  ["(await A('GET', '/api/clients/nope/caregiver-view')).status === 404", "(await A('GET', '/api/clients/nope/caregiver-view')).status === 403", "the office's \"every client\" is every client of its own company (core/caregiverAccess.ts): an id that is not one — another company's or none — is refused alike, so the answer never says which"],
  ["(await q1(sql`SELECT name FROM agencies WHERE id = ${ag.id}`)).name === 'Fixes Care'", "(await q1(sql`SELECT name FROM company WHERE id = ${ag.id}`)).name === 'Fixes Care'", HC_TABLES],
  ["needs.status === 403 && apply.status === 403 &&", "needs.status === 403 && apply.status === 404 &&", "POST /api/matching/apply-schedule is not on the unified app: the template's answered success and applied nothing (a stub), so nobody — caregiver or office — can apply a matching schedule; no schedule is made either way"],
]
ADAPT['homecare/integration.test.ts'] = [
  OFFICE_SHAPE,
  ["asCg.status === 200 && asCg.json.caregivers.length > 0 && asCg.json.caregivers.every((r: any) => !('default_pay_rate' in r)), asCg.json.caregivers?.[0])", "asCg.status === 200 && asCg.json.length > 0 && asCg.json.every((r: any) => !('default_pay_rate' in r)), asCg.json?.[0])", "the caregiver list is a list reply (RULEBOOK §3): its rows are data, not caregivers"],
  ["asAd.json.caregivers.some((r: any) => Number(r.default_pay_rate) === 18.5)", "asAd.json.some((r: any) => Number(r.default_pay_rate) === 18.5)", 'a list reply'],
  ["listC.json.entries.length === 1 && listC.json.entries.every((e: any) => e.caregiverId === cg1.id), listC.json.entries)", "listC.json.length === 1 && listC.json.every((e: any) => e.caregiverId === cg1.id), listC.json)", "the mileage list is a list reply (RULEBOOK §3): its rows are data, not entries (the payroll group's mileage)"],
  ["(await A('GET', `/api/mileage?caregiverId=${cg2.id}`)).json.entries.length === 1", "(await A('GET', `/api/mileage?caregiverId=${cg2.id}`)).json.length === 1", 'a list reply'],
  ["'isPrivatePay' in row && !('first_name' in row), row)", "'isPrivatePay' in row, row)", "this copy reads every reply with each camelCase key also under its snake_case name, so the absence of first_name is not asked; that the list is camelCase is firstName and isPrivatePay being there"],
  ["await q(sql`UPDATE users SET default_pay_rate = 18.50 WHERE id IN (${cg1.id}, ${cg2.id})`)", "await q(sql`UPDATE \"user\" SET default_pay_rate = 18.50 WHERE id IN (${cg1.id}, ${cg2.id})`)", HC_TABLES],
  ["await q(sql`UPDATE agencies SET timezone = NULL WHERE id = ${ag.id}`)", "await q(sql`UPDATE company SET timezone = NULL WHERE id = ${ag.id}`)", HC_TABLES],
  ["await q(sql`UPDATE agencies SET state = NULL WHERE id = ${ag.id}`)", "await q(sql`UPDATE company SET state = NULL WHERE id = ${ag.id}`)", HC_TABLES],
  ["await q(sql`UPDATE agencies SET state = 'WI' WHERE id = ${ag.id}`)", "await q(sql`UPDATE company SET state = 'WI' WHERE id = ${ag.id}`)", HC_TABLES],
  ["await q1(sql`SELECT timezone FROM agencies WHERE id = ${ag.id}`)", "await q1(sql`SELECT timezone FROM company WHERE id = ${ag.id}`)", HC_TABLES],
  ["await q(sql`UPDATE agencies SET timezone = 'UTC' WHERE id = ${ag.id}`)", "await q(sql`UPDATE company SET timezone = 'UTC' WHERE id = ${ag.id}`)", HC_TABLES],
]
const HELP_KB = "the help articles are the app's one knowledge base, /api/support/kb (support-kb permissions; routes/help.ts is not moved)"
ADAPT['homecare/write-gates.test.ts'] = [
  OFFICE_SHAPE,
  ["['/api/calltracking', 'calltracking'], ['/api/subscription', 'saasBilling'], ['/api/help', 'help'],", "['/api/calltracking', 'calltracking'], ['/api/billing', 'saasBilling'], ['/api/support', 'help'],", "the subscription is the app's billing module (/api/billing) and the help articles its knowledge base (/api/support): the test's app forwards those paths to the unified app"],
  ["enabledFeatures: ['ai_receptionist'] } as any).returning()", "enabledFeatures: ['ai_receptionist', 'call_tracking', 'paid_ads'] } as any).returning()", "call tracking and Paid Ads follow their features on the unified app, as the AI receptionist did in the template, so this agency has them (the template's two routers were ungated)"],
  ["['POST', '/api/subscription/subscription/cancel', { immediate: true }],", "['GET', '/api/billing/subscription'],", "the subscription is the app's billing module, /api/billing (routes/saasBilling.ts is not moved)"],
  ["['GET', '/api/subscription/invoices'],", "['GET', '/api/billing/subscription'],", "the subscription is /api/billing (its invoices are the Factory's billing portal)"],
  ["['POST', '/api/help/kb', { title: 't', content: 'c' }],", "['POST', '/api/support/kb', { title: 't', content: 'c' }],", HELP_KB],
  ["const kb = await O('POST', '/api/help/kb', { title: 'How to clock in', content: '…' })", "const kb = await O('POST', '/api/support/kb', { title: 'How to clock in', content: '…' })", HELP_KB],
  ["kb.json.agency_id === ag.id", "kb.json.companyId === ag.id", 'the article carries its company (RULEBOOK §4)'],
  ["const kbRead = await C1('GET', `/api/help/kb/${kb.json?.id}`)", "const kbRead = await C1('GET', '/api/support/kb').then((r) => ({ ...r, json: (r.json || []).find((a: any) => a.id === kb.json?.id) }))", HELP_KB + ', read from its list'],
  ["(await C1('PUT', `/api/help/kb/${kb.json?.id}`, { title: 'x', content: 'y' }))", "(await C1('PUT', `/api/support/kb/${kb.json?.id}`, { title: 'x', content: 'y' }))", HELP_KB],
  ["await O('PUT', `/api/help/kb/${kb.json?.id}`,", "await O('PUT', `/api/support/kb/${kb.json?.id}`,", HELP_KB],
  ["(await O('POST', '/api/help/kb', {})).status === 400", "(await O('POST', '/api/support/kb', {})).status === 400", HELP_KB],
]
ADAPT['homecare/leads.test.ts'] = [
  ["const c = await as(admin)('POST', '/api/leads/sources', { platform: 'web', label: 'Admin source' })", "const c = await as(admin)('POST', '/api/leads/sources', { platform: 'angi', label: 'Admin source' })", "a lead source is one of the platforms the inbox connects to (the shared module checks it; home care's Lead Sources page offers the trades set, and the template took any name)"],
  ["{ name: 'Leads Care Agency', slug: 'leadscare' }", "{ name: 'Leads Care Agency', slug: 'leadscare', enabledFeatures: ['lead_inbox'] }", "the Lead Inbox follows its lead_inbox feature on the server as in the menu (the template's menu was gated, its API was not), so this agency has it"],
  ["check('…with homecare\\'s own message', cg.json?.error === 'Admin access required', cg.json)", "check('…with homecare\\'s own message', cg.json?.error === 'Permission denied', cg.json)", "the inbox's writes are gated by permission (the shared leads module's requirePermission), whose refusal is 'Permission denied'"],
]
ADAPT['homecare/ai-receptionist.test.ts'] = [
  ["slug: 'receptionist-care', enabledFeatures: ['ai_receptionist'] }", "slug: 'receptionist-care', enabledFeatures: ['ai_receptionist', 'call_tracking'] }", "the call log the screen reads is call tracking's, which follows its call_tracking feature on the unified app (the template's router was ungated)"],
  ["created.json?.agencyId === ag.id", "created.json?.companyId === ag.id", HC_TABLES + ': a row names its company'],
  ["row?.name === 'Renamed' && row?.agencyId === ag.id", "row?.name === 'Renamed' && row?.companyId === ag.id", 'a row names its company'],
  ["row2?.delayMinutes === 7 && row2?.agencyId === ag.id", "row2?.delayMinutes === 7 && row2?.companyId === ag.id", 'a row names its company'],
  ["eq(aiReceptionistRule.agencyId, other.id)", "eq(aiReceptionistRule.companyId, other.id)", 'a row names its company'],
  ["eq(aiReceptionistSettings.agencyId, ag.id)", "eq(aiReceptionistSettings.companyId, ag.id)", 'a row names its company'],
  ["eq(aiReceptionistSettings.agencyId, other.id)", "eq(aiReceptionistSettings.companyId, other.id)", 'a row names its company'],
  ["b.status === 200 && Array.isArray(b.json?.data), b)", "b.status === 403, b)", "the unified feature list is company.enabled_features alone — the Factory's sync and every in-app writer write that column, and nothing reads settings.enabledFeatures (core/agencyFeatures.ts) — so a feature only in the old blob is off"],
  ["JSON.stringify((row.settings as any)?.enabledFeatures) === '[\"contacts\"]' && ", "", 'the one writer writes the column only; the blob is no longer a second copy of the list (core/agencyFeatures.ts)'],
]
ADAPT['homecare/webhook-signatures-homecare.test.ts'] = [
  ["{ platform: 'caring_com', label: 'Caring.com' }", "{ platform: 'houzz', label: 'Houzz' }", "a new source is one of the platforms the inbox connects to (the shared leads module checks it; home care's Lead Sources page offers the trades set, and the template took any name)"],
  ["made.json?.inboundEmail === want('caring_com')", "made.json?.inboundEmail === want('houzz')", 'the source made above'],
  ["twilioPhoneNumber: '+16085558888' } as any).returning()", "twilioPhoneNumber: '+16085558888', enabledFeatures: ['call_tracking', 'lead_inbox'] } as any).returning()", "call tracking's settings and the lead sources follow their features (call_tracking, lead_inbox; the template's routers were ungated); the webhooks stay open either way"],
  ["FROM call_log WHERE agency_id = ${ag.id}", "FROM call_log WHERE company_id = ${ag.id}", HC_TABLES + ': a row names its company'],
]
ADAPT['homecare/email-alias-readback.test.ts'] = [
  ["const { users } = await import('./db/schema.ts')", "const { users, agencies } = await import('./db/schema.ts')\nawait db.insert(agencies).values({ name: 'Alias Care', slug: 'alias-care' } as any)", "every person belongs to a company in the unified schema (user.company_id, RULEBOOK §2); the template's users had none, so the agency is made first"],
]
// Home care, planning group (dashboard, reports, the optimizers).
ADAPT['homecare/reports.test.ts'] = [
  ["const near = (a: any, b: number, eps = 0.011) => Math.abs(Number(a) - b) < eps",
    "const near = (a: any, b: number, eps = 0.011) => Math.abs(Number(a) - b) < eps\nconst snakeKey = (k: string) => k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase())\nconst templateShape = (v: any): any => Array.isArray(v) ? v.map(templateShape) : (v && typeof v === 'object') ? ((Array.isArray(v.data) && v.pagination) ? templateShape(v.data) : Object.fromEntries(Object.entries(v).flatMap(([k, x]) => { const s = templateShape(x); return snakeKey(k) === k ? [[k, s]] : [[k, s], [snakeKey(k), s]] }))) : v",
    "templateShape reads a unified reply in the template's shape: a list reply ({ data, pagination }, RULEBOOK §3) as its rows, and every camelCase key (RULEBOOK §2) also under its snake_case name — the values are the server's, unchanged"],
  ["const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}", "const t = await res.text(); let j: any = t; try { j = templateShape(JSON.parse(t)) } catch {}", 'each reply read through templateShape'],
  ["await import('./src/services/agencyTime.ts')", "await import('../../server/crm/homecare/core/agencyTime.ts')", "the agency clock is the foundation's (server/crm/homecare/core/agencyTime.ts; the sandbox sits in apps/unified/.suite)"],
  ["await import('./src/services/scheduleOccurrences.ts')", "await import('../../server/data/homecareCore.ts')", 'the schedule engine is SQL in server/data/homecareCore.ts'],
  ["WITH ${occurrencesCte('2026-09-01', '2026-09-30')}", "WITH ${occurrencesCte(ag.id, '2026-09-01', '2026-09-30')}", "the engine reads one company's schedules: it takes the company's id first"],
  ["await import('./src/routes/rosterOptimizer.ts')", "await import('../../server/crm/homecare/planning/rosterOptimizer.ts')", 'the roster optimizer is server/crm/homecare/planning/rosterOptimizer.ts'],
  ["list.json?.total === 1 && list.json?.routes?.[0]?.status === 'published' && list.json?.routes?.[0]?.route_date === '2026-09-15'", "list.json?.length === 1 && list.json?.[0]?.status === 'published' && list.json?.[0]?.route_date === '2026-09-15'", 'saved routes are a list reply ({ data, pagination }): templateShape reads its rows, so the count is their length'],
  ["r.json?.error === 'Admin access required'", "r.json?.error === 'Permission denied'", "the office's doors are permissions (requirePermission: care-billing, care-payroll, care-hr, care-schedule:update …), whose refusal is 'Permission denied'"],
]
// Home care, portals group (the client and family portals, messages, notifications, texting). Each file reads its
// replies through templateShape (the planning group's reader, above): a list reply as its rows, every camelCase key also
// under its snake_case name — the values are the server's, unchanged.
const PORTALS_SHAPE: [string, string, string] = ["let failed = 0, passed = 0",
  "let failed = 0, passed = 0\nconst snakeKey = (k: string) => k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase())\nconst templateShape = (v: any): any => Array.isArray(v) ? v.map(templateShape) : (v && typeof v === 'object') ? ((Array.isArray(v.data) && v.pagination) ? templateShape(v.data) : Object.fromEntries(Object.entries(v).flatMap(([k, x]) => { const s = templateShape(x); return snakeKey(k) === k ? [[k, s]] : [[k, s], [snakeKey(k), s]] }))) : v",
  "templateShape reads a unified reply in the template's shape: a list reply ({ data, pagination }, RULEBOOK §3) as its rows, and every camelCase key (RULEBOOK §2) also under its snake_case name — the values are the server's, unchanged"]
const PORTALS_READ: [string, string, string] = ["const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}", "const t = await res.text(); let j: any = t; try { j = templateShape(JSON.parse(t)) } catch {}", 'each reply read through templateShape']
ADAPT['homecare/portal.test.ts'] = [
  PORTALS_SHAPE, PORTALS_READ,
  ["const [agency] = await db.insert(agencies).values({ name: 'Portal Test Agency', slug: 'portaltest', state: 'OH' } as any).returning()", "void agency", 'the agency is made before the first clients (below)'],
  ["await setupSchema()", "await setupSchema(); const [agency] = await db.insert(agencies).values({ name: 'Portal Test Agency', slug: 'portaltest', state: 'OH' } as any).returning()", "every home-care row carries its company (company_id NOT NULL, docs/UNIFIED_HOMECARE_PLAN.md decision 2): the agency exists before the first block writes clients (the sandbox fills a fixture row's company with the database's one company)"],
]
ADAPT['homecare/portal-visit-changes.test.ts'] = [PORTALS_SHAPE, PORTALS_READ]
ADAPT['homecare/popup-forms.test.ts'] = [
  PORTALS_SHAPE, PORTALS_READ,
  ["cgOk.status === 201 && cgOk.json.role === 'caregiver'", "cgOk.status === 201 && cgOk.json.role === 'field'", "a new caregiver's seat is the unified role field (the hr group's caregivers route; moved tenants keep caregiver; both read as a caregiver)"],
]
// r4: its first part asks the template's seed rule (db/signupOwner.ts, db/seed.template.ts) for the sign-up owner. The
// unified app has no seed: the Factory's provisioning writes the business and its owner, role 'owner'
// (server/modules/provision.ts, held by apps/unified/tests/provision.test.ts). This copy makes the owner that way and
// does not run the seed's three blocks; the billing doors, the owner's login and the portal locks run as written.
ADAPT['homecare/r4-owner-and-portals.test.ts'] = [
  PORTALS_SHAPE, PORTALS_READ,
  ["const { ensureSignupOwner } = await import('./db/signupOwner.ts')", "const ensureSignupOwner: any = null", "there is no seed rule to import: provisioning writes the owner (server/modules/provision.ts)"],
  ["let owner: any\r\n{\r\n  const r = await ensureSignupOwner(db, users, signup)", "let owner: any = (await db.insert(users).values({ ...signup, role: 'owner', isActive: true } as any).returning())[0]\r\nif (false) {\r\n  const r = await ensureSignupOwner(db, users, signup)", "the owner is the one the Factory provisions (role 'owner'); the seed's block is not run"],
  ["{\r\n  // An agency seeded before this fix", "if (false) {\r\n  // An agency seeded before this fix", "the seed's promotion of an old agency's admin is not run (no seed in the unified app)"],
  ["{\r\n  const seed = readFileSync(", "if (false) {\r\n  const seed = readFileSync(", "the generated seed is not the unified app's (provisioning is)"],
]

// Home care, billing group (visit invoices, claims, payers, authorizations).
const BILLING_TEMPLATE_SHAPE: [string, string, string] = ["const rows = (r: any) => (r?.rows ?? r) as any[]",
  "const rows = (r: any) => (r?.rows ?? r) as any[]\nconst snakeKey = (k: string) => k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase())\nconst templateShape = (v: any): any => Array.isArray(v) ? v.map(templateShape) : (v && typeof v === 'object') ? ((Array.isArray(v.data) && v.pagination) ? templateShape(v.data) : Object.fromEntries(Object.entries(v).flatMap(([k, x]) => { const s = templateShape(x); return snakeKey(k) === k ? [[k, s]] : [[k, s], [snakeKey(k), s]] }))) : v",
  "templateShape reads a unified reply in the template's shape: a list reply ({ data, pagination }, RULEBOOK §3) as its rows, and every camelCase key (RULEBOOK §2) also under its snake_case name — what the template's own index.ts did to every reply (addSnakeAliases); the values are the server's, unchanged"]
const BILLING_READ_THROUGH: [string, string, string] = ["const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}", "const t = await res.text(); let j: any = t; try { j = templateShape(JSON.parse(t)) } catch {}", 'each reply read through templateShape']
ADAPT['homecare/billing.test.ts'] = [
  BILLING_TEMPLATE_SHAPE,
  BILLING_READ_THROUGH,
  ["return { status: r.status, json: await r.json() }", "return { status: r.status, json: templateShape(await r.json()) }", "the family portal's reply read through templateShape too"],
  ["/Private Pay Rate/.test(x.json.message)", "/Private Pay Rate/.test(x.json.error) && x.json.code === 'no_billing_rate'", "a refusal is { error, code } (RULEBOOK §3): the no-rate fix is in the sentence (it was a message field), with code no_billing_rate"],
  ["over.status === 409 && near(over.json.balanceDue, 264)", "over.status === 409 && over.json.code === 'overpayment' && /exceeds the \\$264\\.00 balance due/.test(over.json.error)", "an overpayment refusal is { error, code: 'overpayment' }: the balance due is in the sentence, not a balanceDue field"],
  ["over2.status === 409 && near(over2.json.balanceDue, 164)", "over2.status === 409 && /exceeds the \\$164\\.00 balance due/.test(over2.json.error)", 'the balance due is in the sentence'],
  ["r.json?.error === 'Admin access required'", "r.json?.error === 'Permission denied'", "billing and claims are gated by care-billing permissions (requirePermission), whose refusal is 'Permission denied'"],
  ["'under_30' in sum.json.aging", "'under30' in sum.json.aging", "the aging buckets are camelCase keys (under30, days30To60 …): the template's under_30 has no camelCase it maps back from"],
]
ADAPT['homecare/r3-billing.test.ts'] = [
  BILLING_TEMPLATE_SHAPE,
  BILLING_READ_THROUGH,
  ["a?.private_pay_by_rule === true, a)", "a?.privatePayByRule === true, a)", "the invoice engine's client row is camelCase (server/data/homecareBilling.ts billingClient)"],
  ["b?.private_pay_by_rule === true, b)", "b?.privatePayByRule === true, b)", "camelCase row"],
  ["c?.private_pay_by_rule === false, c)", "c?.privatePayByRule === false, c)", "camelCase row"],
  ["const list = await A('GET', '/api/evv')", "const list = await A('GET', '/api/evv'); const evvPage: any = await (await app.request('/api/evv', { headers: { 'x-test-user': admin.id, 'x-test-agency': ag.id, 'x-test-role': admin.role } })).json()", "the EVV dashboard is a list reply ({ data, pagination }); its total is pagination.total"],
  ["const ids = (list.json.visits || []).map((v: any) => v.clientId)", "const ids = (Array.isArray(list.json) ? list.json : []).map((v: any) => v.clientId)", 'templateShape reads the list reply as its rows'],
  ["&& list.json.total === ids.length, list.json)", "&& evvPage?.pagination?.total === ids.length, list.json)", "the count is the list reply's pagination.total"],
]
// Home care, clients group (server/crm/homecare/clients): the same templateShape reading as the office and planning
// groups', plus the reads that name the template's own files.
const CLIENTS_TEMPLATE_SHAPE = "const snakeKey = (k: string) => k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase())\nconst templateShape = (v: any): any => Array.isArray(v) ? v.map(templateShape) : (v && typeof v === 'object') ? ((Array.isArray(v.data) && v.pagination) ? templateShape(v.data) : Object.fromEntries(Object.entries(v).flatMap(([k, x]) => { const s = templateShape(x); return snakeKey(k) === k ? [[k, s]] : [[k, s], [snakeKey(k), s]] }))) : v"
const CLIENTS_TEMPLATE_SHAPE_WHY = "templateShape reads a unified reply in the template's shape: a list reply ({ data, pagination }, RULEBOOK §3) as its rows, and every camelCase key (RULEBOOK §2) also under its snake_case name — the values are the server's, unchanged"
ADAPT['homecare/care.test.ts'] = [
  ["const ymd = (d: Date) => d.toISOString().slice(0, 10)", "const ymd = (d: Date) => d.toISOString().slice(0, 10)\n" + CLIENTS_TEMPLATE_SHAPE, CLIENTS_TEMPLATE_SHAPE_WHY],
  ["const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}", "const t = await res.text(); let j: any = t; try { j = templateShape(JSON.parse(t)) } catch {}", 'each reply read through templateShape'],
  ["JSON.stringify(p.sections) === JSON.stringify([", "JSON.stringify(p.sections.map(({ name, category, minsPerWeek, tasks }: any) => ({ name, category, minsPerWeek, tasks }))) === JSON.stringify([", "the sections compared on their own four keys (the reply is unchanged, camelCase as the template's was; templateShape's snake_case aliases are not part of it)"],
  ["all.json.clients.find((x: any) => x.id === jane.id)", "all.json.find((x: any) => x.id === jane.id)", 'the office client list is a list reply ({ data, pagination }), not { clients, total, page, pages }: templateShape reads its rows'],
  ["const { careTasksSection } = await import('./src/services/carePdf.ts')", "const { careTasksSection } = await import('../../server/crm/homecare/core/carePdf.ts')", "the care plan PDF's text is the foundation's (server/crm/homecare/core/carePdf.ts; the sandbox sits in apps/unified/.suite)"],
  ["{ task_name: 'Wash Dishes', category: 'iadl', weekly_frequency: 3, allotted_minutes: 15, assessment_source: 'midas_shc_pc_summary' },", "{ taskName: 'Wash Dishes', category: 'iadl', weeklyFrequency: 3, allottedMinutes: 15, assessmentSource: 'midas_shc_pc_summary' },", "the section takes the task rows the unified routes read (camelCase: taskName, weeklyFrequency, allottedMinutes, assessmentSource)"],
  ["{ task_name: 'Bathing', category: 'adl', weekly_frequency: 2, allotted_minutes: 30, assessment_source: null },", "{ taskName: 'Bathing', category: 'adl', weeklyFrequency: 2, allottedMinutes: 30, assessmentSource: null },", 'camelCase task rows'],
  ["const { renderAnswer } = await import('./src/services/carePdf.ts')", "const { renderAnswer } = await import('../../server/crm/homecare/core/carePdf.ts')", "the form PDF's answers are the foundation's carePdf.ts"],
  ["const r = await pglite.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'trg_snapshot_care_plan'`)", "const r = await pglite.query(`SELECT count(*)::int AS n FROM care_plan_revisions WHERE care_plan_id = '${planId}' AND company_id IS NOT NULL`)", "the unified migrations have no snapshot trigger: PUT /api/care-plans/:id writes the revision itself, in the same transaction, with the plan row locked (server/crm/homecare/clients/carePlans.ts)"],
  ["check('the revision trigger is installed by the migration', (r.rows[0] as any).n === 1)", "check('every content change of the plan is a revision in the company, written with the change (five: goals, end date set, end date cleared, schedule saved, schedule removed)', (r.rows[0] as any).n === 5, (r.rows[0] as any).n)", 'the revisions the app wrote, counted'],
]
ADAPT['homecare/r4-care.test.ts'] = [
  ["const q = async (s: any) => { const r: any = await db.execute(s); return (r?.rows ?? r) as any[] }", "const q = async (s: any) => { const r: any = await db.execute(s); return (r?.rows ?? r) as any[] }\n" + CLIENTS_TEMPLATE_SHAPE, CLIENTS_TEMPLATE_SHAPE_WHY],
  ["const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}", "const t = await res.text(); let j: any = t; try { j = templateShape(JSON.parse(t)) } catch {}", 'each reply read through templateShape'],
  ["const pdf = await import('./src/services/carePdf.ts')", "const pdf = await import('../../server/crm/homecare/core/carePdf.ts')", "the care plan PDF's text is the foundation's (server/crm/homecare/core/carePdf.ts); it reads the camelCase task rows the list now answers"],
  ["famNone.status === 200 && famNone.json === null, famNone.json)", "famNone.status === 200 && !!famNone.json && Object.keys(famNone.json).length === 0, famNone.json)", "a reply is an object (RULEBOOK §3): the family portal's \"no active care plan\" is {} (server/crm/homecare/portals/familyPortal.ts), not a bare null"],
  ["(await F('GET', '/api/family-portal/portal/care-plan')).json === null, ended.json)", "Object.keys((await F('GET', '/api/family-portal/portal/care-plan')).json || { x: 1 }).length === 0, ended.json)", 'no active care plan is {}'],
  ["v.status === 200 && v.json[0]?.recorded_at === '2026-10-16T16:10:00Z', v.json)", "v.status === 200 && v.json[0]?.recorded_at === '2026-10-16T16:10:00.000Z', v.json)", "the reading leaves as the same UTC instant, in JSON's own Date form with milliseconds (core/vitals.ts reads it through the query builder; the template formatted the string by hand)"],
  [".json[0]?.recorded_at === '2026-10-16T16:10:00Z')", ".json[0]?.recorded_at === '2026-10-16T16:10:00.000Z')", 'the same instant, JSON Date form'],
]
// Home care, scheduling group (server/crm/homecare/scheduling): the same templateShape reading (scheduling.test.ts also
// drives the planning group's roster optimizer).
ADAPT['homecare/scheduling.test.ts'] = [
  ["const q1 = async (s: any) => (await q(s))[0]", "const q1 = async (s: any) => (await q(s))[0]\n" + CLIENTS_TEMPLATE_SHAPE, CLIENTS_TEMPLATE_SHAPE_WHY],
  ["let j: any = t; try { j = JSON.parse(t) } catch {}", "let j: any = t; try { j = templateShape(JSON.parse(t)) } catch {}", 'each reply read through templateShape'],
]
// Home care, payroll group (r3pay.test.ts also drives the planning group's reports and dashboard, the visits group's
// visit documentation and the clients group's visit notes): the same templateShape reading — the Gusto preview's
// grossPay / overtimeHours, the hours and performance reports' workedHours / payableHours / totalHours and punctuality
// rows (onTimeCount …), the visit documentation's visits (visitDate, caregiverId, punch.clockOutNote) and the client's
// visit notes, a list reply.
ADAPT['homecare/r3pay.test.ts'] = [
  ["const q = async (s: any) => { const r: any = await db.execute(s); return (r?.rows ?? r) as any[] }", "const q = async (s: any) => { const r: any = await db.execute(s); return (r?.rows ?? r) as any[] }\n" + CLIENTS_TEMPLATE_SHAPE, CLIENTS_TEMPLATE_SHAPE_WHY],
  ["const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}", "const t = await res.text(); let j: any = t; try { j = templateShape(JSON.parse(t)) } catch {}", 'each reply read through templateShape (a CSV export is not JSON and stays its text)'],
]
// Run 5 (the agency's clock). Its replies read through templateShape; its imports and screen reads name the moved
// files (the frontend helpers in web/src/crm/pages/homecare/lib, the screens in billing/, office/, portals/), each
// source regex in the unified screens' camelCase spelling.
const R5_FE = 'the screens and their helpers moved to apps/unified/web/src/crm/pages/homecare/ (lib/, billing/, office/, portals/)'
ADAPT['homecare/r5-agency-clock.test.ts'] = [
  ["const q = async (s: any) => { const r: any = await db.execute(s); return (r?.rows ?? r) as any[] }", "const q = async (s: any) => { const r: any = await db.execute(s); return (r?.rows ?? r) as any[] }\n" + CLIENTS_TEMPLATE_SHAPE, CLIENTS_TEMPLATE_SHAPE_WHY],
  ["const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}", "const t = await res.text(); let j: any = t; try { j = templateShape(JSON.parse(t)) } catch {}", 'each reply read through templateShape'],
  ["const me = await call(cg, 'GET', '/api/auth/me')", "const me = await call(cg, 'GET', '/api/company').then((r) => ({ ...r, json: { company: r.json } }))", "every signed-in role, a caregiver included, reads the agency's zone at GET /api/company (effectiveTimezone, server/crm/homecare/office/companyFields.ts), which is what the screens read (web/src/crm/pages/homecare/lib/HomecareFrame.tsx); /me is the shared sign-in's and does not carry it (apps/unified/tests/homecare-office.test.ts)"],
  ["const FE = (process.env.FACTORY_ROOT || '') + 'templates/crm-homecare/frontend/src/'", "const FE = (process.env.FACTORY_ROOT || '') + 'apps/unified/web/src/crm/pages/homecare/'", R5_FE],
  ["await import(FE + 'utils/agencyClock.ts')", "await import(FE + 'lib/agencyClock.ts')", 'the agency clock is lib/agencyClock.ts'],
  ["await import(FE + 'utils/datetime.ts')", "await import(FE + 'lib/datetime.ts')", 'the date formatters are lib/datetime.ts'],
  ["await import(FE + 'utils/serviceTypes.ts')", "await import(FE + 'lib/serviceTypes.ts')", 'the service-type names are lib/serviceTypes.ts'],
  ["INSERT INTO call_log (id, agency_id, start_time", "INSERT INTO call_log (id, company_id, start_time", HC_TABLES + ': a row names its company'],
  ["readFileSync(FE + 'components/admin/PortalClaimDays.tsx', 'utf8')", "readFileSync(FE + 'billing/PortalClaimDays.tsx', 'utf8')", 'Portal Claim Days is billing/PortalClaimDays.tsx'],
  [String.raw`/linked_clients === 0[\s\S]{0,200}No client has \{payer\?\.name\} as their payer yet[\s\S]{0,400}once the caregiver clocks out/.test(screen)`, String.raw`/linkedClients === 0[\s\S]{0,200}No client has \{payer\?\.name\} as their payer yet[\s\S]{0,400}once the caregiver clocks out/.test(screen)`, "the screen reads the reply's camelCase linkedClients (RULEBOOK §2)"],
  ["fs.readFileSync(FE + 'components/admin/ReportsAnalytics.tsx', 'utf8')", "fs.readFileSync(FE + 'office/ReportsAnalytics.tsx', 'utf8')", 'the reports screen is office/ReportsAnalytics.tsx'],
  [String.raw`!/service_type\?\.replace\('_', ' '\)\.toUpperCase\(\)/.test(reports)`, String.raw`!/serviceType\?\.replace\('_', ' '\)\.toUpperCase\(\)/.test(reports)`, "the screen's rows are camelCase (serviceType): the raw-key upper-casing is looked for in that spelling"],
  ["fs.readFileSync(FE + 'components/portal/FamilyPortal.tsx', 'utf8')", "fs.readFileSync(FE + 'portals/FamilyPortal.tsx', 'utf8')", 'the family portal is portals/FamilyPortal.tsx'],
  [String.raw`/serviceLabel\(pick\(plan, 'service_type', 'serviceType'\)\)/.test(family)`, String.raw`/serviceLabel\(plan\.serviceType\)/.test(family)`, "the unified screen is typed to the camelCase reply (RULEBOOK §2): it names plan.serviceType, where the template's pick() read either spelling"],
]

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
