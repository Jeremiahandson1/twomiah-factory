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
  ["check(`a caregiver may still read ${p}`, reached(r), { status: r.status, error: r.json?.error })", "check(`a caregiver is refused ${p}`, r.status === 403, { status: r.status, error: r.json?.error })", "home care withholds the field rung's contacts:read (verticals/homecare/settings.ts withheldRolePermissions): the shared Lead Inbox reads on it, and an agency's leads are prospective clients' details, the office's — a caregiver was offered the inbox (2026-10-19). The template's caregivers had no such page; its API was ungated"],
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

// Home care's screens moved (scheduling.test.ts, caregiver-visit.test.ts): src() reads the moved file per template path,
// and refuses a path with no moved file rather than read the template (2026-10-19).
const HC_MOVED_WHY = 'the screens moved to apps/unified/web/src/crm/pages/homecare/ (docs/UNIFIED_HOMECARE_SCREENS.md) and the schedule rule to server/crm/homecare/core: src() reads the moved file for each template path it is given, and refuses a path with no moved file rather than read the template'
ADAPT['homecare/scheduling.test.ts'].push(
  ["const src = (p: string) => readFileSync(ROOT + p, 'utf8').replace(/\\r\\n/g, '\\n')",
    "const HC_WEB = (process.env.FACTORY_ROOT || '') + 'apps/unified/web/src/crm/pages/homecare/'\nconst MOVED: Record<string, string> = {\n  'frontend/src/components/admin/DragDropScheduler.tsx': 'apps/unified/web/src/crm/pages/homecare/schedule/DragDropScheduler.tsx',\n  'frontend/src/components/admin/SchedulingHub.tsx': 'apps/unified/web/src/crm/pages/homecare/schedule/SchedulingHub.tsx',\n  'frontend/src/components/admin/MakeShiftAvailableModal.tsx': 'apps/unified/web/src/crm/pages/homecare/schedule/MakeShiftAvailableModal.tsx',\n  'frontend/src/utils/shiftTimes.ts': 'apps/unified/web/src/crm/pages/homecare/lib/shiftTimes.ts',\n  'backend/src/services/scheduleOccurrences.ts': 'apps/unified/server/crm/homecare/core/scheduleOccurrences.ts',\n}\nconst src = (p: string) => { if (!MOVED[p]) throw new Error('unified: no moved file for ' + p); return readFileSync((process.env.FACTORY_ROOT || '') + MOVED[p], 'utf8').replace(/\\r\\n/g, '\\n') }",
    HC_MOVED_WHY],
  ["grid.indexOf('// EDIT SHIFT'))", "grid.indexOf('// ═══ EDIT — scope-aware ═══'))", "the delete handler ends where the edit section begins; the moved grid marks it '// ═══ EDIT — scope-aware ═══'"],
  [String.raw`/if \(!res\.ok\)/.test(delFn) && !/await fetch\([^)]*\{\s*method: 'DELETE'[^}]*\}\);\s*showToast/.test(delFn)`,
    String.raw`/import \{[^}]*\bapi\b[^}]*\} from '\.\.\/lib\/http'/.test(grid) && /const del = \(query: string\) => api\.delete\(/.test(delFn) && /catch \(err\) \{\s*toast\.error\(errorMessage\(err, 'Delete failed'\)\)/.test(delFn) && !/fetch\(/.test(delFn)`,
    "the moved grid deletes through the app's api client (lib/http → packages/tenant-ui client.ts handleResponse), which throws on a refusal; every branch awaits del(), so a refused delete skips its success toast and lands in the catch's toast.error with the server's sentence — there is no res.ok to read and no raw fetch"],
  ["grid.indexOf('CREATE SHIFT MODAL'))", "grid.indexOf('═══ CREATE SHIFT ═══'))", "the legend ends where the create dialog begins; the moved grid marks it '═══ CREATE SHIFT ═══' (the template's 'CREATE SHIFT MODAL' is not in it)"],
  [String.raw`/const color\s+= clientColor\(s\.client_id, clientMap\)/.test(grid)`, String.raw`/const color\s+= clientColor\(s\.clientId, clientMap\)/.test(grid)`, "the grid's rows are camelCase (RULEBOOK §2): the chip colours by s.clientId"],
  ["/const label = `\\$\\{formatTime\\(sc\\.start_time\\)\\} \\$\\{getClientName\\(sc\\.client_id\\)\\} · \\$\\{getCaregiverName\\(sc\\.caregiver_id\\)\\}`/.test(hub)",
    "/const label = `\\$\\{formatTime\\(sc\\.startTime\\)\\} \\$\\{getClientName\\(sc\\.clientId\\)\\} · \\$\\{getCaregiverName\\(sc\\.caregiverId\\)\\}`/.test(hub)",
    "the month view's rows are camelCase (startTime, clientId, caregiverId)"],
  ["await import(ROOT + 'frontend/src/utils/date.ts')", "await import(HC_WEB + 'lib/date.ts')", 'the calendar-day helpers are lib/date.ts'],
  ["await import(ROOT + 'frontend/src/utils/datetime.ts')", "await import(HC_WEB + 'lib/datetime.ts')", 'the date formatters are lib/datetime.ts'],
)
ADAPT['homecare/caregiver-visit.test.ts'].push(
  ["const src = (p: string) => readFileSync(ROOT + p, 'utf8').replace(/\\r\\n/g, '\\n')",
    "const HC_WEB = (process.env.FACTORY_ROOT || '') + 'apps/unified/web/src/crm/pages/homecare/'\nconst MOVED: Record<string, string> = {\n  'frontend/src/components/CareTaskChecklist.tsx': 'apps/unified/web/src/crm/pages/homecare/visits/CareTaskChecklist.tsx',\n  'frontend/src/components/caregiver/ShiftMissReport.tsx': 'apps/unified/web/src/crm/pages/homecare/visits/caregiver/ShiftMissReport.tsx',\n  'frontend/src/components/CaregiverDashboard.tsx': 'apps/unified/web/src/crm/pages/homecare/visits/CaregiverDashboard.tsx',\n  'frontend/src/components/caregiver/VisitCarePanel.tsx': 'apps/unified/web/src/crm/pages/homecare/visits/caregiver/VisitCarePanel.tsx',\n}\nconst src = (p: string) => { if (!MOVED[p]) throw new Error('unified: no moved file for ' + p); return readFileSync((process.env.FACTORY_ROOT || '') + MOVED[p], 'utf8').replace(/\\r\\n/g, '\\n') }",
    HC_MOVED_WHY],
  [String.raw`!/setStatus\(t\.task_id, 'refused'/.test(ui)`, String.raw`!/setStatus\(t\.taskId, 'refused'/.test(ui)`, "the checklist's rows are camelCase (taskId): a bare 'refused' PUT is looked for in that spelling"],
  [String.raw`/if \(msg\) \{ setNotesError\(msg\); return; \}/.test(ui)`, String.raw`/if \(msg\) \{ setNotesError\(msg\); return;? \}/.test(ui)`, "the moved checklist writes the same guard without the trailing semicolon ('if (msg) { setNotesError(msg); return }')"],
  ["/\\{formatTime\\(shift\\.start_time\\)\\} – \\{formatTime\\(shift\\.end_time\\)\\}/.test(form) && !/\\{shift\\.start_time\\} – \\{shift\\.end_time\\}/.test(form)",
    "/\\{formatTime\\(shift\\.startTime\\)\\} – \\{formatTime\\(shift\\.endTime\\)\\}/.test(form) && !/\\{shift\\.startTime\\} – \\{shift\\.endTime\\}/.test(form)",
    "my-shifts rows are camelCase (startTime, endTime)"],
  [String.raw`/if \(claimingShiftId\) return;/.test(dash)`, String.raw`/if \(claimingShiftId\) return\b/.test(dash)`, "the moved dashboard writes the in-flight guard without the semicolon ('if (claimingShiftId) return')"],
  [String.raw`/<VisitCarePanel timeEntryId=\{activeSession\.id\} clientId=\{activeSession\.client_id\} \/>/.test(dash)`,
    String.raw`/<VisitCarePanel timeEntryId=\{liveEntryId\} clientId=\{activeSession\.clientId\} \/>/.test(dash) && /const liveEntryId = activeSession && !activeSession\.offline && !String\(activeSession\.id\)\.startsWith\('offline-'\) \? activeSession\.id : null/.test(dash)`,
    "the moved dashboard hands the panel liveEntryId — the active session's id unless the punch is still an offline one with no server row — and the camelCase clientId"],
  ["/'\\/api\\/medications\\/log'/.test(panel) && /'\\/api\\/medications\\/vitals'/.test(panel) && /`\\/api\\/time-entries\\/\\$\\{timeEntryId\\}\\/photos`/.test(panel) && /`\\/api\\/medications\\/due\\/\\$\\{clientId\\}`/.test(panel)",
    "/api\\.post\\('\\/api\\/medications\\/log'/.test(panel) && /api\\.post\\('\\/api\\/medications\\/vitals'/.test(panel) && /api\\.post\\(`\\/api\\/time-entries\\/\\$\\{timeEntryId\\}\\/photos`/.test(panel) && /api\\.get\\(`\\/api\\/medications\\/due\\/\\$\\{clientId\\}`/.test(panel)",
    "the moved panel calls through the app's api client (api.post / api.get), so the check names the verb as well as the route"],
  ["await import(ROOT + 'frontend/src/utils/datetime.ts')", "await import(HC_WEB + 'lib/datetime.ts')", 'the date formatters are lib/datetime.ts'],
)

