// CI guard: no template prints markup or an attribute through an ESCAPING tag (<%= ... %>).
//
// <%= HTML-escapes its value, so a string literal holding markup comes out as text:
//   - website-premium-bar hours/table.ejs printed today's row as
//     'Saturday <span class="hours__today-tag">today</span>' in plain text, and that unwrappable text
//     pushed the Bar and Kitchen columns off a phone screen (Test Bar Run 1, 2026-10-17). The row's
//     class="is-today" came out as class=&#34;is-today&#34; and never applied.
//   - website-store product.ejs printed data-soldout=&#34;1&#34;, so cart.js read '"1"', never '1':
//     a sold-out variant stayed selectable and its "sold out" message never showed.
// Write the markup outside the tag: <% if (cond) { %><span ...><% } %>.
//
//   bun scripts/check-ejs-no-escaped-markup.ts
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const files: string[] = []
const walk = (d: string) => {
  for (const n of readdirSync(d)) {
    if (n === 'node_modules' || n.startsWith('.')) continue
    const p = join(d, n)
    if (statSync(p).isDirectory()) walk(p)
    else if (p.endsWith('.ejs')) files.push(p)
  }
}
walk(ROOT + 'templates')

// A string literal inside <%= %> that holds a tag ('<span') or an attribute ('class="x"').
const MARKUP = /<%=[^%]*(['"`])[^'"`%]*(<[a-zA-Z/]|\b[a-z][a-z0-9-]*="[^"]*")[^'"`%]*\1[^%]*%>/g
let failed = 0
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split(/\r?\n/)
  lines.forEach((line, i) => {
    for (const m of line.matchAll(MARKUP)) {
      failed++
      console.error(`FAIL: ${f.slice(ROOT.length)}:${i + 1} prints markup through an escaping tag: ${m[0].slice(0, 120)}`)
    }
  })
}

// The guard has to see the two shapes it exists for.
const probe = (s: string) => { MARKUP.lastIndex = 0; return MARKUP.test(s) }
const selfTest = [
  probe(`<%= k === todayKey ? ' <span class="hours__today-tag">today</span>' : '' %>`),
  probe(`<%= (v.inventoryQty === 0) ? 'data-soldout="1"' : '' %>`),
  probe(`<tr<%= k === todayKey ? ' class="is-today"' : '' %>>`),
  !probe(`<%= data.heading || 'Hours' %>`),
  !probe(`class="<%= cond ? 'is-selected' : '' %>"`),
]
if (selfTest.some(ok => !ok)) { failed++; console.error('FAIL: the pattern no longer recognises the escaped-markup shapes (self-test ' + selfTest.join(',') + ')') }

if (failed) {
  console.error(`\n${failed} failed (${files.length} templates scanned)`)
  process.exit(1)
}
console.log(`ejs escaped markup: ${files.length} templates clean`)
