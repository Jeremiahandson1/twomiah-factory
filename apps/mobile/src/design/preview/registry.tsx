import React from 'react'
import { HomePreview } from './homes'
import { MorePreview } from './more'
import { LeadsList, LeadDetail, JobsFiltered, JobDetail, ScheduleDay, ContactDetail, QuoteDetail, InvoicesList, InvoiceDetail, TimeClock, CareVisit } from './screensA'
import { BRAND, type Trade, type Seat } from './sample'

export interface PreviewScreen { id: string; group: string; title: string; brand: string; render: () => React.ReactElement }
const trades: [Trade, string][] = [['contractor', 'Contractor'], ['roofing', 'Roofing'], ['homecare', 'Home care']]
const seats: Seat[] = ['owner', 'manager', 'staff']

export const SCREENS: PreviewScreen[] = [
  ...trades.flatMap(([t, tl]) => seats.map((s): PreviewScreen => ({ id: `home-${t}-${s}`, group: '1 Home screens', title: `${tl} — ${s === 'staff' ? (t === 'homecare' ? 'caregiver' : 'field staff') : s}`, brand: BRAND[t], render: () => <HomePreview trade={t} seat={s} /> }))),
  { id: 'more-owner', group: '2 More menu', title: 'More — owner (contractor)', brand: BRAND.contractor, render: () => <MorePreview seat="owner" /> },
  { id: 'more-tech', group: '2 More menu', title: 'More — field tech (contractor)', brand: BRAND.contractor, render: () => <MorePreview seat="staff" /> },
  { id: 'leads-list', group: '3 Phase A screens', title: 'Leads list', brand: BRAND.contractor, render: () => <LeadsList /> },
  { id: 'lead-detail', group: '3 Phase A screens', title: 'Lead detail', brand: BRAND.contractor, render: () => <LeadDetail /> },
  { id: 'jobs-list', group: '3 Phase A screens', title: 'Jobs list (from the Jobs today tile)', brand: BRAND.contractor, render: () => <JobsFiltered /> },
  { id: 'job-detail', group: '3 Phase A screens', title: 'Job detail', brand: BRAND.contractor, render: () => <JobDetail /> },
  { id: 'schedule-day', group: '3 Phase A screens', title: 'Schedule — day', brand: BRAND.contractor, render: () => <ScheduleDay /> },
  { id: 'contact-detail', group: '3 Phase A screens', title: 'Contact detail', brand: BRAND.contractor, render: () => <ContactDetail /> },
  { id: 'quote-detail', group: '3 Phase A screens', title: 'Quote detail', brand: BRAND.contractor, render: () => <QuoteDetail /> },
  { id: 'invoices-list', group: '3 Phase A screens', title: 'Invoices list', brand: BRAND.contractor, render: () => <InvoicesList /> },
  { id: 'invoice-detail', group: '3 Phase A screens', title: 'Invoice detail', brand: BRAND.contractor, render: () => <InvoiceDetail /> },
  { id: 'invoice-pay', group: '3 Phase A screens', title: 'Invoice — take payment', brand: BRAND.contractor, render: () => <InvoiceDetail paying /> },
  { id: 'time-clock', group: '3 Phase A screens', title: 'Time clock (clocked in)', brand: BRAND.contractor, render: () => <TimeClock /> },
  { id: 'care-visit', group: '3 Phase A screens', title: 'Home care visit', brand: BRAND.homecare, render: () => <CareVisit /> },
]
