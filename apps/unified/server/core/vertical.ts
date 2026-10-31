// A vertical is a setting (SPEC §8, RULEBOOK §8): which industry this tenant is, and the handful of things that
// differ by industry. Everything here feeds an option the shared modules already take, so a vertical changes
// words and switches, never code paths.
import type { StarterContent } from './starter.ts'
import type { Vocabulary } from '../../../../packages/tenant-ui/src/labels/vocabulary.ts'

/**
 * CREW SCOPE — Jobber's rule for a job trade's field seat: it reads the jobs assigned to it and to its crews
 * (server/crm/ownWork.ts), the customers on those jobs and its own bookings, not the whole business. Each job vertical
 * withholds these from `field` (withheldRolePermissions); managers and up keep them. Landscaping first (live retest,
 * 2026-10-24), then every job trade (contractor, field service, roofing, basic). RV's field seat is the sales floor,
 * which works the whole customer book, so it keeps them.
 */
export const CREW_SCOPE_WITHHELD = ['jobs:read-all', 'contacts:read-all', 'bookings:read-all']

export interface VerticalSettings {
  /** Stable id, reported to the screens and the mobile app as company.vertical. */
  id: string
  /** What the industry is called, for people. */
  label: string
  /**
   * What this business calls the people it serves, its work, its team, and what asks for a review by itself
   * (packages/tenant-ui labels/vocabulary.ts). Every shared screen builds its sentences from it; required, so no vertical
   * falls back to a contractor's words.
   */
  vocabulary: Vocabulary
  /** What this vertical calls each role rung (owner, admin, manager, field, viewer); unset rungs use the shared defaults. */
  roleLabels?: Record<string, string>
  /** Permissions added to a rung's base list, e.g. `{ field: ['contacts:create'] }`. */
  extraRolePermissions?: Record<string, string[]>
  /** Base permissions a seat does not get in this vertical (PermissionsDeps.withheldRolePermissions). */
  withheldRolePermissions?: Record<string, string[]>
  /**
   * Older role names this vertical's people may still carry, read as a rung, e.g. `{ staff: 'field' }` (the vet's
   * clinical staff seat, templates/crm-vet middleware/permissions.ts).
   */
  roleMapping?: Record<string, string>
  /** What the authenticator app lists two-factor under. */
  mfaIssuer: string
  /**
   * The vertical's feature list in the shared feature registry (packages/tenant-backend featureRegistry), which is
   * keyed by the CRM template name it grew up with ('crm', 'crm-salon'…). Until the registry is keyed by vertical.
   */
  featureSet: string
  /** Exterior Visualizer address, for the verticals that offer it. */
  visionUrl?: () => string | null
  /** The public website. */
  site: SiteSettings
  /**
   * The CRM screens' settings for this vertical: what each shared screen (packages/tenant-ui) is configured with —
   * labels, which sections a record shows, presets. Plain data, handed to the browser in the admin page
   * (http/adminScreens.ts) and typed there (web/src/crm/vertical.ts). The CRM templates kept these as
   * frontend/src/*Config.ts, one copy per template.
   */
  screens: Record<string, unknown>
  /**
   * How the CRM's shared modules behave for this vertical: switches for what the engine can do, never code. Each was a
   * difference between the CRM templates' copies of a routes/*.ts file (CUTOVER_LEDGER, step 3e). Absent = off / the
   * base CRM's behaviour.
   */
  crm?: CrmSettings
  /** What a new business finds on day one (help articles, price-book categories). Absent: the base CRM's (core/starter.ts). */
  starter?: StarterContent
  /** Online booking's answers for this vertical; each is the owner's switch to change. */
  booking?: {
    /** Whether the booking form asks for the customer's address when the owner hasn't said (the trades go to the address). Absent: asked. */
    requireAddress?: boolean
    /**
     * Where a booking lands besides the booking list. 'practice' is the vet's book: the pet becomes a chart under its
     * owner (found again by the owner and the pet's name) and the booking an appointment for both, in the booking's own
     * transaction (server/crm/vet/onlineBooking.ts; templates/crm-vet routes/booking.ts appointmentCalendar). 'chair' is
     * the salon's: the booking an appointment in The Book (server/crm/salon/onlineBooking.ts; templates/crm-salon). Absent:
     * the booking list only.
     */
    calendar?: 'practice' | 'chair'
    /** The public form asks for the pet and refuses a booking without its name (templates/crm-vet requirePet). With calendar 'practice'. */
    requirePet?: boolean
  }
}

