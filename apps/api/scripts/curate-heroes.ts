/**
 * Hero-library curation harness.
 *
 *   bun run scripts/curate-heroes.ts search <group> "<query>" [count]
 *   bun run scripts/curate-heroes.ts keep   <group> <id> <id> ...
 *
 * `search` pulls candidates from the Pexels API and writes small review
 * thumbnails to scratchpad/hero-review/<group>/ plus a candidates.json holding
 * every photo's attribution. Nothing is committed at this stage.
 *
 * A HUMAN (or the assistant, by actually looking at the thumbnails) then picks
 * the keepers. That review step is the entire point of this library: the
 * alternative — trusting a search query — is what puts theatre audiences on a
 * home-care site and stock-photo dentists on a roofing page.
 *
 * `keep` downloads the chosen photos at full size into
 * assets/hero-library/<group>/ and rewrites the HERO_LIBRARY block in
 * config/heroLibrary.ts with their attribution, which the Pexels API
 * Guidelines require us to display wherever the photo appears.
 */
import fs from 'fs'
import path from 'path'

const API_KEY = process.env.PEXELS_API_KEY
if (!API_KEY) {
  console.error('PEXELS_API_KEY is not set (apps/api/.env)')
  process.exit(1)
}

const apiDir = path.resolve(import.meta.dir, '..')
const ASSETS = path.join(apiDir, 'assets', 'hero-library')
const MANIFEST = path.join(apiDir, 'src', 'config', 'heroLibrary.ts')
const REVIEW = path.resolve(apiDir, '..', '..', 'scratchpad', 'hero-review')

interface Candidate {
  id: number
  tag: string
  photographer: string
  photographer_url: string
  url: string
  alt: string
  download: string // full-size URL we commit
  review: string   // small URL we look at
}

async function search(group: string, query: string, count: number, tag: string) {
  const res = await fetch(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape&size=large`,
    { headers: { Authorization: API_KEY! } },
  )
  if (!res.ok) throw new Error('Pexels search failed: ' + res.status + ' ' + (await res.text()).slice(0, 200))
  const body = await res.json() as any

  const dir = path.join(REVIEW, group)
  fs.mkdirSync(dir, { recursive: true })

  const existing: Candidate[] = fs.existsSync(path.join(dir, 'candidates.json'))
    ? JSON.parse(fs.readFileSync(path.join(dir, 'candidates.json'), 'utf8'))
    : []

  const candidates: Candidate[] = [...existing]
  for (const p of body.photos || []) {
    if (candidates.some(c => c.id === p.id)) continue
    const c: Candidate = {
      id: p.id,
      tag,
      photographer: String(p.photographer || '').replace(/\s+/g, ' ').trim(),
      photographer_url: p.photographer_url,
      url: p.url,
      alt: p.alt || '',
      download: p.src.large2x || p.src.large,
      review: p.src.medium,
    }
    // Review copy is deliberately small: we are judging composition and
    // subject, and a 4MB file per candidate helps nobody.
    const img = await fetch(c.review)
    fs.writeFileSync(path.join(dir, `${p.id}.jpg`), Buffer.from(await img.arrayBuffer()))
    candidates.push(c)
    console.log(`  candidate ${p.id} — ${c.alt.slice(0, 70)} (${c.photographer})`)
  }

  fs.writeFileSync(path.join(dir, 'candidates.json'), JSON.stringify(candidates, null, 2))
  console.log(`\n${candidates.length} candidate(s) in ${dir} — review the .jpg files, then run \`keep\`.`)
}

async function keep(group: string, ids: string[]) {
  const dir = path.join(REVIEW, group)
  const candidates: Candidate[] = JSON.parse(fs.readFileSync(path.join(dir, 'candidates.json'), 'utf8'))

  const outDir = path.join(ASSETS, group)
  fs.mkdirSync(outDir, { recursive: true })

  const entries: Array<Record<string, string>> = []
  let n = 0
  for (const spec of ids) {
    // "<id>" keeps the search tag; "<id>:<tag>" overrides it, because one
    // search returns shots that belong in different slots — a tight shingle
    // close-up is a hero, a safety harness is not.
    const [id, tagOverride] = String(spec).split(':')
    const c = candidates.find(x => String(x.id) === String(id))
    if (!c) throw new Error('No candidate with id ' + id + ' in ' + group)
    if (tagOverride) c.tag = tagOverride
    n++
    const file = `${group}-${String(n).padStart(2, '0')}.jpg`
    const img = await fetch(c.download)
    if (!img.ok) throw new Error('Download failed for ' + id)
    const bytes = Buffer.from(await img.arrayBuffer())
    fs.writeFileSync(path.join(outDir, file), bytes)
    entries.push({
      file,
      tag: c.tag,
      source: 'pexels',
      photographer: c.photographer,
      photographerUrl: c.photographer_url,
      sourceUrl: c.url,
      sourceId: String(c.id),
      license: 'Pexels License',
    })
    console.log(`  kept ${id} -> ${file} (${Math.round(bytes.length / 1024)}KB, ${c.photographer})`)
  }

  // Rewrite just this group's array in the manifest, leaving the rest alone.
  let src = fs.readFileSync(MANIFEST, 'utf8')
  const lines = entries.map(e =>
    '    { file: ' + JSON.stringify(e.file) +
    ', tag: ' + JSON.stringify(e.tag) +
    ", source: 'pexels'" +
    ', photographer: ' + JSON.stringify(e.photographer) +
    ', photographerUrl: ' + JSON.stringify(e.photographerUrl) +
    ', sourceUrl: ' + JSON.stringify(e.sourceUrl) +
    ', sourceId: ' + JSON.stringify(e.sourceId) +
    ", license: 'Pexels License' },",
  ).join('\n')

  const empty = new RegExp('(\\n  ' + group + ': )\\[\\],')
  const filled = new RegExp('(\\n  ' + group + ': )\\[[\\s\\S]*?\\n  \\],')
  if (empty.test(src)) {
    src = src.replace(empty, `$1[\n${lines}\n  ],`)
  } else if (filled.test(src)) {
    src = src.replace(filled, `$1[\n${lines}\n  ],`)
  } else {
    throw new Error('Could not find the "' + group + '" group in heroLibrary.ts')
  }
  fs.writeFileSync(MANIFEST, src)
  console.log(`\nheroLibrary.ts updated: ${group} now has ${entries.length} image(s), each with attribution.`)
}

const [, , cmd, group, ...rest] = process.argv
if (cmd === 'search') {
  const query = rest[0]
  const count = parseInt(rest[1] || '8')
  const tag = rest[2] || 'hero'
  if (!group || !query) { console.error('usage: curate-heroes.ts search <group> "<query>" [count] [tag]'); process.exit(1) }
  await search(group, query, count, tag)
} else if (cmd === 'keep') {
  if (!group || rest.length === 0) { console.error('usage: curate-heroes.ts keep <group> <id>[:tag] <id>[:tag] ...'); process.exit(1) }
  await keep(group, rest)
} else {
  console.error('usage: curate-heroes.ts search|keep ...')
  process.exit(1)
}
