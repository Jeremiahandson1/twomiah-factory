// Home-care defects the move found in the template, fixed in the unified app's home-care core:
//   · an hourly or per-visit authorization's EVV visits were counted as 15-minute units (the form stores 'hours' and
//     'visits'; the counter compared with 'hour' and 'visit');
//   · its emails put names into the page as they were.
import { describe, test, expect } from 'bun:test'
import { calcUnits } from '../server/crm/homecare/core/evvVisits.ts'
import { homecareTemplates } from '../server/crm/homecare/core/messages.ts'

const start = '2026-10-19T14:00:00Z'
const end = '2026-10-19T16:30:00Z' // two and a half hours

describe('EVV units follow the authorization\'s unit, in any spelling it was stored', () => {
  test('hours', () => {
    expect(calcUnits(start, end, 'hours')).toBe(2.5)
    expect(calcUnits(start, end, 'hour')).toBe(2.5)
  })
  test('visits and days: one', () => {
    expect(calcUnits(start, end, 'visits')).toBe(1)
    expect(calcUnits(start, end, 'visit')).toBe(1)
    expect(calcUnits(start, end, 'days')).toBe(1)
  })
  test('15-minute units, the default', () => {
    expect(calcUnits(start, end, '15min')).toBe(10)
    expect(calcUnits(start, end, null)).toBe(10)
  })
  test('no clock-out, no units', () => {
    expect(calcUnits(start, null, 'hours')).toBe(0)
  })
})

describe('home-care emails', () => {
  const brand = { companyName: 'Care & Co <Agency>', primaryColor: '#123456' } as any
  test('every message escapes what it is given in its HTML, and keeps it as written in its text', () => {
    const evil = '<img src=x onerror=alert(1)>'
    const data: Record<string, unknown> = {
      contactName: evil, clientName: evil, familyName: evil, userName: evil, documentTitle: evil, email: 'a@b.example',
      portalUrl: 'https://x.example/p?a=1&b=2', setupUrl: 'https://x.example/s', resetUrl: 'https://x.example/r', payUrl: 'https://x.example/pay',
      invoiceNumber: '12', total: '10.00', amountDue: '10.00', dueDate: 'Oct 20', daysOverdue: 3, newPassword: 'pw', tempPassword: 'pw',
    }
    for (const [name, t] of Object.entries(homecareTemplates)) {
      const r = t(data, brand, 'https://app.example')
      expect({ name, raw: r.html.includes(evil) }).toEqual({ name, raw: false })
      expect({ name, brand: r.html.includes('Care & Co <Agency>') }).toEqual({ name, brand: false })
    }
    const sig = homecareTemplates.homecareDocumentSignatureRequest(data, brand, 'https://app.example')
    expect(sig.html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(sig.text).toContain(evil)
  })
})
