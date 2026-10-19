// A home-care agency's public pages, outside the shell and without a staff sign-in (templates/crm-homecare App.tsx):
// the client portal (/portal, its invite setup), the family portal (/family), paying a visit invoice (/pay/:invoiceId,
// /payment-success), a new hire's onboarding packet (/onboarding/:token) and the careers page (/careers, /careers/:slug).
// App.tsx routes each of those paths here (crm/verticals/homecare.tsx PUBLIC_PATHS), only for home care; the server
// serves the page at them only for home care (server/http/adminScreens.ts HOMECARE_PAGES).
//
// Each group's public screen reads the address itself (useLocation/useParams of the outer route), so there is one
// level of routes: people's for careers and onboarding, the portals' for the rest.
import { useLocation } from 'react-router-dom'
import { HomecareFrame } from './lib/HomecareFrame'
import PeoplePublic from './people/public'
import PortalsPublic from './portals/public'

export default function HomecarePublicApp() {
  const { pathname } = useLocation()
  const people = pathname.startsWith('/careers') || pathname.startsWith('/onboarding/')
  return (
    <HomecareFrame staff={false}>
      {people ? <PeoplePublic /> : <PortalsPublic />}
    </HomecareFrame>
  )
}
