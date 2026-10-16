// The hire dialog and the new caregiver's password; the public pages' browser tab. (Run 3, 10/16)
//
//   "The hire dialog prints the new caregiver's temporary password in plain text on screen (it is also emailed separately)."
//   "The public careers page tab is titled 'Test Home Care Co CRM'."
//
// POST /api/applications/:id/hire now WAITS for the welcome email. Sent → the response says where it went and carries no
// password, and the dialog says "Login details emailed to …". Not sent (the provider refused, or none is configured) →
// the password comes back so the office can hand it over, and the dialog says the email did not go.
// The email is delivered to an SMTP stand-in on 127.0.0.1 inside this test; nothing leaves the machine.
import net from 'node:net'
import { readFileSync } from 'node:fs'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}

// ── a minimal SMTP server: accepts, or refuses every recipient
let refuse = false
const delivered: string[] = []
const smtp = net.createServer((sock) => {
  sock.write('220 stub ESMTP\r\n')
  let buf = '', inData = false
  sock.on('data', (chunk) => {
    buf += chunk.toString('utf8')
    for (;;) {
      if (inData) {
        const end = buf.indexOf('\r\n.\r\n')
        if (end < 0) return
        delivered.push(buf.slice(0, end)); buf = buf.slice(end + 5); inData = false
        sock.write('250 OK queued\r\n')
        continue
      }
      const i = buf.indexOf('\r\n')
      if (i < 0) return
      const line = buf.slice(0, i); buf = buf.slice(i + 2)
      const cmd = line.slice(0, 4).toUpperCase()
      if (cmd === 'RCPT') sock.write(refuse ? '550 5.1.1 No such mailbox\r\n' : '250 OK\r\n')
      else if (cmd === 'DATA') { sock.write('354 go ahead\r\n'); inData = true }
      else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end() }
      else sock.write('250 OK\r\n')
    }
  })
  sock.on('error', () => {})
})
await new Promise<void>((r) => smtp.listen(0, '127.0.0.1', () => r()))
process.env.SMTP_HOST = '127.0.0.1'
process.env.SMTP_PORT = String((smtp.address() as any).port)
process.env.ENCRYPTION_KEY = 'a'.repeat(64)
process.env.FRONTEND_URL = 'https://hire-test.example'

const { Hono } = await import('hono')
const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { agencies, users } = await import('./db/schema.ts')
const { eq } = await import('drizzle-orm')
const [ag] = await db.insert(agencies).values({ name: 'Hire Care', slug: 'hire-care', state: 'MN', email: 'office@hire.test' } as any).returning()
const [admin] = await db.insert(users).values({ email: 'admin@hire.test', passwordHash: 'x', firstName: 'Ada', lastName: 'Admin', role: 'admin' } as any).returning()

