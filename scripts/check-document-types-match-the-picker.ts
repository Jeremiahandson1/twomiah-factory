// The document types the API accepts must be exactly the ones the page offers.
//
// The list lived only on the frontend (docsConfig.ts), where it builds the type picker and the type
// filter. The API had never been told, so it kept whatever string it was handed: POST a document with
// `type: "banana"` and a banana was stored, and it then showed up in the filter as a real category
// beside Contract and Permit. Nothing in the UI could produce it, which is exactly why nobody noticed
// — the picker is not a validator, it is a convenience. (roof T18 D4)
//
// The backend now takes the list through `options.types`. That makes it the one piece of config with
// two homes, so this holds them identical: same members, both directions. A type added to the picker
// and not to the route would be rejected the moment someone chose it; a type added to the route and
// not the picker would be silently unreachable.
//
// Two templates are exempt because they file no documents at all — no docsConfig, no mounted route.
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', 'templates')

const listFrom = (src: string, key: RegExp): string[] | null => {
  const m = src.match(key)
  if (!m) return null
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}

let failures = 0
const fail = (m: string) => { failures++; console.error(`FAIL: ${m}`) }
let checked = 0

// A mounted route with no picker is a real finding, but a DIFFERENT one — an API the product cannot
// reach, which is the shape roof's documents module had before T18 wired it up. It is reported rather
// than failed, because this guard's rule is that the two type lists AGREE, and a template with no
// picker has no list to disagree with.
//
//   crm-dispensary — route mounted, no DocumentsPage and no App.tsx route: reachable only by hand.
//   crm-homecare   — has document components but no docsConfig; parked for the CVHC re-base.
const notes: string[] = []

for (const t of readdirSync(ROOT)) {
  if (!t.startsWith('crm') || t === 'crm-automotive') continue
  const cfgPath = join(ROOT, t, 'frontend', 'src', 'docsConfig.ts')
  const routePath = join(ROOT, t, 'backend', 'src', 'routes', 'documents.ts')
  const hasCfg = existsSync(cfgPath)
  const hasRoute = existsSync(routePath)

  // a template with neither files no documents; that is a shape, not a fault
  if (!hasCfg && !hasRoute) continue
  if (hasCfg && !hasRoute) {
    // this direction IS a fault: a picker with nothing behind it
    fail(`${t}: has a docsConfig but no mounted route — the page offers a picker for an API that is not there`)
    continue
  }
  if (!hasCfg) {
    notes.push(`${t}: mounts the documents route but has no docsConfig — the API is there with no picker in front of it`)
    continue
  }

  const picker = listFrom(readFileSync(cfgPath, 'utf8'), /types:\s*\[([^\]]*)\]/s)
  const api = listFrom(readFileSync(routePath, 'utf8'), /types:\s*\[([^\]]*)\]/s)

  if (!picker?.length) { fail(`${t}: docsConfig.ts declares no types`); continue }
  if (!api?.length) {
    fail(`${t}: routes/documents.ts passes no options.types — the API will store any string it is sent, including one no picker can produce`)
    continue
  }

  checked++
  const missingFromApi = picker.filter((x) => !api.includes(x))
  const missingFromPicker = api.filter((x) => !picker.includes(x))
  if (missingFromApi.length) {
    fail(`${t}: the picker offers ${missingFromApi.join(', ')} but the API would refuse it — choosing it is a 400`)
  }
  if (missingFromPicker.length) {
    fail(`${t}: the API accepts ${missingFromPicker.join(', ')} but no picker offers it — unreachable from the product`)
  }
}

for (const n of notes) console.log(`  note: ${n}`)
console.log(failures === 0
  ? `check-document-types-match-the-picker: ok (${checked} templates file documents, ${notes.length} noted)`
  : `check-document-types-match-the-picker: ${failures} failure(s)`)
process.exit(failures ? 1 : 0)
