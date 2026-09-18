// CI guard: a veterinary client's portal is about their animals.
//
// For four builds the owner portal served a builder's product: its sections were projects, changeOrders,
// selections, myJobs, lienWaivers, submittals, rfis, sharedDocuments, projectFiles, equipment, agreements and
// serviceRequest — nothing about patients, vaccinations or appointments — and the summary told a veterinary
// practice's client how many ACTIVE PROJECTS and PENDING QUOTES they had. (Vet T12 H6)
//   bun scripts/check-portal-pets.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const portal = read('packages/tenant-backend/src/portal/portal.ts')
if (!/pets: !!t\.patient && !off\('pets'\)/.test(portal)) fail('the portal must mount a Pets section when the vertical has patients')
if (!/app\.get\('\/p\/:token\/pets', portalAuth/.test(portal)) fail('…with a list of the owner\'s animals')
if (!/app\.get\('\/p\/:token\/pets\/:petId', portalAuth/.test(portal)) fail('…and one animal\'s record')
if (!/eq\(t\.patient\.ownerId, contactId\)/.test(portal)) fail("the pets LIST must be filtered to the visitor's own animals")
if (!/eq\(t\.patient\.ownerId, contact\.id\)/.test(portal)) fail("…and so must one pet's record")
if (!/\.\.\.\(has\.projects \? \{ activeProjects: Number\(projectCount\.value\) \} : \{\}\)/.test(portal)) fail('a vertical without projects must not be told how many active projects it has')
if (!/pets = \{ pets: ids\.length, vaccinationsDue: Number\(due\?\.value \|\| 0\), nextAppointment:/.test(portal)) fail('the portal home must summarise the pets, what is overdue and when they are next seen')
if ((portal.match(/notInArray\(t\.appointment\.status, \['cancelled', 'no_show'\]\)/g) || []).length < 3) fail('a cancelled appointment must not count as what is next — in the summary, the list AND the record')
// the clinical chart stays inside the practice
const petDetail = portal.slice(portal.indexOf("app.get('/p/:token/pets/:petId'"), portal.indexOf('// ---- projects'))
for (const clinical of ['notes', 'alerts', 'allergies']) {
  if (new RegExp(`pet: \\{[^}]*\\b${clinical}:`).test(petDetail)) fail(`the pet payload must not carry the chart's ${clinical}`)
}

const types = read('packages/tenant-ui/src/portal/types.ts')
if (!/\| 'pets'/.test(types)) fail('the portal UI must know the pets section')
if (!/pets: 'My Pets'/.test(types) || !/pets: 'pets'/.test(types)) fail('…with a label and a path')
if (!/DEFAULT_CLIENT_NAV: PortalSection\[\] = \['pets',/.test(types)) fail('…and it must be in the client nav (the backend decides whether it appears)')
const dash = read('packages/tenant-ui/src/portal/PortalDashboard.tsx')
if (!/if \(s === 'pets'\) \{ value = summary\?\.pets \?\? 0; label = config\.labels\.pets \}/.test(dash)) fail('the portal home card must count the pets')
const page = read('packages/tenant-ui/src/portal/PortalPets.tsx')
if (!page) fail('packages/tenant-ui/src/portal/PortalPets.tsx is missing — the section has nowhere to render')
if (!/portalFetch\('\/pets'\)/.test(page) || !/portalFetch\(`\/pets\/\$\{petId\}`\)/.test(page)) fail('the pets pages must read the portal endpoints')
const barrel = read('packages/tenant-ui/src/portal/index.ts')
if (!/export \{ PortalPets, PortalPetDetail \} from '\.\/PortalPets'/.test(barrel)) fail('the pages must be exported from the portal barrel')

const vetWiring = read('templates/crm-vet/backend/src/routes/portal.ts')
if ((vetWiring.match(/patient, vaccination, appointment, visit,/g) || []).length < 2) fail('crm-vet must IMPORT its animals and pass them in tables')
const vetBarrel = read('templates/crm-vet/frontend/src/components/portal/index.ts')
if (!/PortalPets,/.test(vetBarrel) || !/PortalPetDetail,/.test(vetBarrel)) fail('crm-vet must export the pets pages')
const vetApp = read('templates/crm-vet/frontend/src/App.tsx')
if (!/<Route path="pets" element=\{<PortalPets \/>\} \/>/.test(vetApp) || !/<Route path="pets\/:petId" element=\{<PortalPetDetail \/>\} \/>/.test(vetApp)) fail('crm-vet must route the pets pages')

if (failed) { console.error(`\nportal pets: ${failed} check(s) FAILED`); process.exit(1) }
console.log('portal pets: a vet client sees their animals, what is due and what is booked — and no project counts')
