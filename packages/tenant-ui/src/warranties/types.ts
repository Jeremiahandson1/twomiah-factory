// Shared Warranties page — the contract between a template and the vendored page
// (crm, crm-fieldservice, crm-landscaping, crm-rv).
export interface WarrantiesApi {
  get: (path: string, params?: any) => Promise<any>
  post: (path: string, body?: any) => Promise<any>
  put: (path: string, body?: any) => Promise<any>
  delete: (path: string) => Promise<any>
}
/**
 * The examples in the warranty and claim forms, in the trade's own words — each vertical's settings.ts sets them
 * (screens.warranties). A contractor was shown "Plantings — one-year replacement", landscaping's example, because the
 * page had one set of words for every trade (live test 2026-10-22). Absent: the neutral defaults below.
 */
export interface WarrantiesConfig {
  namePlaceholder?: string
  categoryPlaceholder?: string
  claimTitlePlaceholder?: string
  claimLocationPlaceholder?: string
}
export const defaultWarrantiesConfig: Required<WarrantiesConfig> = {
  namePlaceholder: 'e.g., Workmanship — one year',
  categoryPlaceholder: 'e.g., workmanship',
  claimTitlePlaceholder: 'e.g., Problem with completed work',
  claimLocationPlaceholder: 'e.g., Where the problem is',
}
export const resolveWarrantiesConfig = (c?: WarrantiesConfig): Required<WarrantiesConfig> => ({
  namePlaceholder: c?.namePlaceholder || defaultWarrantiesConfig.namePlaceholder,
  categoryPlaceholder: c?.categoryPlaceholder || defaultWarrantiesConfig.categoryPlaceholder,
  claimTitlePlaceholder: c?.claimTitlePlaceholder || defaultWarrantiesConfig.claimTitlePlaceholder,
  claimLocationPlaceholder: c?.claimLocationPlaceholder || defaultWarrantiesConfig.claimLocationPlaceholder,
})
export interface WarrantiesPageProps { api: WarrantiesApi; config?: WarrantiesConfig }
