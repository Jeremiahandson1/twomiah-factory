import { Link } from 'react-router-dom';

// A real not-found page. Unknown routes used to `<Navigate to="/" />`, which for a signed-out visitor
// lands on the login screen — so a typo or a stale bookmark read as an unexpected sign-out rather than
// a missing page. Same fix salon made for its M-05. (roof T17 L4)
export default function NotFoundPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 dark:bg-slate-900">
      <div className="text-center">
        <p className="text-6xl font-bold text-blue-600 dark:text-blue-400">404</p>
        <h1 className="mt-4 text-2xl font-bold text-gray-900 dark:text-slate-100">Page not found</h1>
        <p className="mt-2 text-gray-500 dark:text-slate-400">The page you&rsquo;re looking for doesn&rsquo;t exist or has moved.</p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Link to="/crm" className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium">Go to the CRM</Link>
          <Link to="/" className="px-4 py-2 border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-100 dark:border-slate-700 dark:text-slate-200">Home</Link>
        </div>
      </div>
    </div>
  );
}
