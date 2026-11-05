// The insurance claim on the phone (docs/parity/roof-insurance-extras.md, parity row 12): the claim screen's rules and saves
// (apps/mobile/src/insurance/claim.ts, app/(details)/job/claim.tsx) through the REAL offline queue (src/offline/engine.ts) with a
// scripted network. What it proves:
//   · a seat is offered only what the server lets it do (insurance:create / update / approve, the two feature switches), supplement by
//     supplement, in the desktop's order and words;
//   · typed text becomes what the server takes: dollars as "1250.50", a row left blank is skipped, a half-filled row is refused with a
//     sentence, nothing the person did not type is invented;
//   · with no signal every save is KEPT under one record per job's claim and goes, in the order made, when signal returns; a save the
//     server refuses is kept as failed with the server's words and what was made after it waits; nothing is dropped;
//   · a failed save leads to the claim screen; the screen shows queued saves as waiting (never done), shows what the server withheld
//     as hidden (never $0), has no native dialog, and is wired into the app (layout, job page).
//
//   bun run tests/mobile/insurance-claim.test.ts
import fs from 'node:fs'
import path from 'node:path'
import { createEngine, type KV, type Sender } from '../../apps/mobile/src/offline/engine.ts'
import { describeItem, openFor } from '../../apps/mobile/src/offline/describe.ts'
import {
  addMortgageCheck, addNote, addSupplement, amountText, approveSupplement, blankLine, certificateSent, claimKey, claimSeat, denySupplement, depreciationReleased,
  depreciationSentence, isError, moveMortgageCheck, NEXT_CHECK_STEP, phoneDay, setSupplementStatus, shownDay, shownMoney, startClaim, statusesFor, submitSupplement,
  supplementActions, supplementLines, type PhoneStatusDef,
} from '../../apps/mobile/src/insurance/claim.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}
const root = path.resolve(import.meta.dir, '../../apps/mobile')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')

const ALL = new Set(['insurance_workflow', 'insurance_extras'])
const seatOf = (perms: string[], features: Set<string> = ALL) => claimSeat((p) => perms.includes('*') || perms.includes(p), (f) => features.has(f))
const OWNER = seatOf(['*'])
const REP = seatOf(['insurance:read', 'insurance:create', 'insurance:update'])
const FIELD = seatOf(['jobs:read'])
const CLERK = seatOf(['insurance:read', 'insurance:update'])
const UNDER_REVIEW: PhoneStatusDef = { id: 's1', name: 'Under review', baseStatus: 'submitted', archived: false }
const OLD: PhoneStatusDef = { id: 's2', name: 'Old one', baseStatus: 'submitted', archived: true }
const NEEDS_INFO: PhoneStatusDef = { id: 's3', name: 'Need more information', baseStatus: 'draft', archived: false }
const ids = (a: { id: string }[]) => a.map((x) => x.id).join(',')

function world() {
  let t = Date.parse('2026-10-31T15:00:00Z')
  const data = new Map<string, string>()
  const kv: KV = { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => { data.set(k, v) } }
  const sent: Array<{ method: string; path: string; body: any }> = []
  let online = false
  const refuse = new Map<string, { status: number; data?: any }>()
  const send: Sender = async ({ method, path: p, body }) => {
    if (!online) return { status: 0 }
    const r = refuse.get(p)
    sent.push({ method, path: p, body })
    return r ?? { status: 200, data: { ok: true } }
  }
  let n = 0
  const engine = createEngine({ kv, send, now: () => t, random: () => 0.5, newId: () => `save${++n}`, setTimer: () => () => {} })
  return { engine, sent, refuse, goOnline: () => { online = true; engine.setOnline(true) }, goOffline: () => { online = false; engine.setOnline(false) } }
}

