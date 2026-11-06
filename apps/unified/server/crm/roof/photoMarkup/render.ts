// The marked copy of a photo: the original's picture, turned the way a screen shows it, with the drawing laid over it.
// The original is never touched; the copy is a new file of its own.
import sharp from 'sharp'
import { markupSvg, type MarkupShape } from './shapes.ts'

export interface MarkedPicture { bytes: Buffer; contentType: string; ext: string }

export async function renderMarked(original: Buffer, shapes: MarkupShape[]): Promise<MarkedPicture> {
  // .rotate() applies the camera's own orientation, the way every screen shows the photo, so a mark lands where it was drawn.
  const upright = await sharp(original).rotate().toBuffer({ resolveWithObject: true })
  const { width, height } = upright.info
  const layer = Buffer.from(markupSvg(shapes, width, height))
  const joined = sharp(upright.data).composite([{ input: layer, top: 0, left: 0 }])
  // A photo stays the kind of file it was (a camera's JPEG stays one); a GIF becomes a PNG.
  if (upright.info.format === 'jpeg') return { bytes: await joined.jpeg({ quality: 90 }).toBuffer(), contentType: 'image/jpeg', ext: 'jpg' }
  if (upright.info.format === 'webp') return { bytes: await joined.webp({ quality: 90 }).toBuffer(), contentType: 'image/webp', ext: 'webp' }
  return { bytes: await joined.png().toBuffer(), contentType: 'image/png', ext: 'png' }
}
