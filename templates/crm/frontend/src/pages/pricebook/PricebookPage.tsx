// PricebookPage — shared implementation (packages/tenant-ui/src/pricebook), vendored into this tenant as ../../shared. Wrapper only.
import { PricebookPage } from '../../shared'
import api from '../../services/api'
import { useToast } from '../../contexts/ToastContext'
import { pricebookConfig } from '../../pricebookConfig'

export default function PricebookPageWrapper() {
  const toast = useToast()
  return <PricebookPage api={api as any} toast={toast} config={pricebookConfig} />
}
