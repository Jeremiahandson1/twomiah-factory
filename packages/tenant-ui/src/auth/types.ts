// Shared auth — the contract between a template and the vendored provider / pages / route guards.

export interface AuthUser {
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
  avatar?: string | null
  phone?: string | null
}

export interface AuthCompany {
  id: string
  name: string
  slug: string
  logo?: string | null
  primaryColor?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  website?: string | null
  enabledFeatures: string[]
  settings?: Record<string, any> | null
  createdAt?: string | null
  visionUrl?: string | null
  vertical?: string
}

export interface AuthData {
  user: AuthUser
  company: AuthCompany
  accessToken: string
  refreshToken: string
  permissions?: string[]
}

/** The slice of the template's api client the auth module uses. */
export interface AuthApi {
  login: (email: string, password: string) => Promise<AuthData>
  logout: () => Promise<void>
  getMe: () => Promise<any>
  forgotPassword: (email: string) => Promise<any>
  resetPassword: (token: string, password: string) => Promise<any>
  clearTokens: () => void
}

export interface AuthContextValue {
  user: AuthUser | null
  company: AuthCompany | null
  loading: boolean
  error: string | null
  isAuthenticated: boolean
  isAdmin: boolean
  isManager: boolean
  login: (email: string, password: string) => Promise<AuthData>
  logout: () => Promise<void>
  checkAuth: () => Promise<void>
  updateCompany: (updates: Partial<AuthCompany>) => void
  hasFeature: (featureId: string) => boolean
  getToken: () => string | null
}

/** Client-side mirror of the backend rule: 8+ characters with at least one letter and one number. */
export const PASSWORD_RULE_TEXT = 'at least 8 characters, with at least one letter and one number'
export const passwordMeetsRule = (p: string) => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p)
