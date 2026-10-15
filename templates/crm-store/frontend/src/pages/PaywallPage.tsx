// The lock page. ONE implementation for every CRM: packages/tenant-ui/src/auth/PaywallScreen.tsx — its words follow WHY
// the store is locked, and the owner restarts it by paying. This file hands it the store's name, its lock (from /me —
// the store has no company row), sign-out and the API client; the store's screens live at /, not /crm. (10/14)
import { PaywallScreen } from '../shared'
import { useAuth } from '../contexts/AuthContext'
import api from '../services/api'

export default function PaywallPage() {
  const { storeName, accountLock, logout } = useAuth()
  return (
    <PaywallScreen
      company={{ name: storeName, settings: { accountLock } }}
      request={(method, path) => api.call(method, path)}
      homePath="/"
      onSignOut={() => { void logout().finally(() => location.assign('/login')) }}
    />
  )
}
