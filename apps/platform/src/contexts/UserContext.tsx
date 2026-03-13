import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, API_URL } from '../supabase'
import type { Session } from '@supabase/supabase-js'

export type UserRole = 'owner' | 'admin' | 'editor' | 'viewer'

interface UserProfile {
  id?: string
  email: string
  name: string
  role: UserRole
}

interface UserContextValue {
  user: UserProfile | null
  loading: boolean
  /** Check if the current user has one of the allowed roles */
  hasRole: (...roles: UserRole[]) => boolean
}

const UserContext = createContext<UserContextValue>({
  user: null,
  loading: true,
  hasRole: () => false,
})

export function useUser() {
  return useContext(UserContext)
}

export function UserProvider({ session, children }: { session: Session | null; children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!session?.access_token) {
      setUser(null)
      setLoading(false)
      return
    }

    let cancelled = false

    async function fetchProfile() {
      try {
        const res = await fetch(`${API_URL}/api/v1/factory/settings/profile`, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session!.access_token}`,
          },
        })
        const data = await res.json()
        if (!cancelled) {
          setUser({
            id: data.id,
            email: data.email || session!.user?.email || '',
            name: data.name || '',
            role: data.role || 'viewer',
          })
        }
      } catch {
        // If fetch fails, default to viewer role so the user isn't locked out entirely
        if (!cancelled) {
          setUser({
            email: session!.user?.email || '',
            name: '',
            role: 'viewer',
          })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchProfile()
    return () => { cancelled = true }
  }, [session?.access_token])

  const hasRole = (...roles: UserRole[]) => {
    if (!user) return false
    return roles.includes(user.role)
  }

  return (
    <UserContext.Provider value={{ user, loading, hasRole }}>
      {children}
    </UserContext.Provider>
  )
}
