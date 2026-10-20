// Every website form that asks to be contacted posts here: the contact form (a plain post, or fetch from its inline
// script), the care finder (JSON), catering enquiries and the service-area waitlist. Moved from the premium site's
// handleLead: a per-address limit, a honeypot and a minimum time on the page stop bots; every answer the form asked
// for is kept; the enquiry is saved where the business works its leads (core/enquiry.ts) and the owner is emailed.
import type { Context } from 'hono'
import { asc } from 'drizzle-orm'
import { company } from '../db/schema/index.ts'
import type { VerticalSettings } from '../core/vertical.ts'
import type { createEnquiries } from '../core/enquiry.ts'
import { fail, done } from '../http/reply.ts'
import { escHtml } from './render.ts'
import { BAR_FORMS, BAR_FORM_THANKS } from '../crm/bar/enquiry.ts'

const WINDOW_MS = 10 * 60 * 1000
const MAX_PER_WINDOW = 5
const THANKS = "Got it — thanks. We'll be in touch soon."
/** Form fields that are the form's own machinery or already read by name, so not repeated as "extra answers". */
const CONTROL = new Set(['name', 'email', 'phone', 'project', 'message', 'notes', 'source', 'website', 'honeypot', 't'])

function clientIp(c: Context): string {
  const xff = c.req.header('X-Forwarded-For') || ''
  if (xff) return xff.split(',')[0].trim()
  return c.req.header('CF-Connecting-IP') || c.req.header('X-Real-IP') || 'unknown'
}

/** The page a visitor sees after a no-script form post: one line and a way back. */
function replyPage(ok: boolean, text: string, referer?: string): string {
  let back = '/'
  try { if (referer) back = new URL(referer).pathname || '/' } catch {}
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex"><title>' + (ok ? 'Thank you' : 'Please try again') + '</title>' +
    '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:17px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:#f7f7f5;color:#1a1a1a}' +
    'main{max-width:30rem;padding:2rem 1rem;text-align:center}h1{font-size:1.6rem;margin:0 0 .5rem}a{color:inherit;font-weight:600}</style></head>' +
    '<body><main><h1>' + (ok ? 'Thank you.' : 'That didn’t go through.') + '</h1><p>' + escHtml(text) + '</p>' +
    '<p><a href="' + escHtml(back) + '">' + (ok ? 'Back to the site' : 'Go back and try again') + '</a></p></main></body></html>'
}

