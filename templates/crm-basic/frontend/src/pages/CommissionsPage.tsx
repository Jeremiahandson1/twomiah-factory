// CommissionsPage — shared implementation (packages/tenant-ui/src/commissions), vendored as ../shared. Wrapper only.
import { CommissionsPage } from '../shared'
import api from '../services/api'
import { useToast } from '../contexts/ToastContext'

// The four stored keys in this CRM's words — this template serves showcase, foodtruck and basic — a gym, a venue and a food truck, none of which has a tech (T51).
const ROLE_WORDS: Record<string, string> = {
  technician: 'Staff',
  sales_rep: 'Sales',
  manager: 'Managers',
  all: 'Everyone'
}

export default function CommissionsPageWrapper() {
  const toast = useToast()
  return <CommissionsPage api={api as any} toast={toast} config={{ roleWords: ROLE_WORDS, planExample: 'Standard staff plan' }} />
}
