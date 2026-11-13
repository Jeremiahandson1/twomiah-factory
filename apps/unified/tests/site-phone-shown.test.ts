// A phone number is shown written out — ten bare digits as (715) 864-5052 (server/site/render.ts shownPhone; the first
// AI-built signup site reviewed printed "7158645052" on every page, 2026-11-13) — and every link that dials it carries
// digits only, whatever is shown. The three places that printed the number raw into the link are held here.
import { test, expect } from 'bun:test'
import path from 'node:path'
import ejs from 'ejs'
import { VIEWS, shownPhone } from '../server/site/render.ts'
import { consentBoxHtml } from '../server/site/smsConsent.ts'

const SHOWN = shownPhone('7158645052')
const settings = { companyName: 'Northside Lawn Care', phone: SHOWN, email: '', nav: [], photoCredits: [], contentGaps: [], serviceAreas: [] }
const words = { contactAddressLabel: 'Office', contactMessageLabel: 'Your message', contactMessageRequired: 'Please write a short message.' }

test('the split call to action shows the number written out and dials its digits', async () => {
  const html = await ejs.renderFile(path.join(VIEWS, 'sections/cta/split.ejs'), { data: { heading: 'Call us', phone: SHOWN }, settings, words }) as string
  expect(html).toContain('href="tel:7158645052">(715) 864-5052</a>')
})

test('the contact block shows the number written out and dials its digits', async () => {
  const html = await ejs.renderFile(path.join(VIEWS, 'sections/contact/form-info.ejs'), { data: { heading: 'Get in touch', phone: SHOWN }, settings, words, smsConsent: consentBoxHtml }) as string
  expect(html).toContain('href="tel:7158645052">(715) 864-5052</a>')
})

test('the footer, in a design with a cover and one without, dials digits', async () => {
  for (const cover of [false, true]) {
    const html = await ejs.renderFile(path.join(VIEWS, 'base.ejs'), { body: '', assetV: 'V', settings, crmApiUrl: '', currentPath: '/', lcpImage: '', lcpPreloads: [], embed: false, jsonLd: '', siteOptions: { cover }, chatToText: false, numberSwap: '' }) as string
    expect([cover, html.includes('<a href="tel:7158645052">(715) 864-5052</a>')]).toEqual([cover, true])
    expect([cover, /href="tel:[^"]*[() -]/.test(html)]).toEqual([cover, false])
  }
})
