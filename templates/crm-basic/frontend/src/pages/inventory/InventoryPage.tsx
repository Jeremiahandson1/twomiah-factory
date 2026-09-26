// InventoryPage — shared implementation (packages/tenant-ui/src/inventory), vendored as ../../shared. Wrapper only.
import { InventoryPage } from '../../shared'
import api from '../../services/api'

export default function InventoryPageWrapper() {
  return <InventoryPage api={api as any} />
}
