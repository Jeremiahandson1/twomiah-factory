// Route guards — one implementation for every CRM.
//   ProtectedRoute: signed-in only (+ optional role list), hard-locks an expired trial onto /crm/paywall.
//   PublicRoute:    signed-out only; a signed-in visitor is sent back where they came from.
import React, { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { isTrialExpired, isTrialBypassPath } from './trialStatus'

/** Hook-based <Navigate>: react-router's JSX components do not type-check from the vendored package. */
function Redirect({ to, state }: { to: string; state?: unknown }) {
  const navigate = useNavigate()
  useEffect(() => { navigate(to, { replace: true, state }) }, [navigate, to, state])
  return null
}

function Spinner({ label }: { label?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-slate-800">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        {label && <p className="text-gray-600 dark:text-slate-400">{label}</p>}
      </div>
    </div>
  )
}

export function ProtectedRoute({ children, requiredRole }: { children: React.ReactNode; requiredRole?: string | string[] }) {
  const { isAuthenticated, loading, user, company } = useAuth()
  const location = useLocation()

  if (loading) return <Spinner label="Loading..." />
  if (!isAuthenticated) return <Redirect to="/login" state={{ from: location }} />

  // Hard-lock on trial expiry — redirect to the paywall for every route except the upgrade path,
  // the paywall itself, and logout.
  if (isTrialExpired(company) && !isTrialBypassPath(location.pathname)) return <Redirect to="/crm/paywall" />

  if (requiredRole) {
    const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole]
    if (!roles.includes(user?.role ?? '')) return <Redirect to="/" />
  }
  return <>{children}</>
}

export function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth()
  const location = useLocation()

  if (loading) return <Spinner />
  if (isAuthenticated) {
    const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/'
    return <Redirect to={from} />
  }
  return <>{children}</>
}
