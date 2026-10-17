// WarrantiesPage — shared implementation (packages/tenant-ui/src/warranties), vendored as ../../shared. Wrapper only.
import { WarrantiesPage } from '../../shared'
import api from '../../services/api'

export default function WarrantiesPageWrapper() {
  return <WarrantiesPage api={api as any} />
}
