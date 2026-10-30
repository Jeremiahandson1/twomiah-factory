// "Has the real server changed what it says?" — the drift check behind tests/demo-drift.test.ts.
//
// The demo's data (demo/public/demo-data/<trade>.json) is what a real server answered on the day it was recorded. When the
// server later answers differently in SHAPE — a field added, renamed, removed, a number that became text, a route that now
// refuses — the demo's screens would be drawn from a stale answer. This compares a fresh recording with the committed one and
// says what moved. Values are not compared (names, dates and ids differ between two recordings of the same seed); shapes are.
import { looksLikeId } from '../web/demo/keys.ts'
import type { DemoData, RecordedResponse } from '../web/demo/store.ts'

const DATE_LIKE = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/

/** "GET /api/jobs/abc…?from=2026-10-30" → "GET /api/jobs/:id?from=:date": the request without the day or the row it was made for. */
export function templateKey(key: string): string {
  const space = key.indexOf(' ')
  const method = key.slice(0, space)
  const [path, query = ''] = key.slice(space + 1).split('?')
  const p = path.split('/').map((s) => (looksLikeId(s) ? ':id' : s)).join('/')
  const q = query.split('&').filter(Boolean).map((kv) => {
    const [k, v = ''] = kv.split('=')
    const value = decodeURIComponent(v)
    return `${k}=${looksLikeId(value) ? ':id' : DATE_LIKE.test(value) ? ':date' : value}`
  })
  q.sort()
  return `${method} ${p}${q.length ? '?' + q.join('&') : ''}`
}

/** Every path in a body with the type found there ('null' where only null was seen). Arrays are walked across all their rows. */
export function shapeOf(body: unknown): Map<string, string> {
  const out = new Map<string, string>()
  const put = (path: string, type: string) => {
    const was = out.get(path)
    if (!was || was === 'null') out.set(path, type)
    else if (type !== 'null' && was !== type) out.set(path, `${was}|${type}`.split('|').sort().filter((v, i, a) => a.indexOf(v) === i).join('|'))
  }
  const walk = (v: unknown, path: string) => {
    if (v === null || v === undefined) return put(path, 'null')
    if (Array.isArray(v)) { put(path, 'array'); for (const x of v) walk(x, `${path}[]`); return }
    if (typeof v === 'object') {
      put(path, 'object')
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, `${path}.${looksLikeId(k) || DATE_LIKE.test(k) ? '*' : k}`)
      return
    }
    put(path, typeof v)
  }
  walk(body, '$')
  return out
}

interface TemplateShape { statuses: Set<number>; paths: Map<string, string> }

function byTemplate(data: DemoData): Map<string, TemplateShape> {
  const out = new Map<string, TemplateShape>()
  for (const [key, r] of Object.entries(data.responses) as Array<[string, RecordedResponse]>) {
    const t = templateKey(key)
    const shape = out.get(t) ?? { statuses: new Set<number>(), paths: new Map<string, string>() }
    shape.statuses.add(r.status)
    for (const [p, type] of shapeOf(r.body)) {
      const was = shape.paths.get(p)
      shape.paths.set(p, !was || was === 'null' ? type : type === 'null' || was === type ? was : [...new Set([...was.split('|'), ...type.split('|')])].sort().join('|'))
    }
    out.set(t, shape)
  }
  return out
}

/** What is different between the committed data and a fresh recording, as sentences. Empty: the demo's data is current. */
export function driftBetween(committed: DemoData, fresh: DemoData): string[] {
  const was = byTemplate(committed), now = byTemplate(fresh)
  const found: string[] = []
  for (const t of now.keys()) if (!was.has(t)) found.push(`new request the screens make: ${t}`)
  for (const t of was.keys()) if (!now.has(t)) found.push(`request no longer made: ${t}`)
  for (const [t, a] of was) {
    const b = now.get(t)
    if (!b) continue
    const sa = [...a.statuses].sort().join(','), sb = [...b.statuses].sort().join(',')
    if (sa !== sb) found.push(`${t}: answered ${sa}, now ${sb}`)
    for (const [p, type] of b.paths) {
      const old = a.paths.get(p)
      if (old === undefined) found.push(`${t}: new field ${p} (${type})`)
      else if (old !== 'null' && type !== 'null' && old !== type) found.push(`${t}: ${p} was ${old}, now ${type}`)
    }
    for (const p of a.paths.keys()) if (!b.paths.has(p)) found.push(`${t}: field ${p} gone`)
  }
  return found
}
