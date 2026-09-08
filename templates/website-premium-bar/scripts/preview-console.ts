/**
 * preview-console.ts — render the console with sample data and no database,
 * so the layout can be eyeballed and screenshotted. Writes _render/console.html
 * and _render/console-login.html with CSS/JS inlined.
 *
 *   bun scripts/preview-console.ts
 */
import fs from 'fs'
import path from 'path'
import ejs from 'ejs'
import { liveStateFromHours } from '../lib/live'
import { isHoursConfig, EMPTY_HOURS, type HoursConfig } from '../lib/hours'

const ROOT = path.resolve(import.meta.dir, '..')
const views = path.join(ROOT, 'views', 'console')
const out = path.join(ROOT, '_render')
fs.mkdirSync(out, { recursive: true })
const read = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'))
const settings: any = read(path.join(ROOT, 'content', 'settings.json'))
const hoursRaw = read(path.join(ROOT, 'content', 'hours.json'))
const hours: HoursConfig = isHoursConfig(hoursRaw) ? hoursRaw : EMPTY_HOURS
const extras: any = read(path.join(ROOT, 'content', 'live.json')); delete extras._note
const now = process.env.NOW ? new Date(process.env.NOW) : new Date()
const live = liveStateFromHours(hours, now, extras)
const menu: any = read(path.join(ROOT, 'content', 'menu.json'))
const sections = menu.sections.map((s: any, i: number) => ({ id: 'sec-' + i, slug: s.slug, name: s.name, sortOrder: i }))
const items = menu.sections.flatMap((s: any, i: number) => s.items.map((it: any, j: number) => ({ id: 'item-' + i + '-' + j, sectionId: 'sec-' + i, name: it.name, is86ed: j === 1 && i === 0, isActive: true, sortOrder: j })))
const taps = [
  { lineNumber: 1, beerName: 'Draft Root Beer', status: 'pouring', isActive: true },
  { lineNumber: 2, beerName: 'Spaten Optimator', status: 'last_keg', isActive: true },
  { lineNumber: 3, beerName: 'Spotted Cow', status: 'just_tapped', isActive: true },
]
const inquiries = [
  { id: 'q1', name: 'Dana K.', phone: '(715) 555-0142', partySize: 14, requestedDate: '2026-10-03', occasion: 'Packer party', message: 'Noon game, we can bring a cake.', status: 'new', createdAt: now },
]
const games = [{ league: 'NFL', home: 'Bears', away: 'Packers', startsAt: new Date(now.getTime() + 3600000), isFeatured: true, note: 'doors at 6' }]
const events: any[] = []
const inline = (html: string) => html
  .replace('<link rel="stylesheet" href="/styles/console.css">', '<style>\n' + fs.readFileSync(path.join(ROOT, 'build', 'styles', 'console.css'), 'utf8') + '\n</style>')
  .replace('<script src="/scripts/console.js" defer></script>', '<script>\n' + fs.readFileSync(path.join(ROOT, 'build', 'scripts', 'console.js'), 'utf8') + '\n</script>')

const home = await ejs.renderFile(path.join(views, 'home.ejs'), {
  staff: { id: 'p1', label: 'Bar phone', sessionId: 's1' }, settings, live, status: { roomStatus: live.room.status, note: live.note, overrideUntil: null },
  sections, items, taps, inquiries, games, events, timezone: live.timezone, hoursToday: { bar: live.bar, kitchen: live.kitchen },
}) as string
fs.writeFileSync(path.join(out, 'console.html'), inline(home))
const login = await ejs.renderFile(path.join(views, 'login.ejs'), { companyName: settings.companyName, error: '', next: '/console/', noPins: false }) as string
fs.writeFileSync(path.join(out, 'console-login.html'), inline(login))
console.log('OK → _render/console.html, _render/console-login.html')
