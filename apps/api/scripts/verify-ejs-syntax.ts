// Compile-check every modified EJS file from the landscaping + showcase backport.
// We don't render — that needs real data — we just call ejs.compile() so a
// syntax error throws.
import ejs from 'ejs'
import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '../../../templates')

const TARGETS = [
  'website-landscaping/views/home.ejs',
  'website-landscaping/views/gallery.ejs',
  'website-landscaping/views/blog-post.ejs',
  'website-landscaping/views/project-detail.ejs',
  'website-landscaping/views/custom-page.ejs',
  'website-landscaping/views/service.ejs',
  'website-landscaping/views/subservice.ejs',
  'website-showcase/views/home.ejs',
  'website-showcase/views/gallery.ejs',
  'website-showcase/views/blog-post.ejs',
  'website-showcase/views/project-detail.ejs',
  'website-showcase/views/custom-page.ejs',
  'website-showcase/views/service.ejs',
  'website-showcase/views/subservice.ejs',
]

let ok = 0
let fail = 0
for (const rel of TARGETS) {
  const abs = path.join(ROOT, rel)
  try {
    const src = fs.readFileSync(abs, 'utf8')
    ejs.compile(src, { filename: abs })
    console.log('OK   ' + rel)
    ok++
  } catch (err: any) {
    console.log('FAIL ' + rel + '  ' + (err && err.message ? err.message.split('\n')[0] : err))
    fail++
  }
}
console.log(`\n${ok}/${ok + fail} EJS files compile cleanly.`)
process.exit(fail === 0 ? 0 : 1)
