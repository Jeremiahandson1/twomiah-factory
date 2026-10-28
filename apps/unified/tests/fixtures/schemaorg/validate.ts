// Checks JSON-LD against schema.org's own vocabulary (vocabulary.json, built by build.ts), well past "it parses": every @type
// must be a real schema.org type, every property a real one that may sit on that type, and every value the kind of thing the
// property holds. Returns the problems, in words; none means the markup is made of real schema.org parts used the way
// schema.org says. It says nothing about what any search engine will do with it.
import fs from 'node:fs'
import path from 'node:path'

const V = JSON.parse(fs.readFileSync(path.join(import.meta.dir, 'vocabulary.json'), 'utf8')) as {
  types: Record<string, string[]>; props: Record<string, { domains: string[]; ranges: string[] }>; members: Record<string, string>
}

const ancestors = new Map<string, Set<string>>()
function up(t: string): Set<string> {
  const have = ancestors.get(t)
  if (have) return have
  const out = new Set<string>([t])
  ancestors.set(t, out)
  for (const p of V.types[t] ?? []) for (const a of up(p)) out.add(a)
  return out
}
const isA = (t: string, of: string) => up(t).has(of)

const TEXTUAL = ['Text', 'URL', 'Date', 'DateTime', 'Time', 'PronounceableText', 'CssSelectorType', 'XPathType']
const NUMERIC = ['Number', 'Integer', 'Float']
const SCHEMA = 'https://schema.org/'
const typesOf = (n: any): string[] => ([] as string[]).concat(n['@type'] ?? []).map(String)

export function validateJsonLd(doc: any): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  const refs: string[] = []
  const nodes: any[] = Array.isArray(doc?.['@graph']) ? doc['@graph'] : [doc]
  if (doc?.['@context'] !== 'https://schema.org' && doc?.['@context'] !== 'https://schema.org/') problems.push('@context is not schema.org')

  const checkValue = (where: string, prop: string, ranges: string[], v: any) => {
    if (Array.isArray(v)) return v.forEach((x) => checkValue(where, prop, ranges, x))
    if (v === null || v === undefined || v === '') return void problems.push(`${where}.${prop} is empty`)
    if (typeof v === 'string') {
      if (v.startsWith(SCHEMA) && V.members[v.slice(SCHEMA.length)]) {
        const m = V.members[v.slice(SCHEMA.length)]
        if (!ranges.some((r) => isA(m, r))) problems.push(`${where}.${prop}: ${v} is a ${m}, which ${prop} does not hold`)
        return
      }
      if (!ranges.some((r) => TEXTUAL.some((t) => isA(t, r) || isA(r, t)))) problems.push(`${where}.${prop}: text where ${prop} holds ${ranges.join(' / ')}`)
      return
    }
    if (typeof v === 'number') { if (!ranges.some((r) => NUMERIC.some((t) => isA(t, r) || isA(r, t)))) problems.push(`${where}.${prop}: a number where ${prop} holds ${ranges.join(' / ')}`); return }
    if (typeof v === 'boolean') { if (!ranges.includes('Boolean')) problems.push(`${where}.${prop}: a boolean where ${prop} holds ${ranges.join(' / ')}`); return }
    if (typeof v === 'object') {
      if (v['@id'] && !v['@type'] && Object.keys(v).length === 1) { refs.push(v['@id']); return }
      const ts = typesOf(v)
      if (!ts.length) return void problems.push(`${where}.${prop}: an object with no @type`)
      if (!ts.some((t) => ranges.some((r) => isA(t, r)))) problems.push(`${where}.${prop}: a ${ts.join('+')} where ${prop} holds ${ranges.join(' / ')}`)
      checkNode(where + '.' + prop, v)
    }
  }

  const checkNode = (where: string, n: any) => {
    const ts = typesOf(n)
    if (!ts.length) return void problems.push(`${where}: no @type`)
    for (const t of ts) if (!(t in V.types)) problems.push(`${where}: ${t} is not a schema.org type`)
    if (n['@id']) ids.add(String(n['@id']))
    for (const [prop, v] of Object.entries(n)) {
      if (prop.startsWith('@')) continue
      const p = V.props[prop]
      if (!p) { problems.push(`${where}: ${prop} is not a schema.org property`); continue }
      if (!ts.some((t) => p.domains.some((d) => isA(t, d)))) problems.push(`${where}: ${prop} does not belong on ${ts.join('+')} (it belongs on ${p.domains.join(', ')})`)
      checkValue(where, prop, p.ranges, v)
    }
  }

  nodes.forEach((n, i) => checkNode(`${typesOf(n)[0] ?? 'node'}[${i}]`, n))
  for (const r of refs) if (!ids.has(r)) problems.push(`@id ${r} refers to a node that is not in the graph`)
  return problems
}

/** Every application/ld+json block in a page, parsed. */
export function jsonLdOf(html: string): any[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]))
}
