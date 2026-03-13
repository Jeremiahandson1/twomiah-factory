import { ShieldX } from 'lucide-react'
import { useUser, type UserRole } from '../contexts/UserContext'

interface RequireRoleProps {
  allowed: UserRole[]
  children: React.ReactNode
}

export default function RequireRole({ allowed, children }: RequireRoleProps) {
  const { user, loading, hasRole } = useUser()

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 p-12">
        Loading...
      </div>
    )
  }

  if (!user || !hasRole(...allowed)) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 p-12 gap-4">
        <ShieldX size={48} className="text-gray-600" />
        <h2 className="text-xl font-semibold text-white">You don't have permission</h2>
        <p className="text-sm text-gray-500">
          This page requires one of the following roles: {allowed.join(', ')}.
          <br />
          Your current role is <span className="text-gray-300 font-medium">{user?.role || 'unknown'}</span>.
        </p>
      </div>
    )
  }

  return <>{children}</>
}