/** The base CRM's behaviour: a vertical without its own `crm` settings gets this. */
export const BASE_CRM: CrmSettings = {
  documents: { markup: true, types: ['general', 'contract', 'permit', 'drawing', 'photo', 'invoice', 'receipt', 'other'] },
  tech: { checklistType: 'site_checklist', checklistTitle: 'Site checklist' },
  portal: { disable: ['service'] },
  // The live map and trips from the drivers' phones (the old contractor template had no feed; the unified app has it
  // for every vertical, and the contractor offers fleet and gps_tracking).
  fleet: { gps: true },
}

export interface CrmSettings {
  /**
   * A customer's service sites, and equipment at them: contacts list their sites and equipment, a job and a quote
   * point at a site and a piece of equipment, equipment records its site and the jobs done on it. (field service,
   * landscaping, basic, bar)
   */
  serviceSites?: boolean
  /** The portal's Visits section: finished visits with the crew's note and after-photos (landscaping; feature visit_reports). */
  visitReports?: boolean
  jobs?: {
    /** What a new job is when none is given (the database's default is 'service'). */
    defaultType?: string
    /** Photos on a job, kept in the private bucket and served by /api/media. */
    photos?: boolean
    /** A job can be billed on its own: POST /api/jobs/:id/invoice, numbered with this prefix and padding. */
    billing?: { prefix: string; pad: number; termsDays: number }
    /** Text the customer when a tech is on the way and when they arrive. */
    textArrival?: boolean
    /** A new job must be for a customer (packages/tenant-backend jobs.ts options.requireCustomer); the vertical's own word comes from its vocabulary. */
    requireCustomer?: boolean
    /** A repeating job can run on chosen days of the week (Monday and Thursday), not just one weekday. */
    repeatWeekdays?: boolean
  }
  quotes?: {
    /** Text the customer a link when a quote is sent. */
    textOnSend?: boolean
  }
  documents?: {
    /** Plan markup (drawings annotated): construction only. */
    markup?: boolean
    types: string[]
  }
  agreements?: {
    /** Service agreements recur and generate their own jobs. */
    recurrence?: boolean
  }
  fleet?: {
    /** Vehicles' live locations and trips (GPS): the fleet module's location, trip and mileage endpoints answer for real. (contractor, field service, basic) */
    gps?: boolean
  }
  leads?: {
    /** The lead platforms the Lead Sources page offers and the server accepts (ids; screens.leads.platforms has the same list). Absent: the trades set. (basic) */
    platforms?: string[]
    /** What a converted lead becomes: 'client' where a person you convert is in the book (salon). Absent: 'lead'. */
    contactType?: string
  }
  /** The field view's end-of-visit checklist. */
  tech: { checklistType: string; checklistTitle: string; legacyChecklistTypes?: string[] }
  /** Customer-portal sections this vertical doesn't offer. */
  portal: { disable: string[] }
  /**
   * What /api/dashboard answers: 'events' is the private-events dashboard (the book ahead, the pipeline by status,
   * the rooms, the money owed — server/crm/restaurant/eventsDashboard.ts), which templates/crm-restaurant and
   * templates/crm-bar shipped in place of the jobs dashboard. Absent: the jobs dashboard. (restaurant, bar)
   * 'practice' is the veterinary practice's (patients, the day's appointments, billed visit revenue, vaccinations
   * due, wellness enrolments — server/crm/vet/dashboard.ts, templates/crm-vet routes/dashboard.ts). (vet)
   * 'salon' is the salon's (the book today, the month's services and takings by chair, who is due back, active
   * memberships — server/crm/salon/dashboard.ts, templates/crm-salon routes/dashboard.ts). (salon)
   * 'dealership' is the RV / powersports dealer's (inventory, the sales pipeline, service, the Reports page's sales
   * figures — server/crm/rv/dashboard.ts, templates/crm-rv routes/dashboard.ts). (rv)
   * 'homecare' is the agency's (clients, caregivers clocked in, today's visits on the live board, invoices owed, the
   * office's to-do list — server/crm/homecare/planning/dashboard.ts, templates/crm-homecare routes/dashboard.ts). (homecare)
   * 'roof' is the roofer's (jobs open and in production, today's inspections and installs, quotes waiting, money owed,
   * new leads — server/crm/roof/field/dashboard.ts, templates/crm-roof routes/dashboard.ts). (roof)
   */
  dashboard?: 'events' | 'practice' | 'salon' | 'dealership' | 'homecare' | 'roof'
  /**
   * Private events (server/crm/restaurant) reach into the shared modules: a contact lists their events and can't be
   * deleted while they have any; money recorded on an event's invoice (by hand or by Stripe) confirms an enquiry it is
   * the deposit for and moves the invoice's due date to the next installment; the old event-payment ledger is moved
   * onto invoices once at boot. (templates/crm-restaurant and crm-bar routes/contacts, invoices, services/stripe,
   * routes/events.ts' backfill) (restaurant, bar)
   */
  events?: boolean
  /**
   * Patients (animals) on an owner's record (vet): a contact lists their pets and can't be deleted while they have
   * any (or any appointment); documents and invoices can be filed against a patient; the customer portal shows the
   * owner's pets, their vaccinations, appointments and visits. (templates/crm-vet routes/contacts, documents,
   * invoices, portal)
   */
  patients?: boolean
  /**
   * Whose book /api/appointments and /api/reminders are — one path each, so one router each: 'practice' is the
   * vet's (exam rooms, providers, patients; vaccination recall — server/crm/vet/). Absent: the salon's. (vet)
   */
  appointments?: 'practice'
  support?: {
    /** What the help assistant is told about this business's software, in place of the generic CRM sentence. (vet) */
    assistant?: string
  }
  /**
   * Whose /api/loyalty it is: absent is the salon's programme (points and punch cards earned on visits —
   * server/crm/salon/loyalty.ts, templates/crm-salon routes/loyalty.ts). Another value names the vertical whose own
   * router serves the path instead (the bar's regulars). (salon, bar)
   */
  loyalty?: 'bar'
  /**
   * The bar's food side (crm/bar: the menu, the register and grill, the card reader, the kiosk, online ordering) as a
   * vertical other than the bar has it: whether the register opens long tabs until the owner says otherwise, and the
   * feature the tap list needs on top of the menu's (a restaurant pours draft only when it switches 'draft_taps' on).
   * Absent: the bar's own (tabs on, taps with the menu). (restaurant)
   */
  foodService?: { tabs?: boolean; tapsFeature?: string }
  /**
   * Records that keep a contact from being deleted, beyond the standard ones (invoices, quotes, jobs, projects):
   * 'appointment', 'serviceRecord', 'membershipEnrollment' (salon, templates/crm-salon routes/contacts.ts).
   */
  contacts?: {
    guards?: Array<'appointment' | 'serviceRecord' | 'membershipEnrollment' | 'repairOrder' | 'salesLead' | 'storeOrder'>
    /**
     * The types a contact can be, in place of the shared four (lead, client, subcontractor, vendor): a dealership sells
     * to customers — ['lead', 'customer', 'vendor'] (templates/crm-rv routes/contacts.ts). Absent: the shared four.
     */
    types?: string[]
    /**
     * What a paying customer's contact type is: a converted lead becomes one, an imported or migrated customer is one,
     * and QuickBooks syncs them as customers. 'customer' at a dealership (templates/crm-rv routes/contacts.ts,
     * routes/import.ts, services/{import,migration,quickbooks}.ts). Absent: 'client'.
     */
    customerType?: string
  }
  team?: {
    /** Work a team member holds besides jobs, unassigned when they're removed: 'appointment' (a stylist's chair). (salon) */
    assignedWork?: Array<'appointment'>
    /**
     * The roles a login may be given or moved to (company module POST / PUT /api/company/users): ['manager', 'field'] —
     * a shop's three seats are owner, manager and staff, and it has no admin seat (templates/crm-store routes/users.ts
     * ASSIGNABLE_ROLES; owner's decision 2026-10-10). The owner is never assignable anywhere. Absent: the shared list
     * (admin, manager, field, viewer). (store)
     */
    roles?: string[]
  }
  invoices?: {
    /** A tip line on an invoice (salon). */
    tips?: boolean
    /** A client's account balance is a way to pay and a place to refund to (client_account_entry; salon). */
    accountBalance?: boolean
    /**
     * Which clock decides an invoice's day: 'booking' is the zone the booking calendar is set to (America/Chicago when
     * Booking was never set up), the salon's own clock (templates/crm-salon utils/salonDate.ts). Absent: the company's
     * zone (companyTimeZone).
     */
    clock?: 'booking'
    /**
     * How an invoice is numbered, a quote's converted invoice too: a dealership's run INV-1001, INV-1002…
     * ({ prefix: 'INV', pad: 0, seed: 1000 }, templates/crm-rv routes/invoices.ts and quotes.ts). Absent: INV-00001.
     */
    numbering?: { prefix: string; pad: number; seed: number }
  }
  /**
   * Where a website enquiry goes: 'pipeline' is a dealership's sales pipeline — a sales lead at new, on the customer's
   * existing contact when the email (or a phone nothing contradicts) matches, and the same message sent again within
   * 30 days kept as the open lead it already made (templates/crm-rv routes/webhooks.ts, T59). It takes an email or a
   * phone (the website chat's phone-only lead), and a `unitOfInterest` whose stock number links the lead to that unit.
   * Absent: the Lead Inbox when it's on, else a lead contact.
   */
  websiteEnquiries?: 'pipeline'
  /**
   * The vertical's own website forms, by `formType`: 'bar' answers the party request (a dated one opens an enquiry
   * in the party book) and the Regulars sign-up (crm/bar/enquiry.ts; templates/crm-bar routes/webhooks.ts). Any
   * other form is an ordinary enquiry. 'events' is a restaurant's: its catering form, with a real event date, opens an
   * enquiry in the event book (crm/restaurant/eventEnquiry.ts), when the 'event_web_enquiries' feature is on.
   */
  websiteForms?: 'bar' | 'events'
  /** The home-care add-on: its records, routes and timed work (server/crm/homecare; templates/crm-homecare). */
  homecare?: boolean
  /**
   * The roofing add-on (server/crm/roof; templates/crm-roof; docs/UNIFIED_ROOF_PLAN.md): insurance claims and
   * supplements, measurements and roof reports, storms and canvassing, crews and materials — and roofing's own job
   * module at /api/jobs, over the CRM's job table, in place of the shared one. (roof)
   */
  roof?: boolean
  /**
   * The store add-on (server/crm/store; templates/crm-store; docs/UNIFIED_STORE_PLAN.md): the catalogue, orders and
   * refunds, the storefront's public API and checkout, the merchant's payment, shipping and supplier connections,
   * discount codes, product reviews and the store's loyalty over the shared programme. (store)
   */
  store?: boolean
  /**
   * Who a phone call is about, for call tracking and the AI receptionist: 'clients' matches the caller to a home-care
   * client by phone (call_log.client_id), makes a client on a first call instead of a contact or an inbox lead, and
   * counts the call-volume report's hours and days on the agency's clock (templates/crm-homecare
   * services/calltracking.ts, services/aiReceptionist.ts). Absent: contacts, and the Lead Inbox where it is on. (homecare)
   */
  callers?: 'clients'
  /**
   * The switch the call log, the tracking numbers and the CallRail key (/api/calltracking) ride. 'ai_receptionist': the
   * vertical sells no Call Tracking, so the AI Receptionist page is their only screen and its switch opens them, its
   * Settings tab holding the CallRail key (templates/crm-roof index.ts, AIReceptionistPage.tsx). Absent: 'call_tracking'. (roof)
   */
  callTrackingSwitch?: 'ai_receptionist'
  /** The expense categories this trade buys in, and the words for the ones whose id isn't enough. Absent: the shared list. (salon) */
  expenses?: { categories: string[]; categoryLabels?: Record<string, string> }
  reports?: {
    /** Team productivity by services performed and what they took (service_record), for a chair. Absent: hours and jobs. (salon) */
    teamProductivity?: 'serviceRecords'
    /**
     * What /api/reports answers: 'homecare' is the agency's own reports (scheduled, worked and payable hours, revenue,
     * P&L, Client Hours by Week, the client report — server/crm/homecare/planning/reports.ts, templates/crm-homecare
     * routes/reports.ts) in place of the shared CRM reports. Absent: the shared CRM reports. (homecare)
     */
    module?: 'homecare'
  }
  reviews?: {
    /** What a review request is about when it has no job: 'visit' is the client's latest service record. (salon) */
    subject?: 'visit'
  }
  /** Text clients a reminder of tomorrow's appointment (the salon's hourly sweep, started once at boot). */
  appointmentReminders?: boolean
  /** The help centre and its assistant, grounded in what this vertical's business actually has switched on. (salon) */
  help?: {
    /** "You are a helpful support assistant for <productNoun>." */
    productNoun: string
    /** Seeded article title → the feature it describes; an article whose feature is off isn't shown. */
    articleFeatures: Record<string, string>
    /** [feature, words] the assistant may name, when the feature is on. */
    topics: Array<[string, string]>
    /** What to name when nothing is listed. */
    fallbackTopics: string
    /** A sentence on what this software does not have. */
    notOffered?: string
  }
}