// Home care's screen and server reads in ai-receptionist, fixes, evv and incidents, pointed at the unified app's files
// (2026-10-19). Each list is added to the file's own entries above.
const NEW: Record<string, [string, string, string][]> = {}

const AIR_FE = 'the AI receptionist is the shared one (web/src/crm/pages/AIReceptionistPage.tsx, server/crm/comms/aiReceptionist.ts and aiReceptionistService.ts), not a home-care copy'
NEW['homecare/ai-receptionist.test.ts'] = [
  ["const ROOT = (process.env.FACTORY_ROOT || '') + 'templates/crm-homecare/'", "const ROOT = (process.env.FACTORY_ROOT || '') + 'apps/unified/'", AIR_FE],
  ["readFileSync(ROOT + 'frontend/src/pages/AiReceptionistPage.tsx', 'utf8')", "readFileSync(ROOT + 'web/src/crm/pages/AIReceptionistPage.tsx', 'utf8')", 'the screen is the shared AIReceptionistPage.tsx'],
  ["const dash = readFileSync(ROOT + 'frontend/src/components/AdminDashboard.tsx', 'utf8')", "const dash = readFileSync(ROOT + 'web/src/App.tsx', 'utf8'), shellNav = readFileSync(ROOT + 'web/src/shell.ts', 'utf8'), hcVertical = readFileSync(ROOT + 'web/src/crm/verticals/homecare.tsx', 'utf8')", "AdminDashboard's switch is the app's routes (App.tsx) and menu (shell.ts); home care's menu is the shared menu less SHARED_HIDDEN (crm/verticals/homecare.tsx)"],
  ["readFileSync(ROOT + 'backend/src/services/aiReceptionist.ts', 'utf8')", "readFileSync(ROOT + 'server/crm/comms/aiReceptionistService.ts', 'utf8')", 'the service is server/crm/comms/aiReceptionistService.ts (RULE_FIELDS, SETTINGS_FIELDS)'],
  ["readFileSync(ROOT + 'backend/src/routes/aiReceptionist.ts', 'utf8')", "readFileSync(ROOT + 'server/crm/comms/aiReceptionist.ts', 'utf8')", 'the router is server/crm/comms/aiReceptionist.ts'],
  ["const ruleKeys = keysOf('ruleBody'), settingsKeys = keysOf('settingsBody')", String.raw`const ifaceKeys = (name: string) => { const m = new RegExp('interface ' + name + ' \\{([\\s\\S]*?)\\n\\}').exec(page); return m ? Array.from(m[1].matchAll(/^\s*(\w+)\??:/gm)).map((x) => x[1]) : [] }
  const ruleKeys = ifaceKeys('AutoReplyFormData'), settingsKeys = ifaceKeys('AISettings')`, "the shared screen has no ruleBody/settingsBody builders: a rule is sent as the form's typed state (AutoReplyFormData) and a setting as a Partial<AISettings>, so the fields it can send are those two interfaces' keys"],
  [String.raw`const sends = Array.from(page.matchAll(/api\.(post|put)\([^,]+,\s*([^)]*\)?)\)/g)).map((m) => m[2].trim())`, String.raw`const sends = Array.from(page.matchAll(/body: JSON\.stringify\(([^)]*)\)/g)).map((m) => m[1].trim())`, "the shared screen writes through its own api(path, { method, body: JSON.stringify(x) }) helper over client.raw (the session cookie)"],
  [String.raw`sends.length >= 4 && sends.every((s) => /^(ruleBody\(form\)|settingsBody\(settings\)|\{ isActive: !rule\.isActive \})$/.test(s)), sends)`, String.raw`sends.length === 5 && sends.every((s) => /^(data|updates|\{ isActive: !rule\.isActive \}|\{ isEnabled: !settings\.isEnabled \})$/.test(s)) && /const handleSave = async \(data: AutoReplyFormData\)/.test(page) && /const updateSettings = async \(updates: Partial<AISettings>\)/.test(page), sends)`, "a rule save sends the typed form (data: AutoReplyFormData), a settings change one field (updates: Partial<AISettings>; aiSettingsSchema takes any subset), the switches { isActive } / { isEnabled }"],
  ["const missing = calls.filter((c) => c.startsWith('GET /api/calltracking') ? false : !routePaths.includes(c))", String.raw`const uCalls = Array.from(page.matchAll(/\bapi\(\s*[\x60']([^\x60']+)[\x60'](?:,\s*\{\s*method:\s*'(\w+)')?/g)).map((m) => (m[2] || 'GET') + ' /api/ai-receptionist' + m[1].replace(/\$\{[^}]+\}/g, ':x'))
  const missing = uCalls.filter((c) => !routePaths.includes(c))`, "the shared screen's api(path, { method }) prefixes /api/ai-receptionist (the call log goes through callApi, /api/calltracking/calls, read above)"],
  ["check('every AI-receptionist endpoint the screen calls exists on the router', calls.length >= 6 && missing.length === 0, { calls, missing })", "check('every AI-receptionist endpoint the screen calls exists on the router', uCalls.length >= 6 && missing.length === 0, { uCalls, missing })", 'the calls read in the api(path, { method }) form'],
  [String.raw`/case 'ai-receptionist': return <AiReceptionistPage \/>/.test(dash) && /import AiReceptionistPage from '\.\.\/pages\/AiReceptionistPage'/.test(dash))`, String.raw`/<Route path="ai-receptionist" element=\{<AIReceptionistPage \/>\} \/>/.test(dash) && /const AIReceptionistPage = named\(\(\) => import\('\.\/crm\/pages\/AIReceptionistPage'\), 'AIReceptionistPage'\)/.test(dash)
    && /\{ to: '\/crm\/ai-receptionist', icon: Bot, label: 'AI Receptionist', features: \['ai_receptionist'\], permission: 'ai-receptionist:read' \}/.test(shellNav) && !/SHARED_HIDDEN = \[[^\]]*'\/crm\/ai-receptionist'/.test(hcVertical))`, "/crm/ai-receptionist is the app's route (App.tsx) and the shared menu's item, which an agency keeps (not in SHARED_HIDDEN)"],
  [String.raw`check('the unmounted snake_case screen is gone, and nothing imports it', !/admin\/AIReceptionist'/.test(dash))`, String.raw`check('the unmounted snake_case screen is gone, and nothing imports it', !(await import('node:fs')).readdirSync(ROOT + 'web/src/crm/pages/homecare', { recursive: true }).some((f: any) => /receptionist/i.test(String(f))) )`, 'no home-care copy of the AI receptionist screen exists, and App.tsx mounts only the shared one'],
  // the second static block: the feature list, its writers, the gate and the menu
  ["const SRC = (process.env.FACTORY_ROOT || '') + 'templates/crm-homecare/'", "const SRC = (process.env.FACTORY_ROOT || '') + 'apps/unified/'", 'the server and the shell are the unified app’s'],
  ["const idx = readFileSync(SRC + 'backend/src/index.ts', 'utf8')", "const idx = readFileSync(SRC + 'server/modules/company.ts', 'utf8')", "the Factory's /api/internal/sync-features is server/modules/company.ts (syncFeatures)"],
  ["const syncAt = idx.indexOf(\"app.post('/api/internal/sync-features'\")", "const syncAt = idx.indexOf(\"const syncFeatures = new Hono().post('/'\")", 'the sync route is the syncFeatures router, mounted at /api/internal/sync-features'],
  [String.raw`const syncBody = idx.slice(syncAt, idx.indexOf('\n})', syncAt))`, String.raw`const syncBody = idx.slice(syncAt, idx.indexOf('\n  })', syncAt))`, 'the handler sits inside createCompanyModules (indented)'],
  [String.raw`/setAgencyFeatures\(/.test(syncBody) && !/currentSettings\.enabledFeatures\s*=/.test(syncBody), syncBody.slice(0, 300))`, String.raw`/await db\.update\(company\)\.set\(\{ enabledFeatures: body\.features, updatedAt: new Date\(\) \}\)/.test(syncBody) && /deps\.features\.forgetFeatures\(co\.id\)/.test(syncBody) && !/\bsettings\b/.test(syncBody), syncBody.slice(0, 300))`, 'the unified list is company.enabled_features alone (core/agencyFeatures.ts header): the sync writes that column, no settings blob, and drops the gate cache at once'],
  [String.raw`/timingSafeEqual\(/.test(syncBody))`, String.raw`/\{ path: '\/api\/internal\/sync-features', access: 'factory' as const, router: syncFeatures \}/.test(idx) && /crypto\.timingSafeEqual\(Buffer\.from\(got\), Buffer\.from\(key\)\)/.test(readFileSync(SRC + 'server/http/registry.ts', 'utf8')) && /if \(m\.access === 'factory'\) guards\.push\(factoryOnly\)/.test(readFileSync(SRC + 'server/http/registry.ts', 'utf8')))`, "the key is checked by the registry's factoryOnly guard for every access: 'factory' mount (server/http/registry.ts); its 401/503 are held by apps/unified/tests/company-modules.test.ts"],
  ["const comp = readFileSync(SRC + 'backend/src/routes/company.ts', 'utf8')", "const comp = readFileSync((process.env.FACTORY_ROOT || '') + 'packages/tenant-backend/src/company/company.ts', 'utf8')", "Settings › Features is the shared company router's PUT /features"],
  ["const bill = readFileSync(SRC + 'backend/src/services/billing.ts', 'utf8')", "const bill = readFileSync((process.env.FACTORY_ROOT || '') + 'packages/tenant-backend/src/billing.ts', 'utf8')", "plan & billing is the shared billing.ts (a mirror of the Factory's subscription)"],
  [String.raw`const strays = [['routes/company.ts', comp], ['services/billing.ts', bill], ['index.ts', idx]].filter(([, s]) => /\.set\(\{[^}]*enabledFeatures/.test(s as string))`, String.raw`const writes = (s: string) => (s.match(/\.set\(\{[^}]*enabledFeatures/g) || []).length
  const strays = [['company.ts PUT /features: one write, then onFeaturesChanged', writes(comp) === 1 && /\.set\(\{ enabledFeatures: next, updatedAt: new Date\(\) \}\)[\s\S]{0,300}deps\.onFeaturesChanged\?\.\(next\)/.test(comp)], ['modules/company.ts: the sync, and onFeaturesChanged drops the cache', writes(idx) === 1 && /onFeaturesChanged: \(features: string\[\]\) => \{ deps\.features\.forgetFeatures\(\);/.test(idx)], ['billing.ts: never', writes(bill) === 0]].filter(([, ok]) => !ok)`, "the unified writers of the one list (the column): the Factory's sync and Settings › Features, each followed by the gate's cache drop; the in-CRM billing writes none (plans change at the Factory, which syncs)"],
  ["check('billing.ts writes its tier features through setAgencyFeatures (4 places)', (bill.match(/setAgencyFeatures\\(/g) || []).length === 4)", String.raw`check('billing.ts writes its tier features through setAgencyFeatures (4 places)', !/enabledFeatures|setAgencyFeatures/.test(bill) && /restart-checkout/.test(bill))`, "the shared billing never sets features: a plan change is made at the Factory (portal-link / restart-checkout), and the Factory's sync-features writes the list"],
  ["const gateSrc = readFileSync(SRC + 'backend/src/middleware/enabledFeature.ts', 'utf8')", "const gateSrc = readFileSync(SRC + 'server/app.ts', 'utf8')", 'the gate is built in server/app.ts'],
  ["check('the gate reads both fields (readSettingsBlob: true)', /readSettingsBlob: true/.test(gateSrc))", String.raw`check('the gate reads both fields (readSettingsBlob: true)', /const features = createEnabledFeatureGate\(\{ db, tables: \{ company \} \}\)/.test(gateSrc) && !/readSettingsBlob/.test(gateSrc))`, 'the unified gate reads the column alone (readSettingsBlob off), the same list every writer writes'],
  ["const routeSrc = readFileSync(SRC + 'backend/src/routes/aiReceptionist.ts', 'utf8')", "const routeSrc = readFileSync(SRC + 'server/crm/comms/aiReceptionist.ts', 'utf8')", 'the router is server/crm/comms/aiReceptionist.ts'],
  ["const gateAt = routeSrc.indexOf(\"app.use('*', requireEnabledFeature('ai_receptionist'))\")", "const gateAt = routeSrc.indexOf(\"app.use('*', d.features.requireEnabledFeature('ai_receptionist'))\")", "the gate is the app's d.features.requireEnabledFeature"],
  ["const dash = readFileSync(SRC + 'frontend/src/components/AdminDashboard.tsx', 'utf8')", "const dash = readFileSync(SRC + 'web/src/shell.ts', 'utf8'), appShell = readFileSync((process.env.FACTORY_ROOT || '') + 'packages/tenant-ui/src/shell/AppShell.tsx', 'utf8')", "the menu is web/src/shell.ts, drawn and URL-gated by the shared AppShell"],
  [String.raw`/'ai-receptionist': 'ai_receptionist'/.test(dash))`, String.raw`/\{ to: '\/crm\/ai-receptionist', icon: Bot, label: 'AI Receptionist', features: \['ai_receptionist'\]/.test(dash))`, "a menu item's features list is its gate"],
  [String.raw`(dash.match(/\{navSections\.map\(/g) || []).length === 2 && !/\{NAV_SECTIONS\.map\(/.test(dash))`, String.raw`(appShell.match(/\{navItems\.map\(/g) || []).length === 1 && !/\{config\.nav\.map\(/.test(appShell) && /&& \(!i\.features \|\| i\.features\.some\(\(f\) => hasFeature\(f\)\)\),/.test(appShell))`, 'the shell draws one list (navItems, filtered by feature, permission and role), the same aside on a phone (the drawer) as on a desk'],
  [String.raw`check('search offers only allowed items', /itemAllowed\(item\.id\) && item\.label/.test(dash))`, String.raw`check('search offers only allowed items', /<GlobalSearch api=\{api\} placeholder=\{config\.searchPlaceholder\} \/>/.test(appShell))`, "the header search is /api/search (records, filtered on the server by the company's features: server/crm/comms/search.ts), never handed the menu, so it offers no page at all"],
  [String.raw`/if \(FEATURE_FOR_ITEM\[currentPage\] && !itemAllowed\(currentPage\)\)/.test(dash))`, String.raw`/const blocked = blockedRoute\(matches, hasFeature, alwaysOn\)/.test(appShell) && /\.\.\.config\.nav\.filter\(\(i\) => !i\.external\)\.map\(\(i\) => \(\{ to: i\.to, label: i\.label, features: i\.features \}\)\)/.test(appShell))`, "a typed /crm/ai-receptionist with the feature off is refused by the shell's route gate (AppShell gatedItem, from the menu's features); the page also shows ModuleNotEnabled on the server's FEATURE_NOT_ENABLED"],
  ["const ctx = readFileSync(SRC + 'frontend/src/contexts/AuthContext.tsx', 'utf8')", "const ctx = readFileSync((process.env.FACTORY_ROOT || '') + 'packages/tenant-ui/src/auth/AuthContext.tsx', 'utf8')", "the screens' hasFeature is the shared AuthContext's"],
  [String.raw`/company\?\.enabledFeatures\?\.includes\(featureId\)/.test(ctx) && /settings\.enabledFeatures\?\.includes\(featureId\)/.test(ctx))`, String.raw`/const hasFeature = \(featureId: string\): boolean => company\?\.enabledFeatures\?\.includes\(featureId\) \?\? false/.test(ctx) && !/settings\??\.enabledFeatures/.test(ctx) && !/readSettingsBlob/.test(gateSrc))`, "the same answer as the gate: both read company.enabled_features alone"],
]

