// CommissionsPage — shared implementation (packages/tenant-ui/src/commissions), vendored as ../shared. Wrapper only.
import { CommissionsPage } from '../shared'
import api from '../services/api'
import { useToast } from '../contexts/ToastContext'

// The four stored keys in this CRM's words — a contractor's words: crews in the field, sales reps who sell the jobs.
const ROLE_WORDS: Record<string, string> = {
  technician: 'Crew',
  sales_rep: 'Sales',
  manager: 'Project managers',
  all: 'Everyone'
}

export default function CommissionsPageWrapper() {
  const toast = useToast()
  return <CommissionsPage api={api as any} toast={toast} config={{ roleWords: ROLE_WORDS, planExample: 'Standard sales plan' }} />
}
