/** supplied-assets.ts — process the owner-supplied brand files.
 *  bun scripts/supplied-assets.ts <leather.jpg> <lettering-transparent.png> [lantern-transparent.png]
 *  Writes build/images/brand/: leather.{webp,jpg} (seamless roll-and-blend, darkened, warmed),
 *  lettering.webp / lettering-400.webp / lettering-header.webp (transparent gold AMBER INN),
 *  lantern.webp (transparent), corner.webp (top-right corner cap + filigree, flipped in CSS for the others). */
import path from 'path'
import sharp from 'sharp'
const [leatherSrc, letteringSrc, lanternSrc, cornerSrc] = process.argv.slice(2)
const out = path.resolve(import.meta.dir, '..', 'build', 'images', 'brand')
const clear = { r: 0, g: 0, b: 0, alpha: 0 }

if (leatherSrc) {
  // Seamless without mirroring (mirroring makes butterfly patterns): roll the photo by half so its
  // outer edges wrap perfectly, then lay the unrolled photo back over the middle with a soft mask
  // to hide the cross seam. Then pull it down to near-black with a warm cast, like the cover.
  const W = 1200, H = 800
  // Flatten the photo's lighting (bright middle, dark edges) with a high-pass so the tile has no blotches.
  const lit = await sharp(leatherSrc).resize({ width: W, height: H, fit: 'cover' }).raw().toBuffer()
  const low = await sharp(leatherSrc).resize({ width: W, height: H, fit: 'cover' }).blur(60).raw().toBuffer()
  const flat = Buffer.alloc(lit.length)
  for (let i = 0; i < lit.length; i++) flat[i] = Math.max(0, Math.min(255, lit[i] - low[i] + 96))
  const base = await sharp(flat, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer()
  const q = async (l: number, t: number, w: number, h: number) => sharp(base).extract({ left: l, top: t, width: w, height: h }).toBuffer()
  const hw = W / 2, hh = H / 2
  const rolled = await sharp({ create: { width: W, height: H, channels: 3, background: '#000' } }).composite([
    { input: await q(hw, hh, hw, hh), left: 0, top: 0 }, { input: await q(0, hh, hw, hh), left: hw, top: 0 },
    { input: await q(hw, 0, hw, hh), left: 0, top: hh }, { input: await q(0, 0, hw, hh), left: hw, top: hh },
  ]).png().toBuffer()
  // Radial mask: opaque in the middle (hides the rolled cross seam), clear at the edges (keeps the wrap).
  const mask = Buffer.alloc(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (x - W / 2) / (W / 2), dy = (y - H / 2) / (H / 2), r = Math.sqrt(dx * dx + dy * dy)
    mask[y * W + x] = Math.round(255 * Math.max(0, Math.min(1, (1 - r) / 0.45)))
  }
  const overlay = await sharp(base).joinChannel(mask, { raw: { width: W, height: H, channels: 1 } }).png().toBuffer()
  const seamless = await sharp(rolled).composite([{ input: overlay, left: 0, top: 0 }]).toBuffer()
  const dark = sharp(seamless).tint({ r: 150, g: 122, b: 88 }).modulate({ brightness: 0.17, saturation: 0.55 }).linear(1.7, -4)
  await dark.clone().webp({ quality: 66 }).toFile(path.join(out, 'leather.webp'))
  await dark.clone().jpeg({ quality: 70, mozjpeg: true }).toFile(path.join(out, 'leather.jpg'))
  const st = await sharp(path.join(out, 'leather.webp')).stats()
  console.log('leather tile', W, 'x', H, 'mean', st.channels.map(c => c.mean.toFixed(0)).join(','))
}

async function transparent(src: string, padX: number, padY: number) {
  const trimmed = await sharp(src).trim().toBuffer()
  const m = await sharp(trimmed).metadata()
  return sharp(trimmed).extend({ left: Math.round(m.width! * padX), right: Math.round(m.width! * padX), top: Math.round(m.height! * padY), bottom: Math.round(m.height! * padY), background: clear }).png().toBuffer()
}

if (letteringSrc) {
  const padded = await transparent(letteringSrc, 0.04, 0.06)
  for (const [name, width] of [['lettering.webp', 900], ['lettering-400.webp', 400], ['lettering-header.webp', 240]] as const)
    await sharp(padded).resize({ width }).webp({ quality: 88, alphaQuality: 90 }).toFile(path.join(out, name))
  const f = await sharp(path.join(out, 'lettering.webp')).metadata()
  console.log('lettering', f.width, 'x', f.height)
}

if (lanternSrc) {
  const padded = await transparent(lanternSrc, 0.03, 0.03)
  await sharp(padded).webp({ quality: 90, alphaQuality: 95 }).toFile(path.join(out, 'lantern.webp'))
  const f = await sharp(path.join(out, 'lantern.webp')).metadata()
  console.log('lantern', f.width, 'x', f.height)
}

if (cornerSrc) {
  await sharp(await sharp(cornerSrc).trim().toBuffer()).webp({ quality: 88, alphaQuality: 92 }).toFile(path.join(out, 'corner.webp'))
  const f = await sharp(path.join(out, 'corner.webp')).metadata()
  console.log('corner', f.width, 'x', f.height)
}
