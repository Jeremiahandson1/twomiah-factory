// Renders the roofing template's two hand-authored sample compositions
// to standalone HTML files so they can be opened side by side in a
// browser — the visual proof that roofing looks distinct from
// contractor + fieldservice.
//
// Run from apps/api:
//   bun run scripts/render-premium-roofing-samples.ts
import fs from 'fs'
import path from 'path'
import ejs from 'ejs'

const ROOT = path.resolve(__dirname, '../../../templates/website-premium-roofing')
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

  const outPath = path.join(ROOT, outName)
  fs.writeFileSync(outPath, inlined)
  console.log('OK ', path.basename(compositionPath), '→', outName, '(' + inlined.length + ' bytes)')
}

;(async () => {
  await render(path.join(samplesDir, 'composition-a.json'), 'composition-a.html')
  await render(path.join(samplesDir, 'composition-b.json'), 'composition-b.html')
  console.log('\nOpen side by side to compare with the other premium templates:')
  console.log('  ', path.join(ROOT, 'composition-a.html'))
  console.log('  ', path.join(ROOT, 'composition-b.html'))
  console.log('  vs.')
  console.log('  ', path.resolve(__dirname, '../../../templates/website-premium-contractor/composition-a.html'))
  console.log('  ', path.resolve(__dirname, '../../../templates/website-premium-fieldservice/composition-a.html'))
})()
