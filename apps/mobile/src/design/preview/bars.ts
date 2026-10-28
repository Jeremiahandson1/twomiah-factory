import type { BarItem } from '..'
import type { Trade, Seat } from './sample'

/** Bottom bar per trade and seat. Five slots; "More" is always last; alerts live in the header bell. No Leads tab (owner, 2026-10-28). */
const BAR: Record<Trade, Record<Seat, BarItem[]>> = {
  contractor: {
    owner: [home('Home'), jobs(), sched(), people('Contacts'), more()],
    manager: [home('Home'), jobs(), sched(), people('Contacts'), more()],
    staff: [home('Home'), jobs(), sched(), { key: 'time', label: 'Time', icon: 'time-outline', activeIcon: 'time' }, more()],
  },
  roofing: {
    owner: [{ key: 'home', label: 'Pipeline', icon: 'funnel-outline', activeIcon: 'funnel' }, jobs(), people('Contacts'), { key: 'canvass', label: 'Canvass', icon: 'walk-outline', activeIcon: 'walk' }, more()],
    manager: [{ key: 'home', label: 'Pipeline', icon: 'funnel-outline', activeIcon: 'funnel' }, jobs(), people('Contacts'), { key: 'canvass', label: 'Canvass', icon: 'walk-outline', activeIcon: 'walk' }, more()],
    staff: [{ key: 'home', label: 'Pipeline', icon: 'funnel-outline', activeIcon: 'funnel' }, jobs(), people('Contacts'), { key: 'canvass', label: 'Canvass', icon: 'walk-outline', activeIcon: 'walk' }, more()],
  },
  homecare: {
    owner: [home('Home'), sched(), people('Clients'), msgs(), more()],
    manager: [home('Home'), sched(), people('Clients'), msgs(), more()],
    staff: [home('Today'), sched(), { key: 'clock', label: 'Clock', icon: 'finger-print-outline', activeIcon: 'finger-print' }, msgs(), more()],
  },
}
function home(label: string): BarItem { return { key: 'home', label, icon: 'home-outline', activeIcon: 'home' } }
function jobs(): BarItem { return { key: 'jobs', label: 'Jobs', icon: 'hammer-outline', activeIcon: 'hammer' } }
function sched(): BarItem { return { key: 'schedule', label: 'Schedule', icon: 'calendar-outline', activeIcon: 'calendar' } }
function people(label: string): BarItem { return { key: 'people', label, icon: 'people-outline', activeIcon: 'people' } }
function msgs(): BarItem { return { key: 'messages', label: 'Messages', icon: 'chatbubbles-outline', activeIcon: 'chatbubbles', badge: 2 } }
function more(): BarItem { return { key: 'more', label: 'More', icon: 'ellipsis-horizontal-outline', activeIcon: 'ellipsis-horizontal' } }
export const barFor = (trade: Trade, seat: Seat) => BAR[trade][seat]
