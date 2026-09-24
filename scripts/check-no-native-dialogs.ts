// CI guard: the salon asks and reports in its own words, not the browser's.
//
// Salon T28 L8 — "Errors shown in native browser alert boxes. Duplicate enrolment, check-in warnings and
// client-create failures use window.alert/confirm rather than the app's own toasts."
//
// A native dialog is an OS box carrying the Render hostname, unstyled, unthemed, blocking, and impossible
// to make readable in dark mode. window.alert was already being monkey-patched into a toast, so the half
// of the finding people actually saw was confirm() — which stayed native because it needs a boolean back.
// ConfirmProvider answers with a promise, so that reason is gone and nothing needs to be native.
//
// This checks the salon, where the finding was raised. The other verticals still carry their own
// confirm() calls and are listed, not checked, so the debt is written down rather than silent.
//   bun scripts/check-no-native-dialogs.ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error('FAIL: ' + m) }

const NOT_YET_CONVERTED = ['crm', 'crm-fieldservice', 'crm-landscaping', 'crm-restaurant', 'crm-rv', 'crm-vet', 'crm-roof', 'crm-store', 'crm-dispensary', 'crm-homecare']

const SRC = 'templates/crm-salon/frontend/src'
// ToastContext owns the window.alert shim — it is the one file allowed to name it.
const EXEMPT = ['contexts/ToastContext.tsx']

const walk = (dir: string): string[] => {
  let out: string[] = []
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = dir + '/' + name
    if (statSync(join(ROOT, rel)).isDirectory()) out = out.concat(walk(rel))
    else if (/\.tsx?$/.test(name)) out.push(rel)
  }
  return out
}

let files: string[] = []
try { files = walk(SRC) } catch { fail(SRC + ' is missing') }

for (const rel of files) {
  if (EXEMPT.some((e) => rel.endsWith(e))) continue
  const src = readFileSync(join(ROOT, rel), 'utf8')
  src.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return          // a comment naming it is documentation
    if (/\bawait confirm\(/.test(line)) return            // the app's own, via useConfirm()
    const hit = /\bwindow\.(alert|confirm|prompt)\s*\(/.exec(line) || /(^|[^.\w])(alert|confirm|prompt)\s*\(/.exec(line)
    if (!hit) return
    const which = hit[1] === 'alert' || hit[1] === 'confirm' || hit[1] === 'prompt' ? hit[1] : hit[2]
    fail(`${rel}:${i + 1} calls ${which}() — use toast.error for a failure, or useConfirm() to ask: ${line.trim().slice(0, 90)}`)
  })
}

// the provider has to be mounted, or useConfirm() quietly falls back to the native dialog
const app = (() => { try { return readFileSync(join(ROOT, 'templates/crm-salon/frontend/src/App.tsx'), 'utf8') } catch { return '' } })()
if (!app) fail('templates/crm-salon/frontend/src/App.tsx is missing')
if (!/<ConfirmProvider>/.test(app)) fail('ConfirmProvider must be mounted in App.tsx — without it useConfirm() falls back to window.confirm and the dialogs come back')

if (failed) { console.error(`\nno native dialogs: ${failed} check(s) FAILED (not yet converted: ${NOT_YET_CONVERTED.join(', ')})`); process.exit(1) }
console.log(`no native dialogs: the salon asks and reports in its own words (not yet converted: ${NOT_YET_CONVERTED.join(', ')})`)
