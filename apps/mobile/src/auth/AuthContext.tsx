import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { loadTokens, saveTokens, saveApiUrl, clearTokens, getApiUrl, post, get } from '../api/client'

interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
  avatar?: string
}

interface Company {
  id: string
  name: string
  slug: string
  logo?: string
  primaryColor?: string
  enabledFeatures: string[]
}

interface AuthState {
  user: User | null
  company: Company | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (serverUrl: string, email: string, password: string) => Promise<{ ok: boolean; error?: string }>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthState>({} as AuthState)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [company, setCompany] = useState<Company | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Try to restore session on mount
  useEffect(() => {
    ;(async () => {
      await loadTokens()
      if (getApiUrl()) {
        const res = await get('/api/auth/me')
        if (res.ok) {
          setUser(res.data.user)
          setCompany(res.data.company)
        } else {
          await clearTokens()
        }
      }
      setIsLoading(false)
    })()
  }, [])

  const login = useCallback(async (serverUrl: string, email: string, password: string) => {
    await saveApiUrl(serverUrl)
    const res = await post('/api/auth/login', { email, password })
    if (!res.ok) {
      return { ok: false, error: res.error || 'Login failed' }
    }
    await saveTokens(res.data.accessToken, res.data.refreshToken)
    setUser(res.data.user)
    setCompany(res.data.company)
    return { ok: true }
  }, [])

  const logout = useCallback(async () => {
    await post('/api/auth/logout')
    await clearTokens()
    setUser(null)
    setCompany(null)
  }, [])

  const refresh = useCallback(async () => {
    const res = await get('/api/auth/me')
    if (res.ok) {
      setUser(res.data.user)
      setCompany(res.data.company)
    }
  }, [])

  return (
    <AuthContext.Provider value={{ user, company, isAuthenticated: !!user, isLoading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