export function createEnquiryHandler(deps: { db: any; vertical: VerticalSettings; enquiries: ReturnType<typeof createEnquiries> }) {
  const { db, vertical, enquiries } = deps
  const buckets = new Map<string, number[]>()

  return async function handle(c: Context) {
    const isJson = (c.req.header('content-type') || '').includes('application/json')
    // A browser posting without script gets a page back, not raw JSON.
    const wantsPage = !isJson && (c.req.header('accept') || '').includes('text/html')
    const reply = (ok: boolean, text: string, status: 200 | 400 | 429 | 500 = ok ? 200 : 400) =>
      wantsPage ? c.html(replyPage(ok, text, c.req.header('referer')), status) : ok ? done(c, text) : fail(c, status as 400 | 429 | 500, text)

    // The limit first, so a flood never reaches the database or the mail.
    const ip = clientIp(c)
    const now = Date.now()
    const times = (buckets.get(ip) || []).filter((t) => now - t < WINDOW_MS)
    if (times.length >= MAX_PER_WINDOW) {
      c.header('Retry-After', String(Math.ceil((WINDOW_MS - (now - times[0])) / 1000)))
      return reply(false, 'Too many submissions. Please try again later.', 429)
    }
    times.push(now)
    buckets.set(ip, times)

    try {
      const body = (isJson ? await c.req.json().catch(() => ({})) : await c.req.parseBody({ all: true })) as Record<string, any>
      // Bots fill every field, including the hidden one; a real person takes longer than 1.5s. Both get a quiet
      // "thanks" so the bot learns nothing.
      if (String(body.website || body.honeypot || '').trim()) return reply(true, THANKS)
      const stamp = parseInt(String(body.t || '0'), 10)
      if (stamp > 0 && Date.now() - stamp < 1500) return reply(true, THANKS)

      const one = (v: any) => (Array.isArray(v) ? v.map(String).join(', ') : String(v ?? '')).trim()
      const email = one(body.email)
      const source = one(body.source) || String(c.req.header('referer') || '').trim() || null
      // The waitlist asks only for an email; the lead still needs a name the business can read.
      const name = one(body.name) || (source === 'service-area-waitlist' ? 'Service-area waitlist' : '')
      const phone = one(body.phone) || null
      // A dealership's pipeline (CrmSettings.websiteEnquiries 'pipeline') takes the website chat's lead as the RV CRM
      // did (templates/crm-rv routes/webhooks.ts; website-rv server-static.ts /api/chat): an email OR a phone, and the
      // unit the visitor asked about (`unitOfInterest`), kept on its own so its stock number can link the unit.
      const pipeline = vertical.crm?.websiteEnquiries === 'pipeline'
      const interest = pipeline ? one(body.unitOfInterest).slice(0, 200) : ''
      // What they wrote, plus every other answer the form asked for (event date, headcount, ZIP, care type…).
      const extras = Object.keys(body).filter((k) => !CONTROL.has(k) && !(pipeline && k === 'unitOfInterest') && one(body[k])).slice(0, 20)
        .map((k) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, (x) => x.toUpperCase()) + ': ' + one(body[k]).slice(0, 500))
      const message = [one(body.message || body.project || body.notes), ...extras].filter(Boolean).join('\n').slice(0, 5000)

      if (!name || name.length < 2) return reply(false, 'Name is required.')
      // A vertical's own forms (CrmSettings.websiteForms: the bar's party request and Regulars sign-up) take an email
      // or a phone number and need no message; every other form needs an email and a message.
      const ownForm = vertical.crm?.websiteForms === 'bar' && BAR_FORMS.has(one(body.formType))
      if (ownForm) {
        if (email && !email.includes('@')) return reply(false, 'Valid email required.')
        if (!email && !phone) return reply(false, 'An email or a phone number, so we can reach you.')
      } else if (pipeline) {
        // An email or a phone, and something to go on: what they wrote, or the unit they asked about.
        if (email && !email.includes('@')) return reply(false, 'Valid email required.')
        if (!email && !phone) return reply(false, 'An email or a phone number, so we can reach you.')
        if (!interest && (!message || message.length < 4)) return reply(false, vertical.site.words.contactMessageRequired)
      } else {
        if (!email || !email.includes('@')) return reply(false, 'Valid email required.')
        if (!message || message.length < 4) return reply(false, vertical.site.words.contactMessageRequired)
      }

      const [co] = await db.select({ id: company.id, name: company.name, email: company.email }).from(company).orderBy(asc(company.createdAt)).limit(1)
      if (!co) return reply(false, 'Could not save your message. Please try again.', 500)
      const form = ownForm ? Object.fromEntries(Object.keys(body).slice(0, 40).map((k) => [k, one(body[k]).slice(0, 2000)])) : undefined
      const enquiry = { name, email, phone, message, source, form, ip, ...(interest ? { interest } : {}) }
      await enquiries.record(co.id, enquiry)
      void enquiries.notifyOwner({ email: co.email, companyName: co.name }, enquiry)
      // The bar's own forms answer in its words ("You're on the list."); every other form says thanks.
      return reply(true, (ownForm && BAR_FORM_THANKS[one(body.formType)]) || THANKS)
    } catch (err: any) {
      console.error('[enquiry] not saved:', err?.message)
      return reply(false, 'Could not save your message. Please try again.', 500)
    }
  }
}

