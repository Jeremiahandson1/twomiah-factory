import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import api, { User } from '../services/api'

type AuthValue = {
  user: User | null
  loading: boolean
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!api.hasToken) { setLoading(false); return }
    api.getMe()
      .then(setUser)
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
    const u = await api.login(email, password)
    setUser(u)
  }
  const logout = async () => {
    await api.logout()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, isAuthenticated: !!user, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
