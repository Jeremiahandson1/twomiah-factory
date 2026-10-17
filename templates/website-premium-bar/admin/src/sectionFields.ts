// Editors for the trade sections (and the shared ones that had none), described as data. One generic
// form (sectionForms/GenericSectionForm) renders any of these — a new section needs an entry here,
// not a new component. Field keys are exactly what each views/sections/<type>/<variant>.ejs reads.
//
// What the site states is the owner's: these are the owner typing their own facts, so nothing here
// is pre-filled with a claim.

export type FieldSpec =
  | { key: string; label: string; kind: 'text' | 'textarea' | 'number' | 'image'; hint?: string; placeholder?: string }
  | { key: string; label: string; kind: 'bool'; hint?: string }
  | { key: string; label: string; kind: 'select'; options: Array<{ value: string; label: string }>; hint?: string }
  | { key: string; label: string; kind: 'cta'; hint?: string }
  | { key: string; label: string; kind: 'strings'; hint?: string; placeholder?: string; addLabel?: string; numbers?: boolean }
  | { key: string; label: string; kind: 'list'; item: FieldSpec[]; itemLabel: string; hint?: string; max?: number }
  | { key: string; label: string; kind: 'group'; fields: FieldSpec[]; hint?: string }

export interface TradeSection {
  type: string
  variant: string
  label: string
  description: string
  fields: FieldSpec[]
  defaultData: Record<string, unknown>
}

const heading: FieldSpec = { key: 'heading', label: 'Heading', kind: 'text' }
const intro: FieldSpec = { key: 'intro', label: 'Intro (optional)', kind: 'textarea' }

