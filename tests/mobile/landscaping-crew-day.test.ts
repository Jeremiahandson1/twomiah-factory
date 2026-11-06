// Landscaping parity rows 11–15, the phone's half (the server's is apps/unified tests/landscaping-parity-phone.test.ts).
//   · row 11: directions open in the crew's chosen maps app — Google Maps, Apple Maps (iPhone only) or Waze — by each app's
//     universal address, and the choice is remembered on the phone;
//   · row 12: "Couldn't do it" sends a reason from the list and the rebook answer, kept with no signal under the visit's key;
//   · row 13: a material line from the price book or typed, with its own entry key (a repeat is one line); the visit links to its
//     checklists (Finish is refused until the required ones are done — the server's rule);
//   · rows 11 and 14: Today's route opens the map of the day and Finish Day; the recap reads in plain words;
//   · row 15: each person's clock start/stop carries the tap time; a waiting tap shows on the person at once.
// Fails without the change: none of these existed.
//
//   bun run tests/mobile/landscaping-crew-day.test.ts
import fs from 'node:fs'
import path from 'node:path'
import { appsFor, directionsUrl, readChoice, CHOICE_KEY } from '../../apps/mobile/src/trades/directions.ts'
import { SKIP_REASONS, REBOOK, NO_REBOOK, skipRequest, materialRequest, materialsKey, quantityOf, crewClockRequest, crewKey, clocksWithWaiting, recapLines, hoursWords } from '../../apps/mobile/src/trades/crewDay.ts'
import { LANDSCAPING } from '../../apps/mobile/src/trades/landscaping.ts'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600)) }
}
const app = path.resolve(import.meta.dir, '../../apps/mobile')
const route = LANDSCAPING.find((s) => s.id === 'landscaping-route')!
const visit = { id: 'v1', number: 'J-7', status: 'scheduled', address: '1 Elm St', contact: { name: 'Pat Client' } }

console.log('row 11: the maps app')
{
  check('an iPhone is offered Google Maps, Apple Maps and Waze', appsFor('ios').map((a) => a.id).join() === 'google,apple,waze')
  check('an Android phone is not offered Apple Maps', appsFor('android').map((a) => a.id).join() === 'google,waze')
  check('Google Maps: driving directions to the address', directionsUrl('google', '1 Elm St, Eau Claire') === 'https://www.google.com/maps/dir/?api=1&destination=1%20Elm%20St%2C%20Eau%20Claire&travelmode=driving')
  check('Apple Maps and Waze by their own addresses', directionsUrl('apple', 'A B').startsWith('https://maps.apple.com/?daddr=A%20B') && directionsUrl('waze', 'A B') === 'https://waze.com/ul?q=A%20B&navigate=yes')
  check('a remembered choice is read back; one this phone is not offered is not', readChoice('waze', 'android') === 'waze' && readChoice('apple', 'android') === null && readChoice(null, 'ios') === null && readChoice('nonsense', 'ios') === null)
  check('the choice is kept under its own key', CHOICE_KEY === 'twomiah_maps_app_v1')
  const dir = route.detail!.sections.flatMap((s) => s.links?.(visit) || []).find((l) => l.label.startsWith('Directions'))
  check('the visit’s Directions row goes to the chosen maps app', dir?.directions === '1 Elm St')
  const detail = fs.readFileSync(path.join(app, 'src/trades/TradeDetail.tsx'), 'utf8')
  check('…asks the first time, remembers, and can be changed', detail.includes('DirectionsSheet') && detail.includes('Change maps app'))
}

console.log('row 12: couldn’t do it')
{
  const a = route.detail!.actions!.find((x) => x.id === 'skip')!
  check('offered on an open or started visit, not a finished one', !!a.when?.({ status: 'scheduled' }) && !!a.when?.({ status: 'in_progress' }) && !a.when?.({ status: 'completed' }))
  check('behind its own switch', a.feature === 'visit_skip')
  const reason = a.inputs!.find((i) => i.id === 'reason')!
  check('a reason is picked from the list, required', reason.required === true && reason.choices!.length === SKIP_REASONS.length && reason.choices!.includes('Locked gate'))
  const req = a.request(visit, { reason: 'Locked gate', rebook: NO_REBOOK, note: ' Code changed ' })
  check('it sends the reason’s id, the rebook answer, the note and the tap time', req.path === '/api/crew-day/visits/v1/skip' && req.body.reason === 'locked_gate' && req.body.rebook === false && req.body.note === 'Code changed' && !!Date.parse(req.body.tappedAt), req)
  check('rebook is the default', skipRequest('v1', { reason: 'Rain or weather', rebook: REBOOK })!.body.rebook === true)
  check('no reason, no save', skipRequest('v1', {}) === null)
  check('kept with no signal under the visit’s key', a.offline?.(visit)?.key === 'job:v1')
}

