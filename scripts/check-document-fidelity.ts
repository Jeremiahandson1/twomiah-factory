// CI guard: a Document must be preserved as uploaded and served so it can be previewed.
//  1) storeUpload must NOT transcode the main file (it re-encoded PNGs to JPEG in place but recorded the
//     ORIGINAL size and .png name — the Documents list overstated size ~24× and served JPEG bytes under a
//     .png name). It must record the bytes actually stored (uploaded.size / uploaded.mimetype).
//  2) The file stream must serve PDFs inline as application/pdf (they were forced to octet-stream, so the
//     preview pane rendered blank), while still downloading anything else as an opaque attachment.
//   bun scripts/check-document-fidelity.ts
import { readFileSync } from 'node:fs'
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const src = strip(readFileSync(new URL('../packages/tenant-backend/src/files/documents.ts', import.meta.url), 'utf8'))

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// (1) no in-place transcode of the document's main file; the row records the stored original.
if (/processImage/.test(src)) fail('documents must not transcode the main file (processImage) — a document keeps its original bytes/name/size')
if (!/size:\s*uploaded\.size/.test(src)) fail('the document row must record uploaded.size (the bytes actually stored)')
if (!/mimeType:\s*uploaded\.mimetype/.test(src)) fail('the document row must record uploaded.mimetype (not a re-encoded type)')

// (2) PDFs served inline for preview.
if (!/contentType === 'application\/pdf'/.test(src)) fail("the file stream's inline check must include application/pdf so PDFs preview")
if (!/inline \? 'inline' : 'attachment'/.test(src)) fail('the file stream must set Content-Disposition inline for previewable types, attachment otherwise')

if (failed) { console.error(`\ndocument fidelity: ${failed} check(s) FAILED`); process.exit(1) }
console.log('document fidelity: documents keep their original bytes/name/size and PDFs preview inline')
