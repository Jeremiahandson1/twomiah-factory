// Portal session: loads /api/portal/p/:token once and hands every page a scoped fetch.
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import type { PortalBackendSections, PortalConfig, PortalRole, ResolvedPortalConfig } from './types'
import { resolvePortalConfig, roleFor } from './types'

export const API_URL: string = ((import.meta as any).env && (import.meta as any).env.VITE_API_URL) || ''

export interface PortalContactInfo { name: string; email?: string | null; type?: string | null }
export interface PortalCompanyInfo { name: string; logo?: string | null; primaryColor?: string | null; email?: string | null; phone?: string | null }
export interface PortalSummary { activeProjects: number; pendingQuotes: number; totalInvoices: number; outstandingBalance: number }

export interface PortalContextValue {
  token: string | undefined
  contact: PortalContactInfo | undefined
  contactType: string
  role: PortalRole
  company: PortalCompanyInfo | undefined
  summary: PortalSummary | undefined
  sections: PortalBackendSections
  config: ResolvedPortalConfig
  loading: boolean
  error: string | null
  fetch: (endpoint: string, options?: RequestInit) => Promise<any>
  refresh: () => Promise<void>
  /** Absolute URL for a customer-side endpoint (downloads open in a new tab). */
  url: (endpoint: string) => string
}

const PortalContext = createContext<PortalContextValue | null>(null)

async function readError(response: Response, fallback: string): Promise<string> {
  try { const body = await response.json(); return body?.error || fallback } catch { return fallback }
}

export function PortalProvider({ config, children }: { config?: PortalConfig; children: React.ReactNode }) {
  const { token } = useParams()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const resolved = React.useMemo(() => resolvePortalConfig(config), [config])

  const load = useCallback(async () => {
    if (!token) { setLoading(false); setError('Invalid portal link'); return }
    try {
      const response = await fetch(`${API_URL}/api/portal/p/${token}`)
      if (!response.ok) throw new Error(await readError(response, 'Failed to load portal'))
      setData(await response.json())
      setError(null)
    } catch (err) {
      setError((err as Error).message)
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  const portalFetch = useCallback(async (endpoint: string, options: RequestInit = {}) => {
    const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData
    const response = await fetch(`${API_URL}/api/portal/p/${token}${endpoint}`, {
      ...options,
      headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...(options.headers || {}) },
    })
    if (!response.ok) throw new Error(await readError(response, 'Request failed'))
    if (response.status === 204) return null
    return response.json()
  }, [token])

  const url = useCallback((endpoint: string) => `${API_URL}/api/portal/p/${token}${endpoint}`, [token])

  const contact = data?.contact as PortalContactInfo | undefined
  const contactType = (contact?.type as string) || 'client'
  const value: PortalContextValue = {
    token, contact, contactType, role: roleFor(contactType),
    company: data?.company, summary: data?.summary, sections: (data?.sections as PortalBackendSections) || {},
    config: resolved, loading, error, fetch: portalFetch, refresh: load, url,
  }
  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>
}

export function usePortal(): PortalContextValue {
  const context = useContext(PortalContext)
  if (!context) throw new Error('usePortal must be used within PortalProvider')
  return context
}