console.log('row 13: materials and checklists')
{
  const typed = materialRequest('v1', { name: ' Mulch ', quantity: 2.5, unit: 'yards' }, 'mk1')
  check('a typed material: name, how much, unit, its own key', typed.path === '/api/crew-day/visits/v1/materials' && typed.body.name === 'Mulch' && typed.body.quantity === 2.5 && typed.body.unit === 'yards' && typed.body.entryKey === 'mk1')
  const fromBook = materialRequest('v1', { pricebookItemId: 'pb1', name: 'ignored', quantity: 1 }, 'mk2')
  check('from the price book: its id, not a name (the server takes the name and cost from the book)', fromBook.body.pricebookItemId === 'pb1' && !('name' in fromBook.body))
  check('how much is a positive number', quantityOf('2,5') === 2.5 && quantityOf('0') === null && quantityOf('abc') === null && quantityOf('-1') === null)
  check('the materials of a visit wait under their own key', materialsKey('v1') === 'materials:v1')
  const links = route.detail!.sections.filter((s) => s.feature === 'visit_materials' || s.feature === 'job_checklists').flatMap((s) => s.links?.(visit) || [])
  check('the visit links to its checklists and its materials', links.some((l) => l.route === '/(details)/job/checklist?id=v1') && links.some((l) => l.route === '/(details)/visit-materials?jobId=v1'))
}

console.log('rows 11 and 14: the day and Finish Day')
{
  const day = fs.readFileSync(path.join(app, 'src/trades/LandscapingDay.tsx'), 'utf8')
  check('Today’s route opens the map of the day where it is switched on', day.includes("hasFeature('crew_day_map')") && day.includes('/(details)/route-day'))
  const screen = fs.readFileSync(path.join(app, 'app/(details)/route-day.tsx'), 'utf8')
  check('the map is the server’s picture (the key never reaches the phone)', screen.includes('/api/crew-day/day/map') && !/[?&]key=/.test(screen))
  const lines = recapLines({ stops: 6, done: 4, couldNotDo: [{}], stillOpen: [{}], hours: 5.25, notesOutstanding: [{}, {}] })
  check('the recap in plain words', lines.join(' | ') === '4 of 6 stops done | 1 could not be done | 1 still to do | 5 h 15 min worked | 2 customer notes still to write', lines)
  check('…and a quiet day says only what happened', recapLines({ stops: 1, done: 1, couldNotDo: [], stillOpen: [], hours: 0.75, notesOutstanding: [] }).join(' | ') === '1 of 1 stop done | 45 min worked')
  check('hours in words', hoursWords(2) === '2 h' && hoursWords(0.5) === '30 min')
}

console.log('row 15: each person’s clock')
{
  const r = crewClockRequest('v1', 'm:abc', 'start', new Date('2026-11-06T13:00:00Z'))
  check('start carries the person and the tap time', r.path === '/api/crew-day/visits/v1/crew/m%3Aabc/start' && r.body.tappedAt === '2026-11-06T13:00:00.000Z')
  const people = [{ key: 'u:1', running: false }, { key: 'm:abc', running: true }]
  const queue = [{ method: 'POST', recordKey: crewKey('v1'), path: crewClockRequest('v1', 'u:1', 'start').path }, { method: 'POST', recordKey: crewKey('v1'), path: crewClockRequest('v1', 'm:abc', 'stop').path }]
  const shown = clocksWithWaiting(people, queue, 'v1')
  check('a waiting start shows the person on the clock, marked waiting', shown[0].running === true && shown[0].waiting === true)
  check('a waiting stop shows them off it', shown[1].running === false && shown[1].waiting === true)
  check('nothing waiting: as the server says', clocksWithWaiting(people, [], 'v1').every((p, i) => p.running === people[i].running && !p.waiting))
  const crewLink = route.detail!.sections.find((s) => s.feature === 'crew_timers')!.links!(visit)[0]
  check('the visit opens its crew clocks', crewLink.route === '/(details)/visit-crew?jobId=v1')
}

console.log('the screens are registered')
{
  const layout = fs.readFileSync(path.join(app, 'app/(details)/_layout.tsx'), 'utf8')
  for (const name of ['route-day', 'visit-materials', 'visit-crew']) check(`${name} is registered and exists`, layout.includes(`'${name}'`) && fs.existsSync(path.join(app, `app/(details)/${name}.tsx`)))
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
