// AdsPage — shared implementation (packages/tenant-ui/src/ads), vendored into this tenant as ../../shared. Wrapper only.
import { AdsPage } from '../../shared'
import api from '../../services/api'
import { useToast } from '../../contexts/ToastContext'

export default function AdsPageWrapper() {
  const toast = useToast()
  return <AdsPage api={api as any} toast={toast} />
}
