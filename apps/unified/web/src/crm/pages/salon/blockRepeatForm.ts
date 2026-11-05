// The block dialog's one piece of arithmetic (salon parity row 2): a blocked-time type's usual length, added to the start, on the company's
// own clock. Real elapsed minutes, so a block that crosses the end of daylight saving still lasts as long as the type says.
import { companyMoment, companyWall } from '@twomiah/tenant-ui/src/time/companyClock'

export function addMinutesToWall(date: string, time: string, minutes: number): { date: string; time: string } {
  return companyWall(new Date(companyMoment(date, time).getTime() + minutes * 60_000))
}
