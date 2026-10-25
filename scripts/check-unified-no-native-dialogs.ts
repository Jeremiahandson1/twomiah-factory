// CI guard: the unified app asks and reports in its own dialogs, never the browser's (2026-10-22).
//
// A native alert/confirm/prompt is an OS box carrying the host name, unstyled, unthemed and blocking. The unified
// screens have the app's own (useConfirm / usePrompt, packages/tenant-ui/src/ui/ConfirmProvider.tsx, mounted in
// apps/unified/web/src/App.tsx). Found on 10/22: a roofer's supplement approval, the draw schedule's "approved amount"
// (whose Cancel approved the draw anyway), submittal notes and the AIA form's signer — all browser boxes.
// scripts/check-no-native-dialogs.ts covers the salon template and packages/tenant-ui; this covers apps/unified/web.
//   bun scripts/check-unified-no-native-dialogs.ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const SRC = 'apps/unified/web/src'
let failed = 0
const fail = (m: string) => { failed++; console.error('FAIL: ' + m) }

const walk = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap((name) => {
  const rel = dir + '/' + name
  return statSync(join(ROOT, rel)).isDirectory() ? walk(rel) : /\.tsx?$/.test(name) ? [rel] : []
})

let files: string[] = []
try { files = walk(SRC) } catch { fail(SRC + ' is missing — fix this guard\'s walk') }
if (files.length < 50) fail(`only ${files.length} files under ${SRC} — fix this guard's walk`)
// The public site's own scripts and pages too: the booking page's cancel used the browser's confirm (salon run, 10/25).
const SITE = 'apps/unified/site'
const siteWalk = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap((name) => {
  const rel = dir + '/' + name
  return statSync(join(ROOT, rel)).isDirectory() ? siteWalk(rel) : /\.(ts|js|ejs)$/.test(name) ? [rel] : []
})
const siteFiles = (() => { try { return siteWalk(SITE) } catch { fail(SITE + ' is missing — fix this guard\'s walk'); return [] } })()
if (siteFiles.length < 30) fail(`only ${siteFiles.length} files under ${SITE} — fix this guard's walk`)
files = [...files, ...siteFiles]

for (const rel of files) {
  const src = readFileSync(join(ROOT, rel), 'utf8')
  // The app's own dialogs as this file names them: `const prompt = usePrompt()`, `const ask = useConfirm()`. Awaited,
  // a call to one of those is the app's — the screens bind usePrompt to `prompt`.
  const own = [...src.matchAll(/\bconst\s+(\w+)\s*=\s*use(?:Confirm|Prompt)\(\)/g)].map((m) => m[1])
  src.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return                       // a comment naming it is documentation
    if (own.some((n) => new RegExp('\\bawait\\s+' + n + '\\(').test(line))) return
    // window.alert( / window.confirm( / window.prompt(, or the bare call — not a method of something else (x.confirm(),
    // and not "alert (" in a sentence.
    const hit = /\bwindow\.(alert|confirm|prompt)\s*\(/.exec(line) || /(?<![.\w])(alert|confirm|prompt)\(/.exec(line)
    if (hit) fail(`${rel}:${i + 1} calls ${hit[1]}() — use the app's own: useConfirm() to ask, usePrompt() for a line of text, toast for a message: ${line.trim().slice(0, 90)}`)
  })
}

const app = (() => { try { return readFileSync(join(ROOT, SRC, 'App.tsx'), 'utf8') } catch { return '' } })()
if (!/<ConfirmProvider>/.test(app)) fail(`ConfirmProvider must be mounted in ${SRC}/App.tsx — without it useConfirm()/usePrompt() fall back to the browser's boxes`)

if (failed) { console.error(`\nunified, no native dialogs: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`unified, no native dialogs: ${files.length} files, none calls the browser's alert/confirm/prompt`)
