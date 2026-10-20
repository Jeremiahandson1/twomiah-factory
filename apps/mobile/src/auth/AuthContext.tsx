import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { loadTokens, clearTokens, getApiUrl, getRefreshToken, post, get } from '../api/client'
import { signInWithPassword, completeMfaSignIn, type MfaChallenge } from './signIn'

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
  /** The unified app's vertical id (apps/unified/verticals/*) — including ones with no phone screens. */
  vertical?: string
  settings?: Record<string, any>
  phone?: string | null
  email?: string | null
}

interface AuthState {
  user: User | null
  company: Company | null
  isAuthenticated: boolean
  isLoading: boolean
  /**
   * The password step. `mfa` set (ok false, no error) means the sign-in is waiting for a code: no
   * tokens were stored, and completeMfa() finishes it.
   */
  login: (serverUrl: string, email: string, password: string) => Promise<{ ok: boolean; error?: string; mfa?: MfaChallenge }>
  /**
   * The code step. `restart` means the challenge is gone (expired, spent, too many tries): go back to
   * the password. Otherwise a failure stays on the code step.
   */
  completeMfa: (challengeId: string, code: string) => Promise<{ ok: boolean; error?: string; restart?: boolean; usedRecoveryCode?: boolean }>
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
    const step = await signInWithPassword(serverUrl, email, password)
    if (step.kind === 'mfa') return { ok: false, mfa: step.challenge }
    if (step.kind === 'error') return { ok: false, error: step.error }
    await apply(step.data)
    return { ok: true }
  }, [apply])

  const completeMfa = useCallback(async (challengeId: string, code: string) => {
    const step = await completeMfaSignIn(challengeId, code)
    if (step.kind === 'signedIn') {
      await apply(step.data)
      return { ok: true, usedRecoveryCode: step.usedRecoveryCode }
    }
    return { ok: false, error: step.error, restart: step.kind === 'restart' }
  }, [apply])

  const logout = useCallback(async () => {
    // This device's refresh token: with none, the server signs the person out of EVERY device
    // (packages/tenant-backend auth.ts POST /logout).
    await post('/api/auth/logout', { refreshToken: getRefreshToken() }).catch(() => {})
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
    <AuthContext.Provider value={{ user, company, isAuthenticated: !!user, isLoading, login, completeMfa, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
