// DocumentsPage — shared implementation in packages/tenant-ui/src/files, vendored as ../shared.
// This wrapper only hands the shared page this template's api client, toast, feature flags and config.
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { DocumentsPage as SharedDocumentsPage } from '../shared';
import { DOCUMENTS } from '../docsConfig';

export default function DocumentsPage() {
  const toast = useToast();
  const { hasFeature } = useAuth();
  return <SharedDocumentsPage api={api as any} toast={toast} config={{ ...DOCUMENTS, hasFeature }} />;
}
