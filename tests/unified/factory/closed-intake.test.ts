// The "see a preview first" website offer is closed and its code removed (apps/api/src/routes/factory/closedIntake.ts):
// its old addresses answer 410 with the way to the signup, and nothing in the Factory or the platform can still take a
// submission, write a preview, email a link to one or start its checkout.
import { test, expect } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { CLOSED_INTAKE_ROUTES, CLOSED_MESSAGE, SIGNUP_URL, registerClosedIntakeRoutes } from '../../../apps/api/src/routes/factory/closedIntake'

const ROOT = path.resolve(import.meta.dir, '../../..')
const { Hono } = createRequire(path.join(ROOT, 'apps/api/package.json'))('hono')
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const ID = '11111111-1111-4111-8111-111111111111'
const at = (p: string) => p.replace(':id', ID).replace(':slug', 'about')

/** Every .ts/.tsx file under a folder, as repo-relative paths with forward slashes. */
function sources(dir: string): string[] {
  return (fs.readdirSync(path.join(ROOT, dir), { recursive: true }) as string[])
    .map((f) => dir + '/' + String(f).replace(/\\/g, '/'))
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('/node_modules/'))
}

test('every old address of the offer answers 410 with the way to the signup', async () => {
  const a = new Hono()
  registerClosedIntakeRoutes(a)
  for (const [method, p, kind] of CLOSED_INTAKE_ROUTES) {
    const res = await a.request(at(p), { method: method.toUpperCase(), ...(method === 'post' ? { body: new FormData() } : {}) })
    expect(res.status).toBe(410)
    if (kind === 'json') {
      const body = await res.json() as any
      // The forms that posted here print `error` to the visitor: it has to say where to go instead.
      expect(body.error).toBe(CLOSED_MESSAGE)
      expect(body.error).toContain('twomiah.com/signup')
      expect(body.success).toBeUndefined()
      expect(body.ready).toBeUndefined()
    } else {
      const html = await res.text()
      expect(html).toContain('href="' + SIGNUP_URL + '"')
      expect(html).not.toContain('checkout-premium')
    }
  }
})

test('the list covers the form, its checkout, its feedback, its status and every page it showed', () => {
  expect(CLOSED_INTAKE_ROUTES.map(([m, p]) => m + ' ' + p)).toEqual([
    'post /public/intake',
    'post /public/intake/:id/feedback',
    'post /public/intake/:id/checkout-premium',
    'get /public/intake/:id/preview-premium',
    'get /public/intake/:id/preview-premium/:slug',
    'get /public/intake/:id/preview',
    'get /public/intake/:id/checkout-complete',
    'get /public/intake/:id/status',
  ])
})

test('the closed routes do not shadow the signup', async () => {
  const a = new Hono()
  registerClosedIntakeRoutes(a)
  a.post('/public/signup', (c: any) => c.json({ success: true }))
  a.post('/public/preview', (c: any) => c.text('preview'))
  expect((await a.request('/public/signup', { method: 'POST' })).status).toBe(200)
  expect((await a.request('/public/preview', { method: 'POST' })).status).toBe(200)
})

test('the Factory registers them, and no other route file answers an old address', () => {
  expect(read('apps/api/src/routes/factory.ts')).toContain('registerClosedIntakeRoutes(factory)')
  const routeFiles = sources('apps/api/src/routes').filter((f) => !f.endsWith('/closedIntake.ts'))
  const stillThere = routeFiles.filter((f) => /['"`]\/(public\/)?intake[/'"`]/.test(read(f)))
  expect(stillThere).toEqual([])
})

test('nothing in the Factory can still write, email or sell one of its previews', () => {
  const gone = [
    'composeIntakePreview', 'autoComposeForNewIntake', 'recomposePreviewWithFeedback', 'renderPremiumPreviewPage',
    'notifyNewIntake', 'notifyPreviewReady', 'notifyPreviewFollowup', 'notifyIntakeFeedback',
    'createPremiumWebsiteCheckout', 'injectApproveAndBuyWidget', 'injectFeedbackWidget', 'previewRetryDecision',
  ]
  const hits: string[] = []
  for (const f of sources('apps/api/src')) {
    const src = read(f)
    for (const name of gone) if (src.includes(name)) hits.push(f + ': ' + name)
  }
  expect(hits).toEqual([])
})

test('the sweep that retried its previews still resumes a signup\'s own site', () => {
  const intake = read('apps/api/src/routes/factory/intake.ts')
  const sweep = intake.slice(intake.indexOf("factory.post('/internal/preview-sweep'"))
  expect(sweep).toContain("if (!checkCronSecret(c)) return c.json({ error: 'Unauthorized' }, 401)")
  expect(sweep).toContain('resumeSignupComposes(await liveSignupSiteDeps())')
  expect(sweep).not.toContain("'intake'")
  expect(read('apps/api/src/services/scheduler.ts')).toContain("path: '/api/v1/factory/internal/preview-sweep'")
})

test('the platform sends /start to the signup; its form and its review screen are gone', () => {
  const appSrc = read('apps/platform/src/App.tsx')
  expect(appSrc).toContain('<Route path="/start" element={<StartClosed />} />')
  expect(appSrc).toContain('window.location.replace(SIGNUP_URL)')
  const hits = sources('apps/platform/src').filter((f) => /PublicIntakePage|PremiumReviewPage|premium-review|factory\/(public\/)?intake\//.test(read(f)))
  expect(hits).toEqual([])
  for (const f of ['apps/platform/src/pages/PublicIntakePage.tsx', 'apps/platform/src/pages/PremiumReviewPage.tsx'])
    expect(fs.existsSync(path.join(ROOT, f))).toBe(false)
})
