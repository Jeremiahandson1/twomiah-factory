// AppLayout — shared implementation in packages/tenant-ui/src/shell (AppShell), vendored as ../../shared.
// This wrapper hands the shell this template's api client, auth, socket state and nav config (shellConfig.ts).
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { useSocket } from '../../contexts/SocketContext';
import { AppShell } from '../../shared';
import { SHELL } from '../../shellConfig';

export default function AppLayout() {
  const auth = useAuth();
  const { connected } = useSocket();
  return <AppShell api={api as any} auth={auth as any} connected={!!connected} config={SHELL} />;
}