/**
 * The site designs: a design is the look a business's website wears (site/designs/<id>.css on top of the base). The
 * first eight are the premium template families' looks; 'classic' is the base alone. The rest are whole looks of their
 * own (SITE_DESIGN_SPECS: build 'whole').
 */
export const SITE_DESIGNS = ['classic', 'bar', 'dispensary', 'fieldservice', 'homecare', 'landscaping', 'roofing', 'showcase', 'foundry', 'heritage', 'studio', 'market'] as const
export type SiteDesign = typeof SITE_DESIGNS[number]

/**
 * How a design is built. One row per design, and nothing else in the app branches on a design's NAME: the stylesheet
 * (server/site/routes.ts siteStylesheet) and the page around it (site/views/base.ejs, through siteOptions) read these
 * fields. Two independent ideas, which used to be one ("cover"):
 *
 *   build  — 'overrides': the design adds a few rules to the base (the default). 'whole': the design is a complete look;
 *            its stylesheet is laid over the base, which stays beneath it as a CSS layer and styles only what the design
 *            never does (the booking pages, a section its look lacks).
 *   frame  — the page the look is drawn on. 'book' is the bar's leather book (cover caps and corners, dark-first, its own
 *            self-hosted faces, a one-page menu). Absent: the standard page. A whole look need not have a frame.
 *
 * A whole look brings its own type (`fonts`: the Google Fonts stylesheet the page loads in place of the base's Inter and
 * Fraunces) and, when it restyles itself for light and dark (`schemes`: it follows the visitor's device setting,
 * prefers-color-scheme), the page says so (color-scheme) so the browser's own form controls and scrollbars follow too.
 */
