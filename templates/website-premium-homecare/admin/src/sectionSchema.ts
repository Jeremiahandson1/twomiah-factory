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
