import { describe, expect, test } from 'bun:test'
import fs from 'fs'
import path from 'path'
import { labelFromSizes, sizesFromLabel, sizesOf, taxOn } from './sizes'

const menuJson = JSON.parse(fs.readFileSync(path.join(import.meta.dir, '..', '..', 'content', 'menu.json'), 'utf8'))
const section = (slug: string) => menuJson.sections.find((s: any) => s.slug === slug)

describe('sizesFromLabel — the transcribed menu', () => {
  test('burger: sandwich / platter, with our own stable ids', () => {
    const s = section('burgers'); const h = s.items.find((i: any) => i.slug === 'hamburger')
    expect(sizesFromLabel(h.priceCents, h.priceLabel, s.description)).toEqual([
      { id: 'sandwich', name: 'Sandwich', priceCents: 579 }, { id: 'platter', name: 'Platter', priceCents: 729 },
    ])
  })
  test('"Tuesdays · $7.49 / $9.09" ignores the day', () => {
    const s = section('burgers'); const pb = s.items.find((i: any) => i.slug === 'peanut-butter-bacon')
    expect(sizesFromLabel(pb.priceCents, pb.priceLabel, s.description).map(v => v.priceCents)).toEqual([749, 909])
  })
  test('daily specials say "Burger / platter"', () => {
    const s = section('daily-specials')
    expect(sizesFromLabel(s.items[0].priceCents, s.items[0].priceLabel, s.description).map(v => v.id)).toEqual(['burger', 'platter'])
  })
  test('wings: counts become piece sizes', () => {
    const s = section('daily-specials'); const w = s.items.find((i: any) => i.slug === 'wednesday-wings')
    expect(sizesFromLabel(w.priceCents, w.priceLabel, s.description)).toEqual([
      { id: '15-pieces', name: '15 pieces', priceCents: 799 }, { id: '20-pieces', name: '20 pieces', priceCents: 1039 },
    ])
  })
  test('single price, and no price at all (the register asks)', () => {
    expect(sizesFromLabel(949, '$9.49', null)).toEqual([{ id: 'regular', name: 'Regular', priceCents: 949 }])
    expect(sizesFromLabel(949, null, null)).toEqual([{ id: 'regular', name: 'Regular', priceCents: 949 }])
    expect(sizesFromLabel(null, null, null)).toEqual([{ id: 'regular', name: 'Regular', priceCents: null }])
  })
  test('every item in the real menu gets at least one size; priced items get prices', () => {
    for (const s of menuJson.sections) for (const i of s.items) {
      const vs = sizesFromLabel(i.priceCents, i.priceLabel, s.description)
      expect(vs.length).toBeGreaterThan(0)
      if (typeof i.priceCents === 'number') for (const v of vs) expect(v.priceCents).toBeGreaterThan(0)
      expect(new Set(vs.map(v => v.id)).size).toBe(vs.length)
    }
  })
})

describe('sizesOf', () => {
  test('stored sizes win over the label', () => {
    expect(sizesOf({ variations: [{ id: 'basket', name: 'Basket', priceCents: 500 }], priceCents: 1, priceLabel: '$9 / $10' })).toEqual([{ id: 'basket', name: 'Basket', priceCents: 500 }])
  })
  test('falls back to the label', () => {
    expect(sizesOf({ variations: [], priceCents: 579, priceLabel: '$5.79 / $7.29' }, 'Sandwich / platter.').map(v => v.id)).toEqual(['sandwich', 'platter'])
  })
})

describe('labelFromSizes', () => {
  test('short for plain sizes, named otherwise, null for one price', () => {
    expect(labelFromSizes([{ id: 'a', name: 'Sandwich', priceCents: 599 }, { id: 'b', name: 'Platter', priceCents: 749 }])).toBe('$5.99 / $7.49')
    expect(labelFromSizes([{ id: 'a', name: '15 pieces', priceCents: 799 }, { id: 'b', name: '20 pieces', priceCents: 1039 }])).toBe('15 pieces $7.99 · 20 pieces $10.39')
    expect(labelFromSizes([{ id: 'x', name: 'Regular', priceCents: 949 }])).toBeNull()
  })
})

describe('taxOn — 5.5% Wisconsin + Eau Claire County', () => {
  test('rounds half-up to the cent with integer math', () => {
    expect(taxOn(2407, 550)).toBe(132)     // 132.385
    expect(taxOn(1000, 550)).toBe(55)
    expect(taxOn(100, 550)).toBe(6)        // 5.5 → 6
    expect(taxOn(0, 550)).toBe(0)
    expect(taxOn(579, 550)).toBe(32)       // 31.845 → 32
  })
})
