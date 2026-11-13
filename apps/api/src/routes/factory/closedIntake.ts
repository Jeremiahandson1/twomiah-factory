/**
 * The "see a preview first" website offer is CLOSED (owner, 2026-11-13).
 *
 * It was the Factory's first way to sell a website: a form (platform.twomiah.com/start and twomiah.com/businesses) posted
 * to /public/intake, the AI wrote a preview, the prospect was emailed a link, and "Approve & launch" on that page took a
 * payment and deployed the site. Its preview and its paid build both come from the old templates/website-premium-*, so a
 * customer who bought there started on the engine every new customer is being kept off. The one way in now is the signup
 * (POST /public/signup), which builds on the unified app.
 *
 * The offer's own code is removed: its handlers, its emails, its checkout, its retry sweep, the buy and feedback widgets
 * on its preview page, and the platform's form and staff review screens. What is left is this file — an old link or a
 * saved form gets a clear answer and the way to the signup, rather than a bare 404. Nothing is saved, nobody is
 * emailed, no model is called and no payment is started.
 */
import type { Hono } from 'hono'

export const SIGNUP_URL = 'https://twomiah.com/signup'

export const CLOSED_MESSAGE = 'This form has closed. To get your website, sign up at twomiah.com/signup.'

const CLOSED_PAGE = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<meta name="robots" content="noindex"><title>This preview has closed</title></head>' +
  '<body style="font:16px/1.6 system-ui,-apple-system,\'Segoe UI\',Roboto,sans-serif;padding:60px 24px;max-width:560px;margin:auto;color:#334155;background:#ffffff">' +
  '<h1 style="font:600 28px/1.2 Georgia,serif;color:#0f172a;margin:0 0 12px">This preview has closed</h1>' +
  '<p>We no longer sell websites from a preview link. You can start your site, and see it before you pay, when you sign up.</p>' +
  '<p style="margin-top:24px"><a href="' + SIGNUP_URL + '" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">Sign up at twomiah.com</a></p>' +
  '<p style="color:#475569;font-size:14px;margin-top:24px">Questions? Email <a href="mailto:support@twomiah.com" style="color:#1e40af">support@twomiah.com</a>.</p>' +
  '</body></html>'

/** The public routes of the closed offer: [method, path, what a caller gets]. */
export const CLOSED_INTAKE_ROUTES: ReadonlyArray<readonly ['post' | 'get', string, 'json' | 'page']> = [
  ['post', '/public/intake', 'json'],
  ['post', '/public/intake/:id/feedback', 'json'],
  ['post', '/public/intake/:id/checkout-premium', 'json'],
  ['get', '/public/intake/:id/preview-premium', 'page'],
  ['get', '/public/intake/:id/preview-premium/:slug', 'page'],
  ['get', '/public/intake/:id/preview', 'page'],
  ['get', '/public/intake/:id/checkout-complete', 'page'],
  ['get', '/public/intake/:id/status', 'json'],
]

export function registerClosedIntakeRoutes(factory: Hono<any>): void {
  for (const [method, path, kind] of CLOSED_INTAKE_ROUTES) {
    const answer = (c: any) => kind === 'json'
      ? c.json({ error: CLOSED_MESSAGE, closed: true, signupUrl: SIGNUP_URL }, 410)
      : c.html(CLOSED_PAGE, 410)
    if (method === 'post') factory.post(path, answer)
    else factory.get(path, answer)
  }
}
