// SettingsPage — shared implementation in packages/tenant-ui/src/shell, vendored as ../shared.
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { SettingsPage as SharedSettingsPage } from '../shared';
import { SETTINGS } from '../settingsConfig';

export default function SettingsPage() {
  const toast = useToast();
  const auth = useAuth();
  return <SharedSettingsPage api={api as any} auth={auth as any} toast={toast} config={SETTINGS} />;
}
