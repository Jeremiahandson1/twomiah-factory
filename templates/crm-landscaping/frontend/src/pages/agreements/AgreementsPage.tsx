// AgreementsPage — shared implementation (packages/tenant-ui/src/agreements), vendored as ../../shared. Wrapper only.
import { AgreementsPage } from '../../shared'
import api from '../../services/api'
import { agreementsConfig } from '../../agreementsConfig'

export default function AgreementsPageWrapper() {
  return <AgreementsPage api={api as any} config={agreementsConfig} />
}
