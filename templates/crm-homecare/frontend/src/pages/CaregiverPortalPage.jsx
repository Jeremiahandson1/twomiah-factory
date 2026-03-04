import { lazy, Suspense } from 'react';
const CaregiverDashboard = lazy(() => import('../components/caregiver/CaregiverDashboard.jsx'));

export default function CaregiverPortalPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-400">Loading…</div>}>
      <CaregiverDashboard />
    </Suspense>
  );
}
