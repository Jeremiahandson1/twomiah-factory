// The trade kit's screens (salon, restaurant, bar, store, vet — apps/mobile/src/trades) held to the owner's standing rules, from the
// specs themselves: nothing here needs a device.
//   · every tile that opens a kit screen opens a spec whose list IS the tile's list (a tile opens exactly what it counts);
//   · no action touches a card, refund, register, kiosk, gift card or payment key; every action that texts, ships, buys or records money
//     asks first (a confirm); every action names the permission the server checks;
//   · every bar is five slots at most with More last, and every tab is a file; every spec has an empty state in plain words;
//   · product copy: they/them (no he/she/his/her); no developer words on a screen.
//
//   bun run tests/mobile/trade-screens.test.ts
import fs from 'node:fs'
import path from 'node:path'
import { SPECS, specFor } from '../../apps/mobile/src/trades/specs.ts'
import { FORBIDDEN } from '../../apps/mobile/src/trades/kit.ts'
import { VERTICAL_TABS, PHONE_VERTICALS, VET_PHONE_ON } from '../../apps/mobile/src/vertical/verticals.ts'
import { tilesFor, reqUrl } from '../../apps/mobile/src/home/tiles.ts'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600)) }
}
const TRADES = ['salon', 'restaurant', 'bar', 'store', 'vet'] as const
const app = path.resolve(import.meta.dir, '../../apps/mobile')
const sampleRow: any = new Proxy({ id: 'x1', contactId: 'c1', status: 'x', contact: { id: 'c1', name: 'Sam Rivera' } }, { get: (t: any, k) => (k in t ? t[k] : 'x') })

check('there are specs', SPECS.length >= 5)
check('spec ids are unique', new Set(SPECS.map((s) => s.id)).size === SPECS.length)
check('vet is OFF in the phone app (and built)', VET_PHONE_ON === false && !PHONE_VERTICALS.includes('vet') && tilesFor('vet').length > 0)
check('salon, restaurant, bar and store are ON', ['salon', 'restaurant', 'bar', 'store'].every((v) => PHONE_VERTICALS.includes(v as any)))

for (const s of SPECS) {
  check(`${s.id}: names the permission its seat needs`, s.any.length > 0)
  check(`${s.id}: lists from the API and has plain-words empty state`, s.list.path.startsWith('/api/') && s.empty.title.length > 3 && s.empty.body.length > 3)
  const reqs: string[] = [reqUrl(s.list)]
  const actions = [...(s.actions || []), ...(s.detail?.actions || [])]
  for (const a of actions) {
    let r: any = null
    try { r = a.request(sampleRow, Object.fromEntries((a.inputs || []).map((i) => [i.id, 'x']))) } catch { /* a request that needs a real row */ }
    const url = r?.path || ''
    reqs.push(url)
    check(`${s.id}/${a.id}: names the permission the server checks`, a.any.length > 0)
    check(`${s.id}/${a.id}: is not a card, refund, register, kiosk, gift card or payment-key call`, !FORBIDDEN.test(url) && !FORBIDDEN.test(a.label) && !FORBIDDEN.test(a.id), { url, label: a.label })
    check(`${s.id}/${a.id}: a write that texts, ships, buys, charges or records money asks first`, !/(text|send|ship|label|buy|deposit|pay|stock|count|close)/i.test(a.id + ' ' + url) || !!a.confirm || !!a.inputs?.length, a.id)
  }
  check(`${s.id}: no card/register/kiosk path anywhere`, reqs.every((u) => !FORBIDDEN.test(u)), reqs)
  // copy: they/them, no developer words
  const copy = JSON.stringify([s.title, s.empty, ...actions.map((a) => [a.label, a.confirm?.title, a.confirm?.button, a.done, a.inputs?.map((i) => i.label)])])
  check(`${s.id}: copy is they/them and plain`, !/\b(he|she|his|her|hers|him)\b/i.test(copy) && !/\b(endpoint|api|json|payload|tile)\b/i.test(copy), copy)
}

for (const trade of TRADES) {
  for (const t of tilesFor(trade)) {
    if (t.screen === 'trade') {
      const s = specFor(t.spec || '')
      check(`${trade}/${t.id}: opens a kit screen that exists`, !!s)
      check(`${trade}/${t.id}: that screen lists exactly the tile's request`, !!s && reqUrl(s.list) === reqUrl(t.list), s && [reqUrl(s.list), reqUrl(t.list)])
    }
    check(`${trade}/${t.id}: banner is short plain words`, t.banner.length <= 28)
  }
  const tabs = VERTICAL_TABS[trade]
  check(`${trade}: the bar is five slots at most per seat, More last`, [true, false].every((field) => {
    const shown = tabs.filter((x) => !x.seat || (x.seat === 'field') === field)
    return shown.length <= 5 && shown[shown.length - 1]?.name === 'more'
  }), tabs.map((x) => x.name))
  check(`${trade}: every tab is a screen file`, tabs.every((x) => fs.existsSync(path.join(app, 'app/(tabs)', x.name + '.tsx'))), tabs.filter((x) => !fs.existsSync(path.join(app, 'app/(tabs)', x.name + '.tsx'))).map((x) => x.name))
  check(`${trade}: no register, kiosk or card tab`, tabs.every((x) => !FORBIDDEN.test(x.name + x.title)))
}

// the standing copy rule for every file of the kit
const kit = fs.readdirSync(path.join(app, 'src/trades')).filter((f) => /\.tsx?$/.test(f))
for (const f of kit) {
  const text = fs.readFileSync(path.join(app, 'src/trades', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  check(`src/trades/${f}: copy has no he/she/his/her`, !/'[^']*\b(he|she|his|her)\b[^']*'/i.test(text))
}
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
