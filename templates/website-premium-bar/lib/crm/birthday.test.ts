import { describe, expect, test } from 'bun:test'
import { birthdayConfig, birthdayEmailHtml, checkUnsubscribeToken, targetDays, unsubscribeToken } from './birthday'

describe('birthday email', () => {
  test('off by default; nothing goes without the owner turning it on', () => {
    expect(birthdayConfig(null)).toEqual({ enabled: false, daysBefore: 3, subject: 'Happy birthday from the Amber Inn', message: '' })
    expect(birthdayConfig({ enabled: 'yes', daysBefore: 40 }).enabled).toBe(false)
    expect(birthdayConfig({ enabled: true, daysBefore: 40 }).daysBefore).toBe(3)
  })
  test('who is due: 3 days ahead, across a month end', () => {
    expect(targetDays('2026-09-25', 3)).toEqual([{ month: 9, day: 28 }])
    expect(targetDays('2026-09-29', 3)).toEqual([{ month: 10, day: 2 }])
    expect(targetDays('2026-12-30', 3)).toEqual([{ month: 1, day: 2 }])
  })
  test('Feb 29 people go out with Feb 28 in normal years, on the day in leap years', () => {
    expect(targetDays('2027-02-25', 3)).toEqual([{ month: 2, day: 28 }, { month: 2, day: 29 }])
    expect(targetDays('2028-02-25', 3)).toEqual([{ month: 2, day: 28 }])
    expect(targetDays('2028-02-26', 3)).toEqual([{ month: 2, day: 29 }])
  })
  test('unsubscribe tokens are per-email and checked in constant time', () => {
    const t = unsubscribeToken('Jen@Example.com')
    expect(checkUnsubscribeToken('jen@example.com', t)).toBe(true)
    expect(checkUnsubscribeToken('dave@example.com', t)).toBe(false)
    expect(checkUnsubscribeToken('jen@example.com', 'nope')).toBe(false)
  })
  test('the email: first name, the owner\'s words escaped, the address and an unsubscribe link', () => {
    const html = birthdayEmailHtml({ company: 'Amber Inn', name: 'Jen Berg', message: 'Your burger is on us this week.\n\nShow this at the bar. <b>no html</b>', address: '840 E Madison St, Eau Claire, WI', unsubUrl: 'https://x/unsubscribe?e=a&t=b' })
    expect(html).toContain('Happy birthday, Jen.')
    expect(html).toContain('840 E Madison St')
    expect(html).toContain('href="https://x/unsubscribe?e=a&amp;t=b"')
    expect(html).toContain('&lt;b&gt;no html&lt;/b&gt;')
    expect(html.replace(/<[^>]*>/g, '')).not.toContain('!')   // the words, not the doctype
  })
})
