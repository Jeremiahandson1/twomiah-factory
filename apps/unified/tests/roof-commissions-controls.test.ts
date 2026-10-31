// Who sees commissions, and the disclaimer a commissioned person accepts — both set per company (docs/parity/roof-commissions-costing.md
// #12, #13; roofing parity row 4), through the real server.
//   · owner and admin always see everyone's commissions; by default the manager does too (as it always did); the company can add
//     field and read-only seats and take the manager off — enforced on the routes AND told to the screen at sign-in;
//   · everyone always sees their own earnings.
import { describe, test, expect, beforeAll } from 'bun:test'
import { bootRoofKit, PASS } from './roofMoneyKit.ts'

let k: Awaited<ReturnType<typeof bootRoofKit>>
beforeAll(async () => { k = await bootRoofKit() }, 120_000)

const putRoles = (who: string, roles: unknown) => k.as(who)('/api/roof-money/settings', { method: 'PUT', json: { commissionViewerRoles: roles } })
const seen = async (who: string) => (await k.json(await k.as(who)('/api/commissions'))).body.data as any[]
const plansStatus = async (who: string) => (await k.as(who)('/api/commissions/plans')).status

describe('which roles see commissions', () => {
  test('by default the owner and the manager see everyone’s; field and read-only seats see their own', async () => {
    for (const who of ['rep', 'manager']) {
      expect((await k.as('owner')('/api/commissions', { method: 'POST', json: { userId: k.ids[who], commissionAmount: who === 'rep' ? 25 : 35, notes: `${who} bonus` } })).status).toBe(201)
    }
    expect((await seen('owner')).length).toBe(2)
    expect((await seen('manager')).length).toBe(2)
    expect(await plansStatus('manager')).toBe(200)
    expect((await seen('rep')).map((c) => c.notes)).toEqual(['rep bonus'])
    expect(await plansStatus('rep')).toBe(403)
    expect((await seen('viewer')).length).toBe(0)
    expect(await plansStatus('viewer')).toBe(403)
    const settings = await k.json(await k.as('manager')('/api/roof-money/settings'))
    expect(settings.body.commissionViewerRoles).toEqual(['manager'])
  })

  test('only a seat that may change commission plans changes who sees them; the roles are checked', async () => {
    expect((await putRoles('manager', ['field'])).status).toBe(403)
    expect((await putRoles('owner', ['owner'])).status).toBe(400)
    expect((await putRoles('owner', ['plumber'])).status).toBe(400)
    expect((await putRoles('owner', 'field')).status).toBe(400)
  })

  test('the company lets field and read-only seats see everyone’s and takes the manager off, at once, on the routes and at sign-in', async () => {
    const saved = await k.json(await putRoles('owner', ['field', 'viewer']))
    expect([saved.status, saved.body.commissionViewerRoles]).toEqual([200, ['field', 'viewer']])
    // The routes follow at once.
    expect((await seen('rep')).length).toBe(2)
    expect(await plansStatus('rep')).toBe(200)
    expect((await seen('viewer')).length).toBe(2)
    expect(await plansStatus('viewer')).toBe(200)
    // The manager is off the list: their own earnings only.
    expect((await seen('manager')).map((c) => c.notes)).toEqual(['manager bonus'])
    expect(await plansStatus('manager')).toBe(403)
    // The owner always sees everyone's.
    expect((await seen('owner')).length).toBe(2)
    // The screen is told at sign-in what each seat may do.
    const login = async (email: string) => (await (await k.t.call('/api/auth/login', { method: 'POST', json: { email, password: PASS } })).json())
    const perms = (b: any): string[] => b.permissions ?? b.user?.permissions ?? []
    const mgr = await login('manager@test.example')
    const rep = await login('rep@test.example')
    expect(perms(mgr)).not.toContain('commissions:read')
    expect(perms(rep)).toContain('commissions:read')
    // Putting the manager back restores the default, and a field seat falls back to its own.
    expect((await putRoles('owner', ['manager'])).status).toBe(200)
    expect(await plansStatus('manager')).toBe(200)
    expect(await plansStatus('rep')).toBe(403)
    expect((await seen('rep')).map((c) => c.notes)).toEqual(['rep bonus'])
  })
})

