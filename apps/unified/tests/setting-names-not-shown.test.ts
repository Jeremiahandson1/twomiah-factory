// No server setting's name is ever said to a business. (Live test 2026-10-22: the home care Integrations Hub told an owner
// "Add GUSTO_API_KEY to connect"; the RV's AI answered "missing ANTHROPIC_API_KEY"; QuickBooks' connect button could answer
// "QBO_CLIENT_ID / QBO_CLIENT_SECRET / QBO_REDIRECT_URI".) An owner cannot reach the server's settings — what they can do is
// email support, or press the button that connects it.
//
// The rule is read off the source, as text a person could be shown: every string literal in the app's server and screens
// and in the shared packages. A literal that names an environment setting (FOO_API_KEY, BAR_SECRET, …) fails, unless the
// line only READS the setting (process.env / env.X / Bun.env), or writes it to a log, or the literal is a comment. Nothing
// is allowed by line number or by file: a sentence that names a setting is the defect wherever it is.
import { describe, test, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '../../..')
const DIRS = ['apps/unified/server', 'apps/unified/web/src', 'packages/tenant-ui/src', 'packages/tenant-backend/src']
const SETTING = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(?:API_KEY|KEY|SECRET|TOKEN|SID|CLIENT_ID|ID|URL|URI|BASE)\b/
const LITERAL = /(['"`])((?:\\.|(?!\1).)*)\1/g

function files(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (name === 'node_modules' || name === 'dist') continue
    if (statSync(p).isDirectory()) out.push(...files(p))
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

/** Lines that only read a setting, or log, or are comments — never words for a person. */
const notShown = (line: string) => {
  const t = line.trim()
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')
    || /process\.env|\bBun\.env|\benv\.[A-Z_]|\benv\[|logger\.(info|warn|error|debug)|console\.(log|warn|error|info)/.test(line)
}

/** Every literal naming a setting, as `file: text`. */
export function settingNamesShown(dirs = DIRS): string[] {
  const hits: string[] = []
  for (const d of dirs) {
    for (const f of files(path.join(ROOT, d))) {
      const lines = readFileSync(f, 'utf8').split(/\r?\n/)
      lines.forEach((line, i) => {
        if (notShown(line)) return
        // A trailing comment on a code line is not shown either.
        const code = line.replace(/\s\/\/\s.*$/, '')
        for (const m of code.matchAll(LITERAL)) {
          // A template literal's interpolations are code, not words: one that builds a URL from NOAA_BASE says nothing.
          const text = m[2].replace(/\$\{[^}]*\}/g, '')
          // An identifier-only literal is a key or a constant's name used as data, not a sentence (e.g. 'STRIPE_SECRET_KEY'
          // in a list of names to read): a sentence has a space in it.
          if (!/\s/.test(text)) continue
          if (SETTING.test(text)) hits.push(`${path.relative(ROOT, f).replace(/\\/g, '/')}:${i + 1}: ${text.slice(0, 120)}`)
        }
      })
    }
  }
  return hits
}

describe('a business is never told the name of a server setting', () => {
  test('no sentence in the server, the screens or the shared packages names one', () => {
    expect(settingNamesShown()).toEqual([])
  }, 60_000)

  test('the check finds one when it is there', () => {
    // The rule is run on a sentence of the shape the live test found, so a regex that matched nothing would fail here.
    const probe = "    if (!key) return c.json({ error: 'Add GUSTO_API_KEY to connect' }, 503)"
    const caught = [...probe.matchAll(LITERAL)].some((m) => /\s/.test(m[2]) && SETTING.test(m[2]))
    expect(caught).toBe(true)
    expect(notShown(probe)).toBe(false)
    expect(notShown("    const key = process.env.GUSTO_API_KEY // 'Add GUSTO_API_KEY'")).toBe(true)
  })
})
