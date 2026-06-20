// ─── Core domain types ─────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  avatar?: string | null;
  phone?: string | null;
}

export interface CompanySettings {
  plan?: string;
  billingCycle?: string;
  employeeCount?: string;
  industry?: string;
  limits?: {
    users: number | null;
    contacts: number | null;
    jobs: number | null;
    storage: number | null;
  };
  trialEndsAt?: string;
  subscriptionStatus?: string;
  [key: string]: unknown;
}

export interface Company {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
  primaryColor?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  website?: string | null;
  enabledFeatures: string[];
  settings?: CompanySettings | null;
  visionUrl?: string | null;
  vertical?: string;
}

export interface AuthData {
  user: User;
  company: Company;
  accessToken: string;
  refreshToken: string;
  permissions?: string[];
}

// ─── Toast ──────────────────────────────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

export interface ToastActions {
  success: (msg: string, duration?: number) => number;
  error: (msg: string, duration?: number) => number;
  info: (msg: string, duration?: number) => number;
  warning: (msg: string, duration?: number) => number;
}

// ─── Permissions ────────────────────────────────────────────────────────────

export interface PermissionsValue {
  role: string;
  roleLevel: number;
  permissions: string[];
  can: (permission: string) => boolean;
  canAny: (permissions: string[]) => boolean;
  canAll: (permissions: string[]) => boolean;
  isAtLeast: (minRole: string) => boolean;
  isOwner: boolean;
  isAdmin: boolean;
  isManager: boolean;
  isField: boolean;
  isViewer: boolean;
  canManageTeam: boolean;
  canManageFinancials: boolean;
  canApproveTime: boolean;
  canCreateQuotes: boolean;
  canDeleteAnything: boolean;
}

// ─── Auth context ───────────────────────────────────────────────────────────

export interface AuthContextValue {
  user: User | null;
  company: Company | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isManager: boolean;
  login: (email: string, password: string) => Promise<AuthData>;
  register: (formData: Record<string, string>) => Promise<AuthData>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  updateCompany: (updates: Partial<Company>) => void;
  hasFeature: (featureId: string) => boolean;
  getToken: () => string | null;
}

// ─── Socket context ─────────────────────────────────────────────────────────

export interface SocketContextValue {
  socket: ReturnType<typeof import('socket.io-client').io> | null;
  connected: boolean;
  subscribe: (event: string, callback: (...args: unknown[]) => void) => () => void;
  emit: (event: string, data?: unknown) => void;
  joinRoom: (room: string) => void;
  leaveRoom: (room: string) => void;
}

// ─── Common component props ─────────────────────────────────────────────────

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  className?: string;
}

// ─── API types ──────────────────────────────────────────────────────────────

export interface ApiError extends Error {
  status?: number;
  data?: unknown;
}

export interface ApiOptions {
  showSuccessToast?: boolean;
  successMessage?: string;
  showErrorToast?: boolean;
  errorMessage?: string;
  onSuccess?: (result: unknown) => void;
  onError?: (err: Error) => void;
}

// ─── Feature types ──────────────────────────────────────────────────────────

export interface Feature {
  id: string;
  name: string;
  description: string;
}

export interface FeatureCategory {
  id: string;
  name: string;
  icon: string;
  description: string;
  features: Feature[];
}

// ─── Pagination / list params ───────────────────────────────────────────────

export interface ListParams {
  page?: number;
  limit?: number;
  search?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  status?: string;
  type?: string;
  [key: string]: string | number | undefined;
}

// ─── Generic entity types used across pages ─────────────────────────────────

export interface Contact {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  type: string;
  source?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  notes?: string | null;
  companyId: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface Job {
  id: string;
  title: string;
  status: string;
  contactId?: string | null;
  projectId?: string | null;
  scheduledDate?: string | null;
  completedDate?: string | null;
  total?: string | number | null;
  companyId: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface Quote {
  id: string;
  number: string;
  status: string;
  contactId?: string | null;
  total?: string | number | null;
  companyId: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface Invoice {
  id: string;
  number: string;
  status: string;
  contactId?: string | null;
  total?: string | number | null;
  balance?: string | number | null;
  companyId: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface Project {
  id: string;
  name: string;
  status: string;
  contactId?: string | null;
  budget?: string | number | null;
  companyId: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}
