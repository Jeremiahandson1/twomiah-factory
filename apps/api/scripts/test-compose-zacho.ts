import { generateWebsiteContent } from '../src/services/contentGenerator.ts'

const ai = await generateWebsiteContent({
  businessName: 'Zacho Sports Center', businessType: 'rv',
  location: { city: 'Eau Claire', state: 'WI', stateFull: 'Wisconsin' },
  services: ['New & Used Boats', 'Motorcycles', 'ATVs & Side-by-Sides', 'Service & Repair', 'Parts & Accessories', 'Financing'],
  description: "Eau Claire's family-owned powersports and marine dealer — Bennington and Crestliner pontoons and fishing boats, Indian, Honda and Yamaha motorcycles, ATVs and side-by-sides. Full-service sales, certified on-site service, and financing for every credit situation.",
  colorPalette: { primary: '#E67A22', secondary: '#1A1A1A' },
  serviceRegion: 'Eau Claire & Chippewa Falls', nearbyCities: ['Chippewa Falls', 'Altoona', 'Menomonie'],
  phone: '+1-715-723-0264', email: 'twomiah14@gmail.com',
})

console.log('\n===== HERO =====')
console.log('tagline :', ai.homepage?.hero?.tagline)
console.log('title   :', ai.homepage?.hero?.title)
console.log('subtitle:', ai.homepage?.hero?.subtitle)
console.log('image   :', ai.homepage?.hero?.image)
console.log('\n===== SERVICES =====')
for (const s of (ai.services || [])) console.log('  •', s.name, '—', (s.description || '').slice(0, 70))
console.log('\n===== BLOG POSTS =====')
for (const p of (ai.posts || [])) console.log('  •', p.title)
console.log('\n===== META =====')
console.log('title:', ai.settings?.defaultMetaTitle)
console.log('desc :', ai.settings?.defaultMetaDescription)
// sanity: contractor leakage check
const blob = JSON.stringify(ai).toLowerCase()
const bad = ['roof', 'contractor', 'hvac', 'plumbing', 'lien', 'remodel'].filter(w => blob.includes(w))
const good = ['boat', 'powersport', 'motorcycle', 'atv', 'marine', 'pontoon'].filter(w => blob.includes(w))
console.log('\nRV terms present:', good.join(', ') || 'NONE ⚠️')
console.log('Contractor leakage:', bad.join(', ') || 'none ✓')
