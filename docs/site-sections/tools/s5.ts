// Three published posts and the section that shows them (everything here is plainly sample text).
const base = process.argv[2] || 'http://localhost:4320'
const sql = (q: string, params: unknown[] = []) => fetch(base + '/__sql', { method: 'POST', body: JSON.stringify({ sql: q, params }) }).then((r) => r.json())
const [co] = await sql('select id from company limit 1')
await sql('delete from post')
const posts: Array<[string, string, string, string, string]> = [
  ['spring-checklist', 'A spring checklist for the outside of your house', 'Gutters, caulk, the deck boards, the hose bibs: what to look at on the first warm Saturday.', '/__img/4.png', '2026-09-18'],
  ['reading-a-quote', 'How to read a contractor’s quote', 'What a good quote spells out, and the questions to ask when a line says only “allowance”.', '/__img/5.png', '2026-08-30'],
  ['why-we-demo-first', 'Why we take the old cabinets out before we draw anything', 'A short note on what we find behind a wall, and why it changes the plan.', '', '2026-07-12'],
]
for (const [slug, title, excerpt, cover, date] of posts) await sql(`insert into post (id, company_id, slug, title, excerpt, cover_image_url, status, published_at, body) values (md5(random()::text), $1, $2, $3, $4, $5, 'published', $6, 'Sample body.')`, [co.id, slug, title, excerpt, cover || null, date + 'T12:00:00Z'])
await fetch(base + '/__page/home', { method: 'POST', body: JSON.stringify({ title: 'Home', sections: [
  { type: 'hero', variant: 'centered-stats', data: { title: 'Built right in Verona', subtitle: 'Kitchens, baths and additions.' } },
  { type: 'blog_preview', variant: 'latest', data: { heading: 'From the blog', intro: 'Notes from the job site.', count: 3 } },
] }) })
console.log('seeded posts')
