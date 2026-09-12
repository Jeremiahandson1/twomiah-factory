// QuoteDetailPage — shared implementation in packages/tenant-ui/src/invoicing, vendored as ../../shared.
// This wrapper only hands the shared page this template's api client, toast, company settings and vertical config.
import api from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { QuoteDetailPage as SharedQuoteDetailPage } from '../../shared';
import { INVOICING } from '../../invoicingConfig';

export default function QuoteDetailPage() {
  const toast = useToast();
  const { company } = useAuth();
  return <SharedQuoteDetailPage api={api as any} toast={toast} settings={(company as any)?.settings} config={INVOICING} />;
}
