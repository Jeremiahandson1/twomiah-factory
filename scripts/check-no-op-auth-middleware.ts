// CI guard: a guard that always calls next() is not a guard.
//
//   bun run scripts/check-no-op-auth-middleware.ts
//
// crm-homecare shipped a middleware/permissions.ts whose requirePermission and requireRole both did
// nothing but `await next()`. It existed so route files vendored from the contractor CRM would
// import cleanly. The effect was that leads.ts carried nine gates —
// requirePermission('contacts:delete') and friends — that read in the source exactly like the real
// gate they are in every other template, and enforced nothing. Deleting a lead, converting one into
// a client, editing the lead sources: open to any signed-in user, including a caregiver.
//
// Nothing could catch it. check-permission-vocabulary only asks whether the RESOURCE is granted to
// some role; it never asks whether the function doing the asking is real. A route sweep run with an
// admin token sees 200 either way. The same shape has bitten before in a generated test sandbox
// (see the "sandbox requireRole no-op" note), where every authorisation assertion passed against
// unguarded code.
//
// This fails the build when an auth-shaped middleware is a pass-through AND a route uses it.
// Defining one and never using it is allowed (it is dead code, not a false promise).
import * as fs from 'fs'
import * as path from 'path'

const ROOT = path.resolve(import.meta.dir, '..')
const TPL = path.join(ROOT, 'templates')
const read = (p: string) => fs.readFileSync(p, 'utf8').split('\r').join('')

// Names that claim to authorise. `authenticate` is deliberately absent: it establishes identity.
const AUTHZ_NAME = /^(require|authorize|ensure|assert)[A-Z]\w*$/

/** Does this body refuse anything ITSELF? A real guard has a branch that does not reach next(). */
function refusesDirectly(body: string) {
  const denies = /\b(c|ctx)\s*\.\s*(json|text|body)\s*\(|throw\b|\.status\s*\(\s*(401|403)/.test(body)
  const branches = /\bif\s*\(/.test(body)
  return denies && branches
}

/**
 * Resolve delegation before judging. `export const requireAdmin = requireRole('admin','owner')` has
 * no branch of its own and is still a real guard, because requireRole refuses. Checking bodies in
 * isolation called that a no-op and produced 37 false positives across roof, store, dispensary and
 * pricing on the first run — every one of them a delegating one-liner.
 */
function resolveRefusals(decls: Array<{ name: string; body: string }>) {
  const refuses = new Map<string, boolean>()
  for (const d of decls) refuses.set(d.name, refusesDirectly(d.body))
  for (let pass = 0; pass < decls.length + 1; pass++) {
    let changed = false
    for (const d of decls) {
      if (refuses.get(d.name)) continue
      for (const other of decls) {
        if (other.name === d.name || !refuses.get(other.name)) continue
        // body references a guard that does refuse -> this one delegates to it
        if (new RegExp(`\\b${other.name}\\b`).test(d.body.slice(d.body.indexOf('=') + 1))) {
          refuses.set(d.name, true); changed = true; break
        }
      }
    }
    if (!changed) break
  }
  return refuses
}

/** Extract `{ name, body }` for exported function/const middleware declarations. */
function declarations(src: string) {
  const out: Array<{ name: string; body: string }> = []
  const re = /export\s+(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*=)/g
  for (const m of re.exec.length ? src.matchAll(re) : []) {
    const name = m[1] || m[2]
    if (!AUTHZ_NAME.test(name)) continue
    // body = from the declaration to the next top-level `export ` (or EOF)
    const start = m.index!
    const nextExport = src.indexOf('\nexport ', start + 1)
    out.push({ name, body: src.slice(start, nextExport < 0 ? src.length : nextExport) })
  }
  return out
}

const errors: string[] = []
let templates = 0, checked = 0

for (const t of fs.readdirSync(TPL).sort()) {
  const be = path.join(TPL, t, 'backend', 'src')
  const mw = path.join(be, 'middleware')
  const routes = path.join(be, 'routes')
  if (!fs.existsSync(mw) || !fs.existsSync(routes)) continue
  templates++

  // Collect every auth-shaped declaration across the whole middleware directory first, so a guard
  // in one file that delegates to one in another still resolves.
  const decls: Array<{ name: string; body: string }> = []
  for (const f of fs.readdirSync(mw).filter(x => x.endsWith('.ts'))) decls.push(...declarations(read(path.join(mw, f))))
  checked += decls.length
  const refuses = resolveRefusals(decls)
  const noops = decls.filter(d => !refuses.get(d.name)).map(d => d.name)
  if (!noops.length) continue

  // Is any pass-through actually used as a gate in a route?
  for (const f of fs.readdirSync(routes).filter(x => x.endsWith('.ts'))) {
    const src = read(path.join(routes, f))
    for (const name of noops) {
      const used = new RegExp(`\\.(get|post|put|patch|delete)\\([^)]*\\b${name}\\b|\\.use\\([^)]*\\b${name}\\b`).test(src)
      if (!used) continue
      errors.push(
        `${t}: routes/${f} uses '${name}' as a guard, but ${name} never refuses anything — it only ` +
        `calls next(). The route reads as gated and is not. Implement it or stop using it.`
      )
    }
  }
}

for (const e of [...new Set(errors)]) console.error('ERROR', e)
console.log(`\nno-op auth middleware: ${templates} template(s), ${checked} auth-shaped middleware checked, ${new Set(errors).size} used-but-inert`)
if (errors.length) process.exit(1)
