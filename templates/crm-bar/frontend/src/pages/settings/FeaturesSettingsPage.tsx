// FeaturesSettingsPage — shared implementation in packages/tenant-ui/src/shell, vendored as ../../shared.
import api from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { FeaturesSettingsPage as SharedFeaturesSettingsPage } from '../../shared';

export default function FeaturesSettingsPage() {
  const toast = useToast();
  const auth = useAuth();
  return <SharedFeaturesSettingsPage api={api as any} auth={auth as any} toast={toast} />;
}
