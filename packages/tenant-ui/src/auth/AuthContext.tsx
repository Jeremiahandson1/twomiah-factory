// Shared auth provider — one session model for every CRM. The template's contexts/AuthContext.tsx hands
// this its api client and re-exports useAuth so the rest of the app keeps importing from there.
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { AuthApi, AuthContextValue, AuthUser, AuthCompany, AuthData } from './types'

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ api, children }: { api: AuthApi; children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [company, setCompany] = useState<AuthCompany | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const checkAuth = useCallback(async () => {
    const token = localStorage.getItem('accessToken')
    if (!token) { setLoading(false); return }
    // Retry once on a transient failure (timeout / network / server waking up) before giving up —
    // a cold start or a brief stall must not end the session.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const data = await api.getMe() as Record<string, unknown>
        setUser(data.user as AuthUser)
        setCompany(data.company as AuthCompany)
        setError(null)
        setLoading(false)
        return
      } catch (err) {
        const status = (err as { status?: number })?.status
        const isTransient = (err as { isTransient?: boolean })?.isTransient === true || status === 0 || (typeof status === 'number' && status >= 500)
        if (isTransient) {
          console.warn(`Auth check transient failure (attempt ${attempt + 1}):`, err)
          if (attempt === 0) continue
          // Keep the token — the server is unreachable, not the session invalid.
          setError('Could not reach the server. Your session is preserved — retrying shortly.')
          setLoading(false)
          return
        }
        // A real 401 (or other auth failure): the session is genuinely invalid.
        console.error('Auth check failed (session invalid):', err)
        api.clearTokens()
        setUser(null)
        setCompany(null)
        setLoading(false)
        return
      }
    }
  }, [api])

  useEffect(() => { checkAuth() }, [checkAuth])

  // The api client dispatches auth:expired when a refresh fails; drop the session without a hard reload.
  useEffect(() => {
    const handleExpired = () => { setUser(null); setCompany(null) }
    window.addEventListener('auth:expired', handleExpired)
    return () => window.removeEventListener('auth:expired', handleExpired)
  }, [])

  const login = async (email: string, password: string): Promise<AuthData> => {
    setError(null)
    try {
      const data = await api.login(email, password)
      setUser(data.user)
      setCompany(data.company)
      return data
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
      throw err
    }
  }

  const logout = async () => {
    try { await api.logout() } finally { setUser(null); setCompany(null) }
  }

  const updateCompany = (updates: Partial<AuthCompany>) => {
    setCompany(prev => prev ? { ...prev, ...updates } : null)
  }

  const role = user?.role ?? ''
  const isAuthenticated = !!user
  // 'owner' outranks 'admin' — treat it as admin-or-higher, otherwise the account owner is locked out
  // of admin-gated UI like Settings › Features.
  const isAdmin = role === 'admin' || role === 'owner'
  const isManager = role === 'owner' || role === 'admin' || role === 'manager'
  const getToken = useCallback(() => localStorage.getItem('accessToken'), [])
  const hasFeature = (featureId: string): boolean => company?.enabledFeatures?.includes(featureId) ?? false

  return (
    <AuthContext.Provider value={{ user, company, loading, error, isAuthenticated, isAdmin, isManager, login, logout, checkAuth, updateCompany, hasFeature, getToken }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
