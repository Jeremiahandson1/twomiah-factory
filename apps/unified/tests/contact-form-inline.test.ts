// The website's contact form says what is missing in its own words, under the box (live test 2026-10-22: "Name is
// required" showed only as the browser's tooltip). The real /contact page from the server, run in happy-dom with its
// own inline script: an empty Send shows each message, marks the box, focuses the first and posts nothing; the server
// still refuses on its own.
import { describe, test, expect, beforeAll } from 'bun:test'
import { Window } from 'happy-dom'
import { bootTenant, seedOwner } from './harness.ts'

let html = ''
let t: Awaited<ReturnType<typeof bootTenant>>
beforeAll(async () => {
  t = await bootTenant()
  const s = await seedOwner(t)
  await t.db.insert(t.schema.website).values({ companyId: s.company.id } as any)
  await t.db.insert(t.schema.page).values({ companyId: s.company.id, slug: 'contact', title: 'Contact', isPublished: true, sections: [{ type: 'contact', variant: 'form-info', data: { heading: 'Talk to us' } }] } as any)
  const r = await t.call('/contact')
  expect(r.status).toBe(200)
  html = await r.text()
}, 60_000)

// Send as a browser does: the submit event the form's script listens for. A click on the button fired it under one test
// runner and not the CI's (2026-10-22); the behaviour under test is the script's answer to submit.
const send = (win: any, form: any) => form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }))

function page() {
  const win: any = new Window({ url: 'https://site.example.com/contact', settings: { enableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true, suppressInsecureJavaScriptEnvironmentWarning: true } } as any)
  // Under the servers' Bun (1.3.14, what CI runs) happy-dom's script context is missing the language's own globals —
  // the page's script failed on Number and Date, which every browser has. They are handed over, nothing else.
  for (const k of ['Number', 'Date', 'Math', 'JSON', 'String', 'Array', 'Object', 'RegExp', 'Boolean', 'Error', 'Promise', 'encodeURIComponent', 'decodeURIComponent', 'parseInt', 'parseFloat', 'isNaN']) if (typeof win[k] === 'undefined') win[k] = (globalThis as any)[k]
  const posts: any[] = []
  win.fetch = async (url: string, init: any) => { posts.push({ url, init }); return { ok: true, json: async () => ({ message: 'Thanks' }) } }
  win.document.write(html)
  return { win, doc: win.document, posts }
}

describe('the contact form, empty, sent', () => {
  test('each required box gets its own message under it; the first is focused; nothing is posted', async () => {
    const { win, doc, posts } = page()
    const form = doc.querySelector('form.contact-form')
    expect(form).not.toBeNull()
    expect(form.noValidate).toBe(true)
    send(win, form)
    await new Promise((r) => setTimeout(r, 10))
    const msg = (id: string) => doc.getElementById(id)
    expect(msg('cf-name-err').hidden).toBe(false)
    expect(msg('cf-name-err').textContent).toBe('Please enter your name.')
    expect(msg('cf-email-err').textContent).toBe('Please enter your email address.')
    expect(msg('cf-message-err').textContent.length).toBeGreaterThan(5)
    expect(doc.getElementById('cf-name').getAttribute('aria-invalid')).toBe('true')
    expect(doc.activeElement?.id).toBe('cf-name')
    expect(posts).toHaveLength(0)
    win.close()
  })

  test('a bad email is named; once fixed and filled in, the form posts and the messages clear', async () => {
    const { win, doc, posts } = page()
    const set = (id: string, v: string) => { const el = doc.getElementById(id); el.value = v; el.dispatchEvent(new win.Event('input', { bubbles: true })) }
    set('cf-name', 'Pat Lee'); set('cf-email', 'pat@'); set('cf-message', 'Kitchen remodel next spring')
    send(win, doc.querySelector('form.contact-form'))
    await new Promise((r) => setTimeout(r, 10))
    expect(doc.getElementById('cf-email-err').textContent).toContain('valid email')
    expect(doc.getElementById('cf-name-err').hidden).toBe(true)
    expect(posts).toHaveLength(0)
    set('cf-email', 'pat@example.com')
    expect(doc.getElementById('cf-email-err').hidden).toBe(true)
    send(win, doc.querySelector('form.contact-form'))
    await new Promise((r) => setTimeout(r, 10))
    expect(posts).toHaveLength(1)
    expect(posts[0].url).toContain('/api/leads')
    win.close()
  })

  test('the server keeps its own check', async () => {
    const r = await t.call('/api/leads', { method: 'POST', json: { name: '', email: 'x@example.com', message: 'Hello there' }, headers: { Accept: 'application/json' } })
    expect(r.status).toBe(400)
    expect((await r.json()).error).toBe('Name is required.')
  })
})
