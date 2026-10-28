// Fill the stand-in site (serve-site.ts) with the owner's facts the screens need: bun seed-home.ts <base-url>
// Everything here is plainly sample text for the screens; nothing is a claim about a real business.
const base = process.argv[2] || 'http://localhost:4320'
const post = (p: string, body: unknown) => fetch(base + p, { method: 'POST', body: JSON.stringify(body) })
await post('/__page/home', { title: 'Home', sections: [
  { type: 'hero', variant: 'centered-stats', data: { eyebrow: 'Remodeling · Verona, WI', title: 'Built right in Verona', subtitle: 'Kitchens, baths and additions for homes around Madison.', primaryCta: { label: 'Get in touch', href: 'contact' } } },
  { type: 'services', variant: 'cards-grid', data: { heading: 'What we do', items: [
    { title: 'Kitchen remodels', description: 'Layouts, cabinets, counters and lighting, planned with you before any work starts.\n\nWe take a kitchen down to the studs when it needs it, and leave it alone when it does not.', image: '/__img/1.png',
      bullets: ['A design conversation at your house', 'Demolition and haul-away', 'Cabinets, counters and backsplash', 'Plumbing and electrical to code', 'A final walkthrough with you'],
      subServices: [{ title: 'Cabinet refacing', description: 'New doors and drawer fronts on cabinets that are still sound.' }, { title: 'Countertops' }, { title: 'Lighting and electrical' }] },
    { title: 'Bathroom remodels', description: 'Tile, fixtures and layout changes for the bathrooms you use every day.', image: '/__img/2.png', bullets: ['Tub and shower replacement', 'Tile and waterproofing'] },
    { title: 'Additions', description: 'A new room that looks like it was always part of the house.', image: '/__img/3.png' },
    { title: 'Decks and porches', description: '', href: 'contact' },
  ] } },
  { type: 'contact', variant: 'form-info', data: { heading: 'Get in touch', phone: '(608) 555-0142', email: 'hello@westridge.example', address: '12 Main St, Verona, WI 53593' } },
] })
await post('/__page/contact', { title: 'Contact', sections: [{ type: 'contact', variant: 'form-info', data: { heading: 'Get in touch', phone: '(608) 555-0142', email: 'hello@westridge.example', address: '12 Main St, Verona, WI 53593' } }] })
console.log('seeded')
