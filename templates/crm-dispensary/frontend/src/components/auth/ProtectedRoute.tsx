import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from "../../contexts/AuthContext";
import { isAccountLocked, isTrialBypassPath } from '../../shared';

export function ProtectedRoute({ children, requiredRole }: { children: any; requiredRole?: string }) {
  const { isAuthenticated, loading, user, company } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-slate-800">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-slate-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // A company the Factory has locked (an ended subscription or an expired trial) sees only the lock page, billing and
  // sign-out — the same rule as the shared ProtectedRoute. The server refuses the rest anyway. (10/14)
  if (isAccountLocked(company) && !isTrialBypassPath(location.pathname)) {
    return <Navigate to="/crm/paywall" replace />;
  }

  if (requiredRole) {
    const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
    if (!roles.includes(user?.role)) {
      return <Navigate to="/" replace />;
    }
  }

  return children;
}

export function PublicRoute({ children }: { children: any }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-slate-800">
        <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (isAuthenticated) {
    const from = location.state?.from?.pathname || '/';
    return <Navigate to={from} replace />;
  }

  return children;
}
