// EquipmentPage — shared implementation (packages/tenant-ui/src/equipment), vendored as ../../shared. Wrapper only.
import { EquipmentPage } from '../../shared'
import api from '../../services/api'
import { equipmentConfig } from '../../equipmentConfig'

export default function EquipmentPageWrapper() {
  return <EquipmentPage api={api as any} config={equipmentConfig} />
}
