// TechView — shared implementation (packages/tenant-ui/src/tech), vendored as ../../shared. Wrapper only.
import { TechView } from '../../shared'
import api from '../../services/api'
import { useToast } from '../../contexts/ToastContext'
import { useAuth } from '../../contexts/AuthContext'

// a crew's end-of-visit checks — this CRM shipped the HVAC list unchanged. Saved by /api/tech/:id/checklist against this CRM's own form template.
const CHECKLIST = {
  title: 'Property checklist',
  subtitle: 'Gates, edges, hard surfaces, irrigation and debris',
  items: [
    { id: 'gates', label: 'Gates closed and pets secured' },
    { id: 'edges', label: 'Edges and trim done' },
    { id: 'hard_surfaces', label: 'Clippings cleared from drives and paths' },
    { id: 'irrigation', label: 'Irrigation heads checked' },
    { id: 'debris', label: 'Debris hauled or bagged' },
    { id: 'photos', label: 'Before and after photos taken' },
  ],
}

export default function TechViewWrapper() {
  const toast = useToast()
  const { hasFeature } = useAuth()
  return <TechView api={api as any} toast={toast} config={{ hasFeature, title: 'My Visits', checklist: CHECKLIST }} />
}
