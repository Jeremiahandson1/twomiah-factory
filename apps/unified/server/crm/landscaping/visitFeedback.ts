// The customer's feedback on a visit (landscaping parity row 31, Jobber's feedback survey; feature `visit_survey`, not ready). The
// visit-done message carries a signed link (data/visitReports.ts feedbackToken, good for 60 days); it opens a small page here — no
// sign-in, no script — where the customer gives 1 to 5 and a comment. Mounted PUBLIC at /api/visit-feedback: the link is the only key.
//
//   GET  /:token        the page (?r=1..5 picks a rating, as the email's buttons do)
//   POST /:token        the answer (a form post); one answer per visit — a second shows the first
//
// A rating under the business's alert line emails its office people. The rating shows on the visit's report and the Visit messages
// screen (crm/landscaping/visitReports.ts).
import { Hono } from 'hono'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { readFeedbackToken, feedbackView, rateVisit, VISIT_SURVEY, MAX_COMMENT } from '../../data/visitReports.ts'

const esc = (s: string) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string))

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${esc(title)}</title>
<style>
body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#f9fafb;color:#111827}
main{max-width:520px;margin:0 auto;padding:32px 16px}
h1{font-size:22px;margin:0 0 8px}
p{line-height:1.5}
.stars{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}
.stars label{flex:1;min-width:56px}
.stars input{position:absolute;opacity:0}
.stars span{display:block;text-align:center;padding:12px 0;border:1px solid #d1d5db;border-radius:10px;background:#fff;font-size:18px;cursor:pointer}
.stars input:checked+span{border-color:#16a34a;background:#dcfce7;font-weight:bold}
.stars input:focus-visible+span{outline:2px solid #2563eb;outline-offset:2px}
textarea{width:100%;box-sizing:border-box;min-height:110px;border:1px solid #d1d5db;border-radius:10px;padding:10px;font:inherit}
button{margin-top:16px;width:100%;padding:12px;border:0;border-radius:10px;background:#16a34a;color:#fff;font-size:16px;font-weight:bold;cursor:pointer}
.muted{color:#6b7280;font-size:14px}
.err{color:#b91c1c}
@media (prefers-color-scheme: dark){body{background:#0f172a;color:#e5e7eb}.stars span,textarea{background:#1e293b;border-color:#334155;color:#e5e7eb}.stars input:checked+span{background:#14532d;border-color:#22c55e}.muted{color:#94a3b8}}
</style></head><body><main>${body}</main></body></html>`
}

const LABELS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent']

function form(v: { title: string; companyName: string }, picked: number | null, error?: string) {
  const stars = [1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="rating" value="${n}"${picked === n ? ' checked' : ''} required><span>${n} ★<br><small>${LABELS[n]}</small></span></label>`).join('')
  return page('How did we do?', `<h1>How did we do?</h1>
<p>${esc(v.companyName)} would like to know how <b>${esc(v.title)}</b> went.</p>
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
<form method="post"><fieldset style="border:0;padding:0;margin:0"><legend class="muted">Your rating, 1 (poor) to 5 (excellent)</legend><div class="stars">${stars}</div></fieldset>
<label for="comment" class="muted">Anything you want us to know? (optional)</label>
<textarea id="comment" name="comment" maxlength="${MAX_COMMENT}"></textarea>
<button type="submit">Send</button></form>`)
}

const thanks = (v: { companyName: string; rating: number | null }, again = false) => page('Thank you', `<h1>Thank you</h1>
<p>${again ? 'We already have your answer for this visit' : 'Your answer is with us'}: ${v.rating} of 5.</p>
<p class="muted">${esc(v.companyName)} reads every one. You can close this page.</p>`)

const gone = () => page('Link not working', `<h1>This link is not working</h1><p>It may have run out. Reply to the message you got if you want to tell us how the visit went.</p>`)

export function createVisitFeedbackRoutes(d: CrmDeps) {
  const app = new Hono<AppEnv>()
  /** The visit a link names, if the link is good and the business has the survey on. */
  const named = async (token: string) => {
    const t = readFeedbackToken(token)
    if (!t) return null
    if (!(await d.features.isFeatureEnabled(t.companyId, VISIT_SURVEY).catch(() => false))) return null
    const view = await feedbackView(d.db, t.companyId, t.reportId)
    return view ? { ...t, view } : null
  }

  app.get('/:token', async (c) => {
    c.header('X-Robots-Tag', 'noindex, nofollow')
    c.header('Cache-Control', 'no-store')
    const n = await named(c.req.param('token'))
    if (!n) return c.html(gone(), 404)
    if (n.view.rating != null) return c.html(thanks(n.view, true))
    const r = Number(c.req.query('r'))
    return c.html(form(n.view, Number.isInteger(r) && r >= 1 && r <= 5 ? r : null))
  })

  app.post('/:token', async (c) => {
    c.header('X-Robots-Tag', 'noindex, nofollow')
    c.header('Cache-Control', 'no-store')
    const n = await named(c.req.param('token'))
    if (!n) return c.html(gone(), 404)
    const body: any = await c.req.parseBody().catch(() => ({}))
    const rating = Number(body?.rating)
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return c.html(form(n.view, null, 'Pick a rating from 1 to 5.'), 400)
    const comment = typeof body?.comment === 'string' ? body.comment : null
    const out = await rateVisit(d.db, n.companyId, n.reportId, rating, comment, (m) => (d.services as any).emailService.sendRaw(m))
    if (out.status === 'missing') return c.html(gone(), 404)
    return c.html(thanks(out.view, out.status === 'already'))
  })

  return app
}
