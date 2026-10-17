// InventoryPage — shared implementation (packages/tenant-ui/src/inventory), vendored as ../../shared. Wrapper only.
import { InventoryPage } from '../../shared'
import api from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'

export default function InventoryPageWrapper() {
  // hasFeature: with multi_location on, a warehouse or truck can belong to a branch
  const { hasFeature } = useAuth()
  return <InventoryPage api={api as any} hasFeature={hasFeature} />
}
