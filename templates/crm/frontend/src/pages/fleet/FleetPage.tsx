// FleetPage — shared implementation (packages/tenant-ui/src/fleet), vendored as ../../shared. Wrapper only.
import { FleetPage } from '../../shared'
import api from '../../services/api'
import { fleetConfig } from '../../fleetConfig'

export default function FleetPageWrapper() {
  return <FleetPage api={api as any} config={fleetConfig} />
}
