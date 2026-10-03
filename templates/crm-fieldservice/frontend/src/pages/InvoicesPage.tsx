// InvoicesPage — shared implementation in packages/tenant-ui/src/invoicing, vendored as ../shared.
// This wrapper only hands the shared page this template's api client, toast, company settings and vertical config.
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { InvoicesPage as SharedInvoicesPage } from '../shared';
import { INVOICING } from '../invoicingConfig';

export default function InvoicesPage() {
  const toast = useToast();
  const { company } = useAuth();
  /**
   * `can` threaded in, the same as on QuotesPage. InvoicingConfig's own comment calls this out as
   * "T30 debt: the QuickBooks sync button" — the hook existed, nothing passed it, so `cfg.can` was
   * always undefined and the controls it guards were shown to everyone. (T41)
   */
  const { can } = usePermissions();
  return (
    <SharedInvoicesPage
      api={api as any}
      toast={toast}
      settings={(company as any)?.settings}
      config={{ ...INVOICING, can }}
    />
  );
}
