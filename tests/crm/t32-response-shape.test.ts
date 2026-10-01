// T32 L7 — "snake_case keys and naive timestamps from takeoffs, selections, assemblies, recurring".
//
// Filed as a LOW, which undersells half of it. The modules that reach for raw SQL instead of
// Drizzle's query builder answer in Postgres's snake_case while every screen in this product reads
// camelCase — so the fields are not merely inconsistent, they are UNDEFINED on the page:
//
//   SelectionsPage reads  sel.dueDate, sel.priceDifference, sel.selectedOption.name
//   the API answered      due_date,    price_difference,    selected_option.name
//
// The selections screen therefore showed no due date, no chosen product and no upgrade cost, over
// arithmetic that was correct underneath. That is the same fault as T32 B5 (a BLOCKER) in takeoffs,
// in a module that had never had the fix applied.
//
// So this suite asserts the SHAPE of what these endpoints answer, which is the thing a refactor of
// the row reader can silently break and no other test here looks at.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, project } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'Shape Co', slug: 'shape-co', email: 's@test.local', state: 'OH', settings: { timezone: 'UTC' },
  enabledFeatures: ['selections', 'takeoffs', 'projects', 'change_orders', 'tasks', 'recurring_jobs', 'invoices'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner@shape.local', passwordHash: 'x', firstName: 'Ines', lastName: 'Shape',
  role: 'owner', companyId: co.id, isActive: true,
} as any).returning()
const [client] = await db.insert(contact).values({ companyId: co.id, name: 'Shape Client', type: 'client' } as any).returning()
const [proj] = await db.insert(project).values({
  companyId: co.id, contactId: client.id, name: 'Shape Build', number: 'PRJ-S1', status: 'active',
} as any).returning()