const FIX_FE = 'the screens moved to apps/unified/web/src/crm/pages/homecare/ (people/, visits/, clients/)'
NEW['homecare/fixes.test.ts'] = [
  ["const src = (p: string) => readFileSync(ROOT + p, 'utf8').replace(/\\r\\n/g, '\\n')", "const src = (p: string) => readFileSync(ROOT + p, 'utf8').replace(/\\r\\n/g, '\\n')\nconst usrc = (p: string) => readFileSync((process.env.FACTORY_ROOT || '') + 'apps/unified/' + p, 'utf8').replace(/\\r\\n/g, '\\n')", 'usrc reads the unified app’s files (' + FIX_FE + ')'],
  ["const pp = src('frontend/src/components/admin/PayrollProcessing.tsx')", "const pp = usrc('web/src/crm/pages/homecare/people/PayrollProcessing.tsx')", 'Payroll is people/PayrollProcessing.tsx'],
  [String.raw`/a\?\.mileageRate \?\? a\?\.mileage_rate/.test(pp) && /JSON\.stringify\(\{ mileageRate: s \}\)/.test(pp) && /onClick=\{saveSettings\}/.test(pp))`, String.raw`/api\.get\('\/api\/company'\)/.test(pp) && /const n = Number\(a\?\.mileageRate\)/.test(pp) && /await api\.put\('\/api\/company', \{ mileageRate: s \}\)/.test(pp) && /onClick=\{saveSettings\}/.test(pp))`, "the screen reads GET /api/company's camelCase mileageRate (RULEBOOK §2; server/crm/homecare/office/companyFields.ts) and saves through the app's api client"],
  ["const modal = src('frontend/src/components/CaregiverClientModal.tsx')", "const modal = usrc('web/src/crm/pages/homecare/visits/CaregiverClientModal.tsx')", 'the card is visits/CaregiverClientModal.tsx (opened from visits/CaregiverDashboard.tsx)'],
  ["const m = src('frontend/src/components/admin/EditClientModal.tsx')", "const m = usrc('web/src/crm/pages/homecare/clients/EditClientModal.tsx')", 'Edit Client is clients/EditClientModal.tsx'],
  [String.raw`/medicalNotes: v\('medicalNotes', 'medical_notes'\)/.test(m) && /carePreferences: v\('carePreferences', 'care_preferences'\)/.test(m)`, String.raw`/medicalNotes: client\.medicalNotes \|\| ''/.test(m) && /carePreferences: client\.carePreferences \|\| ''/.test(m)`, "the client is read camelCase (RULEBOOK §2): the template's v() read either spelling"],
  [String.raw`/medicalNotes: text\('medical_notes'\)/.test(src('backend/db/schema.ts')) && /care_preferences/.test(src('backend/db/migrations/0023_fixes.sql'))`, String.raw`/medicalNotes: text\('medical_notes'\),\s*carePreferences: text\('care_preferences'\)/.test(usrc('server/db/schema/homecare.ts')) && /CREATE TABLE IF NOT EXISTS "clients" \([^;]*"medical_notes" text,\s*"care_preferences" text,/.test(usrc('server/db/migrations/0007_homecare.sql'))`, "the unified schema has both columns on clients (server/db/schema/homecare.ts), created by its home-care migration 0007_homecare; the template's 0023_fixes is not a unified migration"],
  ["&& ((es: any[]) => { const i = es.findIndex((e) => e.tag === '0023_fixes'); return i > 0 && `${es[i - 1].idx}:${es[i - 1].tag},${es[i].idx}:${es[i].tag}` === '21:0022_integration,22:0023_fixes' })(JSON.parse(src('backend/db/migrations/meta/_journal.json')).entries))", "&& JSON.parse(usrc('server/db/migrations/meta/_journal.json')).entries.some((e: any) => e.idx === 7 && e.tag === '0007_homecare'))", 'the unified journal lists 0007_homecare at idx 7'],
  ["const form = src('frontend/src/components/caregiver/ShiftMissReport.tsx')", "const form = usrc('web/src/crm/pages/homecare/visits/caregiver/ShiftMissReport.tsx')", 'the miss report is visits/caregiver/ShiftMissReport.tsx'],
  [String.raw`const idx = src('backend/src/index.ts')
  const at = idx.indexOf("app.use('/api/*', refuseViewAsWrites)")
  const firstRoute = idx.indexOf('app.route(')
  const firstApiHandler = idx.search(/app\.(get|post|put|patch|delete|all)\('\/api\//)
  check('6. src/index.ts mounts it on /api/* above every route', at > 0 && at < firstRoute && at < firstApiHandler, { at, firstRoute, firstApiHandler })`, String.raw`const appSrc = usrc('server/app.ts'), signIn = usrc('server/crm/homecare/office/signIn.ts')
  const wrap = signIn.slice(signIn.indexOf('export function withHomecareSessions('), signIn.indexOf('export function createStaffPickerRoutes('))
  const at = wrap.indexOf('await refuseViewAsWrites(c, '), realAt = wrap.indexOf('return real(c, ')
  check('6. src/index.ts mounts it on /api/* above every route', /const realAuth = vertical\.crm\?\.homecare \? withHomecareSessions\(sharedAuth, /.test(appSrc) && /const authenticate = deps\.testing\?\.authenticate \? deps\.testing\.authenticate\(realAuth\) : realAuth/.test(appSrc) && at > 0 && realAt > at, { at, realAt })`, "the unified app has no app-wide /api/* use: View As's refusal runs inside the app's one authenticate for a home-care tenant (withHomecareSessions, server/crm/homecare/office/signIn.ts, wired in server/app.ts), before the shared sign-in and so before every signed-in route; held behaviourally by apps/unified/tests/homecare-office.test.ts ('View As and signing out', 'View As in a cookie session')"],
]

