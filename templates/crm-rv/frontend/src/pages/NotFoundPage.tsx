import { Link } from 'react-router-dom';

// A real not-found page. Unknown routes used to redirect to "/" (and, for a
// signed-out session, on to the login screen) — so a stale link read as an
// unexpected sign-out rather than a missing page (M-13).
export default function NotFoundPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="text-center">
        <p className="text-6xl font-bold text-orange-500">404</p>
        <h1 className="mt-4 text-2xl font-bold text-gray-900">Page not found</h1>
        <p className="mt-2 text-gray-500">The page you’re looking for doesn’t exist or has moved.</p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Link to="/crm" className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-medium">Go to the CRM</Link>
          <Link to="/" className="px-4 py-2 border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-100">Home</Link>
        </div>
      </div>
    </div>
  );
}
