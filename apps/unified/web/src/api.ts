// The admin's API client: the shared one (packages/tenant-ui/src/api/client.ts). The build sets VITE_AUTH_MODE=cookie
// (web/vite.config.ts), so the session is the server's httpOnly cookies and this page never holds a credential.
export { api } from './shared'