export interface SiteDesignSpec {
  /** What the website settings call the design. */
  label: string
  build: 'overrides' | 'whole'
  frame?: 'book'
  fonts?: string
  schemes?: boolean
  /**
   * How the colour tokens are named (server/site/palette.ts): 'base' — the base stylesheet's (--paper, --white, --ink,
   * --brand-deep); 'look' — a whole look's (--bg, --sf, --tx, and its own dark band, `band`); 'bar' — the bar's own, whose
   * page is leather and is not restyled. headAlign: where a section's heading sits, so the accent bar under it follows.
   */
  tokens?: 'base' | 'look' | 'bar'
  /** The custom property that holds a whole look's dark band (foundry --steel, heritage --deep, studio and market --panel). */
  band?: string
  headAlign?: 'left' | 'center'
  /** The header is dark in both light and dark mode (foundry's steel), so a hollow button in it takes white, not the brand. */
  headerDark?: boolean
  /** A visitor may pick this look for the site they sign up for (the free preview on twomiah.com, POST /public/signup). */
  choosable?: boolean
}

export const SITE_DESIGN_SPECS: Record<SiteDesign, SiteDesignSpec> = {
  classic: { label: 'Classic', build: 'overrides' },
  bar: { label: 'Bar & tavern', build: 'whole', frame: 'book', tokens: 'bar' },
  dispensary: { label: 'Dispensary', build: 'overrides' },
  fieldservice: { label: 'Field service', build: 'overrides' },
  homecare: { label: 'Home care', build: 'overrides' },
  landscaping: { label: 'Landscaping', build: 'overrides' },
  roofing: { label: 'Roofing', build: 'overrides' },
  showcase: { label: 'Showcase', build: 'overrides' },
  // Three looks for a contractor's site (docs/new-looks): industrial, editorial, modern studio.
  foundry: {
    label: 'Foundry', build: 'whole', schemes: true, choosable: true, tokens: 'look', band: '--steel', headAlign: 'left', headerDark: true,
    fonts: 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Barlow:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap',
  },
  heritage: {
    label: 'Heritage', build: 'whole', schemes: true, choosable: true, tokens: 'look', band: '--deep',
    fonts: 'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Hanken+Grotesk:wght@400;500;600;700&display=swap',
  },
  // A look made for a shop (docs/store-looks): the photograph first, a price you can read, one strong Add to cart.
  market: {
    label: 'Market', build: 'whole', schemes: true, choosable: true, tokens: 'look', band: '--panel', headAlign: 'left',
    fonts: 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@500;600;700;800&family=Albert+Sans:wght@400;500;600;700;800&display=swap',
  },
  studio: {
    label: 'Studio', build: 'whole', schemes: true, choosable: true, tokens: 'look', band: '--panel', headAlign: 'left',
    fonts: 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap',
  },
}

