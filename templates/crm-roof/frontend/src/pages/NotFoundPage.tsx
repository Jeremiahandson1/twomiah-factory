import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

// A real not-found page. Unknown /crm/* routes used to redirect to "/" (and on to
// the login screen), so a typo or stale bookmark read as an unexpected sign-out
// rather than a missing page (M-05).
//
// It wears the tenant's brand colour. The 404 and its button were hardcoded teal-600, so a shop whose
// brand is #1d4ed8 hit a page in somebody else's colour — measured at rgb(13,148,136) against a blue
// brand. The catch-all route sits inside AuthProvider, so the company really is reachable here; when it
// is not (a 404 while signed out) this falls back to the colour the page used to be, rather than to
// nothing. (Field Service T26 L9)
const FALLBACK_BRAND = '#2563eb';

export default function NotFoundPage() {
  const { company } = useAuth();
  const brand = company?.primaryColor || FALLBACK_BRAND;
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 dark:bg-slate-900">
      <div className="text-center">
        {/*
          NOT the brand colour. (T51 follow-up)

          This was `style={{ color: brand }}`, so the contrast of the one glyph that says what
          happened depended on a colour the CUSTOMER picks. Measured on this tenant in dark mode:
          blue-700 on slate-900 is 2.66:1, and 60px text still needs 3:1. Any brand dark enough to
          look good on a white site fails on the dark ground, and no guard can see it — it is an
          inline style, which every contrast check in scripts/ reads straight past.

          A token colour that clears AA in both themes. The brand still appears on the button below,
          where it is a BACKGROUND with white text and that pair is managed deliberately.
        */}
        <p className="text-6xl font-bold text-gray-500 dark:text-slate-400">404</p>
        <h1 className="mt-4 text-2xl font-bold text-gray-900 dark:text-slate-100">Page not found</h1>
        <p className="mt-2 text-gray-500 dark:text-slate-400">The page you’re looking for doesn’t exist or has moved.</p>
        <div className="mt-6 flex items-center justify-center gap-3">
          {/* hover:opacity-90 rather than a darker shade: there is no Tailwind step to reach for when the
              colour is whatever the tenant chose. */}
          <Link to="/crm" className="px-4 py-2 text-white rounded-lg font-medium hover:opacity-90 transition-opacity" style={{ backgroundColor: brand }}>Go to the CRM</Link>
          <Link to="/" className="px-4 py-2 border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">Home</Link>
        </div>
      </div>
    </div>
  );
}
