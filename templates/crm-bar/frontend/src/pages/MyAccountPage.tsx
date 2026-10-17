// MyAccountPage — shared implementation (packages/tenant-ui/src/account), vendored into this tenant as ../shared. Wrapper only.
// Two-factor and your own password, for EVERY role: they lived only on the admin-only Settings page. (T60)
import { MyAccountPage } from '../shared'
import api from '../services/api'
import { useToast } from '../contexts/ToastContext'

export default function MyAccountPageWrapper() {
  const toast = useToast()
  return <MyAccountPage api={api as any} toast={toast} />
}
