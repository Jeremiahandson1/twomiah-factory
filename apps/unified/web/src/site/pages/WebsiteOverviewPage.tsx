// The website's home in the admin: is the site working (visits and enquiries, counted on the site itself — no
// cookies, no Google account), what is left to add, and the way to each part of it.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, FileText, Image, Newspaper, Briefcase, Settings as SettingsIcon } from 'lucide-react'
import { PageError, useMayWrite } from '../../shared'
import { api } from '../../api'
import { verticalScreens } from '../../crm/vertical'
import { FinishYourSiteCard } from '../components/FinishYourSiteCard'
import { UnpublishedList, useSiteDrafts } from '../components/Drafts'

interface Analytics {
  viewsLast30: number
  viewsPrev30: number
  leadsLast30: number
  leadsPrev30: number
  topPages: Array<{ path: string; count: number }>
}

function Delta({ now, prev }: { now: number; prev: number }) {
  if (prev === 0) return null
  const pct = Math.round(((now - prev) / prev) * 100)
  return <span className={'text-xs ml-2 font-medium ' + (pct >= 0 ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300')}>{pct >= 0 ? '+' : ''}{pct}% vs the 30 days before</span>
}

const PARTS = [
  { to: '/crm/website/pages', icon: FileText, label: 'Pages', text: 'Change the words, photos and sections.' },
  { to: '/crm/website/photos', icon: Image, label: 'Photos', text: 'Upload and tag your pictures.' },
  { to: '/crm/website/blog', icon: Newspaper, label: 'Blog', text: 'Posts that bring in search traffic.' },
  // In the vertical's words where it has them (a restaurant's is not "finished work").
  { to: '/crm/website/portfolio', icon: Briefcase, label: 'Portfolio', text: verticalScreens().website?.portfolioText || 'Finished work, with photos.' },
]

export function WebsiteOverviewPage() {
  const maySettings = useMayWrite('site:settings')
  const mayEdit = useMayWrite('site:update')
  const drafts = useSiteDrafts()
  const [publishedNote, setPublishedNote] = useState<string | null>(null)
  const [data, setData] = useState<Analytics | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.get('/api/site/analytics').then(setData).catch((e: Error) => setError(e.message || "Couldn't load the visit numbers."))
  }, [])

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink">Website</h1>
          <p className="text-muted text-sm mt-1">Visits are counted on your own site — no Google account needed.</p>
        </div>
        <a href="/" target="_blank" rel="noreferrer" className="btn-secondary btn-md">
          <ExternalLink className="w-4 h-4" />
          View your site
        </a>
      </div>

      {/* Everything saved but not on the site yet, and Publish all — as Wix and Webflow keep it (components/Drafts.tsx). */}
      {drafts.items && drafts.items.length > 0 && (
        <section className="card card-padding mb-6" aria-labelledby="unpublished-heading">
          <h2 id="unpublished-heading" className="text-lg font-semibold text-ink mb-1">Unpublished changes</h2>
          <p className="text-sm text-muted mb-4">Saved, but not on your site yet. Open one to look it over, or publish them all together.</p>
          {mayEdit
            ? <UnpublishedList items={drafts.items} onPublished={(r) => { setPublishedNote(`${r.published.length} ${r.published.length === 1 ? 'change is' : 'changes are'} live now.`); drafts.refresh() }} />
            : <UnpublishedList items={drafts.items.map((i) => ({ ...i, mayPublish: false }))} onPublished={() => {}} />}
        </section>
      )}
      {publishedNote && (!drafts.items || drafts.items.length === 0) && (
        <div role="status" className="card card-padding mb-6 text-sm text-green-800 dark:text-green-300">{publishedNote}</div>
      )}
      <PageError message={drafts.error} className="mb-6" />

      <FinishYourSiteCard />

      <PageError message={error} className="mb-6" />
      {!data && !error && <div className="text-muted text-sm mb-6">Loading…</div>}
      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <div className="card card-padding">
              <div className="text-sm text-muted mb-1">Page views · last 30 days</div>
              <div className="text-3xl text-ink font-semibold">{data.viewsLast30.toLocaleString()}<Delta now={data.viewsLast30} prev={data.viewsPrev30} /></div>
            </div>
            <div className="card card-padding">
              <div className="text-sm text-muted mb-1">Enquiries · last 30 days</div>
              <div className="text-3xl text-ink font-semibold">{data.leadsLast30.toLocaleString()}<Delta now={data.leadsLast30} prev={data.leadsPrev30} /></div>
            </div>
          </div>
          <div className="card card-padding mb-6">
            <h2 className="text-sm font-semibold text-ink mb-3">Most-viewed pages · last 30 days</h2>
            {data.topPages.length === 0 && <p className="text-sm text-muted">No visits recorded yet.</p>}
            {data.topPages.map((p) => (
              <div key={p.path} className="flex justify-between gap-4 text-sm py-1.5 border-b border-line last:border-0 text-ink">
                <span className="font-mono truncate">{p.path}</span><span>{p.count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...PARTS, ...(maySettings ? [{ to: '/crm/website/settings', icon: SettingsIcon, label: 'Website settings', text: 'Design, navigation, search and tracking.' }] : [])].map((p) => (
          <Link key={p.to} to={p.to} className="card card-padding flex items-start gap-3 hover:border-brand-500 transition-colors">
            <p.icon className="w-5 h-5 text-brand-600 dark:text-brand-300 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <div className="font-semibold text-ink">{p.label}</div>
              <div className="text-sm text-muted">{p.text}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
