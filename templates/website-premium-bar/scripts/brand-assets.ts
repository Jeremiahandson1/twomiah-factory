/**
 * brand-assets.ts — crop the owner's concept art into web assets.
 *   bun scripts/brand-assets.ts <cover-lantern.jpg> <menu-cover.jpg> <exterior.jpg>
 * Writes build/images/brand/: cover-full.jpg, engraving.jpg, cover.jpg,
 * exterior.jpg, plus small variants. Uses sharp
 * (already a template dependency).
 */
import fs from 'fs'
import path from 'path'
import sharp from 'sharp'

const [lantern, menuCover, exterior] = process.argv.slice(2)
if (!lantern || !menuCover || !exterior) { console.error('usage: bun scripts/brand-assets.ts <cover-lantern> <menu-cover> <exterior>'); process.exit(1) }
const out = path.resolve(import.meta.dir, '..', 'build', 'images', 'brand')
fs.mkdirSync(out, { recursive: true })

const meta = async (p: string) => { const m = await sharp(p).metadata(); return { w: m.width!, h: m.height! } }

// 1. Full cover for the story / parties art panels. (The header/masthead lettering, lantern, corner and leather
//    are the owner's cut-outs — see scripts/supplied-assets.ts.)
{
  // Full cover for the story / parties art panels
  await sharp(lantern).resize({ width: 1200 }).jpeg({ quality: 82, mozjpeg: true }).toFile(path.join(out, 'cover-full.jpg'))
  await sharp(lantern).resize({ width: 600 }).jpeg({ quality: 80, mozjpeg: true }).toFile(path.join(out, 'cover-full-600.jpg'))
}
// 2. Engraving of the building from the menu cover → story masthead / about art.
{
  const { w, h } = await meta(menuCover)
  const box = { left: Math.round(w * 0.20), top: Math.round(h * 0.11), width: Math.round(w * 0.62), height: Math.round(h * 0.34) }
  await sharp(menuCover).extract(box).resize({ width: 1000 }).jpeg({ quality: 84, mozjpeg: true }).toFile(path.join(out, 'engraving.jpg'))
  await sharp(menuCover).resize({ width: 1000 }).jpeg({ quality: 82, mozjpeg: true }).toFile(path.join(out, 'cover.jpg'))
  await sharp(menuCover).resize({ width: 520 }).jpeg({ quality: 80, mozjpeg: true }).toFile(path.join(out, 'cover-520.jpg'))
}
// 3. Exterior at dusk → visit / parties art.
{
  await sharp(exterior).resize({ width: 1400 }).jpeg({ quality: 82, mozjpeg: true }).toFile(path.join(out, 'exterior.jpg'))
  await sharp(exterior).resize({ width: 700 }).jpeg({ quality: 80, mozjpeg: true }).toFile(path.join(out, 'exterior-700.jpg'))
}
for (const f of fs.readdirSync(out)) console.log(f.padEnd(22), (fs.statSync(path.join(out, f)).size / 1024).toFixed(0) + ' KB')