NEW['homecare/evv.test.ts'] = [
  ["const ui = await import(`${process.env.FACTORY_ROOT}templates/crm-homecare/frontend/src/utils/sandata.ts`)", "const ui = await import(`${process.env.FACTORY_ROOT}apps/unified/web/src/crm/pages/homecare/lib/sandata.ts`)", "the caregiver app's Sandata rules are web/src/crm/pages/homecare/lib/sandata.ts (used by visits/CaregiverDashboard.tsx, visits/caregiver/SandataEvv.tsx, office/SandataPanel.tsx)"],
  ["const evvClient = { id: 'c', in_sandata: true, medicaid_id: '1421146410' }", "const evvClient = { id: 'c', inSandata: true, medicaidId: '1421146410' }", "the client is GET /api/sandata/caregiver-context's camelCase row (inSandata, medicaidId: server/crm/homecare/visits/sandata.ts), which lib/sandata.ts reads"],
  ["!ui.needsSandata({ id: 'x', in_sandata: false })", "!ui.needsSandata({ id: 'x', inSandata: false })", 'camelCase client'],
  ["ui.visitNeedsSandata({ id: 'x', in_sandata: false }, true)", "ui.visitNeedsSandata({ id: 'x', inSandata: false }, true)", 'camelCase client'],
  ["ui.medicaidIdOf({ id: 'c', medicaid_id: ' 1421146410 ' })", "ui.medicaidIdOf({ id: 'c', medicaidId: ' 1421146410 ' })", 'camelCase client'],
  ["ui.medicaidIdOf({ id: 'c', medicaid_id: '1197148' })", "ui.medicaidIdOf({ id: 'c', medicaidId: '1197148' })", 'camelCase client'],
  ["ui.medicaidIdOf({ id: 'c', in_sandata: true })", "ui.medicaidIdOf({ id: 'c', inSandata: true })", 'camelCase client'],
]

