// Renders the landscaping template's hand-authored sample compositions.
//
// Run from apps/api:
//   bun run scripts/render-premium-landscaping-samples.ts
import fs from 'fs'
import path from 'path'
import ejs from 'ejs'

const ROOT = path.resolve(__dirname, '../../../templates/website-premium-landscaping')
const viewsDir = path.join(ROOT, 'views')
const dataDir = path.join(ROOT, 'data')
const samplesDir = path.join(dataDir, 'samples')
const buildDir = path.join(ROOT, 'build')

const settings = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'))

async function render(compositionPath: string, outName: string) {
  const homepage = JSON.parse(fs.readFileSync(compositionPath, 'utf8'))
  const body = await ejs.renderFile(path.join(viewsDir, 'home.ejs'), { homepage, settings }) as string
  const html = await ejs.renderFile(path.join(viewsDir, 'base.ejs'), { body, settings, currentPath: '' }) as string

  const inlined = html.replace(/<link\s+rel=["']stylesheet["']\s+href=["']\/styles\/([^"']+)["']\s*\/?>/i, (_m, p) => {
    const cssPath = path.join(buildDir, 'styles', p)
    try { return '<style>\n' + fs.readFileSync(cssPath, 'utf8') + '\n</style>' }
    catch { return _m }
  })

  fs.writeFileSync(path.join(ROOT, outName), inlined)
  console.log('OK ', path.basename(compositionPath), '→', outName, '(' + inlined.length + ' bytes)')
}

;(async () => {
  await render(path.join(samplesDir, 'composition-a.json'), 'composition-a.html')
  await render(path.join(samplesDir, 'composition-b.json'), 'composition-b.html')
  console.log('\nOpen:', path.join(ROOT, 'composition-a.html'))
})()