describe('the commission disclaimer', () => {
  const setWords = (who: string, words: string | null) => k.as(who)('/api/roof-money/settings', { method: 'PUT', json: { commissionDisclaimer: words } })
  const mine = async (who: string) => (await k.json(await k.as(who)('/api/commission-disclaimer'))).body
  const accept = (who: string) => k.as(who)('/api/commission-disclaimer/accept', { method: 'POST' })

  test('with no disclaimer nothing is withheld and there is nothing to accept', async () => {
    expect((await mine('rep')).accepted).toBe(true)
    expect((await seen('rep')).length).toBe(1)
    const none = await accept('rep')
    expect(none.status).toBe(409)
  })

  test('only a seat that may change plans sets the words; until a person accepts, their own commissions are withheld', async () => {
    expect((await setWords('manager', 'Commission is paid on collected money only.')).status).toBe(403)
    const set = await k.json(await setWords('owner', '  Commission is paid on collected money only.  '))
    expect([set.status, set.body.commissionDisclaimer, set.body.commissionDisclaimerVersion]).toEqual([200, 'Commission is paid on collected money only.', 1])
    const before = await mine('rep')
    expect([before.accepted, before.version, before.text]).toEqual([false, 1, 'Commission is paid on collected money only.'])
    // The rep's own lines are held back and the list says why; the owner still sees the rep's lines.
    const list = await k.json(await k.as('rep')('/api/commissions'))
    expect(list.body.data).toEqual([])
    expect(list.body.disclaimerRequired).toBe(true)
    const stmt = await k.json(await k.as('rep')('/api/commissions/statement'))
    expect([stmt.status, stmt.body.code]).toEqual([403, 'disclaimer_required'])
    expect((await seen('owner')).some((c) => c.notes === 'rep bonus')).toBe(true)
  })

  test('accepting shows their commissions; the words and the time are kept; accepting twice is one record', async () => {
    expect((await accept('rep')).status).toBe(200)
    expect((await accept('rep')).status).toBe(200)
    expect((await mine('rep')).accepted).toBe(true)
    const list = await k.json(await k.as('rep')('/api/commissions'))
    expect(list.body.data.map((c: any) => c.notes)).toEqual(['rep bonus'])
    expect(list.body.disclaimerRequired).toBeUndefined()
    expect((await k.as('rep')('/api/commissions/statement')).status).toBe(200)
    const rows = await k.t.db.select().from(k.t.schema.commissionDisclaimerAcceptance)
    expect(rows.length).toBe(1)
    expect([rows[0].userId, rows[0].version, rows[0].disclaimerText]).toEqual([k.ids.rep, 1, 'Commission is paid on collected money only.'])
  })

  test('who has accepted is listed for those who read the pay structure; changed words are accepted again; clearing them removes the gate', async () => {
    const first = await k.json(await k.as('manager')('/api/commission-disclaimer/acceptances'))
    expect(first.status).toBe(200)
    expect(first.body.data.map((a: any) => [a.userName, a.accepted])).toEqual([['Mo Seat', false], ['Rita Seat', true]])
    expect((await k.as('rep')('/api/commission-disclaimer/acceptances')).status).toBe(403)
    // Same words again: no new version, still accepted.
    expect((await k.json(await setWords('owner', 'Commission is paid on collected money only.'))).body.commissionDisclaimerVersion).toBe(1)
    expect((await mine('rep')).accepted).toBe(true)
    // New words: version 2, everyone accepts again; the old acceptance keeps its old words.
    expect((await k.json(await setWords('owner', 'Commission is paid on collected money, less any refund.'))).body.commissionDisclaimerVersion).toBe(2)
    expect((await mine('rep')).accepted).toBe(false)
    expect((await k.json(await k.as('rep')('/api/commissions'))).body.disclaimerRequired).toBe(true)
    const second = await k.json(await k.as('manager')('/api/commission-disclaimer/acceptances'))
    expect(second.body.data.every((a: any) => a.accepted === false)).toBe(true)
    expect((await k.t.db.select().from(k.t.schema.commissionDisclaimerAcceptance))[0].disclaimerText).toBe('Commission is paid on collected money only.')
    // Cleared: nothing is withheld.
    expect((await k.json(await setWords('owner', null))).body.commissionDisclaimer).toBeNull()
    expect((await mine('rep')).accepted).toBe(true)
    expect((await seen('rep')).length).toBe(1)
  })
})