NEW['homecare/incidents.test.ts'] = [
  ["const root = process.env.FACTORY_ROOT + 'templates/crm-homecare/'", "const root = process.env.FACTORY_ROOT + 'apps/unified/'", 'the incident code moved to apps/unified (server/crm/homecare/{office,core}, server/data/homecareIncidents.ts, web/src/crm/pages/homecare/{office,visits/caregiver,lib})'],
  ["'backend/src/routes/incidents.ts', 'backend/src/services/incidentPdf.ts', 'backend/src/services/scheduleOccurrences.ts', 'backend/src/config/incidentOptions.ts',", "'server/crm/homecare/office/incidents.ts', 'server/crm/homecare/core/incidentPdf.ts', 'server/crm/homecare/core/scheduleOccurrences.ts', 'server/crm/homecare/core/incidentOptions.ts', 'server/data/homecareIncidents.ts',", "the routes, the packet, the schedule engine, the options, and the incidents' raw SQL (server/data/homecareIncidents.ts)"],
  ["...readdirSync(root + 'frontend/src/components/admin').filter((f) => /^Incident/.test(f)).map((f) => `frontend/src/components/admin/${f}`),", "...readdirSync(root + 'web/src/crm/pages/homecare/office').filter((f) => /^Incident/.test(f)).map((f) => `web/src/crm/pages/homecare/office/${f}`),", 'the incident screens are office/Incident*.tsx'],
  ["'frontend/src/components/caregiver/IncidentReportForm.tsx', 'frontend/src/utils/incidentOptions.ts',", "'web/src/crm/pages/homecare/visits/caregiver/IncidentReportForm.tsx', 'web/src/crm/pages/homecare/lib/incidentOptions.ts',", "the caregiver's field report and the screens' option helpers"],
]
for (const [k, v] of Object.entries(NEW)) ADAPT[k].push(...v)

// Home care's screen and server reads in integration, r3pay, write-gates and popup-forms, pointed at the unified app's
// files (2026-10-19), added after each file's own entries.
const UFE_WHY = "the screens moved to apps/unified/web/src/crm/pages/homecare/<group>/ and the server to apps/unified/server/crm/homecare/<group>/ and server/data/homecare*.ts (docs/UNIFIED_HOMECARE_SCREENS.md): usrc reads the moved files, so these checks hold the code that ships"
const USRC: [string, string, string] = [String.raw`const src = (p: string) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n')`,
  String.raw`const src = (p: string) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n')
const UNI = (process.env.FACTORY_ROOT || '') + 'apps/unified/'
const usrc = (p: string) => readFileSync(UNI + p, 'utf8').replace(/\r\n/g, '\n')`, UFE_WHY]

