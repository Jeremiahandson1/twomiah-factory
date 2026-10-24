import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import { PageError } from '../../shared'
import { api } from '../../api'

// What the factory's composer left off this site because the owner hadn't
// supplied it — it states only facts the owner gave (no invented prices,
// reviews, staff or photos of "our work"). Seeded into settings.contentGaps at
// first boot; each item says what to add, what it unlocks, and where in this
// admin to do it. Ticking one off is saved to the same settings row (site.content_gaps).
interface Gap { id: string; label: string; unlocks: string; done?: boolean }

// Where each gap is filled in THIS admin. Only section types the page editor
// offers (sectionSchema.ts) — no pricing or badge sections exist here.
const HOW: Record<string, { text: string; to: string }> = {
  description: { text: 'Open any page and rewrite the copy in your own words.', to: '/crm/website/pages' },
  photos: { text: 'Upload them in Photos, add a Gallery section to a page and press Publish, with Show on site on. A page you show joins the menu.', to: '/crm/website/photos' },
  ownerPhoto: { text: 'Upload it in Photos, then set it as the portrait in the About page\'s story section.', to: '/crm/website/photos' },
  testimonials: { text: 'Open the Home page and add a Testimonials section with the review and the customer\'s name.', to: '/crm/website/pages/home' },
  yearFounded: { text: 'Add it to your About story, or as a figure in a Stats section.', to: '/crm/website/pages/about' },
  credentials: { text: 'Add a Stats section or a line in your About story listing them.', to: '/crm/website/pages/about' },
  hours: { text: 'Open your contact page and fill in the hours on its contact section.', to: '/crm/website/pages' },
  pricing: { text: 'Add prices to the service descriptions, or answer "what does it cost" in an FAQ section.', to: '/crm/website/pages' },
}

export function FinishYourSiteCard() {
  const [gaps, setGaps] = useState<Gap[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.get('/api/site/settings')
      .then((site: { contentGaps?: Gap[] }) => setGaps(Array.isArray(site?.contentGaps) ? site.contentGaps : []))
      .catch(() => { /* the checklist is optional — never block the pages list */ })
  }, [])

  const open = gaps.filter(g => !g.done)
  if (open.length === 0) return null

  const markDone = async (id: string) => {
    const next = gaps.map(g => (g.id === id ? { ...g, done: true } : g))
    setGaps(next)
    setError(null)
    try {
      // its own door: a manager edits content but not the site's settings
      await api.post(`/api/site/content-gaps/${encodeURIComponent(id)}/done`, {})
    } catch (e: any) {
      setGaps(gaps)
      setError(e.message)
    }
  }

  return (
    <div className="card card-padding mb-6">
      <h2 className="text-lg text-ink font-semibold mb-1">Finish your site</h2>
      <p className="text-sm text-ink-soft mb-4">
        Your site only says what you told us — we don't make up prices, reviews or photos of your work.
        Each of these adds something real. None of them is required.
      </p>
      <PageError message={error} className="mb-3" />
      <ul className="divide-y divide-line">
        {open.map(g => {
          const how = HOW[g.id]
          return (
            <li key={g.id} className="py-3 flex items-start gap-4">
              <div className="flex-1">
                <div className="text-sm text-ink font-semibold">{g.label}</div>
                <div className="text-sm text-ink-soft">{g.unlocks}</div>
                {how && (
                  <div className="text-xs text-muted mt-1">
                    {how.text} <Link to={how.to} className="underline text-ink">Go there</Link>
                  </div>
                )}
              </div>
              <button onClick={() => markDone(g.id)} className="btn-secondary btn-sm inline-flex items-center gap-1 flex-shrink-0">
                <Check className="w-3.5 h-3.5" />
                Done
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
