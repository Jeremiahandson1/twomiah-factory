import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

type User = { userId: string; email: string; role: string; companyId: string }
type Company = { id: string; name: string; enabledFeatures: string[]; settings: any }
type AuthState = { user: User | null; company: Company | null; token: string | null; login: (email: string, password: string) => Promise<void>; logout: () => void }

const AuthContext = createContext<AuthState>(null as any)
export const useAuth = () => useContext(AuthContext)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'))
  const [user, setUser] = useState<User | null>(null)
  const [company, setCompany] = useState<Company | null>(null)

  useEffect(() => {
    if (token) fetchMe()
  }, [token])

  async function fetchMe() {
    try {
      const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) { logout(); return }
      const data = await res.json()
      setUser(data.user)
      setCompany(data.company)
    } catch { logout() }
  }

  async function login(email: string, password: string) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Login failed') }
    const data = await res.json()
    localStorage.setItem('token', data.accessToken)
    localStorage.setItem('refreshToken', data.refreshToken)
    setToken(data.accessToken)
  }

  function logout() {
    localStorage.removeItem('token')
    localStorage.removeItem('refreshToken')
    setToken(null)
    setUser(null)
    setCompany(null)
  }

  return <AuthContext.Provider value={{ user, company, token, login, logout }}>{children}</AuthContext.Provider>
}
