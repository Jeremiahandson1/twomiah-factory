// The owner's free text cannot break the build.
//
// generator.injectTokens pastes {{COMPANY_NAME}}, {{CITY}}, {{OWNER_NAME}} … into source code, inside '…', "…" and
// `…` literals, JSX attributes and JSX text. A business called "Mary's Home Care" ended a string early and the CRM
// failed to build at signup (found by reading, 10/16: 34 single-quoted company-name literals in 11 CRMs, ~1,200 free-
// text sites in all). This injects a deliberately hostile value into every code file of every CRM template and the
// shared packages, and parses each result: every file that parses with plain values must still parse.
//
//   bun tests/shared/generator-free-text.test.ts
import { readdirSync, readFileSync, statSync } from 'fs'

const ROOT = (process.env.FACTORY_ROOT || process.cwd() + '/').replace(/\\/g, '/').replace(/\/?$/, '/')
const gen = await import(`${ROOT}apps/api/src/services/generator.ts`)

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 600)) }
}

const HOSTILE = `Mary's "Best" \`Care\` \${x} {Co} <b> & Sons \\ O'Fallon`
// Plain stand-ins for the tokens that are not free text, so code positions stay valid.
const plainFor = (tok: string): string => {
  if (/_JSON\}\}$/.test(tok)) return '[]'
  if (/COLOR/.test(tok)) return '#123456'
  if (/^\{\{(IS_STORE|ENABLE_|ADS_ENABLED)/.test(tok)) return 'false'
  if (/COUNT\}\}$/.test(tok)) return '3'
  return 'plain'
}

const files: string[] = []
const walk = (d: string) => {
  for (const f of readdirSync(d)) {
    if (f === 'node_modules' || f === 'dist') continue
    const p = `${d}/${f}`
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(tsx?|jsx?|mjs)$/.test(f)) files.push(p)
  }
}
// Every template the generator injects (CRMs, websites, CMS, pricing), parked automotive aside.
for (const t of readdirSync(`${ROOT}templates`).filter((x) => x !== 'crm-automotive' && statSync(`${ROOT}templates/${x}`).isDirectory())) walk(`${ROOT}templates/${t}`)
walk(`${ROOT}packages`)

const parses = (src: string, p: string): string | null => {
  try { new Bun.Transpiler({ loader: /\.(ts|tsx)$/.test(p) ? 'tsx' : 'jsx' }).transformSync(src); return null } catch (e: any) { return String(e?.message || e).slice(0, 160) }
}

let withTokens = 0, plainOk = 0
const broken: string[] = []
for (const p of files) {
  const src = readFileSync(p, 'utf8')
  const toks = [...new Set(src.match(/\{\{[A-Z0-9_]+\}\}/g) || [])]
  if (!toks.some((t) => gen.FREE_TEXT_TOKENS.has(t))) continue
  withTokens++
  const plain: Record<string, string> = {}, hostile: Record<string, string> = {}
  for (const t of toks) { plain[t] = plainFor(t); hostile[t] = gen.FREE_TEXT_TOKENS.has(t) ? HOSTILE : plainFor(t) }
  if (parses(gen.injectTokens(src, plain), p)) continue // a template-level quirk, not this rule's business
  plainOk++
  const err = parses(gen.injectTokens(src, hostile), p)
  if (err) broken.push(`${p.replace(ROOT, '')}: ${err}`)
}
check(`a hostile business name parses in every code file that carries free text (${plainOk} of ${withTokens} files)`, plainOk > 80 && broken.length === 0, broken.slice(0, 8))

// What the reader sees: the same words, typographic marks.
const shown = gen.literalSafeText("Mary's \"Best\" Care")
check('the name still reads the same: Mary’s “Best” Care', shown === 'Mary’s “Best” Care', shown)
check('a plain name is unchanged', gen.literalSafeText('Eau Claire Home Care') === 'Eau Claire Home Care')
check('emails, URLs and colours are not free text', !['{{COMPANY_EMAIL}}', '{{ADMIN_EMAIL}}', '{{SITE_URL}}', '{{PRIMARY_COLOR}}', '{{DEFAULT_PASSWORD}}', '{{PRODUCTS_JSON}}'].some((t) => gen.FREE_TEXT_TOKENS.has(t)))
check('…and pass through untouched', gen.injectTokens("a='{{ADMIN_EMAIL}}'", { '{{ADMIN_EMAIL}}': "o'brien@x.com" }) === "a='o'brien@x.com'")

// Mutation: with the raw paste (the old injectTokens), the same walk must find broken files.
{
  let rawBroken = 0
  for (const p of files) {
    const src = readFileSync(p, 'utf8')
    const toks = [...new Set(src.match(/\{\{[A-Z0-9_]+\}\}/g) || [])]
    if (!toks.some((t) => gen.FREE_TEXT_TOKENS.has(t))) continue
    let out = src
    for (const t of toks) out = out.split(t).join(gen.FREE_TEXT_TOKENS.has(t) ? HOSTILE : plainFor(t))
    let plainSrc = src
    for (const t of toks) plainSrc = plainSrc.split(t).join(plainFor(t))
    if (!parses(plainSrc, p) && parses(out, p)) rawBroken++
  }
  check(`self-test: the raw paste breaks files (${rawBroken}) — the walk can see the fault`, rawBroken > 10, rawBroken)
}

console.log(`\ngenerator-free-text: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
