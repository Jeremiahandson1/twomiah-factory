/**
 * brand-assets.ts — crop the owner's concept art into web assets.
 *   bun scripts/brand-assets.ts <cover-lantern.jpg> <menu-cover.jpg> <exterior.jpg>
 * Writes build/images/brand/: wordmark.png (header logo), engraving.jpg,
 * cover.jpg, cover-full.jpg, exterior.jpg, plus small variants. Uses sharp
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

// 1. Gold "AMBER INN" wordmark from the lantern cover → header logo (keeps the leather behind it; header is black anyway).
{
  const { w, h } = await meta(lantern)
  const box = { left: Math.round(w * 0.163), top: Math.round(h * 0.205), width: Math.round(w * 0.689), height: Math.round(h * 0.235) }   // inside the frame lines, above OLDEST TAVERN, below EST. 1881
  await sharp(lantern).extract(box).resize({ width: 900 }).webp({ quality: 84 }).toFile(path.join(out, 'wordmark.webp'))
  await sharp(lantern).extract(box).resize({ width: 400 }).webp({ quality: 84 }).toFile(path.join(out, 'wordmark-400.webp'))
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

// 4. Leather tile sampled from the menu cover (plain area beside the engraving), mirrored 2x2 so it repeats without seams.
{
  const { w, h } = await meta(menuCover)
  // Plain leather sits to the right of the engraving, inside the frame.
  const box = { left: Math.round(w * 0.79), top: Math.round(h * 0.29), width: Math.round(w * 0.065), height: Math.round(w * 0.065) }
  const tile = await sharp(menuCover).extract(box).resize({ width: 220, height: 220 }).toBuffer()
  const flipH = await sharp(tile).flop().toBuffer(), flipV = await sharp(tile).flip().toBuffer(), flipHV = await sharp(tile).flop().flip().toBuffer()
  await sharp({ create: { width: 440, height: 440, channels: 3, background: '#0b0906' } })
    .composite([{ input: tile, left: 0, top: 0 }, { input: flipH, left: 220, top: 0 }, { input: flipV, left: 0, top: 220 }, { input: flipHV, left: 220, top: 220 }])
    .jpeg({ quality: 80, mozjpeg: true }).toFile(path.join(out, 'leather-tile.jpg'))
}
// 5. The lantern from the lantern cover.
{
  const { w, h } = await meta(lantern)
  const box = { left: Math.round(w * 0.478), top: Math.round(h * 0.128), width: Math.round(w * 0.095), height: Math.round(h * 0.085) }
  await sharp(lantern).extract(box).resize({ width: 160 }).webp({ quality: 86 }).toFile(path.join(out, 'lantern.webp'))
}
console.log('leather tile + lantern written')

// 6. A wide plain-leather strip from the lantern cover (between the frame and the first line), mirrored vertically into a tall tile.
{
  const { w, h } = await meta(lantern)
  const strip = await sharp(lantern).extract({ left: Math.round(w * 0.17), top: Math.round(h * 0.045), width: Math.round(w * 0.66), height: Math.round(h * 0.05) }).resize({ width: 1200 }).toBuffer()
  const sh = (await sharp(strip).metadata()).height!
  const flipV = await sharp(strip).flip().toBuffer()
  const flipH = await sharp(strip).flop().toBuffer()
  const flipHV = await sharp(strip).flop().flip().toBuffer()
  await sharp({ create: { width: 1200, height: sh * 4, channels: 3, background: '#0b0906' } })
    .composite([{ input: strip, left: 0, top: 0 }, { input: flipV, left: 0, top: sh }, { input: flipH, left: 0, top: sh * 2 }, { input: flipHV, left: 0, top: sh * 3 }])
    .jpeg({ quality: 82, mozjpeg: true }).toFile(path.join(out, 'leather-wide.jpg'))
  console.log('leather-wide.jpg', 1200, 'x', sh * 4)
}
