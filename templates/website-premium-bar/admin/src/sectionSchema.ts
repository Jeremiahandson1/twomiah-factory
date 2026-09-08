// Admin-side mirror of apps/api/src/services/sectionComposer.ts SECTION_SCHEMA.
// Drives the "add section" picker, the form dispatcher, and the section
// list display. Keep in sync with the backend — any new type/variant
// needs both an EJS partial in views/sections/ AND a form component
// registered here.

export interface SectionDef {
  type: string
  variant: string
  label: string
  description: string
  defaultData: Record<string, unknown>
}

export const SECTION_DEFS: SectionDef[] = [
  // ── Tonight Board (bar template) ─────────────────────────────────────
  {
    type: 'tonight', variant: 'board',
    label: 'Tonight Board — live status',
    description: 'Replaces the hero. Kitchen open/closed with countdown, bar hours, what is on tap, tonight\'s game, today\'s special, how busy. All values are live from the console and the hours engine.',
    defaultData: { eyebrow: 'Tonight at', title: '', intro: '', asHeading: true, showTaps: true, showRoom: true, tapsHref: '/taps', menuHref: '/menu' },
  },
  {
    type: 'menu', variant: 'sections',
    label: 'Menu — full menu (from the menu database)',
    description: 'The whole menu as real text with prices, grouped by section, with Menu/MenuItem structured data. Items come from the Menu database (and Square once connected), not from this form.',
    defaultData: { heading: 'The menu', intro: '', asHeading: true, kind: 'all', showSignatureLinks: true },
  },
  {
    type: 'menu', variant: 'item-hero',
    label: 'Menu — signature item page',
    description: 'One signature item (a burger) as its own page: photo, price, story, MenuItem schema. Pick the item by slug.',
    defaultData: { slug: '', section: '', eyebrow: '' },
  },
  {
    type: 'events', variant: 'recurring',
    label: 'Event — weekly (fish fry, trivia)',
    description: 'A weekly recurring thing with its own page: day, time, price, details. Emits Event structured data with a schedule.',
    defaultData: { eyebrow: 'Every Friday', title: 'Fish Fry', day: 'Friday', startTime: '11:00', endTime: '21:00', timeLabel: '', price: '', description: '', details: [], asHeading: true, cta: { label: 'Hours and directions', href: '/visit' } },
  },
  { type: 'timeline', variant: 'eras',
    label: 'Timeline — The story (all eras)',
    description: 'THE ARCHIVE. Every published era from Timeline, oldest first, on a gold spine with a permalink per era. Add eras under Timeline; this section only sets the framing.',
    defaultData: { heading: '145 years on East Madison Street', intro: '', asHeading: true } },
  { type: 'timeline', variant: 'era',
    label: 'Timeline — One era (its own page)',
    description: 'One era from Timeline as a full page: year, title, story, photo or then-and-now pair, prev/next links and a link back to the story. Use on /story/<slug> pages.',
    defaultData: { slug: '', backHref: '/story', backLabel: 'Back to the story' } },
  { type: 'hours', variant: 'table',
    label: 'Hours — bar and kitchen table',
    description: 'Weekly bar AND kitchen hours from Settings → Hours, with tonight\'s live line and upcoming holiday hours. Never type hours anywhere else.',
    defaultData: { heading: 'Hours', intro: '', asHeading: false, showHolidays: true } },
  { type: 'visit', variant: 'details',
    label: 'Visit — address, directions, parking, accessibility',
    description: 'Address and phone from Settings, one-tap directions to Google Maps AND Apple Maps, parking, accessibility notes, good-to-know list.',
    defaultData: { heading: 'Find us', intro: '', asHeading: true, parking: '', accessibility: [], notes: [], showMap: false } },
  { type: 'parties', variant: 'inquiry-form',
    label: 'Parties — inquiry form (texts the owner)',
    description: 'Private-party inquiry, not a reservation system. Saves to the Party inbox and texts the owner. Sidebar facts optional.',
    defaultData: { heading: 'Book the back booths', intro: '', asHeading: true, minParty: 6, promise: '', occasions: [], sidebar: [], facts: [] } },
  { type: 'events', variant: 'list',
    label: 'Events — what\'s on (from the console)',
    description: 'Upcoming events posted from the console, plus the standing weekly things you list here (fish fry, the game).',
    defaultData: { heading: "What's on", intro: '', asHeading: true, recurring: [], emptyText: '' } },
  { type: 'taps', variant: 'wall',
    label: 'Taps — the tap wall (live)',
    description: 'What is actually pouring, from the console\'s tap/blow buttons. Public words are only pouring / just tapped / last keg.',
    defaultData: { heading: 'On tap', intro: '', asHeading: true, leadOrigins: ['Germany'], showPrices: true } },
  // ── Hero ─────────────────────────────────────────────────────────────
  {
    type: 'hero', variant: 'full-bleed',
    label: 'Hero — Full bleed',
    description: 'One large background photo with overlay copy. Best when a single shot earns the lead.',
    defaultData: {
      image: '',
      eyebrow: '',
      title: '',
      subtitle: '',
      primaryCta: { label: 'Get in touch', href: 'contact' },
      secondaryCta: { label: '', href: '' },
    },
  },
  {
    type: 'hero', variant: 'split',
    label: 'Hero — Split image + copy',
    description: 'Copy on one side, image on the other. Good for an about-us moment or second hero block.',
    defaultData: {
      title: '',
      eyebrow: '',
      subtitle: '',
      image: '',
      flip: false,
      primaryCta: { label: '', href: '' },
      stats: [],
    },
  },
  {
    type: 'hero', variant: 'centered-stats',
    label: 'Hero — Centered with stats',
    description: 'Lead with credibility metrics. Big headline, optional stat band underneath.',
    defaultData: {
      eyebrow: '',
      title: '',
      subtitle: '',
      primaryCta: { label: 'Get in touch', href: 'contact' },
      stats: [],
    },
  },

  // ── Services ────────────────────────────────────────────────────────
  {
    type: 'services', variant: 'cards-grid',
    label: 'Services — Card grid',
    description: 'Uniform cards. Reads as a menu when you offer many similar services.',
    defaultData: {
      heading: 'What we do',
      intro: '',
      items: [],
    },
  },
  {
    type: 'services', variant: 'alternating',
    label: 'Services — Alternating rows',
    description: 'Image + copy rows that alternate sides. Editorial feel for fewer, distinct services.',
    defaultData: {
      heading: 'What we do',
      intro: '',
      items: [],
    },
  },

  // ── About / Team ────────────────────────────────────────────────────
  {
    type: 'about', variant: 'story',
    label: 'About — Story',
    description: 'Portrait + multi-paragraph narrative in the founder voice.',
    defaultData: {
      eyebrow: '',
      title: 'Our story',
      portrait: '',
      paragraphs: [''],
      signature: '',
      stats: [],
    },
  },
  {
    type: 'team', variant: 'grid',
    label: 'Team — Grid',
    description: 'Portrait + name + role per member. 2–8 members; responsive grid.',
    defaultData: {
      heading: 'The team',
      intro: '',
      members: [],
    },
  },

  // ── CTA ──────────────────────────────────────────────────────────────
  {
    type: 'cta', variant: 'banner',
    label: 'CTA — Banner',
    description: 'Single-row strip with headline + one primary action. Section punctuation.',
    defaultData: {
      heading: '',
      subtitle: '',
      primaryCta: { label: 'Get in touch', href: 'contact' },
    },
  },
  {
    type: 'cta', variant: 'split',
    label: 'CTA — Split with image',
    description: 'Image on one side, copy + bullets + action on the other. Closing argument.',
    defaultData: {
      heading: '',
      subtitle: '',
      image: '',
      bullets: [],
      primaryCta: { label: 'Get in touch', href: 'contact' },
      phone: '',
    },
  },

  // ── Contact ──────────────────────────────────────────────────────────
  {
    type: 'contact', variant: 'form-info',
    label: 'Contact — Form + business details',
    description: 'Form on one side, phone/email/address/hours/response promise on the other.',
    defaultData: {
      heading: 'Start a conversation',
      intro: '',
      phone: '',
      email: '',
      address: '',
      hours: ['Monday – Friday: 8am – 5pm'],
      responsePromise: 'We reply to project inquiries within one business day.',
    },
  },

  // ── Gallery ─────────────────────────────────────────────────────────
  {
    type: 'gallery', variant: 'grid',
    label: 'Gallery — Photo grid',
    description: 'Responsive 3-column grid of photos. Best for showcasing recent work, projects, dishes, or before/after.',
    defaultData: {
      heading: 'Recent work',
      intro: '',
      photos: [],
    },
  },

  // ── Testimonials ────────────────────────────────────────────────────
  {
    type: 'testimonials', variant: 'quotes',
    label: 'Testimonials — Customer quotes',
    description: '1-3 short quotes from real customers. Most persuasive piece of copy on most service-business sites.',
    defaultData: {
      heading: 'What our customers say',
      intro: '',
      items: [{ quote: '', author: '', role: '', photo: '' }],
    },
  },

  // ── Stats bar ───────────────────────────────────────────────────────
  {
    type: 'stats', variant: 'bar',
    label: 'Stats — Credibility bar',
    description: '3-4 anchor metrics in a colored band. Drops between sections to add trust without taking over a hero.',
    defaultData: {
      heading: '',
      items: [
        { value: '', label: '' },
        { value: '', label: '' },
        { value: '', label: '' },
      ],
    },
  },

  // ── FAQ ─────────────────────────────────────────────────────────────
  {
    type: 'faq', variant: 'accordion',
    label: 'FAQ — Accordion',
    description: 'Pre-empt the 5-8 most common buyer questions. Pure CSS accordion. Huge for SEO and qualifying leads.',
    defaultData: {
      heading: 'Frequently asked',
      intro: '',
      items: [{ question: '', answer: '' }],
    },
  },
]

export function findSectionDef(type: string, variant: string): SectionDef | undefined {
  return SECTION_DEFS.find(d => d.type === type && d.variant === variant)
}
