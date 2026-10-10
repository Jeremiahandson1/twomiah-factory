// T63 — owner's decision (2026-10-09): roofing staff do NOT see insurance claim and supplement amounts, the same
// rule /api/jobs applies (invoices:read). The crew keeps the claim, its status, carrier and dates, and the scope's
// codes and quantities; the figures come off the claim, the supplements, the activity text and the export.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, job, insuranceClaim, supplement, claimActivity } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({ name: 'Hip & Valley', slug: 'hip-t63', email: 'hip-t63@test.local', settings: {}, enabledFeatures: ['insurance_workflow'] } as any).returning()
const mk = async (role: string, tag: string) => (await db.insert(user).values({ email: `${tag}@hip-t63.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id, isActive: true } as any).returning())[0]
const manager = await mk('manager', 'manager'), crew = await mk('field', 'crew')
const [home] = await db.insert(contact).values({ companyId: co.id, firstName: 'Iris', lastName: 'Vale', email: 'iris-t63@test.local' } as any).returning()
const [j] = await db.insert(job).values({ companyId: co.id, contactId: home.id, jobNumber: 'RF-T63-1', jobType: 'insurance', source: 'storm', propertyAddress: '4 Gable Ct', city: 'Akron', state: 'OH', zip: '44301' } as any).returning()
// figures nothing else can produce
const [claim] = await db.insert(insuranceClaim).values({
  companyId: co.id, jobId: j.id, claimNumber: 'CLM-T63', insuranceCompany: 'Granite Mutual',
  deductible: '1111.11', rcv: '12345.67', acv: '9876.54', depreciationHeld: '2469.13', supplementAmount: '2222.22', finalApprovedAmount: '14567.89',
} as any).returning()
await db.insert(supplement).values({ companyId: co.id, jobId: j.id, claimId: claim.id, supplementNumber: 'S-1', status: 'approved', reason: 'Hidden decking',
  lineItems: [{ code: 'RFG-DECK', description: 'Deck replacement', qty: 20, unit: 'SF', unitPrice: 111.11, total: 2222.22 }], totalAmount: '2222.22', approvedAmount: '2222.22' } as any)
await db.insert(claimActivity).values({ companyId: co.id, jobId: j.id, claimId: claim.id, userId: manager.id, activityType: 'note', body: 'Supplement S-1 submitted — $2,222.22 — Hidden decking' } as any)

const app = new Hono()
app.route('/api/insurance', (await import('./src/routes/insurance.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const get = async (who: any, path: string) => {
  const res = await app.request(path, { headers: { 'x-test-user': who.id } })
  const t = await res.text(); let js: any = t; try { js = JSON.parse(t) } catch {}
  return { status: res.status, json: js, text: t }
}
const FIG = /12345|9876|1111\.11|2469|2222|14567|111\.11/

const c1 = await get(crew, `/api/insurance/claims/${j.id}`)
check('the crew opens the claim — carrier and number', c1.status === 200 && c1.json?.insuranceCompany === 'Granite Mutual' && c1.json?.claimNumber === 'CLM-T63', c1.status)
check('…without its six figures, and moneyWithheld', c1.json?.moneyWithheld === true && ['deductible', 'rcv', 'acv', 'depreciationHeld', 'supplementAmount', 'finalApprovedAmount'].every((k) => !(k in c1.json)), c1.json)
const s1 = await get(crew, `/api/insurance/claims/${claim.id}/supplements`)
check('the crew sees the supplement — number, status, reason, the scope line', s1.status === 200 && s1.json?.[0]?.supplementNumber === 'S-1' && s1.json[0].lineItems?.[0]?.code === 'RFG-DECK' && s1.json[0].lineItems[0].qty === 20, s1.json?.[0])
check('…without totals or line prices', !('totalAmount' in (s1.json?.[0] || {})) && !('approvedAmount' in (s1.json?.[0] || {})) && !('unitPrice' in (s1.json?.[0]?.lineItems?.[0] || {})) && !('total' in (s1.json?.[0]?.lineItems?.[0] || {})), s1.json?.[0])
const a1 = await get(crew, `/api/insurance/claims/${claim.id}/activity`)
check('the crew reads the activity, the dollar figure hidden in the text', a1.status === 200 && /Supplement S-1 submitted — \(amount hidden\) — Hidden decking/.test(a1.json?.[0]?.body || ''), a1.json?.[0]?.body)
const x1 = await get(crew, `/api/insurance/claims/${claim.id}/xactimate-export`)
check('the priced export is refused to the crew (403)', x1.status === 403, x1.status)
for (const [label, r] of [['claim', c1], ['supplements', s1], ['activity', a1]] as const) check(`…none of the figures anywhere in the ${label} payload`, !FIG.test(r.text), r.text.match(FIG)?.[0])

const c2 = await get(manager, `/api/insurance/claims/${j.id}`)
check('a manager sees the claim figures', Number(c2.json?.rcv) === 12345.67 && Number(c2.json?.deductible) === 1111.11 && !c2.json?.moneyWithheld, c2.json)
const s2 = await get(manager, `/api/insurance/claims/${claim.id}/supplements`)
check('…the supplement totals and line prices', Number(s2.json?.[0]?.totalAmount) === 2222.22 && s2.json?.[0]?.lineItems?.[0]?.unitPrice === 111.11, s2.json?.[0])
const a2 = await get(manager, `/api/insurance/claims/${claim.id}/activity`)
check('…and the activity with its figure', /\$2,222\.22/.test(a2.json?.[0]?.body || ''), a2.json?.[0]?.body)
const x2 = await get(manager, `/api/insurance/claims/${claim.id}/xactimate-export`)
check('…and is not refused the export (anything but 403)', x2.status !== 403, x2.status)

console.log(`\nt63 claim money: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
