// Salon live test, 2026-10-25 — Marketing:
//   1. the campaign body was a raw HTML box → a visual editor (packages/tenant-ui marketing/EmailEditor.tsx); whatever it
//      or anyone else sends is reduced to the email allow-list where it is saved (tenant-backend marketing/emailHtml.ts),
//      and an email saved before still sends exactly as written;
//   2. "All contacts with an email" → the business's own word (a salon's clients, a bar's guests);
//   3. "Company {{company}}" offered to businesses whose customers are people → only where they can be companies, and an
//      empty field leaves no stray space in the sent email.
import { describe, test, expect, afterAll } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { sanitizeEmailHtml, isSafeCss } from '../../../packages/tenant-backend/src/marketing/emailHtml.ts'
import { createMarketingService, personalize, MERGE_FIELDS } from '../../../packages/tenant-backend/src/marketing/marketing.ts'
import { registerVocabulary } from '../../../packages/tenant-ui/src/labels/vocabulary.ts'
import { marketingCopy, offeredMergeFields } from '../../../packages/tenant-ui/src/marketing/marketingCopy.ts'
import { buttonHtml, imageHtml, linkHtml, linkHref, imageSrc, editsVisually, previewDoc, editorOutput } from '../../../packages/tenant-ui/src/marketing/emailBlocks.ts'
import { bootTenant, seedOwner } from './harness.ts'

const ROOT = path.join(import.meta.dir, '..')
const verticals = fs.readdirSync(path.join(ROOT, 'verticals')).filter((v) => fs.existsSync(path.join(ROOT, 'verticals', v, 'settings.ts')))
const load = async (v: string) => (await import(path.join(ROOT, 'verticals', v, 'settings.ts'))).default as any
const FIELDS = MERGE_FIELDS.map((f) => ({ ...f, token: `{{${f.key}}}` }))
afterAll(() => registerVocabulary(null))

