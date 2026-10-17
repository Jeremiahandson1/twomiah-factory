// LocationsPage — shared implementation (packages/tenant-ui/src/locations), vendored as ../shared. Wrapper only.
import { LocationsPage } from '../shared'
import api from '../services/api'
import { useToast } from '../contexts/ToastContext'

export default function LocationsPageWrapper() {
  const toast = useToast()
  return <LocationsPage api={api as any} toast={toast} />
}
