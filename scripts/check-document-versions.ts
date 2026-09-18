// CI guard: a document's version history includes the file that is live now — listing only the superseded copies
// meant nothing said which version you were looking at, or let you download it from the history. (Landscaping T21 M3)
//   bun scripts/check-document-versions.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const docs = read('packages/tenant-backend/src/files/documents.ts')
const list = docs.slice(docs.indexOf("app.get('/:id/versions'"), docs.indexOf("app.post('/:id/versions'"))
if (!/const live = \{ id: null, documentId: doc\.id, versionNumber: currentVersion,/.test(list)) fail('the versions list must include the file that is live now')
if (!/isCurrent: true \}/.test(list)) fail('the live entry must be marked as the current one')
if (!/return c\.json\(\{ data: \[live, \.\.\.versions\.map\(\(row: any\) => \(\{ \.\.\.row, isCurrent: false \}\)\)\], currentVersion \}\)/.test(list)) fail('the live entry must come first, with the superseded versions after it')
if (/return c\.json\(\{ data: versions, currentVersion: versions\.length \+ 1 \}\)/.test(docs)) fail('the old superseded-only list must be gone')

const page = read('packages/tenant-ui/src/files/DocumentsPage.tsx')
if (!/v\.isCurrent \? <span className="ml-2 text-xs font-normal text-green-600">current<\/span> : null/.test(page)) fail('the version list must show which entry is the live file')
if (!/v\.isCurrent \? `\/api\/documents\/\$\{doc\.id\}\/download` : `\/api\/documents\/\$\{doc\.id\}\/versions\/\$\{v\.id\}\/download`/.test(page)) fail('the live entry must download from the document (it has no version row)')
if (!/\{!v\.isCurrent && <button onClick=\{\(\) => restore\(v\)\}/.test(page)) fail('there must be no Restore button on the file that is already live')
if (!/Current file: <span className="font-normal">v\{currentVersion\} — \{current\.originalName\}/.test(page)) fail('the current file must be shown with its version number')
if (!/versions\.filter\(v => !v\.isCurrent\)\.length === 0 && <p/.test(page)) fail('"No previous versions" must count only the superseded ones now that the live file is in the list')

if (failed) { console.error(`\ndocument version history: ${failed} check(s) FAILED`); process.exit(1) }
console.log('document version history: the live file is in its own history, marked current, downloadable, with nothing to restore')
