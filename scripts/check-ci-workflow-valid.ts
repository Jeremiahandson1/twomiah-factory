// CI guard: the workflow files GitHub actually has to accept.
//
// Every other guard in here checks the product. This one checks the thing that RUNS the guards, because
// that turned out to be the one file nothing was watching.
//
// What happened: ci-add.ts was called with a guard NUMBER as the job id, so build-check.yml grew jobs
// keyed `284:` … `299:`. A job id must be an identifier — GitHub rejects a numeric one, and it rejects
// the WHOLE FILE, not the offending job. So all 150 guard jobs plus the salon suite silently stopped
// running: six-plus commits of green-looking history where nothing ran at all. ci-add.ts did validate
// the result, but it only asked whether the YAML parses, and `284:` parses perfectly well as an integer
// key. A valid file and an acceptable file are different questions.
//
// The failure is invisible from inside CI (a rejected workflow starts no job that could report it), so
// this has to hold locally, where all-guards.sh runs.
//   bun scripts/check-ci-workflow-valid.ts
import { readdirSync, readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error('FAIL: ' + m) }

const DIR = ROOT + '.github/workflows/'
let files: string[] = []
try { files = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)) } catch { fail('.github/workflows is missing'); }
if (!files.length && !failed) fail('.github/workflows has no workflow files')

// GitHub: "must start with a letter or _ and contain only alphanumeric characters, - or _"
const JOB_ID = /^[A-Za-z_][A-Za-z0-9_-]*$/

for (const file of files.sort()) {
  const raw = readFileSync(DIR + file, 'utf8')
  const text = raw.replace(/\r\n/g, '\n')

  let doc: any
  try { doc = Bun.YAML.parse(text) } catch (e) {
    fail(`${file} is not valid YAML — GitHub will reject the entire file: ${(e as Error).message.slice(0, 120)}`)
    continue
  }
  if (!doc || typeof doc !== 'object') { fail(`${file} does not parse to a mapping`); continue }
  if (!doc.jobs || typeof doc.jobs !== 'object') { fail(`${file} has no jobs: block`); continue }

  const ids = Object.keys(doc.jobs)
  if (!ids.length) fail(`${file} declares no jobs`)

  for (const id of ids) {
    if (!JOB_ID.test(id)) {
      fail(`${file}: job id ${JSON.stringify(id)} is not a legal identifier — GitHub rejects the whole file, so every other job in it stops running too`)
    }
    const job = doc.jobs[id]
    if (!job || typeof job !== 'object') { fail(`${file}: job ${id} is empty`); continue }
    // a job either runs steps somewhere, or calls a reusable workflow
    if (!job.uses) {
      if (!job['runs-on']) fail(`${file}: job ${id} has no runs-on`)
      if (!Array.isArray(job.steps) || !job.steps.length) fail(`${file}: job ${id} has no steps`)
    }
    for (const dep of ([] as string[]).concat(job.needs || [])) {
      if (!ids.includes(dep)) fail(`${file}: job ${id} needs "${dep}", which is not a job in this file`)
    }
  }

  // Duplicate job keys parse without complaint — the last one silently wins and the earlier job just
  // never runs. The parsed object cannot show that, so count the raw keys.
  const declared = text.split('\n').filter((l) => /^  [^\s#][^:]*:\s*$/.test(l)).map((l) => l.trim().slice(0, -1))
  const inJobs = declared.filter((d) => ids.includes(d))
  const dupes = inJobs.filter((d, i) => inJobs.indexOf(d) !== i)
  if (dupes.length) fail(`${file}: duplicate job id(s) ${[...new Set(dupes)].join(', ')} — the later one silently replaces the earlier, which then never runs`)
}

if (failed) { console.error(`\nci workflow valid: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`ci workflow valid: ${files.length} workflow file(s), every job id an identifier GitHub will accept`)
