// "Reimburse me" must survive the save. (E2E run 1, 10/14: the field user ticked it, the owner's edit form showed it
// unticked, the Reimburse column stayed "-" and no reimburse action appeared after approval.) Runs the crm's real
// expense routes as a field user and as the owner.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}
const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user } = await import('./db/schema.ts')
const [co] = await db.insert(company).values({ name: 'Reimburse Co', slug: 'reimb-co', email: 'o@rb.test', settings: {}, enabledFeatures: ['expenses', 'jobs'] } as any).returning()
const mk = async (role: string, tag: string) => (await db.insert(user).values({ email: `${tag}@rb.test`, passwordHash: 'x', firstName: tag, lastName: 'T', role, companyId: co.id, isActive: true } as any).returning())[0]
const owner = await mk('owner', 'owner'), field = await mk('field', 'field')

const app = new Hono()
app.route('/api/expenses', (await import('./src/routes/expenses.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const asField = as(field), asOwner = as(owner)
const rowsOf = (j: any) => (Array.isArray(j) ? j : j?.data || j?.expenses || [])

// exactly what the Expenses screen posts (ExpensesPage handleSave)
const payload = { date: '2026-10-14', category: 'materials', vendor: "Joe's Lumber & Supply", description: 'Lumber', amount: 42.37, billable: false, reimbursable: true, projectId: null, jobId: null }
const created = await asField('POST', '/api/expenses', payload)
check(`the field user's expense is created (${created.status})`, created.status === 201, created.json)
check('…with "Reimburse me" kept', created.json?.reimbursable === true, created.json)
const fieldList = await asField('GET', '/api/expenses')
const mine = rowsOf(fieldList.json).find((r: any) => r.id === created.json?.id)
check('the field user sees it marked for reimbursement', mine?.reimbursable === true, mine)
const ownerList = await asOwner('GET', '/api/expenses')
const theirs = rowsOf(ownerList.json).find((r: any) => r.id === created.json?.id)
check('the owner sees it marked for reimbursement', theirs?.reimbursable === true, theirs)
const approved = await asOwner('POST', `/api/expenses/${created.json?.id}/approve`)
check(`the owner approves it (${approved.status})`, approved.status === 200, approved.json)
const after = rowsOf((await asOwner('GET', '/api/expenses')).json).find((r: any) => r.id === created.json?.id)
check('…and it is still for reimbursement, ready to pay', after?.approved === true && after?.reimbursable === true && !after?.reimbursed, after)
const paid = await asOwner('POST', `/api/expenses/${created.json?.id}/reimburse`)
check(`…and can be marked reimbursed (${paid.status})`, paid.status === 200, paid.json)

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