describe('the email allow-list (what is saved)', () => {
  test('script is stripped, with what is inside it', () => {
    expect(sanitizeEmailHtml('<p>Hi</p><script>alert(1)</script><SCRIPT src="https://x.test/a.js"></SCRIPT>')).toBe('<p>Hi</p>')
  })
  test('event handlers are stripped; the element stays', () => {
    expect(sanitizeEmailHtml('<p onclick="steal()">Hi</p>')).toBe('<p>Hi</p>')
    expect(sanitizeEmailHtml('<img src="https://x.test/a.png" onerror="steal()">')).toBe('<img src="https://x.test/a.png">')
    expect(sanitizeEmailHtml('<a href="https://x.test" OnMouseOver=\'steal()\'>go</a>')).toBe('<a href="https://x.test">go</a>')
  })
  test('javascript: links are stripped, however they are spelled', () => {
    for (const href of ['javascript:steal()', 'JaVaScRiPt:steal()', ' javascript:steal()', 'java&#115;cript:steal()', 'jav&#x09;ascript:steal()', 'data:text/html;base64,PHNjcmlwdD4=', 'vbscript:x', '/relative/path']) {
      expect(sanitizeEmailHtml(`<a href="${href}">go</a>`)).toBe('<a>go</a>')
    }
    expect(sanitizeEmailHtml('<a href=javascript:steal()>go</a>')).toBe('<a>go</a>')
  })
  test('links go to http(s), an email address or a phone; images load from http(s) only', () => {
    expect(sanitizeEmailHtml('<a href="mailto:hi@salon.test">mail</a> <a href="tel:+15551234567">call</a>')).toBe('<a href="mailto:hi@salon.test">mail</a> <a href="tel:+15551234567">call</a>')
    expect(sanitizeEmailHtml('<img src="data:image/png;base64,AAAA"><img src="javascript:x"><img src="/media/a.jpg">')).toBe('')
    expect(sanitizeEmailHtml('<img src="http://x.test/a.png" srcset="javascript:x 1x">')).toBe('<img src="http://x.test/a.png">')
  })
  test('frames, objects, forms, SVG and comments go', () => {
    expect(sanitizeEmailHtml('<iframe src="https://x.test">inside</iframe><object data="x">o</object><embed src="x">ok')).toBe('ok')
    expect(sanitizeEmailHtml('<svg><script>alert(1)</script></svg><math><mi>x</mi></math>after')).toBe('after')
    expect(sanitizeEmailHtml('<form action="https://x.test"><input name="p"><button formaction="javascript:x">Send</button></form>')).toBe('Send')
    expect(sanitizeEmailHtml('a<!--[if mso]><img src=x onerror=steal()><![endif]-->b')).toBe('ab')
    expect(sanitizeEmailHtml('<meta http-equiv="refresh" content="0;url=https://x.test"><base href="https://x.test/"><link rel="stylesheet" href="https://x.test/a.css">x')).toBe('x')
  })
  test('markup it cannot read as a tag is shown as text, never passed through', () => {
    expect(sanitizeEmailHtml('<a href="https://x.test"onclick="steal()">go</a>')).toBe('&lt;a href="https://x.test"onclick="steal()">go</a>')
    expect(sanitizeEmailHtml('<img/src="x"/onerror=steal()>')).toBe('&lt;img/src="x"/onerror=steal()>')
    expect(sanitizeEmailHtml('1 < 2 and <3')).toBe('1 &lt; 2 and &lt;3')
  })
  test('style that could run or fetch is dropped; ordinary style stays', () => {
    expect(sanitizeEmailHtml('<p style="width:expression(alert(1))">x</p>')).toBe('<p>x</p>')
    expect(sanitizeEmailHtml('<p style="background:url(javascript:alert(1))">x</p>')).toBe('<p>x</p>')
    expect(sanitizeEmailHtml('<p style="background:u\\72l(x)">x</p>')).toBe('<p>x</p>')
    expect(sanitizeEmailHtml('<style>@import url(https://x.test/a.css);</style><p>x</p>')).toBe('<p>x</p>')
    expect(isSafeCss('color:#111;background:url("https://x.test/bg.png")')).toBe(true)
    expect(isSafeCss('behavior:url(x.htc)')).toBe(false)
  })
  test('merge fields are kept — in the text and in a link', () => {
    const html = '<p>Hi {{firstName}}, {{ lastName }} — {email}</p><a href="https://salon.test/book?e={{email}}">Book</a>'
    expect(sanitizeEmailHtml(html)).toBe(html)
  })
  test('what the editor writes is kept byte for byte (the server never rewrites a clean body)', () => {
    const body = [
      '<h2>Spring at the salon</h2>',
      '<p>Hi {{firstName}}, <b>book</b> your <i>colour</i> refresh.</p>',
      '<ul><li>Cut</li><li>Colour</li></ul>',
      linkHtml('our menu', 'https://salon.test/menu'),
      imageHtml('https://salon.test/media/a.jpg', 'The chair'),
      buttonHtml('Book now', 'https://salon.test/book', '#c2410c'),
      // what Chrome writes back for the same button after an edit (inline colours as rgb())
      '<p><a href="https://salon.test/book" style="display: inline-block; padding: 12px 24px; background-color: rgb(194, 65, 12); color: rgb(255, 255, 255);">Book now</a></p>',
    ].join('')
    expect(sanitizeEmailHtml(body)).toBe(body)
  })
  test('an email built in HTML before the editor (tables, a style block) comes through unchanged', () => {
    const legacy = '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6"><tr><td align="center"><table width="600"><tr><td style="padding:24px;font-family:Arial">'
      + '<h1 style="color:#0f766e">Hello {{firstName}}</h1><p>Our <a href="https://x.test/offer" target="_blank">autumn offer</a>.</p></td></tr></table></td></tr></table>'
    expect(sanitizeEmailHtml(legacy)).toBe(legacy)
    const withStyle = '<style>.cta{color:#fff;background:#0f766e}</style><p class="cta">Go</p>'
    expect(sanitizeEmailHtml(withStyle)).toBe(withStyle)
  })
  test('running it twice changes nothing', () => {
    const messy = '<P ONCLICK=x Style=\'color:red\'>a<b>b</B><a href=\'https://x.test\' href="javascript:x">c</a><img src=https://x.test/i.png alt=hi><script>x</script>'
    const once = sanitizeEmailHtml(messy)
    expect(sanitizeEmailHtml(once)).toBe(once)
    expect(once).toBe('<p style="color:red">a<b>b</b><a href="https://x.test">c</a><img src="https://x.test/i.png" alt="hi">')
  })
})

