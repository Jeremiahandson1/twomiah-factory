import 'hono'

// The authenticated tenant-staff user attached by the auth middleware.
declare module 'hono' {
  interface ContextVariableMap {
    user: { userId: string; email: string; role: string }
  }
}
