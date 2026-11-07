// The quote email when the customer has yet to choose (roofing live test 11/07): it listed Good, Better and Best as lines under
// "Subtotal $8,500 / Total $8,500" — the cheapest option read as the bill, though the customer goes on to pick one. Now it says to
// choose one, the figure is "From", and no subtotal or tax of one option stands as the quote's. A quote with no choice is as before.
import { test, expect } from 'bun:test'
import { crmTemplates } from '../server/crm/messages.ts'

const brand: any = {}
const base = { quoteNumber: 'QTE-1', companyName: 'Acme Roofing', contactName: 'Hank', subtotal: '8500.00', taxAmount: '0', total: '8500.00', documentPath: '/d/abc',
  lineItems: [{ description: 'Good', quantity: '1', unitPrice: '8500.00', total: '8500.00' }, { description: 'Better', quantity: '1', unitPrice: '9500.00', total: '9500.00' }] }

test('options to choose from: "choose one", the figure is From, no subtotal', () => {
  const m = crmTemplates.quoteSent({ ...base, chooseOne: true }, brand, 'https://acme.example.com')
  expect(m.html).toContain('Choose one of these options')
  expect(m.html).toContain('>From</td>')
  expect(m.html).not.toContain('>Subtotal</td>')
  expect(m.html).not.toContain('>Total</td>')
  expect(m.text).toContain('From: $8,500.00')
})

test('a quote with nothing to choose keeps its subtotal and total', () => {
  const m = crmTemplates.quoteSent(base, brand, 'https://acme.example.com')
  expect(m.html).toContain('>Subtotal</td>')
  expect(m.html).toContain('>Total</td>')
  expect(m.html).not.toContain('Choose one of these options')
})
