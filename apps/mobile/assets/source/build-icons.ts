// Draws the app's icons and splash from the Twomiah flame (twomiah-flame.svg, twomiah.com's own favicon).
//
//   bun apps/mobile/assets/source/build-icons.ts
//
// Writes ../icon.png, ../adaptive-icon.png, ../splash.png and ../notification-icon.png. Needs `sharp` (apps/unified has it).
// The sizes and rules are the stores':
//   icon.png               1024×1024, flat colour behind the mark, NO alpha channel (Apple refuses one), square corners
//                          (the stores round them).
//   adaptive-icon.png      1024×1024 transparent; the mark sits inside the central 720×720 (Android crops the rest). The
//                          background colour is app.config.ts's `adaptiveIcon.backgroundColor` (the app's primary colour).
//   splash.png             1284×2778 on the app's splash background (app.config.ts `splash.backgroundColor`).
//   notification-icon.png  96×96 solid white silhouette on transparent (Android tints it; any colour in it is lost).
// The background is the app's primary colour (#1e40af) — the same value app.config.ts gives the splash and the adaptive icon,
// so the artwork and the config agree.
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'

const sharp = createRequire(import.meta.url)(path.resolve(import.meta.dir, '../../../unified/node_modules/sharp')) as typeof import('sharp')
const OUT = path.resolve(import.meta.dir, '..')
const BACKGROUND = '#1e40af'

// The flame's ink spans x 16..104, y 18..99 of its 120×120 drawing; crop to that so scaling is by the mark itself.
const flame = fs.readFileSync(path.join(import.meta.dir, 'twomiah-flame.svg'), 'utf8').replace('viewBox="0 0 120 120"', 'viewBox="16 18 88 81"')
const INK_RATIO = 88 / 81

/** The mark rendered `width` px wide, with its transparency. */
const mark = (width: number) => sharp(Buffer.from(flame), { density: 72 * (width / 88) }).resize({ width, height: Math.round(width / INK_RATIO) }).png().toBuffer()

/** A canvas of w×h with the mark centred and `width` px wide. */
async function canvas(w: number, h: number, markWidth: number, background: string | null) {
  const m = await mark(markWidth)
  const { height: mh = 0 } = await sharp(m).metadata()
  const base = sharp({ create: { width: w, height: h, channels: 4, background: background ?? { r: 0, g: 0, b: 0, alpha: 0 } } })
  return base.composite([{ input: m, left: Math.round((w - markWidth) / 2), top: Math.round((h - mh) / 2) }])
}

// icon: the mark is 704 px wide (69% of the square), flattened — no alpha channel at all.
await (await canvas(1024, 1024, 704, BACKGROUND)).flatten({ background: BACKGROUND }).removeAlpha().png({ compressionLevel: 9 }).toFile(path.join(OUT, 'icon.png'))
// adaptive: 616 px wide — inside the safe 720×720 with room for the corners of a circular mask.
await (await canvas(1024, 1024, 616, null)).png({ compressionLevel: 9 }).toFile(path.join(OUT, 'adaptive-icon.png'))
// splash: 1284×2778, the mark 616 px wide in the middle.
await (await canvas(1284, 2778, 616, BACKGROUND)).flatten({ background: BACKGROUND }).removeAlpha().png({ compressionLevel: 9 }).toFile(path.join(OUT, 'splash.png'))
// notification: the mark's shape only — any pixel with ink becomes solid white, the rest stays clear.
{
  const m = await sharp(await (await canvas(96, 96, 74, null)).png().toBuffer()).raw().toBuffer({ resolveWithObject: true })
  const { data, info } = m
  for (let i = 0; i < data.length; i += 4) { const on = data[i + 3] > 40; data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = on ? 255 : 0 }
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png({ compressionLevel: 9 }).toFile(path.join(OUT, 'notification-icon.png'))
}
console.log('wrote icon.png, adaptive-icon.png, splash.png, notification-icon.png')
