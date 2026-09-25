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
  updateUser: (updates: Partial<AuthUser>) => void
  hasFeature: (featureId: string) => boolean
  /**
   * Everything this person may do, exactly as /api/auth/me answered it: the role's list plus the grants an
   * owner handed them by name. `null` until /me lands — which is not the same as "nothing", and callers
   * have to tell the two apart. (Field Service T30 M-R1)
   */
  permissions: string[] | null
  /**
   * May this person do that? Reads the list above with the server's own rules: `*` allows everything,
   * `invoices:*` allows `invoices:read`.
   *
   * It answers FALSE while the list is unknown, which is deliberate and matches hasFeature(): a hard load
   * shows the menu a moment late rather than flashing up a page the API will refuse. What it must never do
   * is decide a ROUTE before /me lands — that was roof M7, where fifteen owned routes redirected because
   * the answer had not arrived yet. Gate routes behind `company` being present, as AppShell does.
   */
  can: (permission: string) => boolean
  getToken: () => string | null
}

/**
 * The server's matching rule, shared so the screen and the API cannot drift apart: an exact hit, the
 * resource wildcard, or `*`. Deliberately NOT a copy of the role → permission matrix — that lived in eight
 * template PermissionsContexts, went stale in all of them, and is the reason this exists. The list is the
 * server's answer; this only reads it.
 */
export const permissionAllows = (list: string[] | null | undefined, permission: string): boolean => {
  if (!list || !permission) return false
  if (list.includes('*') || list.includes(permission)) return true
  const [resource] = permission.split(':')
  return list.includes(`${resource}:*`)
}

/** Client-side mirror of the backend rule: 8+ characters with at least one letter and one number. */
export const PASSWORD_RULE_TEXT = 'at least 8 characters, with at least one letter and one number'
export const passwordMeetsRule = (p: string) => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p)
