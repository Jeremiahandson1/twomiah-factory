// Routes a section { type, variant, data } to the right form component.
// New section types → register their form here.

import { HeroFullBleedForm } from './sectionForms/HeroFullBleedForm'
import { HeroSplitForm } from './sectionForms/HeroSplitForm'
import { HeroCenteredStatsForm } from './sectionForms/HeroCenteredStatsForm'
import { ServicesCardsGridForm } from './sectionForms/ServicesCardsGridForm'
import { ServicesAlternatingForm } from './sectionForms/ServicesAlternatingForm'
import { CtaBannerForm } from './sectionForms/CtaBannerForm'
import { CtaSplitForm } from './sectionForms/CtaSplitForm'
import { AboutStoryForm } from './sectionForms/AboutStoryForm'
import { TeamGridForm } from './sectionForms/TeamGridForm'
import { ContactFormInfoForm } from './sectionForms/ContactFormInfoForm'
import { GalleryGridForm } from './sectionForms/GalleryGridForm'
import { TestimonialsQuotesForm } from './sectionForms/TestimonialsQuotesForm'
import { FaqAccordionForm } from './sectionForms/FaqAccordionForm'
import { StatsBarForm } from './sectionForms/StatsBarForm'
import { GenericSectionForm } from './sectionForms/GenericSectionForm'
import { findTradeSection } from '../sectionFields'

interface Props {
  type: string
  variant: string
  data: Record<string, any>
  onChange: (d: Record<string, any>) => void
}

export function SectionFormDispatcher({ type, variant, data, onChange }: Props) {
  const key = type + '/' + variant
  switch (key) {
    case 'hero/full-bleed':       return <HeroFullBleedForm data={data} onChange={onChange} />
    case 'hero/split':            return <HeroSplitForm data={data} onChange={onChange} />
    case 'hero/centered-stats':   return <HeroCenteredStatsForm data={data} onChange={onChange} />
    case 'services/cards-grid':   return <ServicesCardsGridForm data={data} onChange={onChange} />
    case 'services/alternating':  return <ServicesAlternatingForm data={data} onChange={onChange} />
    case 'cta/banner':            return <CtaBannerForm data={data} onChange={onChange} />
    case 'cta/split':             return <CtaSplitForm data={data} onChange={onChange} />
    case 'about/story':           return <AboutStoryForm data={data} onChange={onChange} />
    case 'team/grid':             return <TeamGridForm data={data} onChange={onChange} />
    case 'contact/form-info':     return <ContactFormInfoForm data={data} onChange={onChange} />
    case 'gallery/grid':          return <GalleryGridForm data={data} onChange={onChange} />
    case 'testimonials/quotes':
    case 'testimonials/carousel': return <TestimonialsQuotesForm data={data} onChange={onChange} />
    case 'faq/accordion':         return <FaqAccordionForm data={data} onChange={onChange} />
    case 'stats/bar':             return <StatsBarForm data={data} onChange={onChange} />
    default: {
      // Every trade section (and before/after, trust badges, booking button) is described in
      // sectionFields.ts and edited by the generic form.
      const trade = findTradeSection(type, variant)
      if (trade) return <GenericSectionForm fields={trade.fields} data={data} onChange={onChange} />
      return (
        <div className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-3 dark:text-amber-200 dark:bg-amber-950/40 dark:border-amber-900">
          No editor registered for <code>{key}</code>. The section will still render on the public site if the template has a partial for it.
        </div>
      )
    }
  }
}