const PROPOSED: Record<string, [string, string, string][]> = {
  'homecare/integration.test.ts': [
    USRC,
    ["const tt = src('backend/src/routes/timeTracking.ts')", "const tt = usrc('server/crm/homecare/visits/timeTracking.ts')", 'the punch router is server/crm/homecare/visits/timeTracking.ts'],
    [String.raw`/function onVisitClosed[\s\S]{0,200}createEVVFromTimeEntry\(/.test(tt)`, String.raw`/const onVisitClosed = [\s\S]{0,200}createEVVFromTimeEntry\(/.test(tt)`, 'onVisitClosed is a const inside createTimeTrackingRoutes, calling core.evvVisits.createEVVFromTimeEntry'],
    [String.raw`/\/api\/time-entries\/\$\{[^}]+\}\/admin-force-clockout/.test(src('frontend/src/components/admin/LiveBoard.tsx'))`, String.raw`/\/api\/time-entries\/\$\{[^}]+\}\/admin-force-clockout/.test(usrc('web/src/crm/pages/homecare/shifts/LiveBoard.tsx'))`, 'the Live Board is shifts/LiveBoard.tsx'],
    [String.raw`/app\.route\('\/api\/time-entries', timeTrackingRoutes\)/.test(src('backend/src/index.ts'))`, String.raw`/\{ path: '\/api\/time-entries', access: 'user', router: createTimeTrackingRoutes\(core, d\) \}/.test(usrc('server/crm/homecare/visits/index.ts'))`, "the mount is the visits group's (server/crm/homecare/visits/index.ts visitsMounts)"],
    [String.raw`/\/api\/family-portal\/portal\/vitals/.test(src('frontend/src/components/portal/FamilyPortal.tsx'))`, String.raw`/\/api\/family-portal\/portal\/vitals/.test(usrc('web/src/crm/pages/homecare/portals/FamilyPortal.tsx'))`, 'the family portal is portals/FamilyPortal.tsx'],
    [String.raw`/canViewMedications\) tabs\.push\(\{ key: 'vitals'/.test(src('frontend/src/components/portal/FamilyPortal.tsx'))`, String.raw`/canViewMedications\) tabs\.push\(\{ key: 'vitals'/.test(usrc('web/src/crm/pages/homecare/portals/FamilyPortal.tsx'))`, 'the family portal is portals/FamilyPortal.tsx'],
    ["const rep = src('backend/src/routes/reports.ts')", "const rep = usrc('server/data/homecarePlanning.ts')", "the reports' SQL is server/data/homecarePlanning.ts"],
    [String.raw`(rep.match(/\$\{clmIn\}|AND \$\{clmIn\}/g) || []).length`, String.raw`(rep.match(/\$\{claimsIn\(/g) || []).length`, 'the guarded claims filter is the function claimsIn(companyId, start, end, clientId), not the template\'s clmIn fragment'],
    ["for (const f of ['backend/src/services/invoiceEngine.ts', 'backend/src/routes/billing.ts', 'backend/src/services/portalClaimDays.ts']) {", "for (const f of ['server/crm/homecare/core/invoiceEngine.ts', 'server/crm/homecare/billing/invoices.ts', 'server/crm/homecare/core/portalClaimDays.ts', 'server/data/homecareBilling.ts', 'server/data/homecareBillingRoutes.ts']) {", "the invoice engine, the billing routes (billing/invoices.ts), portal claim days and their SQL (server/data/homecareBilling.ts, homecareBillingRoutes.ts)"],
    ["const s = src(f)", "const s = usrc(f)", 'read from the unified server'],
    ["const screen = src('frontend/src/components/admin/VisitDocumentation.tsx')", "const screen = usrc('web/src/crm/pages/homecare/visits/VisitDocumentation.tsx')", 'Visit Documentation is visits/VisitDocumentation.tsx'],
    [String.raw`/visitDate: v\.visit_date, startTime: v\.start_time, caregiverId: v\.caregiver_id/.test(screen)`, String.raw`/visitDate: v\.visitDate, startTime: v\.startTime, caregiverId: v\.caregiverId/.test(screen)`, "the screen's visits are the camelCase reply (RULEBOOK §2): it sends the same three keys from v.visitDate, v.startTime, v.caregiverId"],
    ["src('frontend/src/components/ImpersonationModal.tsx')", "usrc('web/src/crm/pages/homecare/office/ImpersonationModal.tsx')", 'the View As picker is office/ImpersonationModal.tsx'],
    [String.raw`/AuthContext\.Provider value=\{\{[\s\S]{0,200}token: impersonationToken/.test(src('frontend/src/App.tsx'))`, String.raw`/api\.post\(\x60\/api\/auth\/impersonate\/\$\{userId\}\x60, \{\}\);\s*onStaff\(data\.user\)/.test(usrc('web/src/crm/pages/homecare/office/ImpersonationModal.tsx')) && /onStaff=\{\(\) => reloadAsSession\(\)\}/.test(usrc('web/src/crm/pages/homecare/office/ViewAsPanel.tsx')) && /export const reloadAsSession = \(\) => window\.location\.assign\('\/crm\/dashboard'\)/.test(usrc('web/src/crm/pages/homecare/office/ViewAs.tsx'))`, "the session is the server's cookies: POST /api/auth/impersonate sets the httpOnly View As cookie and the page loads afresh as that person (office/ViewAs.tsx reloadAsSession); no script holds the token. The server half (/me is the viewed person, writes refused) is apps/unified/tests/homecare-office.test.ts"],
    ["const dash = src('frontend/src/components/CaregiverDashboard.tsx')", "const dash = usrc('web/src/crm/pages/homecare/visits/CaregiverDashboard.tsx')", "the caregiver's app is visits/CaregiverDashboard.tsx"],
    ["src('frontend/src/components/caregiver/ShiftMissReport.tsx')", "usrc('web/src/crm/pages/homecare/visits/caregiver/ShiftMissReport.tsx')", 'the miss-report form is visits/caregiver/ShiftMissReport.tsx'],
    ["const modal = src('frontend/src/components/admin/EditClientModal.tsx')", "const modal = usrc('web/src/crm/pages/homecare/clients/EditClientModal.tsx')", 'Edit Client is clients/EditClientModal.tsx'],
    [String.raw`/v\('firstName', 'first_name'\)/.test(modal) && /v\('careTypeId', 'care_type_id'\)/.test(modal) && /v\('isPrivatePay', 'is_private_pay'\)/.test(modal)`, String.raw`/firstName: client\.firstName \|\| ''/.test(modal) && /careTypeId: client\.careTypeId \|\| ''/.test(modal) && /isPrivatePay: !!client\.isPrivatePay/.test(modal) && !/client\.(first_name|care_type_id|is_private_pay)\b/.test(modal)`, 'every reply is camelCase (RULEBOOK §2), so the modal reads the camelCase client directly; no snake_case fallback is needed or left'],
    ["const be = ROOT + 'backend/src/'", "const be = UNI + 'server/'", "the server is apps/unified/server"],
    ["!existsSync(be + gone))", String.raw`!readdirSync(be, { recursive: true } as any).map((p: any) => String(p).replace(/\\/g, '/')).some((p: string) => p.endsWith('/' + gone.split('/').pop()) && p !== 'crm/homecare/core/agencyTime.ts'))`, "no file of that name anywhere in the unified server (the shared agency clock is crm/homecare/core/agencyTime.ts)"],
    ["JSON.stringify(expanders) === JSON.stringify(['/services/scheduleOccurrences.ts'])", "JSON.stringify(expanders) === JSON.stringify(['/data/homecareCore.ts'])", "the one schedule engine is SQL in server/data/homecareCore.ts (occurrencesCte)"],
    [String.raw`!/evv_timezone/.test(src('backend/db/schema.ts')) && !/evv_timezone/.test(src('backend/db/migrations/0014_evv.sql'))`, String.raw`!readdirSync(UNI + 'server/db', { recursive: true } as any).map((p: any) => String(p)).filter((p: string) => /\.(ts|sql)$/.test(p)).some((p: string) => /evv_timezone|evvTimezone/.test(readFileSync(UNI + 'server/db/' + p, 'utf8')))`, 'the unified schema and migrations are apps/unified/server/db (schema/, migrations/)'],
  ],
  'homecare/r3pay.test.ts': [
    USRC,
    ["const screen = src('frontend/src/components/admin/PayrollProcessing.tsx')", "const screen = usrc('web/src/crm/pages/homecare/people/PayrollProcessing.tsx')", 'Payroll is people/PayrollProcessing.tsx'],
    [String.raw`!/\.(caregiver|client)_(first|last)\b(?!_name)/.test(screen) && /caregiver_first_name \?\? s\.caregiverFirstName/.test(screen)`, String.raw`!/\.(caregiver|client)(_first|_last|First|Last)\b/.test(screen) && /personName\(s\.caregiverFirstName, s\.caregiverLastName\)/.test(screen) && /personName\(s\.clientFirstName, s\.clientLastName\)/.test(screen)`, "the reply is camelCase (RULEBOOK §2): the screen reads caregiverFirstName / clientFirstName … (cgName / clName), with no snake_case fallback"],
    ["const ui = src('frontend/src/components/admin/ReportsAnalytics.tsx')", "const ui = usrc('web/src/crm/pages/homecare/office/ReportsAnalytics.tsx')", 'the reports screen is office/ReportsAnalytics.tsx'],
    ["const sa = src('frontend/src/components/admin/ShiftApprovals.tsx')", "const sa = usrc('web/src/crm/pages/homecare/shifts/ShiftApprovals.tsx')", 'Shift Approvals is shifts/ShiftApprovals.tsx'],
    ["const board = src('frontend/src/components/admin/LiveBoard.tsx')", "const board = usrc('web/src/crm/pages/homecare/shifts/LiveBoard.tsx')", 'the Live Board is shifts/LiveBoard.tsx'],
    [String.raw`/Clocked: \{fmtDuration\(shift\.duration_minutes\)\}/.test(board) && !/\(shift\.duration_minutes \/ 60\)\.toFixed\(1\)/.test(board)`, String.raw`/Clocked: \{fmtDuration\(shift\.durationMinutes\)\}/.test(board) && !/\/ 60\)\.toFixed\(1\)/.test(board)`, "the board's rows are camelCase (durationMinutes)"],
    ["const cw = src('frontend/src/components/admin/ClientWeekHours.tsx')", "const cw = usrc('web/src/crm/pages/homecare/shifts/ClientWeekHours.tsx')", 'Client Hours by Week is shifts/ClientWeekHours.tsx'],
    [String.raw`/useState\(''\)/.test(cw)`, String.raw`/const \[weekStart, setWeekStart\] = useState\(''\)/.test(cw) && /weekStart: weekStart \|\| undefined/.test(cw)`, 'the week itself starts empty and the first load sends no weekStart'],
    ["const pp = src('frontend/src/components/admin/PayrollProcessing.tsx')", "const pp = usrc('web/src/crm/pages/homecare/people/PayrollProcessing.tsx')", 'Payroll is people/PayrollProcessing.tsx'],
    [String.raw`/\n      <\/div>\n      \)\}\n\n      \{\/\* The pop-ups sit OUTSIDE/.test(pp)`, String.raw`/\n( *)  <\/div>\n\1\)\}\n\n\1\{\/\* The pop-ups sit OUTSIDE/.test(pp)`, "the moved screen nests the tab two spaces deeper: the tab's block closes (its div, then its )}) right before the pop-ups, at whatever depth"],
    ["const files = [...walk(ROOT + 'frontend/src/components/'), ...walk(ROOT + 'frontend/src/pages/')]", String.raw`const files = walk((process.env.FACTORY_ROOT || '') + 'apps/unified/web/src/crm/pages/homecare/')
  const SIDEBAR_Z = Number(/<aside\s+className=\{\x60fixed inset-y-0 left-0 z-(\d+) /.exec(readFileSync((process.env.FACTORY_ROOT || '') + 'packages/tenant-ui/src/shell/AppShell.tsx', 'utf8'))?.[1])`, "every home-care screen is under apps/unified/web/src/crm/pages/homecare/; the sidebar is the app shell's (packages/tenant-ui/src/shell/AppShell.tsx, fixed, z-50), not the template's z-index 1000"],
    ["if (z && Number(z[1]) < 1000) under.push(", "if (z && Number(z[1]) <= SIDEBAR_Z) under.push(", "an overlay must sit above the shell's sidebar"],
    ["if (Number(m[1]) < 1000) under.push(", "if (Number(m[1]) <= SIDEBAR_Z) under.push(", "an overlay must sit above the shell's sidebar"],
    ["check(`no office pop-up sits under the sidebar (z-index 1000): ${files.length} screens, every full-screen overlay ≥ 1000`, under.length === 0 && files.length > 50, under)", "check(`no office pop-up sits under the sidebar (z-index ${SIDEBAR_Z}): ${files.length} screens, every full-screen overlay above it`, Number.isFinite(SIDEBAR_Z) && under.length === 0 && files.length > 50, under)", "the threshold is the shell sidebar's z-index, read from AppShell.tsx (a failed read fails the check)"],
    ["const vdui = src('frontend/src/components/admin/VisitDocumentation.tsx')", "const vdui = usrc('web/src/crm/pages/homecare/visits/VisitDocumentation.tsx')", 'Visit Documentation is visits/VisitDocumentation.tsx'],
    [String.raw`!vdui.includes('{c.last_name}, {c.first_name}') && vdui.includes("plural(data.visits.length, 'visit')")`, String.raw`!vdui.includes('{c.lastName}, {c.firstName}') && /<option key=\{c\.id\} value=\{c\.id\}>\{fullName\(c\)\}<\/option>/.test(vdui) && /const fullName = \([^)]*\) => \[c\?\.firstName, c\?\.lastName\]/.test(vdui) && vdui.includes("plural(visits.length, 'visit')") && vdui.includes('const visits = data?.visits || []')`, "camelCase rows: the picker prints fullName(c) (first then last); the count is plural(visits.length) where visits is data?.visits"],
    ["const hire = src('frontend/src/components/admin/ApplicationsDashboard.tsx')", "const hire = usrc('web/src/crm/pages/homecare/people/ApplicationsDashboard.tsx')", 'Applications is people/ApplicationsDashboard.tsx'],
    [String.raw`!/\{hireModal\.years_experience &&/.test(hire) && /Number\(hireModal\.years_experience\) > 0/.test(hire)`, String.raw`!/\{(hireModal|app)\.yearsExperience &&/.test(hire) && /Number\(hireModal\.yearsExperience\) > 0/.test(hire)`, 'the application row is camelCase (yearsExperience)'],
  ],
  'homecare/write-gates.test.ts': [
    ["templates/crm-homecare/frontend/src/components/CaregiverDashboard.tsx', 'utf8')", "apps/unified/web/src/crm/pages/homecare/visits/CaregiverDashboard.tsx', 'utf8')", "the caregiver's app is visits/CaregiverDashboard.tsx"],
    ["fe.indexOf('const handlePageClick'))", "fe.indexOf('const goTo = '))", 'the handler after it in the moved screen is goTo (there is no handlePageClick)'],
    ["fn.includes('fetch(`${API_BASE_URL}/api/pto`') && !fn.includes('fetch(`${API_BASE_URL}/api/absences'), fn.slice(0, 300))", "fe.indexOf('const handleRequestTimeOff') > 0 && fe.indexOf('const goTo = ') > fe.indexOf('const handleRequestTimeOff') && fn.includes(\"api.post('/api/pto', { type: 'pto', startDate: newTimeOff.startDate, endDate: newTimeOff.endDate\") && !fn.includes('/api/absences'), fn.slice(0, 300))", "the screen calls the app's api client (no token, no fetch): a time-off request with its dates to /api/pto, never /api/absences"],
  ],
  'homecare/popup-forms.test.ts': [
    ["templates/crm-homecare/frontend/src/components/admin/PayersServiceCodes.tsx`, 'utf8')", "apps/unified/web/src/crm/pages/homecare/billing/PayersServiceCodes.tsx`, 'utf8')", 'Payers & Service Codes is billing/PayersServiceCodes.tsx'],
    [String.raw`/const EMPTY_PAYER = \{([\s\S]*?)\};/`, String.raw`/const EMPTY_PAYER = \{([\s\S]*?)\n\}/`, 'the moved file has no semicolons: the object ends at the } at the start of a line'],
    [String.raw`/const PAYER_TYPE_OPTIONS = \[([\s\S]*?)\];/`, String.raw`/const PAYER_TYPE_OPTIONS = \[([\s\S]*?)\n\]/`, 'no semicolons: the list ends at the ] at the start of a line'],
  ],
}
for (const [k, v] of Object.entries(PROPOSED)) ADAPT[k].push(...v)
ADAPT['homecare/r3pay.test.ts'].push(
  // Plain strings, not String.raw: a ${…} in a template literal would be evaluated here.
  ["/method: 'PUT'[\\s\\S]{0,200}startDate: payPeriod\\.startDate/.test(screen) && screen.includes('/api/payroll/${payroll.recordId}/process'))",
    "/api\\.put\\(`\\/api\\/payroll\\/\\$\\{caregiverId\\}\\/approve`, \\{ startDate: payPeriod\\.startDate, endDate: payPeriod\\.endDate \\}\\)/.test(screen) && screen.includes('api.post(`/api/payroll/${payroll.recordId}/process`)'))",
    "the moved screen calls through the app's api client: Approve is api.put(…/approve, { startDate, endDate }) (approveOne), Process is api.post(…/${recordId}/process)"],
)