describe('what the editor inserts', () => {
  test('a typed address becomes a link only to the web, an email address or a phone', () => {
    expect(linkHref('salon.test/book')).toBe('https://salon.test/book')
    expect(linkHref('hello@salon.test')).toBe('mailto:hello@salon.test')
    expect(linkHref('tel:+15551234567')).toBe('tel:+15551234567')
    expect(linkHref('javascript:alert(1)')).toBeNull()
    expect(linkHref('data:text/html,x')).toBeNull()
  })
  test("a photo from the library is made absolute; an inbox can't load /media/…", () => {
    expect(imageSrc('/media/abc.jpg', 'https://salon.example')).toBe('https://salon.example/media/abc.jpg')
    expect(imageSrc('javascript:x', 'https://salon.example')).toBeNull()
  })
  test('an email written as HTML opens in the HTML view; one the editor wrote opens in the editor', () => {
    expect(editsVisually('')).toBe(true)
    expect(editsVisually('<h2>Hi</h2><p>a <b>b</b></p><ul><li>c</li></ul>')).toBe(true)
    expect(editsVisually('<table><tr><td>x</td></tr></table>')).toBe(false)
    expect(editsVisually('<style>p{}</style><p>x</p>')).toBe(false)
    expect(editorOutput('<p><br></p>')).toBe('')
  })
  test('the preview fills the merge fields from a sample person, escaped', () => {
    registerVocabulary(null)
    const doc = previewDoc('<p>Hi {{firstName}} of {{company}}</p>', { firstName: '<b>Al</b>', company: 'Morgan & Co' }, FIELDS)
    expect(doc).toContain('<p>Hi &lt;b&gt;Al&lt;/b&gt; of Morgan &amp; Co</p>')
  })
})

describe('merge fields in the sent email', () => {
  test('an empty field leaves no stray space', () => {
    const person = { name: 'Pat', email: 'pat@test.example', company: '' }
    expect(personalize('Dear {{firstName}} {{lastName}}, welcome', person)).toBe('Dear Pat, welcome')
    expect(personalize('<p>Thanks {{firstName}} {{company}}!</p>', person, { html: true })).toBe('<p>Thanks Pat!</p>')
    expect(personalize('Hello {{company}} team', person)).toBe('Hello team')
    expect(personalize('Pat {{lastName}}', person)).toBe('Pat')
  })
  test('a value is text in the body, not markup; the subject is left plain', () => {
    const person = { name: 'Ann <img src=x onerror=steal()>', company: 'Smith & Sons', email: 'a@test.example' }
    expect(personalize('<p>{{name}} — {{company}}</p>', person, { html: true })).toBe('<p>Ann &lt;img src=x onerror=steal()&gt; — Smith &amp; Sons</p>')
    expect(personalize('For {{company}}', person)).toBe('For Smith & Sons')
  })
})

describe('the Marketing page in each business\'s words', () => {
  for (const v of verticals) {
    test(`${v}: the audience is its ${'customers'} by its own word`, async () => {
      const s = await load(v)
      registerVocabulary(s.vocabulary)
      const copy = marketingCopy()
      expect(copy.audienceAll).toBe(`All ${s.vocabulary.customer.many} with an email`)
      const words = Object.values(copy).filter((x) => typeof x === 'string').join(' | ') + ' | ' + copy.willGoTo(2) + copy.sentTo(1, 1) + copy.confirmSend('x') + copy.sequenceDeleted('x')
      expect(words).not.toMatch(/\bcontacts?\b/i)
    })
  }
  test('a salon reads clients, a bar guests', async () => {
    registerVocabulary((await load('salon')).vocabulary)
    expect(marketingCopy().audienceAll).toBe('All clients with an email')
    expect(marketingCopy().willGoTo(1)).toBe('This campaign will go to 1 client.')
    registerVocabulary((await load('bar')).vocabulary)
    expect(marketingCopy().audienceAll).toBe('All guests with an email')
  })
})

describe('the company merge field is offered where it means something', () => {
  const people = ['salon', 'vet', 'bar', 'restaurant']
  for (const v of verticals) {
    test(v, async () => {
      const s = await load(v)
      expect(typeof s.vocabulary.customerCompany).toBe('boolean')
      if (people.includes(v)) expect(s.vocabulary.customerCompany).toBe(false)
      registerVocabulary(s.vocabulary)
      const offered = offeredMergeFields(FIELDS).map((f) => f.key)
      expect(offered.includes('company')).toBe(s.vocabulary.customerCompany)
      // the rest are always offered
      for (const k of ['firstName', 'lastName', 'name', 'email']) expect(offered).toContain(k)
    })
  }
  test('a contractor keeps it; a template (no vocabulary) reads as it did', async () => {
    registerVocabulary((await load('contractor')).vocabulary)
    expect(offeredMergeFields(FIELDS).some((f) => f.key === 'company')).toBe(true)
    registerVocabulary(null)
    expect(offeredMergeFields(FIELDS).some((f) => f.key === 'company')).toBe(true)
  })
})

async function tenant(vertical: string) {
  const t = await bootTenant({ vertical })
  const seeded = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'email_marketing'] } as any).where(eq(t.schema.company.id, seeded.company.id))
  const res = await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })
  const token = (await res.json() as any).accessToken as string
  const owner = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
  await t.db.insert(t.schema.contact).values({ companyId: seeded.company.id, name: 'Ann Able', email: 'ann@test.example', type: 'client' } as any)
  return { t, owner, companyId: seeded.company.id as string }
}

