// Home care's public pages that are the people group's: the careers page (/careers, /careers/:slug) and a new hire's
// onboarding packet (/onboarding/:token). Rendered by ../publicApp.tsx, which has already put them in the frame; the
// address is read here (useLocation), one level of routes. Each page loads with this bundle (the public app's own).
import { useLocation } from 'react-router-dom'
import CareersPage from './CareersPage'
import OnboardingPacketPage from './OnboardingPacketPage'

export default function PeoplePublic() {
  const { pathname } = useLocation()
  const parts = pathname.split('/').filter(Boolean).map((p) => decodeURIComponent(p))
  if (parts[0] === 'onboarding' && parts[1]) return <OnboardingPacketPage key={parts[1]} token={parts[1]} />
  // /careers, or /careers/:slug
  return <CareersPage slug={parts[0] === 'careers' ? parts[1] : undefined} />
}