export const TRADE_SECTIONS: TradeSection[] = [
  // ── Shared ─────────────────────────────────────────────────────────────
  {
    type: 'before_after', variant: 'slider', label: 'Before / after — Slider',
    description: 'Drag-to-compare pairs of your own before and after photos.',
    fields: [heading, intro, { key: 'items', label: 'Pairs', kind: 'list', itemLabel: 'pair', max: 12, item: [
      { key: 'beforeImage', label: 'Before photo', kind: 'image' }, { key: 'afterImage', label: 'After photo', kind: 'image' },
      { key: 'caption', label: 'Caption (optional)', kind: 'text' }, { key: 'location', label: 'Where (optional)', kind: 'text' },
      { key: 'material', label: 'Material (optional)', kind: 'text' }, { key: 'year', label: 'Year (optional)', kind: 'text' },
    ] }],
    defaultData: { heading: 'Before and after', intro: '', items: [] },
  },
  {
    type: 'trust', variant: 'badges', label: 'Trust — Badges',
    description: 'Licenses, certifications and memberships you actually hold.',
    fields: [heading, intro, { key: 'items', label: 'Badges', kind: 'list', itemLabel: 'badge', item: [{ key: 'name', label: 'Name', kind: 'text', placeholder: 'e.g. GAF Master Elite' }] }],
    defaultData: { heading: '', intro: '', items: [] },
  },
  {
    type: 'reservation', variant: 'cta', label: 'Booking — Button',
    description: 'A heading and a button to your online booking page.',
    fields: [heading, intro, { key: 'buttonLabel', label: 'Button label', kind: 'text' }, { key: 'note', label: 'Small print (optional)', kind: 'text' },
      { key: 'bookingPath', label: 'Booking link', kind: 'text', hint: 'Leave blank for /book.' }],
    defaultData: { heading: 'Book online', intro: '', buttonLabel: 'See open times', note: '' },
  },
  // ── Dispensary ─────────────────────────────────────────────────────────
  {
    type: 'age', variant: 'modal', label: 'Age gate',
    description: 'The "are you old enough" check every visitor sees first.',
    fields: [{ key: 'gateAge', label: 'Minimum age', kind: 'number' }, heading, { key: 'message', label: 'Message', kind: 'textarea' },
      { key: 'stateSelector', label: 'Ask which state they are in', kind: 'bool' }, { key: 'exitUrl', label: 'Where under-age visitors are sent', kind: 'text' }],
    defaultData: { gateAge: 21, stateSelector: true },
  },
  {
    type: 'deals', variant: 'strip', label: 'Deals — Strip',
    description: "This week's deals and promotions.",
    fields: [heading, intro, { key: 'expiresLabel', label: 'When they end (optional)', kind: 'text', placeholder: 'e.g. Through Sunday' },
      { key: 'items', label: 'Deals', kind: 'list', itemLabel: 'deal', item: [{ key: 'title', label: 'Deal', kind: 'text' }, { key: 'description', label: 'Details (optional)', kind: 'textarea' }, { key: 'badge', label: 'Badge (optional)', kind: 'text', placeholder: 'e.g. 20% off' }] }],
    defaultData: { heading: 'Deals', items: [] },
  },
  {
    type: 'strain', variant: 'grid', label: 'Strains — Grid',
    description: 'A filterable grid of strains you carry.',
    fields: [heading, intro, { key: 'items', label: 'Strains', kind: 'list', itemLabel: 'strain', item: [
      { key: 'name', label: 'Name', kind: 'text' },
      { key: 'type', label: 'Type', kind: 'select', options: [{ value: '', label: '—' }, { value: 'indica', label: 'Indica' }, { value: 'sativa', label: 'Sativa' }, { value: 'hybrid', label: 'Hybrid' }, { value: 'cbd', label: 'CBD' }] },
      { key: 'thc', label: 'THC (optional)', kind: 'text', placeholder: 'e.g. 22%' }, { key: 'cbd', label: 'CBD (optional)', kind: 'text' },
      { key: 'price', label: 'Price (optional)', kind: 'text' }, { key: 'description', label: 'Description (optional)', kind: 'textarea' },
      { key: 'effects', label: 'Effects (optional)', kind: 'strings', addLabel: 'Add effect' }, { key: 'terpenes', label: 'Terpenes (optional)', kind: 'strings', addLabel: 'Add terpene' },
      { key: 'image', label: 'Photo (optional)', kind: 'image' },
    ] }],
    defaultData: { heading: 'Strains', items: [] },
  },
  // ── Field service ──────────────────────────────────────────────────────
  {
    type: 'emergency', variant: 'bar', label: 'Emergency — Call bar',
    description: 'A tap-to-call bar for same-day and after-hours calls. Only if you take them.',
    fields: [{ key: 'phone', label: 'Phone', kind: 'text' }, heading, { key: 'subtext', label: 'Subtext (optional)', kind: 'text' },
      { key: 'businessHours', label: 'Regular hours (optional)', kind: 'text', placeholder: 'e.g. 7am-7pm' },
      { key: 'normalHoursLabel', label: 'Label during hours (optional)', kind: 'text' }, { key: 'afterHoursLabel', label: 'Label after hours (optional)', kind: 'text' }],
    defaultData: { phone: '', heading: '' },
  },
  {
    type: 'financing', variant: 'calculator', label: 'Financing — Calculator',
    description: 'A monthly-payment calculator. Only with the terms your lender actually offers.',
    fields: [heading, intro, { key: 'fromMonthly', label: 'Lowest monthly payment', kind: 'number' }, { key: 'apr', label: 'APR (%)', kind: 'number' },
      { key: 'minLoanAmount', label: 'Smallest loan', kind: 'number' }, { key: 'maxLoanAmount', label: 'Largest loan', kind: 'number' },
      { key: 'maxTermMonths', label: 'Longest term (months)', kind: 'number' }, { key: 'ctaLabel', label: 'Button label (optional)', kind: 'text' },
      { key: 'delightRain', label: 'Show the background animation', kind: 'bool' }],
    defaultData: { heading: 'Financing', delightRain: true },
  },
  {
    type: 'pricing', variant: 'flat-rate-menu', label: 'Pricing — Flat-rate menu',
    description: 'Fixed prices for common jobs.',
    fields: [heading, intro, { key: 'items', label: 'Jobs', kind: 'list', itemLabel: 'job', item: [
      { key: 'service', label: 'Job', kind: 'text' }, { key: 'priceLabel', label: 'Price', kind: 'text', placeholder: 'e.g. $189' },
      { key: 'includes', label: "What's included (optional)", kind: 'strings', addLabel: 'Add line' }, { key: 'note', label: 'Note (optional)', kind: 'text' },
    ] }, { key: 'disclaimer', label: 'Small print (optional)', kind: 'textarea' }],
    defaultData: { heading: 'Pricing', items: [] },
  },
  {
    type: 'service_area', variant: 'zip-check', label: 'Service area — ZIP check',
    description: 'Visitors type their ZIP and get an instant "yes, we come to you".',
    fields: [heading, intro, { key: 'serviceZips', label: 'ZIP codes you serve', kind: 'strings', addLabel: 'Add ZIP' },
      { key: 'yesLabel', label: 'Message when served', kind: 'text', hint: '<ZIP> is replaced with what they typed.' },
      { key: 'yesHref', label: 'Button link when served', kind: 'text', placeholder: '/book or /contact' },
      { key: 'noLabel', label: 'Message when not served', kind: 'text' }, { key: 'noEmail', label: 'Offer a "tell me when you expand" signup', kind: 'bool' }],
    defaultData: { heading: 'Do we come to you?', serviceZips: [], noEmail: true },
  },
  // ── Food truck / restaurant ────────────────────────────────────────────
  {
    type: 'menu', variant: 'cards', label: 'Menu — Cards',
    description: 'Your menu items with prices and photos.',
    fields: [heading, intro, { key: 'items', label: 'Items', kind: 'list', itemLabel: 'item', item: [
      { key: 'name', label: 'Name', kind: 'text' }, { key: 'price', label: 'Price (optional)', kind: 'text' },
      { key: 'description', label: 'Description (optional)', kind: 'textarea' }, { key: 'image', label: 'Photo (optional)', kind: 'image' },
      { key: 'dietary', label: 'Dietary tags (optional)', kind: 'strings', placeholder: 'e.g. vegan', addLabel: 'Add tag' },
    ] }],
    defaultData: { heading: 'Menu', items: [] },
  },
  {
    type: 'schedule', variant: 'week-strip', label: 'Schedule — Week',
    description: 'Where you are each day this week.',
    fields: [heading, intro, { key: 'days', label: 'Days', kind: 'list', itemLabel: 'day', max: 14, item: [
      { key: 'dayLabel', label: 'Day', kind: 'text', placeholder: 'e.g. Tue' }, { key: 'location', label: 'Where', kind: 'text' },
      { key: 'hours', label: 'Hours', kind: 'text' }, { key: 'note', label: 'Note (optional)', kind: 'text' },
    ] }],
    defaultData: { heading: 'Find us this week', days: [] },
  },
  {
    type: 'location', variant: 'live-map', label: 'Location — Where we are now',
    description: 'Where the truck is today and recent stops.',
    fields: [heading, intro, { key: 'currentAddress', label: 'Where we are now', kind: 'text' }, { key: 'currentUntil', label: 'Until', kind: 'text', placeholder: 'e.g. 2pm' },
      { key: 'recentLocations', label: 'Recent stops', kind: 'list', itemLabel: 'stop', max: 5, item: [{ key: 'label', label: 'Where', kind: 'text' }, { key: 'when', label: 'When', kind: 'text' }] }],
    defaultData: { heading: 'Where we are', recentLocations: [] },
  },
  {
    type: 'catering', variant: 'inquiry-form', label: 'Catering — Inquiry form',
    description: 'An event-inquiry form (date, headcount, venue).',
    fields: [heading, intro, { key: 'minHeadcount', label: 'Minimum headcount (optional)', kind: 'number' },
      { key: 'leadTimeWeeks', label: 'Book at least this many weeks ahead (optional)', kind: 'number' },
      { key: 'venueTypes', label: 'Venue types to choose from', kind: 'strings', addLabel: 'Add venue type' },
      { key: 'includes', label: "What's included (optional)", kind: 'strings', addLabel: 'Add line' },
      { key: 'responsePromise', label: 'Reply note (optional)', kind: 'text', hint: 'Only a promise you keep.' }],
    defaultData: { heading: 'Catering', venueTypes: ['Wedding', 'Corporate', 'Private party'] },
  },
  {
    type: 'social', variant: 'feed', label: 'Social — Follow us',
    description: 'A link to your Instagram or TikTok.',
    fields: [{ key: 'platform', label: 'Platform', kind: 'select', options: [{ value: 'instagram', label: 'Instagram' }, { value: 'tiktok', label: 'TikTok' }] },
      { key: 'handle', label: 'Handle', kind: 'text', placeholder: '@yourname' }, heading, intro],
    defaultData: { platform: 'instagram', handle: '' },
  },
  // ── Home care ──────────────────────────────────────────────────────────
  {
    type: 'care', variant: 'finder', label: 'Care finder',
    description: 'A short step-by-step form: who needs care, what kind, how many hours.',
    fields: [heading, intro, { key: 'relationships', label: '"Who needs care" choices', kind: 'strings', addLabel: 'Add choice' },
      { key: 'careTypes', label: 'Types of care you offer', kind: 'strings', addLabel: 'Add type' },
      { key: 'hoursOptions', label: '"How many hours" choices', kind: 'strings', addLabel: 'Add choice' },
      { key: 'ctaLabel', label: 'Button label (optional)', kind: 'text' }, { key: 'responsePromise', label: 'Reply note (optional)', kind: 'text', hint: 'Only a promise you keep.' }],
    defaultData: { heading: 'Find the right care' },
  },
  {
    type: 'caregivers', variant: 'grid', label: 'Caregivers — Grid',
    description: 'Your actual caregivers.',
    fields: [heading, intro, { key: 'items', label: 'Caregivers', kind: 'list', itemLabel: 'caregiver', item: [
      { key: 'name', label: 'Name', kind: 'text' }, { key: 'photo', label: 'Photo (optional)', kind: 'image' },
      { key: 'yearsExperience', label: 'Years of experience (optional)', kind: 'number' }, { key: 'blurb', label: 'About (optional)', kind: 'textarea' },
      { key: 'specialties', label: 'Specialties (optional)', kind: 'strings', addLabel: 'Add specialty' },
      { key: 'certifications', label: 'Certifications (optional)', kind: 'strings', addLabel: 'Add certification' },
      { key: 'languages', label: 'Languages (optional)', kind: 'strings', addLabel: 'Add language' },
    ] }],
    defaultData: { heading: 'Our caregivers', items: [] },
  },
  {
    type: 'coverage', variant: 'insurance-guide', label: 'Coverage — How to pay',
    description: 'Which programs and insurance cover care, and how you help.',
    fields: [heading, intro, { key: 'items', label: 'Programs', kind: 'list', itemLabel: 'program', item: [
      { key: 'source', label: 'Program', kind: 'text', placeholder: 'e.g. Long-term care insurance' }, { key: 'whatItCovers', label: 'What it covers', kind: 'textarea' },
      { key: 'eligibility', label: 'Who qualifies', kind: 'textarea' }, { key: 'howToApply', label: 'How to apply', kind: 'textarea' }, { key: 'ourRole', label: 'How we help', kind: 'textarea' },
    ] }],
    defaultData: { heading: 'Paying for care', items: [] },
  },
  // ── Landscaping / roofing ──────────────────────────────────────────────
  {
    type: 'packages', variant: 'seasonal', label: 'Packages — Seasonal',
    description: 'Service packages or tiers, highlighted by season.',
    fields: [heading, intro, { key: 'items', label: 'Packages', kind: 'list', itemLabel: 'package', item: [
      { key: 'title', label: 'Name', kind: 'text' },
      { key: 'tier', label: 'Tier', kind: 'select', options: [{ value: '', label: '—' }, { value: 'basic', label: 'Basic' }, { value: 'standard', label: 'Standard' }, { value: 'premium', label: 'Premium' }] },
      { key: 'pricePerMonth', label: 'Price per month (optional)', kind: 'text' }, { key: 'includes', label: "What's included", kind: 'strings', addLabel: 'Add line' },
      { key: 'seasonOnly', label: 'Season (optional)', kind: 'text', placeholder: 'e.g. winter' }, { key: 'badge', label: 'Badge (optional)', kind: 'text' }, { key: 'note', label: 'Note (optional)', kind: 'text' },
    ] }],
    defaultData: { heading: 'Packages', items: [] },
  },
  {
    type: 'quote', variant: 'instant-address', label: 'Quote — Price by property size',
    description: 'Visitors enter an address and see a price range from your price per square foot.',
    fields: [heading, intro, { key: 'pricePerSqFt', label: 'Your price per square foot ($)', kind: 'number' },
      { key: 'minSqFt', label: 'Smallest job (sq ft, optional)', kind: 'number' }, { key: 'maxSqFt', label: 'Largest job (sq ft, optional)', kind: 'number' },
      { key: 'callToAction', label: 'Button label (optional)', kind: 'text' }],
    defaultData: { heading: 'Get a price range' },
  },
  {
    type: 'banner', variant: 'storm-alert', label: 'Storm alert banner',
    description: 'A banner after a storm, with the dates it hit.',
    fields: [heading, { key: 'subtitle', label: 'Subtitle (optional)', kind: 'textarea' }, { key: 'startDate', label: 'Storm date', kind: 'text', placeholder: 'e.g. 2026-10-02' },
      { key: 'endDate', label: 'Show until (optional)', kind: 'text', placeholder: 'e.g. 2026-11-15' }, { key: 'cta', label: 'Button', kind: 'cta' },
      { key: 'dismissable', label: 'Visitors can close it', kind: 'bool' }],
    defaultData: { heading: '', dismissable: true },
  },
  // ── RV / vet / showcase ────────────────────────────────────────────────
  {
    type: 'inventory', variant: 'showcase', label: 'Inventory — Featured units',
    description: 'Featured units. With an inventory feed in Settings, real units show here automatically.',
    fields: [heading, intro, { key: 'units', label: 'Units', kind: 'list', itemLabel: 'unit', max: 12, item: [
      { key: 'title', label: 'Title', kind: 'text', placeholder: 'e.g. 2024 Grand Design Imagine 2600RB' }, { key: 'type', label: 'Type (optional)', kind: 'text' },
      { key: 'price', label: 'Price (optional)', kind: 'text' }, { key: 'payment', label: 'Monthly payment (optional)', kind: 'text' },
      { key: 'length', label: 'Length (optional)', kind: 'text' }, { key: 'mileage', label: 'Mileage (optional)', kind: 'text' },
      { key: 'image', label: 'Photo', kind: 'image' }, { key: 'url', label: 'Link (optional)', kind: 'text' }, { key: 'status', label: 'Badge (optional)', kind: 'text', placeholder: 'e.g. Just arrived' },
    ] }, { key: 'ctaLabel', label: 'Button label', kind: 'text' }, { key: 'ctaUrl', label: 'Button link', kind: 'text' }, { key: 'disclaimer', label: 'Small print', kind: 'text' }],
    defaultData: { heading: 'Featured inventory', units: [], ctaLabel: 'See all inventory', ctaUrl: '/inventory' },
  },
  {
    type: 'urgent', variant: 'bar', label: 'Urgent care bar',
    description: 'For the owner whose animal is sick right now: heading and tap-to-call.',
    fields: [heading, { key: 'phone', label: 'Phone', kind: 'text' }, { key: 'afterHoursNote', label: 'After-hours note (optional)', kind: 'text' },
      { key: 'walkIns', label: 'We take walk-ins', kind: 'bool' },
      { key: 'emergencyPartner', label: 'After-hours emergency hospital you refer to (optional)', kind: 'group', fields: [
        { key: 'name', label: 'Name', kind: 'text' }, { key: 'phone', label: 'Phone', kind: 'text' }, { key: 'address', label: 'Address', kind: 'text' },
      ] }],
    defaultData: { heading: 'Sick or injured pet?' },
  },
  {
    type: 'reservation', variant: 'widget', label: 'Booking — Party size + time',
    description: 'Pick a party size and a time, then continue to booking.',
    fields: [heading, intro, { key: 'partyLabel', label: 'Party label (optional)', kind: 'text' },
      { key: 'partySizes', label: 'Party sizes', kind: 'strings', numbers: true, addLabel: 'Add size' }, { key: 'times', label: 'Times', kind: 'strings', placeholder: 'e.g. 6:30 PM', addLabel: 'Add time' },
      { key: 'defaultTime', label: 'Preselected time (optional)', kind: 'text' }, { key: 'guestNoun', label: 'Guest word (optional)', kind: 'text', placeholder: 'guest' },
      { key: 'guestNounPlural', label: 'Guests word (optional)', kind: 'text', placeholder: 'guests' }, { key: 'maxLeadDays', label: 'Book up to this many days ahead (optional)', kind: 'number' },
      { key: 'submitLabel', label: 'Button label (optional)', kind: 'text' }, { key: 'note', label: 'Small print (optional)', kind: 'text' },
      { key: 'bookingPath', label: 'Booking link', kind: 'text', hint: 'Leave blank for /book.' }],
    defaultData: { heading: 'Reserve a table' },
  },
]

export function findTradeSection(type: string, variant: string): TradeSection | undefined {
  return TRADE_SECTIONS.find((s) => s.type === type && s.variant === variant)
}