/** The looks a visitor chooses between before they sign up: the designs whose row says `choosable`. */
export const SITE_LOOKS = SITE_DESIGNS.filter((id) => SITE_DESIGN_SPECS[id].choosable === true)

/** A look the visitor may choose, from whatever a request sent: the design's id, or null (not a choosable design). */
export function siteLookOf(v: unknown): SiteDesign | null {
  return typeof v === 'string' && (SITE_LOOKS as readonly string[]).includes(v) ? (v as SiteDesign) : null
}

/** What the website settings call each design. */
export const SITE_DESIGN_LABELS = Object.fromEntries(SITE_DESIGNS.map((id) => [id, SITE_DESIGN_SPECS[id].label])) as Record<SiteDesign, string>

export interface SiteSettings {
  /** The design a new site starts with; the owner's site row can choose another. */
  design: SiteDesign
  /** The words that differ between verticals on the public site. */
  words: {
    /** The contact section's label for the address: "Office" for the trades, "Address" elsewhere. */
    contactAddressLabel: string
    /** What the contact form's message box asks. */
    contactMessageLabel: string
    /** The reply when the message box is sent empty. */
    contactMessageRequired: string
  }
  /** A text-size control in the corner of every page (home care: readers who want larger type). */
  textSizeToggle?: boolean
  /** Where the header's button goes when the site names no page: a bar's is its Find us page, '/visit'. Absent: '/contact'. */
  ctaHref?: string
  /**
   * The live facts the site's own sections read, from the vertical's add-on in the same database: 'bar' is the bar's
   * night — the Tonight board, the taps, the menu, the hours, what's on, the speakeasy door — read through
   * server/crm/bar/barSite.ts (templates/website-premium-bar lib/bar.ts fetched them from the bar CRM over HTTP).
   * 'menu' is the food side's menu alone (a restaurant or a food truck): the sections, items, sizes, prices and photos
   * entered on Menu, 86'd items left off, and a /menu page with its nav item while the menu has items (barSite.ts
   * createMenuSite) — no taps, no Tonight board. Absent: the sections have only their own data.
   */
  facts?: 'bar' | 'menu'
}

