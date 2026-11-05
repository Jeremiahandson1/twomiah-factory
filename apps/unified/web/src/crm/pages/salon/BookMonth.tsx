// The Book by the month (salon parity row 1; feature `book_grid`): the month as whole weeks, Sunday first. Each day shows how many are booked
// and the first few, the way Fresha's month view does; a day opens in the day view and an appointment opens its actions. The arithmetic is
// bookViews.ts; the day an appointment sits on is the company's (bookWeek.byDay).
import { dateWords } from '../../../booking/days'
import { whenTime } from '@twomiah/tenant-ui/src/time/companyClock'
import { byDay } from './bookWeek'
import { monthCells, sameMonth } from './bookViews'

interface MonthAppt { id: string; status?: string; startTime?: string; clientName?: string; serviceName?: string }

const DEAD = new Set(['cancelled', 'no_show'])
const SHOWN = 3
const WEEKDAYS = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']   // a Sunday-first week, only for its names

export default function BookMonth<T extends MonthAppt>({ day, appts, today, onOpenDay, onPick }: { day: string; appts: T[]; today: string; onOpenDay: (d: string) => void; onPick: (a: T) => void }) {
  const cells = monthCells(day)
  const byCell = byDay(appts, cells)
  const time = (a: T) => (a.startTime ? whenTime(new Date(a.startTime), { hour: 'numeric', minute: '2-digit' }) : '')
  return (
    <div className="overflow-x-auto rounded-xl border bg-white dark:bg-slate-900" role="region" aria-label="The Book by the month">
      <div className="min-w-[720px]">
        <div className="grid grid-cols-7 border-b text-center text-xs font-medium uppercase text-gray-500 dark:text-slate-400">
          {WEEKDAYS.map((d) => <div key={d} className="py-2">{dateWords(d, { weekday: 'short' })}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d) => {
            const live = (byCell[d] || []).filter((a) => !DEAD.has(a.status || ''))
            const inMonth = sameMonth(day, d)
            return (
              <section key={d} aria-label={dateWords(d, { weekday: 'long', month: 'long', day: 'numeric' })}
                className={`min-h-[110px] border-b border-r p-1 ${inMonth ? '' : 'bg-gray-50 dark:bg-slate-950/40'}`}>
                <button type="button" onClick={() => onOpenDay(d)} title="Open this day"
                  className={`flex w-full items-center justify-between rounded px-1 text-xs hover:bg-gray-100 dark:hover:bg-slate-800 ${d === today ? 'bg-teal-700 font-bold text-white hover:bg-teal-800 dark:hover:bg-teal-800' : inMonth ? 'text-gray-900 dark:text-slate-100' : 'text-gray-500 dark:text-slate-400'}`}>
                  <span>{Number(d.slice(8))}</span>
                  {live.length > 0 && <span>{live.length} booked</span>}
                </button>
                <div className="mt-1 space-y-0.5">
                  {live.slice(0, SHOWN).map((a) => (
                    <button key={a.id} type="button" onClick={() => onPick(a)} className="block w-full truncate rounded border bg-white px-1 text-left text-[11px] text-gray-800 hover:border-teal-500 dark:bg-slate-900 dark:text-slate-100">
                      <b>{time(a)}</b> {a.clientName || 'Walk-in'}
                    </button>
                  ))}
                  {live.length > SHOWN && <button type="button" onClick={() => onOpenDay(d)} className="text-[11px] text-teal-700 hover:underline dark:text-teal-300">+{live.length - SHOWN} more</button>}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
