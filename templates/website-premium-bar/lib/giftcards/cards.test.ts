import { describe, expect, test } from 'bun:test'
import { generateCode, normalizeCode, validAmount } from './cards'
import { checkTotals } from '../register/money'

describe('gift card codes', () => {
  test('AMBR-XXXX-XXXX with no look-alike letters', () => {
    for (let i = 0; i < 200; i++) {
      const c = generateCode()
      expect(c).toMatch(/^AMBR-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/)
      expect(c.slice(5)).not.toMatch(/[ILOU]/)
    }
  })
  test('codes are not repeated in a big batch', () => {
    const s = new Set(Array.from({ length: 5000 }, () => generateCode()))
    expect(s.size).toBe(5000)
  })
  test('what people type is forgiven', () => {
    expect(normalizeCode('ambr 7k2q 9xmp')).toBe('AMBR-7K2Q-9XMP')
    expect(normalizeCode('AMBR-7K2Q-9XMO')).toBe('AMBR-7K2Q-9XM0')    // O → 0
    expect(normalizeCode('ambr-1lii-0000')).toBe('AMBR-1111-0000')    // I/L → 1
    expect(normalizeCode('  00123456  ')).toBe('00123456')             // a pre-printed card's number
  })
  test('amounts $5 to $500', () => {
    expect(validAmount(2500)).toBe(true); expect(validAmount(499)).toBe(false); expect(validAmount(50001)).toBe(false); expect(validAmount(25.5)).toBe(false)
  })
})

describe('tax with a gift card on the check', () => {
  test('the card is not taxed; the food is', () => {
    const t = checkTotals([
      { qty: 1, unitPriceCents: 2500, state: 'sent', kind: 'giftcard' },
      { qty: 1, unitPriceCents: 1000, state: 'sent', kind: 'item' },
    ], [], 550)
    expect(t.subtotalCents).toBe(3500); expect(t.taxCents).toBe(55); expect(t.totalCents).toBe(3555)
  })
})