// r4-care's screen reads, pointed at the moved files (2026-10-19).
const R4_FE = "the screens moved to apps/unified/web/src/crm/pages/homecare/ (clients/, schedule/, shifts/, visits/, billing/, portals/, lib/; docs/UNIFIED_HOMECARE_SCREENS.md) and the payment engine to server/crm/homecare/core/invoiceEngine.ts: each template path the file names reads its moved file"
ADAPT['homecare/r4-care.test.ts'].push(...([
  [String.raw`const src = (p: string) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n')`,
    String.raw`const UFE = (process.env.FACTORY_ROOT || '') + 'apps/unified/web/src/crm/pages/homecare/'
const MOVED: Record<string, string> = {
  'frontend/src/components/admin/CarePlans.tsx': UFE + 'clients/CarePlans.tsx',
  'frontend/src/components/admin/CareTasksManager.tsx': UFE + 'clients/CareTasksManager.tsx',
  'frontend/src/components/admin/EditClientModal.tsx': UFE + 'clients/EditClientModal.tsx',
  'frontend/src/components/admin/SchedulingHub.tsx': UFE + 'schedule/SchedulingHub.tsx',
  'frontend/src/components/admin/ClientWeekHours.tsx': UFE + 'shifts/ClientWeekHours.tsx',
  'frontend/src/components/admin/PortalClaimDays.tsx': UFE + 'billing/PortalClaimDays.tsx',
  'frontend/src/components/admin/BillingDashboard.tsx': UFE + 'billing/BillingDashboard.tsx',
  'frontend/src/components/admin/BillingEngine.tsx': UFE + 'billing/BillingEngine.tsx',
  'frontend/src/components/admin/FamilyPortalAdmin.tsx': UFE + 'portals/FamilyPortalAdmin.tsx',
  'frontend/src/components/portal/FamilyPortal.tsx': UFE + 'portals/FamilyPortal.tsx',
  'frontend/src/components/portal/ClientPortal.tsx': UFE + 'portals/ClientPortal.tsx',
  'frontend/src/components/portal/PortalHistory.tsx': UFE + 'portals/PortalHistory.tsx',
  'frontend/src/components/portal/PortalDocuments.tsx': UFE + 'portals/PortalDocuments.tsx',
  'frontend/src/components/portal/PortalMessages.tsx': UFE + 'portals/PortalMessages.tsx',
  'frontend/src/components/portal/PortalNotifications.tsx': UFE + 'portals/PortalNotifications.tsx',
  'frontend/src/components/CaregiverClientModal.tsx': UFE + 'visits/CaregiverClientModal.tsx',
  'backend/src/services/invoiceEngine.ts': (process.env.FACTORY_ROOT || '') + 'apps/unified/server/crm/homecare/core/invoiceEngine.ts',
}
const src = (p: string) => { if (!MOVED[p]) throw new Error('r4-care: no unified home named for ' + p); return readFileSync(MOVED[p], 'utf8').replace(/\r\n/g, '\n') }`,
    R4_FE],
  [String.raw`/const isActivePlan = \(plan: any\) => plan\.is_active === true \|\| plan\.isActive === true;/.test(cp) && !/String\(plan\.start_date\)\.slice\(0, 10\) <= t\) && \(!plan\.end_date/.test(cp))`,
    String.raw`/const isActivePlan = \(plan: CarePlan\) => plan\.isActive === true\n/.test(cp) && !/String\(plan\.startDate\)\.slice\(0, 10\) <= t\) && \(!plan\.endDate/.test(cp))`,
    "the reply is camelCase (RULEBOOK §2): the screen reads only the server's isActive (clients/CarePlans.tsx isActivePlan, the whole line), and never re-derives it from startDate/endDate"],
  [String.raw`/title: 'Approve shift swap', confirmLabel: 'Approve swap'/.test(hub)`,
    String.raw`/title: 'Approve shift swap', confirmText: 'Approve swap', danger: false/.test(hub)`,
    "the pop-up is the app's useConfirm (schedule/SchedulingHub.tsx approveSwap): its button text is confirmText, and danger: false keeps it from being the red destructive button"],
  ["/await api\\(`\\/api\\/shift-swaps\\/\\$\\{sw\\.id\\}\\/approve`, \\{ method: 'PUT' \\}\\); showMsg\\(`Swap approved/.test(hub))",
    "/await api\\.put\\(`\\/api\\/shift-swaps\\/\\$\\{sw\\.id\\}\\/approve`\\); showMsg\\(`Swap approved/.test(hub))",
    "the screen calls the route through the app's client, api.put(path) (lib/http.ts), not the template's api(path, { method: 'PUT' })"],
  ["const modal = fpa.slice(fpa.indexOf('{/* Edit Family Member Modal */}'), fpa.indexOf('{/* Add Family Member Modal */}'))",
    "const modal = fpa.slice(fpa.indexOf('{editingMember && ('), fpa.indexOf('{showAddModal && ('))",
    "the unified screen marks its pop-ups by their state, not by comments: the Edit pop-up is the {editingMember && (…)} block, which ends where the Add pop-up's {showAddModal && (…)} begins (portals/FamilyPortalAdmin.tsx)"],
  ["const form = fpa.slice(fpa.indexOf('const EditMemberForm'), fpa.indexOf('// Reply Form Component'))",
    "const form = fpa.slice(fpa.indexOf('function EditMemberForm'), fpa.indexOf('function ReplyForm'))",
    "the form components are function declarations in the unified screen (function EditMemberForm … function ReplyForm)"],
  [String.raw`/isPrimaryContact: flag\('isPrimaryContact', 'is_primary_contact'\)/.test(form)`,
    "/isPrimaryContact: !!member\\.isPrimaryContact/.test(form) && ['canViewSchedule', 'canViewCarePlan', 'canViewMedications', 'canMessage'].every((k) => form.includes(`${k}: !!member.${k}`)) && /await api\\.put\\(`\\/api\\/family-portal\\/admin\\/members\\/\\$\\{memberId\\}`, patch\\)/.test(fpa)",
    "the member row is camelCase (RULEBOOK §2), so the form starts from member.isPrimaryContact and each switch from member.<key> (no snake_case fallback to pick), and Save PUTs that whole patch (updateMember)"],
  [String.raw`/setAgencyTimezone\(data\.agency_timezone\)/.test(cp)`,
    String.raw`/setAgencyTimezone\(data\.agencyTimezone\)/.test(cp)`,
    "GET /api/portal/me answers camelCase agencyTimezone (portals/ClientPortal.tsx)"],
  ["const clock = await import(ROOT + 'frontend/src/utils/agencyClock.ts')",
    "const clock = await import(UFE + 'lib/agencyClock.ts')",
    'the agency clock is lib/agencyClock.ts'],
  [String.raw`/client\.medications_source === 'client_record'/.test(modal)`,
    String.raw`/client\.medicationsSource === 'client_record'/.test(modal)`,
    "the caregiver view is camelCase: medicationsSource (visits/CaregiverClientModal.tsx)"],
  [String.raw`/"EVV \(Sandata\) units per week" is blank for \{c\.client_name\}/.test(pcd)`,
    String.raw`/"EVV \(Sandata\) units per week" is blank for \{c\.clientName\}/.test(pcd)`,
    'the claim-days rows are camelCase: clientName'],
  [String.raw`/<EvvWeeklyUnits clientId=\{evvFor\.client_id\}/.test(pcd)`,
    String.raw`/<EvvWeeklyUnits clientId=\{evvFor\.clientId\}/.test(pcd)`,
    'the claim-days rows are camelCase: clientId'],
  ["/const \\[weekStart, setWeekStart\\] = useState\\(''\\);/.test(pcd) && /const qs = weekStart \\? `&weekStart=\\$\\{weekStart\\}` : '';/.test(pcd)",
    "/const \\[weekStart, setWeekStart\\] = useState\\(''\\)\\n/.test(pcd) && /api\\.get\\('\\/api\\/billing\\/portal-claim-days', \\{ payerId, weekStart: weekStart \\|\\| undefined \\}\\)/.test(pcd)",
    "the screen asks through api.get(path, params), which drops an undefined param (packages/tenant-ui/src/api/client.ts get): the first load sends no weekStart"],
  ["/const qs = weekStart \\? `\\?weekStart=\\$\\{weekStart\\}` : '';/.test(cwh) && /if \\(!weekStart && body\\.weekStart\\) \\{ adopted\\.current = body\\.weekStart; setWeekStart\\(body\\.weekStart\\); \\}/.test(cwh)",
    "/api\\.get\\('\\/api\\/reports\\/client-week', \\{ weekStart: weekStart \\|\\| undefined \\}\\)/.test(cwh) && /if \\(!weekStart && body\\?\\.weekStart\\) \\{ adopted\\.current = body\\.weekStart; setWeekStart\\(body\\.weekStart\\) \\}/.test(cwh)",
    'the screen asks through api.get(path, params), which drops an undefined weekStart, and adopts the week the server answers (shifts/ClientWeekHours.tsx load)'],
  [String.raw`/const mins = \(t: any\) => Number\(t\.minutes_per_week\) \|\| 0;/.test(cp) && /sum \+ \(Number\(t\.minutes_per_week\) \|\| 0\)/.test(ctm)`,
    String.raw`/const mins = \(t: CareTask\) => Number\(t\.minutesPerWeek\) \|\| 0/.test(cp) && /sum \+ \(Number\(t\.minutesPerWeek\) \|\| 0\)/.test(ctm)`,
    "the task rows are camelCase: minutesPerWeek (clients/CarePlans.tsx, clients/CareTasksManager.tsx)"],
  [String.raw`!/\(t\.weekly_frequency \|\| 1\) \* \(t\.allotted_minutes \|\| 0\)/.test(cp + ctm))`,
    String.raw`!/\(t\.weeklyFrequency \|\| 1\) \* \(t\.allottedMinutes \|\| 0\)/.test(cp + ctm))`,
    "the old re-count looked for in the camelCase spelling the screens use (the assessment-import preview's parseInt(String(t.weeklyFrequency)) × parseInt(String(t.allottedMinutes)) is the import's own count, as in the template)"],
  [String.raw`!/allowOverpayment|overpay/i.test(bd))`,
    String.raw`!/allowOverpayment|overpay/i.test(bd + src('frontend/src/components/admin/BillingEngine.tsx')))`,
    "both unified screens with a Record Payment form (billing/BillingDashboard.tsx and billing/BillingEngine.tsx) are looked at"],
] as [string, string, string][]))

