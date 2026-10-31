// The block dialog's type length (web/src/crm/pages/salon/blockRepeatForm.ts): a type's usual length added to the start on the company's clock.
import { describe, test, expect } from 'bun:test'
import { setCompanyTimeZone } from '@twomiah/tenant-ui/src/time/companyClock'
import { addMinutesToWall } from '../web/src/crm/pages/salon/blockRepeatForm.ts'

describe('blocked-time type length on the company clock', () => {
  test('adds the usual length, rolling past midnight', () => {
    setCompanyTimeZone('America/Chicago')
    expect(addMinutesToWall('2026-10-26', '12:00', 45)).toEqual({ date: '2026-10-26', time: '12:45' })
    expect(addMinutesToWall('2026-10-26', '23:30', 90)).toEqual({ date: '2026-10-27', time: '01:00' })
  })
  test('three real hours across the clocks going back (Nov 1 2026) end at 02:30, not 03:30', () => {
    setCompanyTimeZone('America/Chicago')
    expect(addMinutesToWall('2026-11-01', '00:30', 180)).toEqual({ date: '2026-11-01', time: '02:30' })
  })
})
