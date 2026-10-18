// The website's photo library (/api/site/photos), in the shape the screens use. The server's row is the app's one
// `photo` table (publicUrl, tags[]); the site's screens were written against { url, tag }, so the mapping is here once.
import { api } from '../api'

export interface Photo {
  id: string
  url: string
  alt: string | null
  tag: string | null
  width: number | null
  height: number | null
  size: number | null
  createdAt: string
}

interface PhotoRow {
  id: string
  publicUrl: string
  alt?: string | null
  tags?: unknown
  width?: number | null
  height?: number | null
  size?: number | null
  createdAt: string
}

const fromRow = (r: PhotoRow): Photo => ({
  id: r.id,
  url: r.publicUrl,
  alt: r.alt ?? null,
  tag: Array.isArray(r.tags) && typeof r.tags[0] === 'string' ? r.tags[0] : null,
  width: r.width ?? null,
  height: r.height ?? null,
  size: r.size ?? null,
  createdAt: r.createdAt,
})

export async function listPhotos(tag?: string | null): Promise<Photo[]> {
  const res: { data: PhotoRow[] } = await api.get('/api/site/photos', { tag: tag || undefined })
  return res.data.map(fromRow)
}

export async function uploadPhoto(file: File, tag?: string | null): Promise<Photo> {
  const form = new FormData()
  form.append('file', file)
  if (tag) form.append('tag', tag)
  return fromRow(await api.upload('/api/site/photos', form))
}

export async function tagPhoto(id: string, tag: string | null): Promise<void> {
  await api.patch(`/api/site/photos/${id}`, { tag })
}

export async function deletePhoto(id: string): Promise<void> {
  await api.delete(`/api/site/photos/${id}`)
}