for (const [key, changes] of Object.entries(ADAPT)) {
  const [suite, file] = key.split('/')
  const OUT = ROOT + 'tests/unified/' + suite + '/'
  mkdirSync(OUT, { recursive: true })
  // Line endings normalised on both sides: git stores the suite files with LF and a Windows checkout writes CRLF, so an
  // entry spanning two lines matched on one checkout only.
  let s = readFileSync(ROOT + 'tests/' + suite + '/' + file, 'utf8').replace(/\r\n/g, '\n')
  for (const [rawFrom, to, why] of changes) {
    const from = rawFrom.replace(/\r\n/g, '\n')
    const n = s.split(from).length - 1
    if (n !== 1) throw new Error(`${file}: expected the pattern once, found ${n}: ${from}`)
    // A function, so a "$" in the new text is never read as a replacement pattern.
    s = s.replace(from, () => `${to.replace(/\r\n/g, '\n')} /* unified: ${why} */`)
  }
  const header = `// ADAPTED COPY of tests/${suite}/${file}, for the unified app (tests/unified/harness/adapted.ts). Unchanged except the\n// ${changes.length} read(s) marked "unified:", where the rulebook's reply shapes replaced the template's. The original keeps\n// running against the template; tests/unified/harness/unified-divergences.ts names the assertions this copy stands in for.\n`
  writeFileSync(OUT + file, header + s)
  console.log(key, changes.length)
}
