// TechView — shared implementation (packages/tenant-ui/src/tech), vendored as ../../shared. Wrapper only.
import { TechView } from '../../shared'
import api from '../../services/api'
import { useToast } from '../../contexts/ToastContext'
import { useAuth } from '../../contexts/AuthContext'

// one list for every trade this CRM serves (HVAC, plumbing, electrical, cleaning, pest) — it was HVAC-only. Saved by /api/tech/:id/checklist against this CRM's own form template.
const CHECKLIST = {
  title: 'Service checklist',
  subtitle: 'The problem, the fix, safety, clean-up and the customer',
  items: [
    { id: 'problem_confirmed', label: 'Problem confirmed with the customer' },
    { id: 'work_done', label: 'Work completed as agreed' },
    { id: 'tested', label: 'Tested and working' },
    { id: 'safety', label: 'Area left safe' },
    { id: 'cleanup', label: 'Work area cleaned up' },
    { id: 'customer_walkthrough', label: 'Customer shown what was done' },
  ],
}

export default function TechViewWrapper() {
  const toast = useToast()
  const { hasFeature } = useAuth()
  return <TechView api={api as any} toast={toast} config={{ hasFeature, title: 'My Jobs', checklist: CHECKLIST }} />
}
