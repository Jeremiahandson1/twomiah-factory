// Shared Documents page — the contract between a template and the vendored page.
import type { InvoicingApi, InvoicingToast } from '../invoicing/types'

export type FilesApi = InvoicingApi & { baseUrl?: string }
export type FilesToast = InvoicingToast

export interface DocumentsConfig {
  /** Vertical has projects: project filter + picker. Default false. */
  projects?: boolean
  /** Document types offered in the picker/filter (snake_case ok; rendered with spaces). */
  types?: string[]
  /** Plan markup (annotation layers) — construction only. Default false. */
  markup?: boolean
  /** Version history. Default true (every template has the table). */
  versions?: boolean
  /** Feature flag check from the template's auth context (used for the projects picker). */
  hasFeature?: (id: string) => boolean
}

export interface DocumentsPageProps { api: FilesApi; toast: FilesToast; config?: DocumentsConfig }

export const DEFAULT_DOCUMENT_TYPES = ['general', 'contract', 'permit', 'drawing', 'photo', 'invoice', 'receipt', 'other']
export const defaultDocumentsConfig: Required<Omit<DocumentsConfig, 'hasFeature'>> = { projects: false, types: DEFAULT_DOCUMENT_TYPES, markup: false, versions: true }
export const resolveDocumentsConfig = (c?: DocumentsConfig) => ({ ...defaultDocumentsConfig, ...(c || {}) })

export interface DocumentRow {
  id: string
  name: string
  type: string
  originalName?: string | null
  mimeType?: string | null
  size?: number | null
  url: string
  thumbnailUrl?: string | null
  description?: string | null
  createdAt: string
  project?: { id: string; name: string } | null
  contact?: { id: string; name: string } | null
  uploadedBy?: { id: string; firstName?: string | null; lastName?: string | null } | null
}