async function main() {
  console.log('what a seat is offered')
  {
    check('the owner is offered everything', OWNER.open && OWNER.extras && OWNER.file && OWNER.edit && OWNER.decide)
    check('a rep files and moves, but the carrier\'s answer is not theirs', REP.file && REP.edit && !REP.decide && REP.extras)
    check('a field seat reads the claim and does nothing to it', FIELD.open && !FIELD.file && !FIELD.edit && !FIELD.decide && !FIELD.extras)
    check('the extras need insurance:read as well as the feature', !seatOf(['insurance:create']).extras && CLERK.extras)
    check('with the claims module off the screen does not exist', !seatOf(['*'], new Set()).open)
    check('with only the follow-ups off, the claim is there and the extras are not', seatOf(['*'], new Set(['insurance_workflow'])).open && !seatOf(['*'], new Set(['insurance_workflow'])).extras)
    check('a draft is submitted by someone who files', ids(supplementActions({ status: 'draft' }, REP)) === 'submit' && supplementActions({ status: 'draft' }, REP)[0].label === 'Submit to the carrier')
    check('a seat that cannot file is never offered submit', ids(supplementActions({ status: 'draft' }, CLERK)) === '' && ids(supplementActions({ status: 'denied' }, FIELD)) === '')
    check('a denied one is sent again, not re-drafted', supplementActions({ status: 'denied' }, REP)[0].label === 'Send again')
    check('a draft cannot be approved or denied by the carrier\'s hand', !ids(supplementActions({ status: 'draft' }, OWNER)).includes('approve'))
    check('a submitted one gets approve and deny for an approver only', ids(supplementActions({ status: 'submitted' }, OWNER)) === 'approve,deny' && ids(supplementActions({ status: 'submitted' }, REP)) === '')
    check('an approved one can be changed or reversed, worded for what it does', supplementActions({ status: 'approved' }, OWNER).map((a) => a.label).join('|') === 'Change the approved amount|Record a denial instead')
    check('a denied one can be reversed', supplementActions({ status: 'denied' }, OWNER).map((a) => a.id).join() === 'submit,approve,deny')
    check('the company status button needs a status that fits, the extras and insurance:update',
      ids(supplementActions({ status: 'submitted' }, CLERK, [UNDER_REVIEW])) === 'status'
      && ids(supplementActions({ status: 'submitted' }, CLERK, [NEEDS_INFO])) === ''
      && ids(supplementActions({ status: 'submitted' }, CLERK, [OLD])) === ''
      && !ids(supplementActions({ status: 'submitted' }, FIELD, [UNDER_REVIEW])).includes('status'))
    check('only the statuses under the supplement\'s fixed status are offered, never an archived one', ids(statusesFor('submitted', [UNDER_REVIEW, OLD, NEEDS_INFO])) === 's1')
    check('a check moves one step at a time and ends at deposited',
      NEXT_CHECK_STEP.received?.status === 'sent_to_mortgage' && NEXT_CHECK_STEP.sent_to_mortgage?.status === 'endorsed' && NEXT_CHECK_STEP.endorsed?.status === 'deposited' && NEXT_CHECK_STEP.deposited === null)
  }

  console.log('typed text becomes what the server takes')
  {
    const cases: Array<[string, string | null]> = [['1250.5', '1250.50'], ['$1,250', '1250.00'], [' 0 ', '0.00'], ['12.345', null], ['-5', null], ['abc', null], ['', null], ['1e5', null], ['.5', null]]
    for (const [typed, want] of cases) check(`"${typed}" -> ${want}`, amountText(typed) === want, amountText(typed))
    const good = supplementLines([{ description: ' Re-deck ', qty: '12', unit: '', unitPrice: '42.5' }, blankLine()])
    check('a blank row is skipped and the unit defaults', !('error' in good) && good.lines.length === 1 && good.lines[0].unit === 'EA' && good.lines[0].description === 'Re-deck' && good.lines[0].unitPrice === 42.5, good)
    check('the total is worked out in whole cents', !('error' in good) && good.totalCents === 51000, good)
    check('a half-filled row is refused with the line named', JSON.stringify(supplementLines([{ description: 'Vent', qty: '1', unit: 'EA', unitPrice: '' }])) === JSON.stringify({ error: 'Line 1: the price must be an amount of 0 or more, like 125.50.' }))
    check('a price with no words is refused', 'error' in supplementLines([{ description: '', qty: '1', unit: 'EA', unitPrice: '50' }]))
    check('a bad quantity is refused', 'error' in supplementLines([{ description: 'Vent', qty: '0', unit: 'EA', unitPrice: '5' }]))
    check('no lines is refused', 'error' in supplementLines([blankLine()]))
    check('a supplement of nothing is refused', 'error' in supplementLines([{ description: 'Free', qty: '1', unit: 'EA', unitPrice: '0' }]))
    const when = new Date(2026, 9, 31, 23, 30)
    check('the day is the phone\'s calendar day', phoneDay(when) === '2026-10-31' && phoneDay(new Date(2026, 0, 5)) === '2026-01-05')
  }

  console.log('the saves, as the queue takes them')
  {
    const at = new Date(2026, 10, 2, 9, 0)
    const start = startClaim('j1', { claimNumber: ' CLM-9 ', insuranceCompany: ' Buckeye ', policyNumber: ' ', adjusterName: 'Pat', deductible: '1,000' }, 'ROOF-7')
    check('start: POST /api/insurance/claims with the job, trimmed, the deductible as dollars, blanks left off',
      !isError(start) && start.method === 'POST' && start.path === '/api/insurance/claims' && start.recordKey === claimKey('j1') && JSON.stringify(start.body) === JSON.stringify({ jobId: 'j1', claimNumber: 'CLM-9', insuranceCompany: 'Buckeye', adjusterName: 'Pat', deductible: '1000.00' }), start)
    check('start: the label names the job', !isError(start) && start.label === 'ROOF-7 · claim started')
    check('start: no claim number, no carrier, a bad deductible are each refused in words',
      isError(startClaim('j1', { claimNumber: '', insuranceCompany: 'A' })) && isError(startClaim('j1', { claimNumber: '1', insuranceCompany: '' })) && isError(startClaim('j1', { claimNumber: '1', insuranceCompany: 'A', deductible: 'lots' })))
    const note = addNote('j1', 'c/1', '  hi  ')
    check('note: the claim id is encoded in the path, the body is trimmed', !isError(note) && note.path === '/api/insurance/claims/c%2F1/activity' && JSON.stringify(note.body) === JSON.stringify({ activityType: 'note', body: 'hi' }), note)
    check('note: empty is refused', isError(addNote('j1', 'c1', '  ')))
    const sup = addSupplement('j1', 'c1', ' Decking ', [{ description: 'Sheet', qty: '2', unit: 'SHT', unitPrice: '40' }], ' ')
    check('supplement: reason and lines, no notes when blank, no totals invented', !isError(sup) && sup.path === '/api/insurance/claims/c1/supplements' && JSON.stringify(sup.body) === JSON.stringify({ reason: 'Decking', lineItems: [{ description: 'Sheet', qty: 2, unit: 'SHT', unitPrice: 40 }] }), sup)
    check('supplement: no reason is refused', isError(addSupplement('j1', 'c1', ' ', [{ description: 'Sheet', qty: '2', unit: 'SHT', unitPrice: '40' }])))
    const s = { id: 's9', supplementNumber: 'SUP-004' }
    const sub = submitSupplement('j1', s)
    check('submit: POST with no body', sub.path === '/api/insurance/supplements/s9/submit' && sub.body === undefined && sub.label === 'SUP-004 · submitted')
    const ap = approveSupplement('j1', s, '850.5')
    check('approve: the amount typed as dollars', !isError(ap) && ap.path === '/api/insurance/supplements/s9/approve' && JSON.stringify(ap.body) === JSON.stringify({ approvedAmount: '850.50' }), ap)
    check('approve: a bad amount is refused', isError(approveSupplement('j1', s, 'x')))
    const dn = denySupplement('j1', s, ' not storm ')
    check('deny: the reason, trimmed; none is refused', !isError(dn) && JSON.stringify(dn.body) === JSON.stringify({ denialReason: 'not storm' }) && isError(denySupplement('j1', s, ' ')))
    check('company status: set and cleared', JSON.stringify(setSupplementStatus('j1', s, 's1', 'Under review').body) === JSON.stringify({ statusId: 's1' }) && JSON.stringify(setSupplementStatus('j1', s, null).body) === JSON.stringify({ statusId: null })
      && setSupplementStatus('j1', s, 's1', 'Under review').path === '/api/insurance-extras/supplements/s9/custom-status')
    const chk = addMortgageCheck('j1', 'c1', { mortgageCompany: ' First Federal ', amount: '9,250.5', checkNumber: '4471', loanNumber: ' ' }, at)
    check('check: dollars, the day received, no blank boxes', !isError(chk) && chk.path === '/api/insurance-extras/claims/c1/mortgage-checks' && JSON.stringify(chk.body) === JSON.stringify({ mortgageCompany: 'First Federal', amount: '9250.50', receivedOn: '2026-11-02', checkNumber: '4471' }), chk)
    check('check: no company or a bad amount are refused', isError(addMortgageCheck('j1', 'c1', { mortgageCompany: '', amount: '5' }, at)) && isError(addMortgageCheck('j1', 'c1', { mortgageCompany: 'A', amount: '' }, at)))
    const mv = moveMortgageCheck('j1', { id: 'k1', mortgageCompany: 'First Federal' }, 'sent_to_mortgage', at, ' 1Z9 ')
    check('check step: the status, the day, the tracking number only when sent', JSON.stringify(mv.body) === JSON.stringify({ status: 'sent_to_mortgage', on: '2026-11-02', trackingNumber: '1Z9' }) && mv.path === '/api/insurance-extras/mortgage-checks/k1/status')
    check('check step: no tracking number on later steps', JSON.stringify(moveMortgageCheck('j1', { id: 'k1', mortgageCompany: 'F' }, 'endorsed', at, '1Z9').body) === JSON.stringify({ status: 'endorsed', on: '2026-11-02' }))
    check('certificate: the day it went', JSON.stringify(certificateSent('j1', 'c1', at).body) === JSON.stringify({ sentOn: '2026-11-02' }) && certificateSent('j1', 'c1', at).path === '/api/insurance-extras/claims/c1/completion-certificate')
    const rel = depreciationReleased('j1', 'c1', '3,500', at)
    check('release: amount and day; a bad amount is refused', !isError(rel) && JSON.stringify(rel.body) === JSON.stringify({ amount: '3500.00', receivedOn: '2026-11-02' }) && rel.path === '/api/insurance-extras/claims/c1/depreciation-recovered' && isError(depreciationReleased('j1', 'c1', 'some', at)))
    const all = [start, note, sup, sub, ap, dn, chk, mv, certificateSent('j1', 'c1', at), rel]
    check('every save is under the job\'s one claim record, with a label', all.every((r) => !isError(r) && r.recordKey === 'claim:j1' && !!r.label))
    check('no body carries a figure as a float', !/\.\d{3,}/.test(JSON.stringify(all.map((r) => (isError(r) ? null : r.body)))))
  }

  console.log('what the screen shows')
  {
    check('a day the person named is that day, wherever the phone is', shownDay('2026-11-02T00:00:00.000Z') === new Date(2026, 10, 2).toLocaleDateString() && shownDay('2026-11-02') === new Date(2026, 10, 2).toLocaleDateString())
    check('no day is empty, a bad one is empty', shownDay(null) === '' && shownDay('soon') === '')
    check('money has its cents and its commas', shownMoney('1250.5') === '$1,250.50' && shownMoney(0) === '$0.00')
    const day = (d?: string | null) => `D(${d})`
    const held = depreciationSentence({ state: 'send_certificate', held: 4000, insuranceCompany: 'Buckeye' }, day, shownMoney)
    check('held depreciation: the job is done, send the certificate', held === 'Buckeye is holding $4,000.00 of depreciation until it has your certificate of completion. The job is done — send the certificate now.', held)
    check('waiting on the carrier names the day sent', depreciationSentence({ state: 'waiting_on_carrier', held: 4000, certificateSentAt: '2026-11-02' }, day, shownMoney).endsWith('Certificate sent D(2026-11-02); waiting on the carrier.'))
    check('released names the amount and day', depreciationSentence({ state: 'recovered', recoveredAmount: 3500, recoveredAt: '2026-11-09', insuranceCompany: 'Buckeye' }, day, shownMoney) === 'Buckeye released $3,500.00 on D(2026-11-09).')
    check('a withheld figure is never drawn, as $0 or at all', ['send_certificate', 'waiting_on_carrier', 'job_not_done', 'recovered'].every((state) =>
      !depreciationSentence({ state: state as any, moneyWithheld: true, recoveredAt: '2026-11-09' }, day, shownMoney).includes('$')))
  }

  console.log('with no signal, everything is kept and goes in order')
  {
    const w = world()
    await w.engine.load('rep1')
    w.goOffline()
    const at = new Date(2026, 10, 2, 9, 0)
    const s = { id: 's9', supplementNumber: 'SUP-004' }
    const reqs = [
      addNote('j1', 'c1', 'Adjuster Friday'),
      addSupplement('j1', 'c1', 'Decking', [{ description: 'Sheet', qty: '2', unit: 'SHT', unitPrice: '40' }]),
      submitSupplement('j1', s),
      approveSupplement('j1', s, '75'),
      addMortgageCheck('j1', 'c1', { mortgageCompany: 'First Federal', amount: '9000' }, at),
      certificateSent('j1', 'c1', at),
    ]
    const results = []
    for (const r of reqs) { if (isError(r)) throw new Error(r.error); results.push(await w.engine.submit(r)) }
    check('all six are kept, none sent', results.every((r) => r.queued) && w.sent.length === 0)
    check('all are under the one record', w.engine.status().items.every((i) => i.recordKey === 'claim:j1') && w.engine.status().items.length === 6)
    w.goOnline()
    await w.engine.sendNow()
    check('signal back: sent in the order made', w.sent.map((x) => x.path).join('|') === [
      '/api/insurance/claims/c1/activity', '/api/insurance/claims/c1/supplements', '/api/insurance/supplements/s9/submit', '/api/insurance/supplements/s9/approve',
      '/api/insurance-extras/claims/c1/mortgage-checks', '/api/insurance-extras/claims/c1/completion-certificate',
    ].join('|'), w.sent.map((x) => x.path))
    check('the bodies are exactly what was built', w.sent[3].body.approvedAmount === '75.00' && w.sent[4].body.receivedOn === '2026-11-02')
    check('the queue is empty', w.engine.status().items.length === 0)
  }

  console.log('a save the server refuses')
  {
    const w = world()
    await w.engine.load('rep1')
    w.goOnline()
    w.refuse.set('/api/insurance/supplements/s9/approve', { status: 403, data: { error: 'You do not have permission to approve' } })
    const s = { id: 's9', supplementNumber: 'SUP-004' }
    const live = await w.engine.submit(approveSupplement('j1', s, '75') as any)
    check('online, a refusal comes back in the server\'s words and is not queued', !live.queued && live.status === 403 && live.data.error === 'You do not have permission to approve' && w.engine.status().items.length === 0, live)

    const v = world()
    await v.engine.load('rep1')
    v.goOffline()
    v.refuse.set('/api/insurance/claims/c1/supplements', { status: 409, data: { error: 'Claim is closed' } })
    await v.engine.submit(addNote('j1', 'c1', 'Before') as any)
    await v.engine.submit(addSupplement('j1', 'c1', 'Decking', [{ description: 'Sheet', qty: '1', unit: 'EA', unitPrice: '40' }]) as any)
    await v.engine.submit(addNote('j1', 'c1', 'After') as any)
    v.goOnline()
    await v.engine.sendNow()
    const items = v.engine.status().items
    const bad = items.find((i) => i.state === 'failed')
    check('the refused one is kept as failed with the words, the one before it went, the one after it waits',
      !!bad && bad.refusal?.message === 'Claim is closed' && v.sent.filter((x) => x.path.endsWith('/activity')).length === 1 && items.length === 2 && items.some((i) => i.blocked), items)
    const line = describeItem(bad!)
    check('the waiting list says what failed, in words, and leads to the claim', line.failed && line.title === 'New supplement' && line.detail === 'Claim is closed' && line.open === '/(details)/job/claim?id=j1', line)
    check('a job\'s own saves still lead to the job', openFor({ recordKey: 'job:j1', path: '/x' }) === '/(details)/job/j1' && openFor({ recordKey: 'x', path: '/x' }) === null)
  }

  console.log('the screen, as written')
  {
    const screen = read('app/(details)/job/claim.tsx')
    const code = screen.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    check('every write goes through the offline queue, none direct', /useOfflineApi\(\)/.test(code) && /offline\.post\(/.test(code) && !/\bpost\(|\bput\(|\bpatch\(/.test(code.replace(/offline\.post\(/g, '')) && !/from '\.\.\/\.\.\/\.\.\/src\/api\/client'[^\n]*\b(post|put|patch|del)\b/.test(code))
    check('it reads only through get()', /import \{ get \} from '\.\.\/\.\.\/\.\.\/src\/api\/client'/.test(code) && !/\bfetch\(/.test(code))
    check('a queued save is shown as waiting, never as done', /Saved on the phone — waiting to send/.test(code) && /r\.queued/.test(code) && code.indexOf('r.queued') < code.indexOf('r.ok)'))
    check('a refusal is shown in the server\'s words', /toast\.error\(r\.error \|\| /.test(code))
    check('it re-reads the claim when the waiting saves change', /signature/.test(code) && /q\.recordKey === claimKey/.test(code))
    check('the waiting saves are listed with a way to fix a failed one', /describeItem\(q\)/.test(code) && /\/\(details\)\/waiting/.test(code))
    check('what the server withheld is drawn as hidden, never $0', /moneyWithheld/.test(code) && /hidden for your role/.test(code) && /'hidden'/.test(code))
    check('each control asks claimSeat / supplementActions', /claimSeat\(can, hasFeature\)/.test(code) && /supplementActions\(s, seat, statuses\)/.test(code) && /seat\.extras/.test(code) && /seat\.decide/.test(code) && /seat\.file/.test(code) && /seat\.edit/.test(code))
    check('the extras are not even read unless the seat is offered them', /if \(seat\.extras\) \{[\s\S]*?insurance-extras\/claims[\s\S]*?\}/.test(code))
    check('a claim is started only on an insurance job', /jobInfo\.insurance/.test(code) && /jobType === 'insurance'/.test(code))
    check('no native dialog', !/\bAlert\b|\bconfirm\(|\balert\(/.test(code))
    check('no raw status codes in the words shown', !/\{s\.status\}|\{c\.status\}|\{claim\.claimStatus\}/.test(code))
    const layout = read('app/(details)/_layout.tsx')
    check('the layout draws no second header for it', /'job\/claim'/.test(layout))
    const job = read('app/(details)/job/[id].tsx')
    check('the job\'s Insurance Claim card opens it, when the claims module is on', /hasFeature\('insurance_workflow'\)/.test(job) && /\/\(details\)\/job\/claim\?id=\$\{id\}/.test(job))
    check('the screen file exists where the link points', fs.existsSync(path.join(root, 'app/(details)/job/claim.tsx')))
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed) process.exit(1)
}
main()
