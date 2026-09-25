import { describe, expect, test } from 'bun:test'
import { ageState, allDay, cueFor, effectivePrep, learn, lessonFromBump, paceTicket, startNow } from './pacing'

const MIN = 60_000
const t0 = Date.parse('2026-09-26T17:00:00Z')
const burger = { key: 'a', name: 'Cheddarburger', qty: 1, prepSeconds: 600, menuItemId: 'burger' }
const fries = { key: 'b', name: 'Fries', qty: 1, prepSeconds: 240, menuItemId: 'fries' }
const fish = { key: 'c', name: 'Fish Fry', qty: 2, prepSeconds: 420, menuItemId: 'fish' }

describe('paceTicket', () => {
  test('longest item starts at fire; everything is ready together', () => {
    const p = paceTicket(t0, [burger, fries])
    expect(p.readyAt).toBe(t0 + 10 * MIN)
    expect(p.items.find(i => i.name === 'Cheddarburger')!.startAt).toBe(t0)
    expect(p.items.find(i => i.name === 'Fries')!.startAt).toBe(t0 + 6 * MIN)
  })
})

describe('cueFor — the line under each ticket', () => {
  const p = paceTicket(t0, [burger, fries])
  test('at fire: burger on now, fries in 6', () => expect(cueFor(p, t0)).toEqual({ text: 'Cheddarburger on now · Fries in 6', state: 'start' }))
  test('two minutes in: just the countdown to fries', () => expect(cueFor(p, t0 + 2 * MIN)).toEqual({ text: 'Fries in 4', state: 'wait' }))
  test('fries due', () => expect(cueFor(p, t0 + 6 * MIN).text).toBe('Fries on now'))
  test('everything going: up in N', () => expect(cueFor(p, t0 + 8 * MIN)).toEqual({ text: 'Up in 2', state: 'wait' }))
  test('ready: plate it', () => expect(cueFor(p, t0 + 10 * MIN).state).toBe('plate'))
  test('quantities and same-time starts group', () => {
    const q = paceTicket(t0, [burger, { ...fries, qty: 3 }, { ...fries, key: 'd', name: 'Onion Rings', qty: 1 }])
    expect(cueFor(q, t0).text).toBe('Cheddarburger on now · 3 Fries + Onion Rings in 6')
  })
})

describe('startNow and allDay across tickets', () => {
  const a = paceTicket(t0, [burger, fries])
  const b = paceTicket(t0 + 6 * MIN, [{ ...fries, key: 'x', qty: 2 }])
  test('fries from two tickets come due together → one batch', () => {
    expect(startNow([a, b], t0 + 6 * MIN)).toEqual([{ name: 'Fries', qty: 3 }])
  })
  test('all day totals', () => {
    expect(allDay([{ items: [burger, fries] }, { items: [fish, { ...burger, qty: 2 }] }])).toEqual([
      { name: 'Cheddarburger', qty: 3 }, { name: 'Fish Fry', qty: 2 }, { name: 'Fries', qty: 1 },
    ])
  })
})

describe('ageState', () => {
  test('fresh → warn → late', () => {
    expect(ageState(t0, t0 + 5 * MIN, 600, 900)).toBe('fresh')
    expect(ageState(t0, t0 + 10 * MIN, 600, 900)).toBe('warn')
    expect(ageState(t0, t0 + 15 * MIN, 600, 900)).toBe('late')
  })
})

describe('learning from bumps', () => {
  test('uses the owner\'s time until there are enough samples', () => {
    expect(effectivePrep({ prepSeconds: 600, learnedPrepSeconds: 700, learnedSamples: 2 }, 480)).toBe(600)
    expect(effectivePrep({ prepSeconds: 600, learnedPrepSeconds: 700, learnedSamples: 3 }, 480)).toBe(700)
    expect(effectivePrep({ prepSeconds: null, learnedPrepSeconds: null, learnedSamples: 0 }, 480)).toBe(480)
  })
  test('a bump teaches the longest item', () => {
    expect(lessonFromBump([burger, fries], t0, t0 + 11 * MIN, false)).toEqual({ menuItemId: 'burger', observedSeconds: 660 })
  })
  test('no lesson from a recall, a forgotten bump, a mis-tap, or a tie between two items', () => {
    expect(lessonFromBump([burger], t0, t0 + 11 * MIN, true)).toBeNull()
    expect(lessonFromBump([burger], t0, t0 + 50 * MIN, false)).toBeNull()
    expect(lessonFromBump([burger], t0, t0 + 30_000, false)).toBeNull()
    expect(lessonFromBump([burger, { ...burger, key: 'z', menuItemId: 'other' }], t0, t0 + 11 * MIN, false)).toBeNull()
  })
  test('moving average', () => {
    expect(learn(null, 0, 660)).toEqual({ learnedPrepSeconds: 660, learnedSamples: 1 })
    expect(learn(600, 1, 700)).toEqual({ learnedPrepSeconds: 630, learnedSamples: 2 })
  })
})