const app = new Hono()
app.route('/api/selections', (await import('./src/routes/selections.ts')).default)
app.route('/api/takeoffs', (await import('./src/routes/takeoffs.ts')).default)
app.route('/api/change-orders', (await import('./src/routes/changeOrders.ts')).default)
app.route('/api/recurring', (await import('./src/routes/recurring.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}

/** Every key anywhere in a payload that still has an underscore in it. */
const snakeKeys = (v: any, path = '', out: string[] = []): string[] => {
  if (Array.isArray(v)) { v.forEach((x, i) => snakeKeys(x, `${path}[${i}]`, out)); return out }
  if (!v || typeof v !== 'object' || v instanceof Date) return out
  for (const [k, val] of Object.entries(v)) {
    if (/[a-z0-9]_[a-z0-9]/i.test(k)) out.push(path ? `${path}.${k}` : k)
    snakeKeys(val, path ? `${path}.${k}` : k, out)
  }
  return out
}

// ══════════ selections ════════════════════════════════════════════════════════════════════════════
{
  const cat = await api('POST', '/api/selections/categories', { name: 'Countertops', defaultAllowance: 2500 })
  check('a selection category can be created', cat.status === 201 || cat.status === 200, { status: cat.status, body: cat.text?.slice(0, 200) })
  check('…and comes back camelCase', snakeKeys(cat.json).length === 0, { snake: snakeKeys(cat.json) })
  check('…with defaultAllowance readable by the screen', cat.json?.defaultAllowance !== undefined, { keys: Object.keys(cat.json || {}) })

  const opt = await api('POST', '/api/selections/options', {
    categoryId: cat.json?.id, name: 'Calacatta Quartz', manufacturer: 'Caesarstone', model: '5131',
    price: 3180, imageUrl: 'https://example.test/q.jpg', leadTimeDays: 21, unit: 'each',
  })
  check('a selection option can be created', opt.status === 201 || opt.status === 200, { status: opt.status, body: opt.text?.slice(0, 200) })
  check('…and comes back camelCase', snakeKeys(opt.json).length === 0, { snake: snakeKeys(opt.json) })
  check('…with imageUrl, which the client portal renders', opt.json?.imageUrl === 'https://example.test/q.jpg', { imageUrl: opt.json?.imageUrl })
  check('…and leadTimeDays', Number(opt.json?.leadTimeDays) === 21, { leadTimeDays: opt.json?.leadTimeDays })

  const opts = await api('GET', '/api/selections/options')
  const list = opts.json?.data || opts.json
  check('the options LIST is camelCase, including the joined category', snakeKeys(list).length === 0, { snake: snakeKeys(list) })

  // THE ONE THE REPORT WAS LOOKING AT.
  const due = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10)
  const sel = await api('POST', `/api/selections/project/${proj.id}`, {
    projectId: proj.id, categoryId: cat.json?.id, name: 'Kitchen counters',
    location: 'Kitchen', allowance: 2500, quantity: 1, unit: 'each', dueDate: due,
  })
  check('a project selection can be created', sel.status === 201 || sel.status === 200, { status: sel.status, body: sel.text?.slice(0, 200) })
  check('…and comes back camelCase', snakeKeys(sel.json).length === 0, { snake: snakeKeys(sel.json) })
  check('…with the dueDate the screen reads, not due_date', !!sel.json?.dueDate, { keys: Object.keys(sel.json || {}).filter((k) => /due/i.test(k)) })

  await api('POST', `/api/selections/${sel.json?.id}/select`, { optionId: opt.json?.id })

  const listed = await api('GET', `/api/selections/project/${proj.id}`)
  const rows = listed.json?.data || listed.json
  const row = Array.isArray(rows) ? rows[0] : rows
  check('the project selections list is camelCase throughout', snakeKeys(rows).length === 0, { snake: snakeKeys(rows) })
  check('…including the JOINED option, which was selected_option', !!row?.selectedOption, { keys: Object.keys(row || {}).filter((k) => /option/i.test(k)) })
  check('…whose name the screen prints', row?.selectedOption?.name === 'Calacatta Quartz', { name: row?.selectedOption?.name })
  check('…and whose imageUrl it shows a swatch from', row?.selectedOption?.imageUrl === 'https://example.test/q.jpg', { imageUrl: row?.selectedOption?.imageUrl })
  check('…and the joined category name', row?.category?.name === 'Countertops', { category: row?.category })
  check('priceDifference is computed and present', Number(row?.priceDifference) === 680, { priceDifference: row?.priceDifference })
  check('…and flagged as an upgrade', row?.isUpgrade === true, { isUpgrade: row?.isUpgrade })

  const summary = await api('GET', `/api/selections/project/${proj.id}/summary`)
  check('the summary counts the selection', Number(summary.json?.total) === 1, { total: summary.json?.total })
  check('…and totals what was chosen, reading the camelised option', Number(summary.json?.totalSelected) === 3180, { totalSelected: summary.json?.totalSelected })
  check('…and the net difference', Number(summary.json?.netDifference) === 680, { netDifference: summary.json?.netDifference })
  // The summary reads `dueDate` now; if it still read `due_date` this would be 1, because the
  // selection's due date is in the FUTURE and so is not overdue.
  check('…and reads the due date well enough not to call a future selection overdue', Number(summary.json?.overdue) === 0, { overdue: summary.json?.overdue })
}

// ══════════ a selection that lands exactly on its allowance ═══════════════════════════════════════
//
// FOUND WHILE FIXING L7, not in the report. `price_difference` is numeric(12,2), which Postgres
// hands back as a STRING, and the guard read `selection.price_difference !== 0` — "0.00" is never
// equal to 0. So a client picking the standard option AT the allowance price got a change order
// titled "Selection Credit", for nothing, which then had to be approved and moved the project's
// contract value by zero.
{
  const cat = await api('POST', '/api/selections/categories', { name: 'Door Hardware', defaultAllowance: 400 })
  const onBudget = await api('POST', '/api/selections/options', { categoryId: cat.json?.id, name: 'Standard Lever', price: 400, unit: 'each' })
  const sel = await api('POST', `/api/selections/project/${proj.id}`, {
    projectId: proj.id, categoryId: cat.json?.id, name: 'Door hardware', allowance: 400, quantity: 1, unit: 'each',
  })
  await api('POST', `/api/selections/${sel.json?.id}/select`, { optionId: onBudget.json?.id })

  const before = await api('GET', '/api/change-orders')
  const countBefore = (before.json?.data || []).length

  const approved = await api('POST', `/api/selections/${sel.json?.id}/approve`, {})
  check('a selection on exactly its allowance can be approved', approved.status === 200, { status: approved.status, body: approved.text?.slice(0, 200) })
  check('…and raises NO change order, because no money moved', !approved.json?.changeOrder, { changeOrder: approved.json?.changeOrder })

  const after = await api('GET', '/api/change-orders')
  check('…so the project gained no paperwork', (after.json?.data || []).length === countBefore, { before: countBefore, after: (after.json?.data || []).length })
  check('the approved selection comes back camelCase', snakeKeys(approved.json?.selection).length === 0, { snake: snakeKeys(approved.json?.selection) })
  check('…and says it is approved, not the status it had before the update', approved.json?.selection?.status === 'approved', { status: approved.json?.selection?.status })

  // …while one that DOES move money still raises exactly one.
  const upgrade = await api('POST', '/api/selections/options', { categoryId: cat.json?.id, name: 'Brass Lever', price: 525, unit: 'each' })
  const sel2 = await api('POST', `/api/selections/project/${proj.id}`, {
    projectId: proj.id, categoryId: cat.json?.id, name: 'Front door hardware', allowance: 400, quantity: 1, unit: 'each',
  })
  await api('POST', `/api/selections/${sel2.json?.id}/select`, { optionId: upgrade.json?.id })
  const approved2 = await api('POST', `/api/selections/${sel2.json?.id}/approve`, {})
  check('an upgrade DOES still raise a change order', !!approved2.json?.changeOrder, { changeOrder: approved2.json?.changeOrder?.number })
  check('…for the difference, to the cent', Number(approved2.json?.changeOrder?.amount) === 125, { amount: approved2.json?.changeOrder?.amount })
  check('…in the project CO sequence, not a timestamp', /^CO-\d{3}$/.test(approved2.json?.changeOrder?.number || ''), { number: approved2.json?.changeOrder?.number })
}

// ══════════ takeoffs and assemblies ═══════════════════════════════════════════════════════════════
{
  const asm = await api('POST', '/api/takeoffs/assemblies', {
    name: 'Drywall (1/2")', category: 'drywall', measurementType: 'area', wasteFactor: 12,
    materials: [{ name: '1/2" Drywall 4x8', quantityPer: 0.03125, unit: 'sheet', unitCost: 12 }],
  })
  check('an assembly can be created', asm.status === 201 || asm.status === 200, { status: asm.status, body: asm.text?.slice(0, 200) })
  check('…and comes back camelCase, materials included', snakeKeys(asm.json).length === 0, { snake: snakeKeys(asm.json) })
  check('…with measurementType and wasteFactor the screen reads', asm.json?.measurementType === 'area' && Number(asm.json?.wasteFactor) === 12,
    { measurementType: asm.json?.measurementType, wasteFactor: asm.json?.wasteFactor })
  // 0.0313, not 0.03125: quantity_per is numeric(_,4), so the column rounds it. Asserting the
  // stored value rather than the submitted one — the key name is what this suite is about, and
  // pretending the column has more precision than it does would be a test that lies.
  check('…and quantityPer on the material, which was quantity_per', Number(asm.json?.materials?.[0]?.quantityPer) === 0.0313, { materials: asm.json?.materials })
  check('…and its inventoryItem, which was json_build_object(…) as inventory_item', 'inventoryItem' in (asm.json?.materials?.[0] || {}), { keys: Object.keys(asm.json?.materials?.[0] || {}) })

  const asms = await api('GET', '/api/takeoffs/assemblies')
  check('the assemblies LIST is camelCase', snakeKeys(asms.json?.data || asms.json).length === 0, { snake: snakeKeys(asms.json?.data || asms.json) })

  const sheet = await api('POST', `/api/takeoffs/project/${proj.id}`, { projectId: proj.id, name: 'Level 1', planReference: 'A-101' })
  check('a takeoff sheet can be created', sheet.status === 201 || sheet.status === 200, { status: sheet.status, body: sheet.text?.slice(0, 200) })
  check('…and comes back camelCase', snakeKeys(sheet.json).length === 0, { snake: snakeKeys(sheet.json) })
  check('…with planReference, which was plan_reference', sheet.json?.planReference === 'A-101', { planReference: sheet.json?.planReference })

  const item = await api('POST', `/api/takeoffs/sheets/${sheet.json?.id}/items`, {
    assemblyId: asm.json?.id, description: 'North wall', measurementType: 'area', length: 20, width: 9,
  })
  check('a takeoff item can be added', item.status === 201 || item.status === 200, { status: item.status, body: item.text?.slice(0, 200) })
  check('…and comes back camelCase, assembly and materials included', snakeKeys(item.json).length === 0, { snake: snakeKeys(item.json) })
  check('…with measurementValue', item.json?.measurementValue !== undefined, { keys: Object.keys(item.json || {}).filter((k) => /measure/i.test(k)) })
  check('…and the joined assembly, which was row_to_json(ta.*)', item.json?.assembly?.name === 'Drywall (1/2")', { assembly: item.json?.assembly?.name })
  check('…and its calculated materials', (item.json?.calculatedMaterials || []).length > 0, { count: (item.json?.calculatedMaterials || []).length })
  check('…whose materialName the breakdown prints (T32 B5)', !!item.json?.calculatedMaterials?.[0]?.materialName, { first: item.json?.calculatedMaterials?.[0] })

  const full = await api('GET', `/api/takeoffs/sheets/${sheet.json?.id}`)
  check('the sheet with its items is camelCase all the way down', snakeKeys(full.json).length === 0, { snake: snakeKeys(full.json) })
  check('…and carries the joined project name', full.json?.project?.name === 'Shape Build', { project: full.json?.project })

  const sheets = await api('GET', `/api/takeoffs/project/${proj.id}`)
  check("the project's takeoff sheets list is camelCase", snakeKeys(sheets.json?.data || sheets.json).length === 0, { snake: snakeKeys(sheets.json?.data || sheets.json) })
}

// ══════════ recurring — the fourth module the report named ════════════════════════════════════════
//
// I nearly missed this one: a first sweep for raw SQL looked only under templates/ and reported
// "recurring: none", because the implementation lives in packages/tenant-backend and ships to crm,
// crm-fieldservice and crm-landscaping from there. The report was right and the sweep was wrong.
// (feedback: scan packages, not just templates)
{
  const recur = await api('POST', '/api/recurring', {
    contactId: client.id, frequency: 'monthly', startDate: new Date().toISOString().slice(0, 10),
    terms: '30', autoSend: true,
    lineItems: [{ description: 'Monthly maintenance', quantity: 2, unitPrice: 150 }],
  })
  check('a recurring invoice can be created', recur.status === 201 || recur.status === 200, { status: recur.status, body: recur.text?.slice(0, 220) })
  check('…and comes back camelCase', snakeKeys(recur.json).length === 0, { snake: snakeKeys(recur.json) })
  check('…with the nextRunDate the list column shows', !!recur.json?.nextRunDate, { keys: Object.keys(recur.json || {}).filter((k) => /run/i.test(k)) })
  check('…and autoSend, which the form reads as a checkbox', recur.json?.autoSend === true, { autoSend: recur.json?.autoSend })

  const one = await api('GET', `/api/recurring/${recur.json?.id}`)
  check('the single recurring invoice is camelCase, line items included', snakeKeys(one.json).length === 0, { snake: snakeKeys(one.json) })
  check('…and its line items carry unitPrice, not unit_price', one.json?.lineItems?.[0]?.unitPrice !== undefined, { first: one.json?.lineItems?.[0] })
  check('…and the joined contact', one.json?.contact?.name === 'Shape Client', { contact: one.json?.contact?.name })

  const list = await api('GET', '/api/recurring')
  check('the recurring LIST is camelCase throughout', snakeKeys(list.json?.data).length === 0, { snake: snakeKeys(list.json?.data) })

  // Pause/resume/cancel all go through updateRecurringStatus, NOT through the pause/resume/cancel
  // functions the service also exports — those are aliases no route calls. Asserting through the
  // ROUTE is what caught that: camelising the three named functions left the real endpoint raw.
  await api('POST', `/api/recurring/${recur.json?.id}/pause`)
  const resumed = await api('POST', `/api/recurring/${recur.json?.id}/resume`)
  check('resuming answers camelCase', resumed.status === 200 && snakeKeys(resumed.json).length === 0, { status: resumed.status, snake: snakeKeys(resumed.json) })
  check('…with nextRunDate, not next_run_date beside it', !!resumed.json?.nextRunDate && resumed.json?.next_run_date === undefined,
    { nextRunDate: resumed.json?.nextRunDate, legacy: resumed.json?.next_run_date })
}

// ══════════ timestamps carry a zone ═══════════════════════════════════════════════════════════════
//
// The other half of L7: "naive timestamps". A date rendered from a string with no zone is read in
// the BROWSER's zone, so a due date set for the 14th shows as the 13th for anyone west of the
// server. Serialised through JSON a Date becomes an ISO instant ending in Z, which is unambiguous;
// a raw "2026-10-15 00:00:00" is not.
{
  const listed = await api('GET', `/api/selections/project/${proj.id}`)
  const rows = listed.json?.data || listed.json
  const withDate = (Array.isArray(rows) ? rows : []).find((r: any) => r.dueDate)
  check('a selection due date is serialised as an instant, not a naive local string',
    !!withDate && /Z$|[+-]\d{2}:?\d{2}$/.test(String(withDate.dueDate)),
    { dueDate: withDate?.dueDate })
  const created = (Array.isArray(rows) ? rows : [])[0]?.createdAt
  check('…and so is createdAt', !!created && /Z$|[+-]\d{2}:?\d{2}$/.test(String(created)), { createdAt: created })
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
