import React from 'react'
import { JobsFiltered, JobDetail, ScheduleDay, ContactDetail, QuoteDetail, TimeClock, CareVisit } from './screensA'
import { BRAND, type Trade, type Seat } from './sample'

export interface PreviewScreen { id: string; group: string; title: string; brand: string; render: () => React.ReactElement }

export const SCREENS: PreviewScreen[] = [
  { id: 'jobs-list', group: '3 Phase A screens', title: 'Jobs list (from the Jobs today tile)', brand: BRAND.contractor, render: () => <JobsFiltered /> },
  { id: 'job-detail', group: '3 Phase A screens', title: 'Job detail', brand: BRAND.contractor, render: () => <JobDetail /> },
  { id: 'schedule-day', group: '3 Phase A screens', title: 'Schedule — day', brand: BRAND.contractor, render: () => <ScheduleDay /> },
  { id: 'contact-detail', group: '3 Phase A screens', title: 'Contact detail', brand: BRAND.contractor, render: () => <ContactDetail /> },
  { id: 'quote-detail', group: '3 Phase A screens', title: 'Quote detail', brand: BRAND.contractor, render: () => <QuoteDetail /> },
  { id: 'time-clock', group: '3 Phase A screens', title: 'Time clock (clocked in)', brand: BRAND.contractor, render: () => <TimeClock /> },
  { id: 'care-visit', group: '3 Phase A screens', title: 'Home care visit', brand: BRAND.homecare, render: () => <CareVisit /> },
]
