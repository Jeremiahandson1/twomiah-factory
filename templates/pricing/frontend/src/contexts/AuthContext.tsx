import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { api } from '../services/api'

export interface RepProfile {
  id: string
  name: string
  email: string
  phone?: string
  avatar?: string
  territory?: string
  commissionRate: number
}

export interface Company {
  id: string
  name: string
  logo?: string
  primaryColor?: string
}

export interface User {
  id: string
  email: string
  name: string
  role: 'admin' | 'manager' | 'rep'
  repProfile?: RepProfile
}

interface AuthContextType {
  user: User | null
  company: Company | null
  isLoading: boolean
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [company, setCompany] = useState<Company | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const isAuthenticated = !!user

  const fetchMe = useCallback(async () => {
    try {
      const data = await api.get<{ user: User; company: Company }>('/api/auth/me')
      setUser(data.user)
      setCompany(data.company)
    } catch {
      api.setToken(null)
      setUser(null)
      setCompany(null)
    }
  }, [])

  useEffect(() => {
    const token = api.getToken()
    if (token) {
      fetchMe().finally(() => setIsLoading(false))
    } else {
      setIsLoading(false)
    }
  }, [fetchMe])

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.post<{ token: string; user: User; company: Company }>(
      '/api/auth/login',
      { email, password }
    )
    api.setToken(data.token)
    setUser(data.user)
    setCompany(data.company)
  }, [])

  const logout = useCallback(() => {
    api.setToken(null)
    setUser(null)
    setCompany(null)
    window.location.href = '/login'
  }, [])

  return (
    <AuthContext.Provider
      value={{ user, company, isLoading, isAuthenticated, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
