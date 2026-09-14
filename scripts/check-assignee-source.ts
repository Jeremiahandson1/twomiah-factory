// CI guard: the jobs "Assigned To" picker must resolve LOGIN USERS, not the crew roster.
// job.assignedToId references user.id, but GET /api/team returns team_member rows and stops falling back
// to users the moment one roster member exists — which erased every assignable user from the picker.
// The picker must read GET /api/team/assignable (always login users); the shared team module must serve it.
//   bun scripts/check-assignee-source.ts
import { readFileSync } from 'node:fs'
const read = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const jobs = strip(read('packages/tenant-ui/src/jobs/JobsPage.tsx'))
if (!jobs.includes('/api/team/assignable')) fail('JobsPage: assignee picker must fetch /api/team/assignable (login users)')
if (/api\.get\(\s*['"`]\/api\/team['"`]\s*\)/.test(jobs)) fail("JobsPage: assignee picker still calls GET /api/team (the roster) — use /api/team/assignable")

const team = strip(read('packages/tenant-backend/src/team/team.ts'))
if (!/app\.get\(\s*['"`]\/assignable['"`]/.test(team)) fail('team.ts: must define GET /assignable returning login users')
if (!/\/assignable[\s\S]{0,400}t\.user/.test(team)) fail('team.ts: /assignable must select from the user table, not team_member')

if (failed) { console.error(`\nassignee source: ${failed} check(s) FAILED`); process.exit(1) }
console.log('assignee source: the jobs picker resolves login users via /api/team/assignable')
