// What each section type of the Web presence page holds, field by field — ONE description read by the cleaner (clean.mjs, on the
// server, every save) and by the editor (editor.html draws its form from it). Dependency-free: it ships inside the site's function.
//
// A shape is one of:
//   't:80'    one line of text, at most 80 characters        'tl:900'  several lines, at most 900
//   'link'    https:// , tel: , mailto: , #anchor or /path   'img'     a photo: an uploaded /img/<hash>, a /hero-library path, or https://
//   'date'    YYYY-MM-DD                                     'bool'
//   ['a','b'] one of these                                   [shape, max]  a list of at most `max`
//   { key: shape, … }  an object (keys not named are dropped)
// Labels are for the editor; they live beside the shapes so the two cannot drift.
const CTA = { label: 't:40', href: 'link' }
const STATS = [{ label: 't:40', value: 't:20' }, 4]

export const SHAPES = {
  hero: { eyebrow: 't:80', title: 't:140', subtitle: 'tl:300', image: 'img', imageAlt: 't:160', primaryCta: CTA, secondaryCta: CTA, stats: STATS },
  about: { eyebrow: 't:80', title: 't:140', paragraphs: ['tl:900', 6], portrait: 'img', signature: 't:80', stats: STATS },
  services: { heading: 't:80', intro: 'tl:300', items: [{ title: 't:80', description: 'tl:300', image: 'img', href: 'link' }, 12] },
  gallery: { heading: 't:80', intro: 'tl:300', photos: [{ url: 'img', alt: 't:160', caption: 't:160', category: 't:40' }, 24] },
  testimonials: { heading: 't:80', intro: 'tl:300', items: [{ quote: 'tl:500', author: 't:80', role: 't:80', photo: 'img' }, 12] },
  hours: { heading: 't:80', intro: 'tl:300', note: 'tl:300' },
  map: { heading: 't:80', intro: 'tl:300' },
  contact: { heading: 't:80', intro: 'tl:300', responsePromise: 't:160', hours: ['t:60', 8] },
  social: { heading: 't:80', intro: 'tl:300', links: [{ label: 't:30', url: 'link' }, 8] },
  banner: { text: 't:160', href: 'link', label: 't:30' },
  hiring: { heading: 't:80', intro: 'tl:400', jobs: [{ title: 't:80', blurb: 'tl:300', type: ['full', 'part'] }, 12] },
  spot: {
    heading: 't:80', intro: 'tl:300', place: 't:120', address: 't:160', hours: 't:80', note: 'tl:200',
    places: [{ name: 't:80', address: 't:160', note: 'tl:200' }, 12],
  },
  events: { heading: 't:80', intro: 'tl:300', items: [{ title: 't:100', date: 'date', time: 't:40', where: 't:120', description: 'tl:300', href: 'link' }, 40] },
  menu: { heading: 't:80', intro: 'tl:300', items: [{ name: 't:80', description: 'tl:300', price: 't:20', image: 'img' }, 60] },
  cta: { heading: 't:100', subtitle: 'tl:300', primaryCta: CTA },
  deals: { heading: 't:80', intro: 'tl:300', expiresLabel: 't:40', items: [{ title: 't:80', description: 'tl:300', badge: 't:30', validThrough: 'date' }, 12] },
  pricing: { heading: 't:80', intro: 'tl:300', disclaimer: 'tl:300', items: [{ service: 't:80', priceLabel: 't:30', note: 't:160', includes: ['t:80', 6] }, 30] },
  team: { heading: 't:80', intro: 'tl:300', members: [{ name: 't:80', role: 't:80', bio: 'tl:300', portrait: 'img' }, 12] },
  before_after: { heading: 't:80', intro: 'tl:300', items: [{ beforeImage: 'img', afterImage: 'img', caption: 't:160', location: 't:80', material: 't:60', year: 't:4' }, 12] },
  service_area: { heading: 't:80', intro: 'tl:300', serviceZips: ['t:10', 200], yesLabel: 't:40', yesHref: 'link', noLabel: 't:40', noEmail: 't:120' },
  partners: { heading: 't:80', items: [{ name: 't:80', image: 'img', href: 'link' }, 24] },
  products: { heading: 't:80', intro: 'tl:300', items: [{ name: 't:80', description: 'tl:300', price: 't:20', image: 'img', href: 'link', label: 't:30' }, 24] },
  steps: { heading: 't:80', intro: 'tl:300', steps: [{ title: 't:80', text: 'tl:300' }, 6] },
}

/** Words for the editor's fields (key → label). Unlisted keys are shown as their name, spaced. */
export const LABELS = {
  eyebrow: 'Small line above', title: 'Headline', subtitle: 'Words under it', image: 'Photo', imageAlt: 'Describe the photo', primaryCta: 'Main button', secondaryCta: 'Second button',
  label: 'Button words', href: 'Link', stats: 'Numbers', value: 'Number', paragraphs: 'Paragraphs', portrait: 'Portrait', signature: 'Signed', heading: 'Heading', intro: 'Introduction',
  items: 'Items', description: 'Description', photos: 'Photos', url: 'Photo', alt: 'Describe the photo', caption: 'Caption', category: 'Group', quote: 'What they said', author: 'Name', role: 'Role',
  photo: 'Photo', note: 'Note', responsePromise: 'When you will reply', hours: 'Hours', links: 'Links', text: 'Words', jobs: 'Open jobs', blurb: 'A few lines', type: 'Full or part time',
  place: 'Where', address: 'Address', places: 'Places', date: 'Date', time: 'Time', where: 'Where', name: 'Name', price: 'Price', expiresLabel: 'Ends', badge: 'Badge', validThrough: 'Last day',
  disclaimer: 'Fine print', service: 'Service', priceLabel: 'Price', includes: 'Includes', members: 'People', bio: 'About them', beforeImage: 'Before', afterImage: 'After', location: 'Where',
  material: 'Material', year: 'Year', serviceZips: 'ZIP codes we cover', yesLabel: 'Button when we cover them', yesHref: 'Where it goes', noLabel: 'Words when we do not', noEmail: 'Email for those',
  steps: 'Steps', subtitle2: 'Words',
}

/** Section-level caps shared by the cleaner and the tests. */
export const LIMITS = { sections: 30, modelBytes: 200_000, imageBytes: 600_000, resumeMb: 3 }
