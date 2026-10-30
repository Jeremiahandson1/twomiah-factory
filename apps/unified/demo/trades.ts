// The free "Try the demo": one sample business per trade. Pure data, read by the recorder (scripts/record-demo.ts), the
// /demo page (web/demo/picker.tsx) and the tests. Every name here is invented — no real business, person or place.
export interface DemoTrade {
  /** The URL-safe id: ?trade=<id>, demo/seed/<id>.ts, demo/public/demo-data/<id>.json. */
  id: string
  /** The unified vertical the real server is booted as (server/core/vertical.ts). */
  vertical: string
  /** What the /demo page's card calls the trade. */
  label: string
  /** The sample business (clearly fake). */
  business: string
  /** The card's one line. */
  blurb: string
  /** The brand colour the sample business signs in with. */
  primaryColor: string
}

export const DEMO_TRADES: DemoTrade[] = [
  { id: 'contractor', vertical: 'contractor', label: 'Contractor', business: 'Sample Ridge Remodeling', blurb: 'Leads, quotes, jobs and invoices for a remodeling crew.', primaryColor: '#c2410c' },
  { id: 'roofing', vertical: 'roofing', label: 'Roofing', business: 'Sample Peak Roofing', blurb: 'Storm leads, roof quotes, crews and the canvasser view.', primaryColor: '#b91c1c' },
  { id: 'homecare', vertical: 'homecare', label: 'Home care', business: 'Sample Harbor Home Care', blurb: 'Clients, caregivers, visits and billing for a home care agency.', primaryColor: '#0f766e' },
  { id: 'salon', vertical: 'salon', label: 'Salon', business: 'Sample Willow Salon', blurb: 'The book, the service menu, clients and rebooking.', primaryColor: '#9d174d' },
  { id: 'restaurant-bar', vertical: 'bar', label: 'Restaurant & bar', business: 'Sample Corner Tap & Table', blurb: 'Tonight, the menu, private events and the kitchen.', primaryColor: '#1d4ed8' },
  { id: 'store', vertical: 'store', label: 'Store', business: 'Sample Maple Mercantile', blurb: 'Orders, products, customers and shipping for an online shop.', primaryColor: '#4d7c0f' },
]

export const tradeById = (id: string | null | undefined): DemoTrade | undefined => DEMO_TRADES.find((t) => t.id === id)
