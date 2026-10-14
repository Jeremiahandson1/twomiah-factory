// Add User emails a link to choose a password. (E2E run 1, 10/14: "Owner types a temporary password for each seat;
// no invite email is sent.") The teamInvite email existed in every template and nothing sent it. Now an add without a
// password is an invite: the link lands on the reset-password page, works once, and lapses after 7 days; Resend invite
// issues a fresh one to someone who has never signed in. Setting a password yourself still works.
process.env.JWT_SECRET ||= 'invite-access-secret-for-tests-only'
process.env.JWT_REFRESH_SECRET ||= 'invite-refresh-secret-for-tests-only'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user } = await import('./db/schema.ts')
const emailService: any = (await import('./src/services/email.ts')).default

const [co] = await db.insert(company).values({ name: 'Invite Builders', slug: 'invite-builders', email: 'ib@test.local', settings: {}, enabledFeatures: ['team'] } as any).returning()
const mk = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-ib@test.local`, passwordHash: await Bun.password.hash('owner-pass-123', 'bcrypt'), firstName: tag === 'owner' ? 'Olive' : tag, lastName: 'Owens', role, companyId: co.id, isActive: true,
} as any).returning())[0]
const owner = await mk('owner', 'owner')
const manager = await mk('manager', 'manager')

// The email service as the route calls it — captured, never sent.
const sent: Array<{ to: string; data: any }> = []
let answer: any = { success: true }
emailService.sendTeamInvite = async (to: string, data: any) => { sent.push({ to, data }); if (answer instanceof Error) throw answer; return answer }

const app = new Hono()
app.route('/api/company', (await import('./src/routes/company.ts')).default)
app.route('/api/auth', (await import('./src/routes/auth.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const call = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', ...(who ? { 'x-test-user': who.id } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const asOwner = call(owner), asManager = call(manager), anon = call(null)
const row = async (email: string) => (await db.select().from(user).where(eq(user.email, email)).limit(1))[0] as any
const tokenOf = (link: string) => new URL(link, 'https://x.test').searchParams.get('token')

// ══════════ 1. an invite ═══════════════════════════════════════════════════════════════════════
{
  const r = await asOwner('POST', '/api/company/users', { email: 'Pat@Test.local', firstName: 'Pat', lastName: 'Lee', role: 'field' })
  check(`adding a user with no password is an invite (${r.status})`, r.status === 201 && r.json?.invited === true && r.json?.inviteSent === true, r.json)
  const mail = sent.at(-1)
  check('…emailed to them', mail?.to === 'pat@test.local', mail)
  check('…from the person who sent it, for this company, in the role\'s own word', mail?.data?.inviterName === 'Olive Owens' && mail?.data?.companyName === 'Invite Builders' && typeof mail?.data?.role === 'string' && mail.data.role.length > 0, mail?.data)
  check('…with a link to the reset-password page', /\/reset-password\?token=[0-9a-f-]{36}$/.test(mail?.data?.inviteLink || ''), mail?.data?.inviteLink)
  const p = await row('pat@test.local')
  const days = (new Date(p.resetTokenExp).getTime() - Date.now()) / 86_400_000
  check('…which lasts 7 days', days > 6.9 && days <= 7, days)
  check('…and the token in the link is the one stored', tokenOf(mail.data.inviteLink) === p.resetToken)
  check('the seat is active and nobody knows its password', p.isActive === true && !(await Bun.password.verify('', p.passwordHash).catch(() => false)))

  const listed = await asOwner('GET', '/api/company/users')
  const patRow = (listed.json || []).find((u: any) => u.email === 'pat@test.local')
  check('the Users list says the invite is pending, not plain Active', patRow?.invitePending === true, patRow)
  check('…and never sends the token that is the password link', !JSON.stringify(listed.json).includes(p.resetToken) && !('resetToken' in (patRow || {})), Object.keys(patRow || {}))
  const sentHtml = (await import('./src/services/email.ts')).templates.teamInvite({ ...mail.data })
  check('the invite greets them by name, and its subject names the company once', /Hi Pat,/.test(sentHtml.html) && sentHtml.subject === "You're invited to join Invite Builders", sentHtml.subject)
  const { inlineButtonColours } = await import('./src/services/email.ts')
  check('the button carries its colours on the element itself', /class="button"[^>]*style="[^"]*color:#ffffff !important/.test(inlineButtonColours(sentHtml.html)))

  const set = await anon('POST', '/api/auth/reset-password', { token: p.resetToken, password: 'pats-own-pass-1' })
  check(`the link sets their password (${set.status})`, set.status === 200, set.json)
  const login = await anon('POST', '/api/auth/login', { email: 'pat@test.local', password: 'pats-own-pass-1' })
  check(`…and they can sign in with it (${login.status})`, login.status === 200 && !!login.json?.accessToken, login.json)
  const after = ((await asOwner('GET', '/api/company/users')).json || []).find((u: any) => u.email === 'pat@test.local')
  check('once they have chosen a password the invite is no longer pending', after?.invitePending === false, after)
  const again = await anon('POST', '/api/auth/reset-password', { token: p.resetToken, password: 'someone-else-1' })
  check(`the link works once (${again.status})`, again.status === 400, again.json)
}

// ══════════ 2. it lapses; Resend invite gives a fresh one ══════════════════════════════════════
{
  await asOwner('POST', '/api/company/users', { email: 'sam@test.local', firstName: 'Sam', lastName: 'Ray', role: 'field' })
  const s1 = await row('sam@test.local')
  await db.update(user).set({ resetTokenExp: new Date(Date.now() - 1000) } as any).where(eq(user.id, s1.id))
  const late = await anon('POST', '/api/auth/reset-password', { token: s1.resetToken, password: 'sams-pass-123' })
  check(`an expired invite is refused (${late.status})`, late.status === 400, late.json)

  const re = await asOwner('POST', `/api/company/users/${s1.id}/invite`, {})
  const s2 = await row('sam@test.local')
  check(`Resend invite sends a new link (${re.status})`, re.status === 200 && re.json?.inviteSent === true && s2.resetToken && s2.resetToken !== s1.resetToken && tokenOf(sent.at(-1)!.data.inviteLink) === s2.resetToken, re.json)
  const ok = await anon('POST', '/api/auth/reset-password', { token: s2.resetToken, password: 'sams-pass-123' })
  check('…which works', ok.status === 200, ok.json)

  await db.update(user).set({ lastLogin: new Date() } as any).where(eq(user.id, s1.id))
  const signedIn = await asOwner('POST', `/api/company/users/${s1.id}/invite`, {})
  check(`someone who has signed in is pointed to Forgot password instead (${signedIn.status})`, signedIn.status === 409, signedIn.json)
}

// ══════════ 3. a send that fails ═══════════════════════════════════════════════════════════════
{
  answer = new Error('SMTP_HOST is not configured')
  const r = await asOwner('POST', '/api/company/users', { email: 'kim@test.local', firstName: 'Kim', lastName: 'Fox', role: 'field' })
  check(`a failed send still adds the seat and says it was not sent (${r.status})`, r.status === 201 && r.json?.invited === true && r.json?.inviteSent === false, r.json)
  answer = { success: false }
  const re = await asOwner('POST', `/api/company/users/${r.json?.id}/invite`, {})
  check('…a provider that answers success:false is "not sent" too', re.status === 200 && re.json?.inviteSent === false, re.json)
  answer = { success: true }
}

// ══════════ 4. the other doors ═════════════════════════════════════════════════════════════════
{
  const before = sent.length
  const r = await asOwner('POST', '/api/company/users', { email: 'lee@test.local', firstName: 'Lee', lastName: 'Ng', role: 'field', password: 'handed-over-1' })
  check(`a password set by the admin still works, and no invite goes (${r.status})`, r.status === 201 && !r.json?.invited && sent.length === before, r.json)
  const login = await anon('POST', '/api/auth/login', { email: 'lee@test.local', password: 'handed-over-1' })
  check('…they sign in with it', login.status === 200, login.json)

  const susp = await asOwner('POST', '/api/company/users', { email: 'off@test.local', firstName: 'Off', lastName: 'Line', role: 'field', isActive: false })
  check(`an invite for a suspended seat is refused (${susp.status})`, susp.status === 400, susp.json)

  const m = await asManager('POST', '/api/company/users', { email: 'nope@test.local', firstName: 'No', lastName: 'Pe', role: 'field' })
  check(`a manager cannot invite (${m.status})`, m.status === 403, m.json)
  const mr = await asManager('POST', `/api/company/users/${(await row('kim@test.local')).id}/invite`, {})
  check(`…or resend one (${mr.status})`, mr.status === 403, mr.json)
  const foreign = await asOwner('POST', '/api/company/users/00000000-0000-0000-0000-000000000000/invite', {})
  check(`resending to a user who is not in this company is a 404 (${foreign.status})`, foreign.status === 404, foreign.json)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
