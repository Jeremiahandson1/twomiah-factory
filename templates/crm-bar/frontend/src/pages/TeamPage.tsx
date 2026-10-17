// TeamPage — shared implementation (packages/tenant-ui/src/people), vendored into this tenant as ../shared. Wrapper only.
import { TeamPage } from '../shared'
import api from '../services/api'
import { useToast } from '../contexts/ToastContext'
import { useAuth } from '../contexts/AuthContext'
import { teamConfig } from '../peopleConfig'

export default function TeamPageWrapper() {
  const toast = useToast()
  const { hasFeature } = useAuth()
  return <TeamPage api={api as any} toast={toast} config={{ ...teamConfig, hasFeature }} />
}
