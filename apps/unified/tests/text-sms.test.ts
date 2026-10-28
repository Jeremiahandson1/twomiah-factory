// The "Text" button (packages/tenant-ui/src/text): the sms: link for each phone, the ready messages in each vertical's own
// words, and that every place a customer's number shows uses the ONE shared button (no copies).
import { test, expect, describe } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { smsHref, smsNumber, deviceTarget, canTextHere } from '../../../packages/tenant-ui/src/text/smsLink.ts'
import { textMessages, documentLink } from '../../../packages/tenant-ui/src/text/textMessages.ts'
import { registerVocabulary, JOB_TRADE } from '../../../packages/tenant-ui/src/labels/vocabulary.ts'
import { loadVertical } from '../server/core/vertical.ts'

const ROOT = path.resolve(import.meta.dir, '..', '..', '..')
const VERTICALS = ['contractor', 'fieldservice', 'landscaping', 'roofing', 'homecare', 'restaurant', 'bar', 'salon', 'basic', 'store', 'rv', 'vet']

describe('the sms: link', () => {
  test('numbers: digits and a leading +, nothing else; an unusable one gives no link', () => {
    expect(smsNumber('(608) 555-0111')).toBe('6085550111')
    expect(smsNumber('+1 608-555-0111')).toBe('+16085550111')
    for (const bad of ['', '12', 'call me', null, undefined, 5551234, '1'.repeat(16)]) expect(smsNumber(bad)).toBeNull()
    expect(smsHref('n/a', 'hi', 'ios')).toBeNull()
  })

  test('the body goes where each phone looks for it (iPhone: &body=, Android and the standard: ?body=, an unknown phone: ?&body=)', () => {
    const body = 'Hi Sam, we\'re on our way.\nSee you soon — 50% done #1'
    const enc = encodeURIComponent(body).replace(/'/g, '%27')
    expect(smsHref('+16085550111', body, 'ios')).toBe(`sms:+16085550111&body=${enc}`)
    expect(smsHref('+16085550111', body, 'other')).toBe(`sms:+16085550111?body=${enc}`)
    expect(smsHref('+16085550111', body, 'either')).toBe(`sms:+16085550111?&body=${enc}`)
    // percent-encoded UTF-8: a space, a new line, an apostrophe, a dash, a % and a # cannot end the body early
    expect(enc).not.toMatch(/[ \n#&?'!()*]/)
  })

  test('a blank text is just the number', () => {
    for (const t of ['ios', 'other', 'either'] as const) expect(smsHref('6085550111', '', t)).toBe('sms:6085550111')
  })

  test('which phone is this: iPhone, iPad (also when it calls itself a Mac) and Android text from the device; a computer does not', () => {
    const nav = (userAgent: string, platform = '', maxTouchPoints = 0) => ({ userAgent, platform, maxTouchPoints })
    const iphone = nav('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1')
    const ipadAsMac = nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', 'MacIntel', 5)
    const android = nav('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36')
    const mac = nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', 'MacIntel', 0)
    const windows = nav('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36', 'Win32', 0)
    expect([deviceTarget(iphone), deviceTarget(ipadAsMac), deviceTarget(android)]).toEqual(['ios', 'ios', 'other'])
    expect([canTextHere(iphone), canTextHere(ipadAsMac), canTextHere(android), canTextHere(mac), canTextHere(windows)]).toEqual([true, true, true, false, false])
  })
})

describe('the ready messages', () => {
  const token = 'ab12'.repeat(16)
  const link = 'https://westridge.example/d/' + token

  test('a blank text is always offered; invoice and quote only where the record has a real customer link', () => {
    registerVocabulary(JOB_TRADE)
    expect(textMessages({ name: 'Sam Lee' }).map((m) => m.id)).toEqual(['blank', 'ready'])
    const both = textMessages({ name: 'Sam Lee', businessName: 'Westridge Builders', invoice: { number: 'INV-12', link }, quote: { number: 'Q-3', link } })
    expect(both.map((m) => m.id)).toEqual(['blank', 'invoice', 'quote', 'ready'])
    expect(both.find((m) => m.id === 'blank')!.body).toBe('')
    expect(both.find((m) => m.id === 'invoice')!.body).toBe(`Hi Sam, Westridge Builders here. Here is your invoice #INV-12: ${link}`)
    expect(both.find((m) => m.id === 'quote')!.body).toBe(`Hi Sam, Westridge Builders here. Here is your quote #Q-3: ${link}`)
    expect(textMessages({ invoice: { number: '5', link: null }, quote: { number: '6' } }).map((m) => m.id)).toEqual(['blank', 'ready'])
  })

  test('a document link is the /d/<token> address, only for a real token', () => {
    ;(globalThis as any).window = { location: { origin: 'https://westridge.example' } }
    expect(documentLink(token)).toBe(link)
    for (const bad of [undefined, null, '', 'abc', 'g'.repeat(64), token.toUpperCase()]) expect(documentLink(bad)).toBeNull()
    delete (globalThis as any).window
  })

  test('no business name known: the greeting simply leaves it out; no name: "Hi,"', () => {
    registerVocabulary(JOB_TRADE)
    expect(textMessages({ name: 'Sam Lee' }).find((m) => m.id === 'ready')!.body).toBe("Hi Sam, we're on our way.")
    expect(textMessages({}).find((m) => m.id === 'ready')!.body).toBe("Hi, we're on our way.")
  })

  for (const id of VERTICALS) {
    test(id + ': the ready message is in this vertical\'s own words and states no fact', async () => {
      const v = await loadVertical(id)
      registerVocabulary(v.vocabulary)
      const ready = textMessages({ name: 'Sam Lee', businessName: 'Acme' }).find((m) => m.id === 'ready')
      expect(v.vocabulary.readyText).toBeTruthy()
      expect(v.vocabulary.readyText).toMatch(/^[a-z].*\.$/)
      expect(ready!.body).toBe(`Hi Sam, Acme here. ${v.vocabulary.readyText![0].toUpperCase()}${v.vocabulary.readyText!.slice(1)}`)
      // nothing in it a business could be held to: no time, no price, no number
      expect(v.vocabulary.readyText).not.toMatch(/\d|\$|minutes?|hours?|today|tonight|free/i)
    })
  }

  test('the examples the owner gave: an RV or store hands over, a field trade is on its way', async () => {
    const say = async (id: string) => { registerVocabulary((await loadVertical(id)).vocabulary); return textMessages({}).find((m) => m.id === 'ready')!.label }
    expect(await say('rv')).toBe('Your unit is ready for pickup')
    expect(await say('store')).toBe('Your order is ready for pickup')
    for (const id of ['contractor', 'fieldservice', 'roofing', 'landscaping']) expect(await say(id)).toBe("We're on our way")
    registerVocabulary(JOB_TRADE)
  })
})

describe('one button, everywhere a customer\'s number shows', () => {
  const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')
  const TEXT_FILES = ['packages/tenant-ui/src/text/TextButton.tsx', 'packages/tenant-ui/src/text/smsLink.ts', 'packages/tenant-ui/src/text/textMessages.ts', 'packages/tenant-ui/src/text/qr.ts']

  test('no screen builds its own sms: link — only the shared button does', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === 'dist') continue
        const rel = dir + '/' + e.name
        if (e.isDirectory()) walk(rel)
        else if (/\.tsx?$/.test(e.name) && !TEXT_FILES.includes(rel) && /[`'"]sms:\$\{|href=\{?[`'"]sms:/.test(read(rel))) offenders.push(rel)
      }
    }
    walk('packages/tenant-ui/src'); walk('apps/unified/web/src')
    expect(offenders).toEqual([])
  })

  test('the customer numbers named in the brief carry it, and the numbers that are not a customer\'s do not', () => {
    const has = (p: string) => /<TextButton\b/.test(read(p))
    for (const p of [
      'packages/tenant-ui/src/contacts/ContactDetailPage.tsx', 'packages/tenant-ui/src/leads/LeadInboxPage.tsx', 'packages/tenant-ui/src/tech/TechView.tsx',
      'packages/tenant-ui/src/invoicing/InvoiceDetailPage.tsx', 'packages/tenant-ui/src/invoicing/QuoteDetailPage.tsx',
      'apps/unified/web/src/booking/BookingDetailPage.tsx', 'apps/unified/web/src/crm/pages/roof/jobs/JobDetailPage.tsx',
      'apps/unified/web/src/crm/pages/homecare/clients/ClientsManagement.tsx', 'apps/unified/web/src/crm/pages/homecare/visits/CaregiverClientModal.tsx',
    ]) expect([p, has(p)]).toEqual([p, true])
    // crews, adjusters, caregivers, applicants, referral sources, the office's own number and the paid texting inbox: not a customer
    for (const p of [
      'apps/unified/web/src/crm/pages/roof/field/CrewsPage.tsx', 'apps/unified/web/src/crm/pages/roof/insurance/AdjusterDirectoryPage.tsx',
      'apps/unified/web/src/crm/pages/homecare/people/CaregiverManagement.tsx', 'apps/unified/web/src/crm/pages/homecare/people/ApplicationDetail.tsx',
      'apps/unified/web/src/crm/pages/homecare/clients/ReferralSources.tsx', 'apps/unified/web/src/crm/pages/homecare/shifts/EmergencyCoverage.tsx',
      'packages/tenant-ui/src/portal/PortalDashboard.tsx', 'packages/tenant-ui/src/marketing/MessagesPage.tsx',
    ]) expect([p, has(p)]).toEqual([p, false])
  })
})
