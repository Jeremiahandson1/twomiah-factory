// Draft and live: how the website's editor keeps the owner's changes off the public site until they publish them (owner
// 2026-10-23: "I would think it would change in real time as I change things, and if I like it I would click save and
// then publish. But it only changes when I click save, and it says published.") — the way Wix, Squarespace, Webflow and
// Shopify's theme editor do it:
//
//   • Each record the site shows — a page, a blog post, a piece of portfolio work, the site's settings — keeps its LIVE
//     version in the columns it always had, and the owner's saved, unpublished changes in its `draft` column: the whole
//     editable set, or null when what is saved is what is live.
//   • Saving writes the draft. Publish copies the draft over the live columns, in one statement. Discard empties it.
//   • The public site, its menu, the sitemap, llms.txt and the search tags read only the live columns, so nothing a
//     visitor sees changes until Publish.
//   • Whether visitors can open a page or a post at all (page.isPublished, post/portfolio status) is NOT part of the draft:
//     it is its own switch, "Show on site", and takes effect when it is flipped.
//   • The editor's preview renders the draft through the site's own routes (site/preview.ts): this module's scope tells
//     those routes which record to read from the preview instead of the database.
import { AsyncLocalStorage } from 'node:async_hooks'

/** What a page's draft holds: everything the page editor edits except whether the page is shown. */
export const PAGE_DRAFT = ['title', 'sections', 'metaTitle', 'metaDescription'] as const
/** A blog post's words and pictures. */
export const POST_DRAFT = ['title', 'excerpt', 'body', 'coverImageUrl', 'metaTitle', 'metaDescription'] as const
/** A piece of portfolio work's words and photos (its order in the list, sortOrder, is a list action and stays live). */
export const PORTFOLIO_DRAFT = ['title', 'location', 'summary', 'body', 'coverImageUrl', 'photos', 'metaTitle', 'metaDescription'] as const
/**
 * The website's settings the public site shows: its look, words, menu, places, search defaults and tracking. The
 * "Finish your site" checklist (contentGaps) is the owner's to-do list, not something visitors see, and stays live.
 */
export const SETTINGS_DRAFT = [
  'design', 'accentColor', 'faviconUrl', 'tagline', 'contactCtaLabel', 'serviceAreas', 'inventoryFeedUrl', 'nav',
  'seoTitle', 'seoDescription', 'googleTagManagerId', 'googleAnalyticsId', 'googleAdsId', 'facebookPixelId', 'microsoftClarityId',
] as const

export type DraftFields = readonly string[]
export type Draft = Record<string, unknown> & { savedAt?: string }

const pickFields = (src: any, fields: DraftFields) => {
  const out: Record<string, unknown> = {}
  for (const k of fields) out[k] = src?.[k] ?? null
  return out
}
const same = (a: Record<string, unknown>, b: Record<string, unknown>, fields: DraftFields) =>
  fields.every((k) => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null))

/** A stored draft as an object, or null (json columns can come back as text from a moved database). */
export function draftOf(row: any): Draft | null {
  let d = row?.draft
  if (typeof d === 'string') { try { d = JSON.parse(d) } catch { d = null } }
  return d && typeof d === 'object' && !Array.isArray(d) ? (d as Draft) : null
}

/** The live version of the editable fields. */
export const liveOf = (row: any, fields: DraftFields) => pickFields(row, fields)

/** What the editor works on: the saved draft where there is one, else the live version. */
export function workingOf(row: any, fields: DraftFields): Record<string, unknown> {
  const d = draftOf(row)
  return d ? { ...liveOf(row, fields), ...pickFields(d, fields.filter((k) => k in d)) } : liveOf(row, fields)
}

/**
 * The draft after a save: the working copy with `patch` over it — or null when that is exactly the live version (a
 * change typed and then typed back is no unpublished change).
 */
export function nextDraft(row: any, fields: DraftFields, patch: Record<string, unknown>, now = new Date()): Draft | null {
  const merged = { ...workingOf(row, fields), ...pickFields(patch, fields.filter((k) => k in patch)) }
  return same(merged, liveOf(row, fields), fields) ? null : { ...merged, savedAt: now.toISOString() }
}

/** The row as the editor reads it: live columns, the draft (or null) and whether there are unpublished changes. */
export function withDraft<T extends Record<string, any>>(row: T): T & { draft: Draft | null; hasDraft: boolean } {
  const draft = draftOf(row)
  return { ...row, draft, hasDraft: !!draft }
}

// ── The preview ─────────────────────────────────────────────────────────────

/** What one preview render reads instead of the database: one record's draft, or the site's draft settings. */
export interface PreviewOverlay {
  page?: { slug: string; data: Record<string, unknown> }
  post?: { slug: string; data: Record<string, unknown> }
  portfolio?: { slug: string; data: Record<string, unknown> }
  settings?: Record<string, unknown>
}

export const previewScope = new AsyncLocalStorage<PreviewOverlay>()

/** The overlay of the preview being rendered, or null on any real visit. */
export const previewing = (): PreviewOverlay | null => previewScope.getStore() ?? null

/**
 * A row as the preview shows it: the draft over the live row, and shown — a page the owner has hidden still previews,
 * as a post never published does. Any other record, and every real visit, gets the row unchanged.
 */
export function previewRow<T>(kind: 'page' | 'post' | 'portfolio', slug: string, row: T): T {
  const o = previewing()?.[kind]
  if (!o || o.slug !== slug || !row) return row
  const shown = kind === 'page' ? { isPublished: true } : { status: 'published', publishedAt: (row as any).publishedAt ?? new Date() }
  return { ...row, ...o.data, ...shown }
}
