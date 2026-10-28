/**
 * DEV-ONLY PREVIEW DATA. Every name, address and amount here is made up for mock-ups — "Sample", "Example", "Placeholder" — and
 * none of it is ever sent anywhere. This folder is reachable only through app/design-preview.tsx behind __DEV__
 * (tests/mobile/design-preview-dev-only.test.ts holds that).
 */
export const PREVIEW_SENTINEL = 'TWOMIAH-DESIGN-PREVIEW-DO-NOT-SHIP'

export type Trade = 'contractor' | 'roofing' | 'homecare'
export type Seat = 'owner' | 'manager' | 'staff'

export const COMPANY = { contractor: 'Sample Builders Co.', roofing: 'Example Roofing', homecare: 'Placeholder Home Care' } as const
export const PERSON = { owner: 'Sam Owner', manager: 'Morgan Manager', staff: 'Taylor Tech' } as const
export const BRAND = { contractor: '#1e40af', roofing: '#b91c1c', homecare: '#0d9488' } as const

/** The tiles of each trade's home for each seat — the desktop dashboard's own rules (docs/mobile/PARITY.md "Dashboard tiles by seat"). */
export interface TileDef { label: string; value: string; icon: string; tone: 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'; opens: string; hint?: string }

const contractorOffice: TileDef[] = [
  { label: 'New leads', value: '4', icon: 'mail-unread', tone: 'info', opens: 'the 4 leads waiting for an answer', hint: '1 is 2 days old' },
  { label: 'Active projects', value: '3', icon: 'folder-open', tone: 'success', opens: 'the 3 active projects' },
  { label: 'Jobs today', value: '6', icon: 'hammer', tone: 'accent', opens: 'the 6 jobs scheduled today' },
  { label: 'Pending quotes', value: '5', icon: 'document-text', tone: 'warning', opens: 'the 5 quotes waiting on a customer' },
  { label: 'Open invoices', value: '7', icon: 'receipt', tone: 'danger', opens: 'the 7 unpaid invoices', hint: '2 overdue' },
  { label: 'Outstanding', value: '$18,430', icon: 'cash', tone: 'success', opens: 'the unpaid invoices that add up to $18,430' },
]
export const TILES: Record<Trade, Record<Seat, TileDef[]>> = {
  contractor: {
    owner: contractorOffice,
    manager: contractorOffice,
    staff: [
      { label: 'Active projects', value: '3', icon: 'folder-open', tone: 'success', opens: 'the 3 active projects' },
      { label: 'Jobs today', value: '2', icon: 'hammer', tone: 'accent', opens: 'your 2 jobs today' },
    ],
  },
  roofing: {
    // Roofing's home is the pipeline board: a count per stage. Money is shown only to a seat that may see it.
    owner: [], manager: [], staff: [],
  },
  homecare: {
    owner: [
      { label: 'Active clients', value: '38', icon: 'people', tone: 'accent', opens: 'the client list' },
      { label: 'Active caregivers', value: '24', icon: 'person', tone: 'info', opens: 'the caregiver list' },
      { label: 'Shifts today', value: '19', icon: 'calendar', tone: 'accent', opens: "today's schedule" },
      { label: 'Clocked in now', value: '7', icon: 'finger-print', tone: 'success', opens: 'who is clocked in' },
      { label: 'Shifts remaining', value: '12', icon: 'time', tone: 'neutral', opens: "today's shifts still to start" },
      { label: 'Coverage gaps', value: '2', icon: 'alert-circle', tone: 'danger', opens: 'the 2 shifts with no one assigned' },
      { label: 'Pending invoices', value: '$12,960', icon: 'receipt', tone: 'warning', opens: 'billing', hint: '9 invoices, 3 drafts' },
      { label: 'This month revenue', value: '$41,205', icon: 'cash', tone: 'success', opens: 'billing', hint: 'collected this month' },
    ],
    manager: [], // same rule as the owner (care-billing:read) — filled below
    staff: [
      { label: 'My shifts today', value: '3', icon: 'calendar', tone: 'accent', opens: 'your 3 visits today' },
      { label: 'Clock in / out', value: 'Off', icon: 'finger-print', tone: 'neutral', opens: 'the time clock', hint: 'Not clocked in' },
      { label: 'My visits', value: '12', icon: 'home', tone: 'success', opens: 'your visits this week' },
      { label: 'Open shifts', value: '5', icon: 'briefcase', tone: 'info', opens: 'the 5 open shifts you can pick up' },
      { label: 'Messages from the office', value: '2', icon: 'chatbubbles', tone: 'warning', opens: 'your 2 unread messages' },
    ],
  },
}
TILES.homecare.manager = TILES.homecare.owner

/** Home care's "needs attention" panel (action items, no-show alerts, incident responses due). */
export const CARE_ATTENTION = [
  { label: '2 shifts have no one assigned', tone: 'danger' as const, opens: 'Emergency coverage' },
  { label: '1 no-show alert is open', tone: 'warning' as const, opens: 'No-show alerts' },
  { label: '1 incident response is due today', tone: 'warning' as const, opens: 'Incidents' },
]

/** Roofing pipeline stages (apps/unified/web/src/crm/pages/roof/jobs/model.ts PIPELINE_STATUSES, minus the measurement stage). */
export const STAGES: { label: string; count: number; value: string }[] = [
  { label: 'Lead', count: 8, value: '$96,000' }, { label: 'Inspection scheduled', count: 5, value: '$61,500' }, { label: 'Inspected', count: 4, value: '$52,800' },
  { label: 'Proposal sent', count: 6, value: '$118,200' }, { label: 'Signed', count: 3, value: '$47,300' }, { label: 'Material ordered', count: 2, value: '$29,900' },
  { label: 'In production', count: 4, value: '$71,400' }, { label: 'Final inspection', count: 1, value: '$14,600' }, { label: 'Invoiced', count: 3, value: '$38,100' }, { label: 'Collected', count: 11, value: '$162,900' },
]

export interface JobRow { id: string; number: string; title: string; customer: string; address: string; time: string; status: string; tone: 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'neutral' }
export const JOBS_TODAY: JobRow[] = [
  { id: 'j1', number: 'J-1042', title: 'Replace kitchen faucet', customer: 'Alex Example', address: '100 Example St', time: '8:00 AM', status: 'In progress', tone: 'accent' },
  { id: 'j2', number: 'J-1043', title: 'Water heater check', customer: 'Jordan Sample', address: '22 Sample Ave', time: '9:30 AM', status: 'Dispatched', tone: 'info' },
  { id: 'j3', number: 'J-1044', title: 'Bathroom fan install', customer: 'Riley Placeholder', address: '7 Placeholder Rd', time: '11:00 AM', status: 'Scheduled', tone: 'neutral' },
  { id: 'j4', number: 'J-1045', title: 'Outdoor outlet repair', customer: 'Casey Demo', address: '18 Demo Ln', time: '1:00 PM', status: 'Scheduled', tone: 'neutral' },
  { id: 'j5', number: 'J-1046', title: 'Deck board replacement', customer: 'Quinn Sample', address: '5 Sample Ct', time: '2:30 PM', status: 'Scheduled', tone: 'neutral' },
  { id: 'j6', number: 'J-1047', title: 'Gutter reattach', customer: 'Avery Example', address: '61 Example Way', time: '4:00 PM', status: 'Scheduled', tone: 'neutral' },
]
export const LEADS: { id: string; name: string; what: string; source: string; age: string; tone: 'info' | 'warning' | 'danger' }[] = [
  { id: 'l1', name: 'Alex Example', what: 'Kitchen remodel estimate', source: 'Website form', age: 'Today', tone: 'info' },
  { id: 'l2', name: 'Jordan Sample', what: 'Fix a leaking bathroom tap', source: 'Google profile', age: 'Today', tone: 'info' },
  { id: 'l3', name: 'Riley Placeholder', what: 'Deck repair, about 12 boards', source: 'Phone call', age: 'Yesterday', tone: 'warning' },
  { id: 'l4', name: 'Casey Demo', what: 'Quote for new fence', source: 'Referral', age: '2 days ago', tone: 'danger' },
]
export const VISITS = [
  { id: 'v1', who: 'Avery Example', when: '8:00 – 10:00 AM', what: 'Morning routine and light housekeeping', status: 'Done', tone: 'success' as const },
  { id: 'v2', who: 'Quinn Sample', when: '11:00 AM – 1:00 PM', what: 'Meal preparation and errands', status: 'Next', tone: 'accent' as const },
  { id: 'v3', who: 'Jordan Placeholder', when: '3:00 – 5:00 PM', what: 'Companionship and a short walk', status: 'Later', tone: 'neutral' as const },
]
