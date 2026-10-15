import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { loadTokens, saveTokens, saveApiUrl, clearTokens, getApiUrl, post, get } from '../api/client'

/** The last signed-in profile, so the app opens without a connection (tokens stay in SecureStore). */
const PROFILE_KEY = 'twomiah_session_profile_v1'

/**
 * The user from a login or /api/auth/me answer. Most CRM templates send { user, company }; the home
 * care backend's /me sends the user's fields at the top level beside `company` — which read as "no
 * user" and signed every caregiver out each time the app was reopened.
 */
function userOf(data: any): User | null {
  if (!data || typeof data !== 'object') return null
  if (data.user && typeof data.user === 'object' && data.user.id) return data.user
  if (data.id && data.email) {
    const { company: _c, profile: _p, ...u } = data
    return u as User
  }
  return null
}

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
  vertical?: 'contractor' | 'fieldservice' | 'homecare' | 'roofing' | 'landscaping' | 'dispensary' | 'rv'
  settings?: Record<string, any>
  phone?: string | null
  email?: string | null
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

  const apply = useCallback(async (data: any) => {
    const u = userOf(data)
    setUser(u)
    setCompany(data?.company || null)
    if (u) await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify({ user: u, company: data?.company || null })).catch(() => {})
  }, [])

  // Try to restore session on mount
  useEffect(() => {
    ;(async () => {
      try {
        await loadTokens()
        if (getApiUrl()) {
          const res = await get('/api/auth/me').catch(() => ({ ok: false, status: 0, data: null } as any))
          if (res.ok && userOf(res.data)) {
            await apply(res.data)
          } else if (res.status === 401 || res.status === 403) {
            await clearTokens()
          } else {
            // No connection (or a server blip) — not a sign-out. Open with the last profile so a
            // caregiver at a client's house with no signal can still clock in; the API calls
            // themselves still need the saved tokens.
            const saved = await AsyncStorage.getItem(PROFILE_KEY).catch(() => null)
            const p = saved ? JSON.parse(saved) : null
            if (p?.user) { setUser(p.user); setCompany(p.company || null) }
          }
        }
      } finally {
        setIsLoading(false)
      }
    })()
  }, [apply])

  const login = useCallback(async (serverUrl: string, email: string, password: string) => {
    await saveApiUrl(serverUrl)
    const res = await post('/api/auth/login', { email, password }).catch(() => ({ ok: false, error: 'No connection — check your signal and the server address.' } as any))
    if (!res.ok) {
      return { ok: false, error: res.error || 'Login failed' }
    }
    await saveTokens(res.data.accessToken, res.data.refreshToken)
    await apply(res.data)
    return { ok: true }
  }, [apply])

  const logout = useCallback(async () => {
    await post('/api/auth/logout').catch(() => {})
    await clearTokens()
    await AsyncStorage.removeItem(PROFILE_KEY).catch(() => {})
    setUser(null)
    setCompany(null)
  }, [])

  const refresh = useCallback(async () => {
    const res = await get('/api/auth/me').catch(() => ({ ok: false } as any))
    if (res.ok && userOf(res.data)) await apply(res.data)
  }, [apply])

  return (
    <AuthContext.Provider value={{ user, company, isAuthenticated: !!user, isLoading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
