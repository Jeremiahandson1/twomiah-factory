// Rebuilds vocabulary.json from schema.org's own published vocabulary. Run by hand when schema.org moves on (the tests never
// fetch anything): 
//   curl -sS -o /tmp/schemaorg.jsonld https://schema.org/version/latest/schemaorg-current-https.jsonld
//   bun tests/fixtures/schemaorg/build.ts /tmp/schemaorg.jsonld [YYYY-MM-DD]
// Keeps what the structured-data tests need to tell a real schema.org type or property from an invented one: every class with
// its parents, every property with the classes it may sit on and the types it may hold.
import fs from 'node:fs'
import path from 'node:path'
const src = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const strip = (id: string) => id.replace(/^schema:/, '')
const ids = (v: any): string[] => (v == null ? [] : (Array.isArray(v) ? v : [v]).map((x: any) => strip(x['@id'] ?? x)))
const types: Record<string, string[]> = {}
const props: Record<string, { domains: string[]; ranges: string[] }> = {}
// Enumeration members (schema:Monday is a schema:DayOfWeek), which a property written as "https://schema.org/Monday" must be.
const members: Record<string, string> = {}
for (const n of src['@graph']) {
  const kind = ([] as string[]).concat(n['@type'] ?? [])
  const id = strip(String(n['@id'] ?? ''))
  if (!id || id.includes(':') || id.includes('/')) continue
  if (kind.includes('rdfs:Class')) types[id] = ids(n['rdfs:subClassOf'])
  else if (kind.length === 1 && kind[0].startsWith('schema:') && !kind[0].startsWith('schema:DataType')) members[id] = strip(kind[0])
  else if (kind.includes('rdf:Property')) props[id] = { domains: ids(n['schema:domainIncludes']), ranges: ids(n['schema:rangeIncludes']) }
}
const retrieved = process.argv[3] ?? new Date().toISOString().slice(0, 10)
fs.writeFileSync(path.join(import.meta.dir, 'vocabulary.json'), JSON.stringify({ source: 'schemaorg-current-https.jsonld, retrieved ' + retrieved, types, props, members }) + '\n')
console.log('types', Object.keys(types).length, 'properties', Object.keys(props).length)
