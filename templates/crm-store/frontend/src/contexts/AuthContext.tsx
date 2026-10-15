import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import api, { User } from '../services/api'

/**
 * `permissions` — what this person may do, as the server answered it on /login and /me.
 *
 * Every store screen decided on `role === 'owner'`, which is why the store could only ever have an
 * owner and everybody else. The shared PermissionsProvider reads exactly `{ user, permissions }`, so
 * App.tsx mounts it with these and `useMayWrite` / `usePermissions` answer on every screen.
 */
type AuthValue = {
  user: User | null
  permissions: string[] | null
  /** Why the store is locked, or null — from /me (10/14). */
  accountLock: string | null
  storeName: string | null
  loading: boolean
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [permissions, setPermissions] = useState<string[] | null>(null)
  const [accountLock, setAccountLock] = useState<string | null>(null)
  const [storeName, setStoreName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!api.hasToken) { setLoading(false); return }
    api.getMe()
      .then((s) => { setUser(s.user); setPermissions(s.permissions); setAccountLock(s.accountLock ?? null); setStoreName(s.storeName ?? null) })
      .catch((err) => {
        const e = err as { status?: number; isTransient?: boolean }
        const isTransient = e?.isTransient === true || e?.status === 0 || (typeof e?.status === 'number' && e.status >= 500)
        // A stall/timeout is the server being unreachable, not the session being
        // invalid — keep the token so a retry recovers instead of forcing login.
        if (isTransient) console.warn('Auth check transient failure — session preserved:', err)
        else api.clearTokens()
      })
      .finally(() => setLoading(false))
  }, [])

  const login = async (email: string, password: string) => {
    const s = await api.login(email, password)
    setUser(s.user)
    setPermissions(s.permissions)
  }
  // Signing out always signs out here, even when the server call fails (a session already ended elsewhere): a refused
  // logout used to throw before the state was cleared, and the Sign out button did nothing. (E2E Run 2, 10/15)
  const logout = async () => {
    try { await api.logout() } catch { /* the tokens are cleared either way */ } finally {
      setUser(null)
      setPermissions(null)
      setAccountLock(null)
      setStoreName(null)
    }
  }

  return (
    <AuthContext.Provider value={{ user, permissions, accountLock, storeName, loading, isAuthenticated: !!user, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
