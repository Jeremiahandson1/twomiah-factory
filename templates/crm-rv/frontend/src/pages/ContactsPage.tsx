// ContactsPage — shared implementation in packages/tenant-ui/src/contacts, vendored as ../shared.
// This wrapper only hands the shared page this template's api client, toast, feature flags and config.
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { ContactsPage as SharedContactsPage } from '../shared';
import { CONTACTS } from '../contactsConfig';

export default function ContactsPage() {
  const toast = useToast();
  const { hasFeature } = useAuth();
  return <SharedContactsPage api={api as any} toast={toast} config={{ ...CONTACTS, hasFeature }} />;
}
