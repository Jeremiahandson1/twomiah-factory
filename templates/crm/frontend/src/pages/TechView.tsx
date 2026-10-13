// TechView — shared implementation (packages/tenant-ui/src/tech), vendored as ../shared. Wrapper only.
import { TechView } from '../shared'
import api from '../services/api'
import { useToast } from '../contexts/ToastContext'
import { useAuth } from '../contexts/AuthContext'

// a contractor's end-of-visit checks. Saved by /api/tech/:id/checklist against this CRM's own form template.
const CHECKLIST = {
  title: 'Site checklist',
  subtitle: 'Protection, the work, safety, clean-up and the walkthrough',
  items: [
    { id: 'site_protected', label: 'Floors, furniture and fixtures protected' },
    { id: 'work_matches_scope', label: 'Work matches the plan or quote' },
    { id: 'safety', label: 'Hazards cleared, tools put away' },
    { id: 'cleanup', label: 'Debris removed and site cleaned' },
    { id: 'walkthrough', label: 'Walkthrough done with the customer' },
    { id: 'photos', label: 'Before and after photos taken' },
  ],
}

export default function TechViewWrapper() {
  const toast = useToast()
  const { hasFeature } = useAuth()
  return <TechView api={api as any} toast={toast} config={{ hasFeature, title: 'My Jobs', checklist: CHECKLIST }} />
}