const HOSTILE = '<h2>Hi {{firstName}}</h2><script>steal()</script><p onclick="steal()">x</p><a href="javascript:steal()">go</a><img src="https://x.test/a.png" onerror="steal()">'
const CLEAN = '<h2>Hi {{firstName}}</h2><p>x</p><a>go</a><img src="https://x.test/a.png">'

describe('the server keeps only the allow-list, wherever a body is saved', () => {
  test('a campaign, a template and a drip step', async () => {
    const { owner } = await tenant('salon')
    const made = await owner('/api/marketing/campaigns', { method: 'POST', json: { name: 'Spring', subject: 'Hi', body: HOSTILE, audienceType: 'all' } })
    expect(made.status).toBe(201)
    const campaign = await made.json() as any
    expect(campaign.content).toBe(CLEAN)
    const edited = await (await owner(`/api/marketing/campaigns/${campaign.id}`, { method: 'PUT', json: { body: HOSTILE + '<iframe src="https://x.test"></iframe>' } })).json() as any
    expect(edited.content).toBe(CLEAN)
    const template = await (await owner('/api/marketing/templates', { method: 'POST', json: { name: 'T', subject: 'Hi', body: HOSTILE } })).json() as any
    expect(template.body).toBe(CLEAN)
    const seq = await (await owner('/api/marketing/sequences', { method: 'POST', json: { name: 'S', active: true, steps: [{ delayDays: 0, delayHours: 0, subject: 'Hi', body: HOSTILE }] } })).json() as any
    expect(seq.steps[0].body).toBe(CLEAN)
  }, 120_000)

  test('a field we cannot fill is still refused', async () => {
    const { owner } = await tenant('salon')
    const r = await owner('/api/marketing/campaigns', { method: 'POST', json: { name: 'x', subject: 'Hi', body: '<p>Hi {{first_name}}</p>' } })
    expect(r.status).toBe(400)
  }, 120_000)
})

describe('a campaign saved as HTML before the editor sends exactly as it was written', () => {
  test('the stored body goes out unchanged', async () => {
    const { t, companyId } = await tenant('contractor')
    const legacy = '<table width="100%" style="background:#f3f4f6"><tr><td style="padding:24px"><h1>Hello {{firstName}}</h1><p>Our <a href="https://x.test/offer">autumn offer</a> ends Friday.</p><!-- footer --><p style="font-size:12px">Reply STOP</p></td></tr></table>'
    const [row] = await t.db.insert(t.schema.campaign).values({ companyId, name: 'Old', type: 'email', subject: 'Autumn, {{firstName}}', content: legacy, status: 'draft', audienceType: 'all' } as any).returning()
    const sent: any[] = []
    // No public address: no pixel or footer is added, so what goes out is the body itself.
    const service = createMarketingService({ db: t.db, tables: { campaign: t.schema.campaign, contact: t.schema.contact, emailLog: t.schema.emailLog }, sendRaw: async (m) => { sent.push(m); return {} }, env: {} })
    const r = await service.sendCampaign(row.id, companyId)
    expect(r.sent).toBe(1)
    expect(sent[0].html).toBe(legacy.replace('{{firstName}}', 'Ann'))
    expect(sent[0].subject).toBe('Autumn, Ann')
  }, 120_000)

  test('the footer says the business\'s word for who it is writing to', async () => {
    const { t, companyId } = await tenant('bar')
    const [row] = await t.db.insert(t.schema.campaign).values({ companyId, name: 'Quiz', type: 'email', subject: 'Quiz night', content: '<p>Quiz night</p>', status: 'draft', audienceType: 'all' } as any).returning()
    const sent: any[] = []
    const make = (recipientNoun?: string) => createMarketingService({ db: t.db, tables: { campaign: t.schema.campaign, contact: t.schema.contact, emailLog: t.schema.emailLog }, sendRaw: async (m) => { sent.push(m); return {} }, env: { API_URL: 'https://bar.example' }, recipientNoun })
    await make('guest').sendCampaign(row.id, companyId)
    expect(sent[0].html).toContain('because you are a guest of ours')
    expect(sent[0].html.startsWith('<p>Quiz night</p>')).toBe(true)
    const [again] = await t.db.insert(t.schema.campaign).values({ companyId, name: 'Quiz 2', type: 'email', subject: 'Quiz', content: '<p>Quiz</p>', status: 'draft', audienceType: 'all' } as any).returning()
    await make().sendCampaign(again.id, companyId)
    expect(sent[1].html).toContain('because you are a customer or contact of ours')
  }, 120_000)
})
