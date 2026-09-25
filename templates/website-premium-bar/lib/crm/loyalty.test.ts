import { describe, expect, test } from 'bun:test'
import { birthdaySoon, DEFAULT_LOYALTY, loyaltyConfig, pointsFor, rewardAmount } from './loyalty'

describe('loyalty', () => {
  test('defaults, and bad values fall back', () => {
    expect(loyaltyConfig(null)).toEqual(DEFAULT_LOYALTY)
    expect(loyaltyConfig({ pointsPerDollar: 2, rewardPoints: 'x', rewardCents: -5 })).toEqual({ ...DEFAULT_LOYALTY, pointsPerDollar: 2 })
    expect(loyaltyConfig({ enabled: false }).enabled).toBe(false)
  })
  test('points: whole dollars of the subtotal', () => {
    expect(pointsFor(2707, DEFAULT_LOYALTY)).toBe(27)
    expect(pointsFor(99, DEFAULT_LOYALTY)).toBe(0)
    expect(pointsFor(2707, { ...DEFAULT_LOYALTY, pointsPerDollar: 2 })).toBe(54)
    expect(pointsFor(2707, { ...DEFAULT_LOYALTY, enabled: false })).toBe(0)
  })
  test('a reward never takes off more than the check', () => {
    expect(rewardAmount(2707, DEFAULT_LOYALTY)).toBe(1000)
    expect(rewardAmount(579, DEFAULT_LOYALTY)).toBe(579)
  })
  test('birthday this week, across New Year', () => {
    expect(birthdaySoon(9, 28, { year: 2026, month: 9, day: 25 })).toBe(true)
    expect(birthdaySoon(10, 5, { year: 2026, month: 9, day: 25 })).toBe(false)
    expect(birthdaySoon(1, 2, { year: 2026, month: 12, day: 29 })).toBe(true)
    expect(birthdaySoon(null, null, { year: 2026, month: 9, day: 25 })).toBe(false)
  })
})
