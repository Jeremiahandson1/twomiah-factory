// A report's PDF bytes, for the two doors that serve one (the office and the private link) and the homeowner's portal.
// Only the files the report itself shows may be read from the store: its photos and the company's logo.
import { renderReportPdf } from './render.ts'
import type { ReportView } from './view.ts'

const MEDIA_PREFIX = '/media/'

export const readerFor = (storage: any, view: ReportView) => {
  const allowed = new Set<string>([...view.sections.flatMap((s) => s.photos.map((p) => p.url)), ...(view.brand.logo ? [view.brand.logo] : [])])
  return async (url: string): Promise<Buffer | null> => {
    if (!allowed.has(url) || !url.startsWith(MEDIA_PREFIX) || url.includes('..')) return null
    try {
      const obj = await storage.getObject(url.slice(MEDIA_PREFIX.length))
      return obj && String(obj.contentType || '').startsWith('image/') ? Buffer.from(obj.body) : null
    } catch { return null }
  }
}

export const reportPdf = (storage: any, view: ReportView): Promise<Buffer> => renderReportPdf(view, readerFor(storage, view))

/** The file name a downloaded report carries. */
export const reportFileName = (jobNumber: string) => `inspection-report-${String(jobNumber || 'job').replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`