const app = new Hono()
app.route('/api/applications', (await import('./src/routes/applications.ts')).default)
app.route('/api/public/careers', (await import('./src/routes/careersPublic.ts')).default)
const call = async (who: any, method: string, path: string, body?: unknown) => {
  const h: Record<string, string> = { 'content-type': 'application/json' }
  if (who) Object.assign(h, { 'x-test-user': who.id, 'x-test-company': ag.id, 'x-test-role': who.role })
  const res = await app.request(path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const apply = async (first: string, email: string) => {
  const r = await call(null, 'POST', '/api/public/careers/apply', { firstName: first, lastName: 'Applicant', email, phone: '555-0100' })
  if (r.status !== 200) throw new Error('apply failed: ' + JSON.stringify(r.json))
  return r.json.applicationId as string
}

{
  const id = await apply('Sam', 'sam.applicant@example.test')
  const hire = await call(admin, 'POST', `/api/applications/${id}/hire`, { hourlyRate: 17 })
  const welcome = delivered.find((d) => /Your Login Credentials/.test(d.replace(/=\r\n/g, '')))
  check(`emailed: the hire succeeds and says the login went by email (${hire.status})`, hire.status === 200 && hire.json.credentialsEmailed === true && hire.json.emailedTo === 'sam.applicant@example.test', hire.json)
  check('emailed: …and hands the screen NO password — it is in the caregiver\'s inbox, not on the office monitor', !('tempPassword' in hire.json) && !('temp_password' in hire.json) && !/Temporary password/i.test(hire.json.message), hire.json)
  check('emailed: …the message names where it went', /emailed to sam\.applicant@example\.test/.test(hire.json.message), hire.json.message)
  check('emailed: the welcome email really went, carrying the login', !!welcome && /sam\.applicant@example\.test/.test(welcome))
  const [u] = await db.select().from(users).where(eq(users.email, 'sam.applicant@example.test'))
  check('emailed: the caregiver login exists', u?.role === 'caregiver')
}
{
  refuse = true
  const id = await apply('Lee', 'lee.applicant@example.test')
  const hire = await call(admin, 'POST', `/api/applications/${id}/hire`, {})
  check(`email refused: the hire still stands — an email failure never undoes it (${hire.status})`, hire.status === 200 && hire.json.success === true, hire.json)
  check('email refused: credentialsEmailed is false and the temporary password comes back to hand over', hire.json.credentialsEmailed === false && typeof hire.json.tempPassword === 'string' && hire.json.tempPassword.length >= 8, hire.json)
  check('email refused: …and the message says the email could not be sent', /could not be sent to lee\.applicant@example\.test/.test(hire.json.message), hire.json.message)
  const typed = await apply('Kim', 'kim.applicant@example.test')
  const own = await call(admin, 'POST', `/api/applications/${typed}/hire`, { password: 'OfficeChose123' })
  check('email refused: a password the office typed comes back as typed', own.json.tempPassword === 'OfficeChose123', own.json)
  refuse = false
}

// ── the screens that show the result
{
  const root = process.env.FACTORY_ROOT || '../../'
  const fe = root + 'templates/crm-homecare/frontend/src/'
  const dash = readFileSync(fe + 'components/admin/ApplicationsDashboard.tsx', 'utf8')
  check('the hire dialog says "Login details emailed to" when the email went', /hireResult\.credentialsEmailed \?/.test(dash) && /Login details emailed to/.test(dash))
  check('…and prints the password only in the not-emailed branch', /\{hireResult\.tempPassword && <div[^>]*><strong>Temp Password:<\/strong>/.test(dash) && dash.indexOf('Temp Password:') > dash.indexOf('Login details emailed to'))
  const detail = readFileSync(fe + 'components/admin/ApplicationDetail.tsx', 'utf8')
  check('the application page shows the password only when the email did not go', /!data\.credentialsEmailed && data\.tempPassword/.test(detail))

  // The browser tab on the public pages.
  const careers = readFileSync(fe + 'pages/CareersPage.tsx', 'utf8')
  check('the careers page names its tab "Careers — <agency>" (or the opening), not "<agency> CRM"', /usePageTitle\(slug && posting\?\.title \? `\$\{posting\.title\} — Careers at \{\{COMPANY_NAME\}\}` : `Careers — \{\{COMPANY_NAME\}\}`\)/.test(careers))
  const appTsx = readFileSync(fe + 'App.tsx', 'utf8')
  for (const [path, title] of [['/portal/\\*', 'Client portal'], ['/family/\\*', 'Family portal'], ['/onboarding/:token', 'Your onboarding'], ['/pay/:invoiceId', 'Pay your invoice']]) {
    check(`${path.replace('\\', '')} names its tab "${title} — <agency>"`, new RegExp(`path="${path}"\\s+element=\\{<Titled title=\\{\`${title} — \\$\\{AGENCY\\}\`\\}>`).test(appTsx))
  }
  check('the agency name is pasted into a template literal, so an apostrophe cannot break the build', /const AGENCY = `\{\{COMPANY_NAME\}\}`;/.test(appTsx))
  const hook = readFileSync(fe + 'hooks/usePageTitle.ts', 'utf8')
  check('the title is put back when the page closes', /return \(\) => \{ document\.title = before; \};/.test(hook))
}

smtp.close()
console.log(`\nhomecare-hire-credentials: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
