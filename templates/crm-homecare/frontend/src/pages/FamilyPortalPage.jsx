import { lazy, Suspense } from 'react';
const Portal = lazy(() => import('../components/portal/ClientPortal.jsx'));

export default function FamilyPortalPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-400">Loading portal…</div>}>
      <Portal />
    </Suspense>
  );
}
