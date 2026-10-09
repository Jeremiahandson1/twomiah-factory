// CI guard: the roofing measurement map can draw. (T61)
//
//   "The DIY measurement canvas stayed blank."
//
// Rendered in a real browser, the server's satellite picture was fine (228–303 KB) and three things in
// the client stopped it — none of which a server test or a static page sweep can see:
//   1. the CSP's connect-src did not allow data:, and MapLibre fetch()es an image source's URL — the DIY
//      preview hands it the picture as a data: URL, so the browser refused it;
//   2. the styles had no `glyphs`, and the edge/segment labels are text layers, which MapLibre rejects
//      without one ("use of text-field requires a style glyphs property");
//   3. the address autocomplete called google.maps.importLibrary on the script's onload, which with
//      loading=async fires before google.maps is built ("importLibrary is not a function").
//   bun scripts/check-roof-map-renders.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const idx = read('templates/crm-roof/backend/src/index.ts')
const connect = /"connect-src ([^"]+)"/.exec(idx)?.[1] || ''
if (!connect) fail('crm-roof CSP: no connect-src directive found')
else if (!/(^|\s)data:(\s|$)/.test(connect)) fail(`crm-roof CSP: connect-src must allow data: — the DIY map's picture is a data: URL MapLibre fetch()es (it is "${connect}")`)

const styles = read('templates/crm-roof/frontend/src/components/common/MapProvider.tsx')
const versions = (styles.match(/version: 8 as const,/g) || []).length
const glyphs = (styles.match(/version: 8 as const,\n\s*glyphs: GLYPHS,/g) || []).length
if (versions < 3) fail(`MapProvider.tsx: expected the map styles (found ${versions})`)
if (glyphs !== versions) fail(`MapProvider.tsx: ${versions - glyphs} of ${versions} map style(s) carry no glyphs — the label layers are text layers and need one`)
if (!/const GLYPHS = 'https:\/\/fonts\.openmaptiles\.org\/\{fontstack\}\/\{range\}\.pbf'/.test(styles)) fail('MapProvider.tsx: GLYPHS must point at a server that serves the fonts the layers ask for (Open Sans Bold — fonts.openmaptiles.org)')
const editor = read('templates/crm-roof/frontend/src/pages/roofReports/MapEdgeEditor.tsx')
for (const f of editor.match(/'text-font': \[[^\]]*\]/g) || []) if (!/Open Sans Bold/.test(f)) fail(`MapEdgeEditor.tsx asks for a font the glyph server was not checked for: ${f}`)

const auto = read('templates/crm-roof/frontend/src/components/common/AddressAutocomplete.tsx')
if (!/&loading=async&callback=__twomiahMapsReady/.test(auto) || !/__twomiahMapsReady = \(\) => resolve\(\)/.test(auto)) fail("AddressAutocomplete: with loading=async, readiness is Google's callback, not the script's onload")
if (/script\.onload = \(\) => resolve\(\)/.test(auto)) fail('AddressAutocomplete: resolving on script.onload races google.maps being built')
if (!/typeof window\.google\.maps\.importLibrary === 'function'\) await window\.google\.maps\.importLibrary\('places'\)/.test(auto)) fail('AddressAutocomplete: importLibrary must be called only when it exists')

if (failed) { console.error(`\nroof map: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`roof map: CSP lets MapLibre fetch the picture, ${glyphs}/${versions} styles carry glyphs, autocomplete waits for Google's ready callback`)
