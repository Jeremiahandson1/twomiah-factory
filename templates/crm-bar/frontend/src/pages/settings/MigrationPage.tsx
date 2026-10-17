// MigrationPage — shared implementation (packages/tenant-ui/src), vendored into this tenant as ../shared. Wrapper only.
import { MigrationPage } from '../../shared'
import api from '../../services/api'
import { migrationConfig } from '../../integrationsConfig'

export default function MigrationPageWrapper() {
  return <MigrationPage api={api as any} config={migrationConfig} />
}
