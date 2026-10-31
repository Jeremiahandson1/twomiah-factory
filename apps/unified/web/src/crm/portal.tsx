// The customer's portal (/portal/<token>), loaded on its own: it pays cards through Stripe, and Stripe's library
// injects Stripe's script the moment it is imported. Kept out of the admin's bundle, the admin pages never load it.
import { Routes, Route } from 'react-router-dom'
import {
  PortalProvider, PortalLayout, PortalDashboard, PortalProjects, PortalProjectDetail, PortalProjectFiles, PortalQuotes,
  PortalQuoteDetail, PortalInvoices, PortalInvoiceDetail, PortalPaymentMethods, PortalChangeOrders, PortalChangeOrderDetail,
  PortalSelections, PortalMessages, PortalMyJobs, PortalLienWaivers, PortalSubmittalReview, PortalAssignedRfis,
  PortalSharedDocuments, PortalEquipment, PortalEquipmentDetail, PortalAgreements, PortalServiceRequest, PortalVisits, PortalJobFiles, PortalAppointments,
} from '@twomiah/tenant-ui/src/portal'
import { verticalScreens } from './vertical'

/** Mounted at /portal/:token/* — the paths below are the portal's own. */
export default function PortalApp() {
  return (
    <PortalProvider config={verticalScreens().portal as any}>
      <Routes>
        <Route element={<PortalLayout />}>
          <Route index element={<PortalDashboard />} />
          <Route path="projects" element={<PortalProjects />} />
          <Route path="projects/:projectId" element={<PortalProjectDetail />} />
          <Route path="projects/:projectId/files" element={<PortalProjectFiles />} />
          <Route path="quotes" element={<PortalQuotes />} />
          <Route path="quotes/:quoteId" element={<PortalQuoteDetail />} />
          <Route path="invoices" element={<PortalInvoices />} />
          <Route path="invoices/:invoiceId" element={<PortalInvoiceDetail />} />
          <Route path="payment-methods" element={<PortalPaymentMethods />} />
          <Route path="change-orders" element={<PortalChangeOrders />} />
          <Route path="change-orders/:changeOrderId" element={<PortalChangeOrderDetail />} />
          <Route path="selections" element={<PortalSelections />} />
          <Route path="messages" element={<PortalMessages />} />
          <Route path="my-jobs" element={<PortalMyJobs />} />
          <Route path="job-files" element={<PortalJobFiles />} />
          <Route path="lien-waivers" element={<PortalLienWaivers />} />
          <Route path="submittal-review" element={<PortalSubmittalReview />} />
          <Route path="rfis-assigned" element={<PortalAssignedRfis />} />
          <Route path="shared-documents" element={<PortalSharedDocuments />} />
          <Route path="equipment" element={<PortalEquipment />} />
          <Route path="equipment/:equipmentId" element={<PortalEquipmentDetail />} />
          <Route path="agreements" element={<PortalAgreements />} />
          <Route path="service-request" element={<PortalServiceRequest />} />
          <Route path="visits" element={<PortalVisits />} />
          <Route path="appointments" element={<PortalAppointments />} />
        </Route>
      </Routes>
    </PortalProvider>
  )
}