/**
 * The tenant's vertical, from the VERTICAL setting the Factory puts on every tenant (RULEBOOK §9). Production
 * refuses to start without a known one rather than run a business as the wrong industry.
 */
export async function loadVertical(id = process.env.VERTICAL): Promise<VerticalSettings> {
  const known: Record<string, () => Promise<{ default: VerticalSettings }>> = {
    contractor: () => import('../../verticals/contractor/settings.ts'),
    fieldservice: () => import('../../verticals/fieldservice/settings.ts'),
    basic: () => import('../../verticals/basic/settings.ts'),
    vet: () => import('../../verticals/vet/settings.ts'),
    salon: () => import('../../verticals/salon/settings.ts'),
    landscaping: () => import('../../verticals/landscaping/settings.ts'),
    restaurant: () => import('../../verticals/restaurant/settings.ts'),
    rv: () => import('../../verticals/rv/settings.ts'),
    bar: () => import('../../verticals/bar/settings.ts'),
    homecare: () => import('../../verticals/homecare/settings.ts'),
    roofing: () => import('../../verticals/roof/settings.ts'),
    store: () => import('../../verticals/store/settings.ts'),
  }
  if (!id) {
    if (process.env.NODE_ENV === 'production') throw new Error('VERTICAL is not set')
    id = 'contractor'
  }
  const load = known[id]
  if (!load) throw new Error(`Unknown VERTICAL '${id}'`)
  return (await load()).default
}
