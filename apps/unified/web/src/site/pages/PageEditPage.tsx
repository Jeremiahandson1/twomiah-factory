// One page of the website: its sections, title and search tags, beside a live preview of the page as it will look.
// Typing redraws the preview; Save draft keeps the changes off the site; Publish puts them on it (components/Drafts.tsx,
// server site/drafts.ts). "Show on site" is a separate switch: whether visitors can open the page at all.
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { PageError, useConfirm, useMayWrite } from '../../shared'
import { api } from '../../api'
import { findSectionDef, SECTION_DEFS } from '../sectionSchema'
import { SectionFormDispatcher } from '../components/SectionFormDispatcher'
import { AddSectionMenu } from '../components/AddSectionMenu'
import { DraftActions, DraftStatus, LivePreview, PreviewToggle, PublishAllButton, useDraftEditor, useIsWide, useSiteDrafts, type DraftRow } from '../components/Drafts'

interface Section { type: string; variant: string; data: Record<string, any> }

/** Sections that frame a page rather than say something (the server's site/menu.ts FRAMING). */
const FRAMING = new Set(['hero', 'cta', 'reservation'])
const hasSubstance = (sections: Section[]) => sections.some((s) => s && !FRAMING.has(s.type))

/** What the editor edits: the page's draft where it has one, else the live page. */
interface PageContent {
  title: string
  sections: Section[]
  metaTitle: string | null
  metaDescription: string | null
}

const toWorking = (r: DraftRow): PageContent => {
  const s = r.draft ?? r
  return { title: s.title ?? '', sections: Array.isArray(s.sections) ? s.sections : [], metaTitle: s.metaTitle ?? null, metaDescription: s.metaDescription ?? null }
}

function VariantPicker({ currentType, currentVariant, onChange }: { currentType: string; currentVariant: string; onChange: (v: string) => void }) {
  const confirm = useConfirm()
  const siblings = SECTION_DEFS.filter(d => d.type === currentType)
  if (siblings.length <= 1) return null
  return (
    <div className="mb-4 pb-4 border-b border-line">
      <label htmlFor={`variant-${currentType}`} className="block text-xs font-semibold uppercase tracking-wider text-ink-soft mb-1.5">Layout variant</label>
      <select
        id={`variant-${currentType}`}
        value={currentVariant}
        onChange={async (e) => {
          const next = e.target.value
          if (next === currentVariant) return
          const ok = await confirm("We'll keep your text and images, but the new layout may show different fields.", { title: "Switch this section's layout?", confirmText: 'Switch', danger: false })
          if (ok) onChange(next)
        }}
        className="input"
      >
        {siblings.map(def => (
          <option key={def.variant} value={def.variant}>{def.label}</option>
        ))}
      </select>
      <p className="text-xs text-muted mt-1.5">
        {siblings.find(d => d.variant === currentVariant)?.description}
      </p>
    </div>
  )
}

export function PageEditPage() {
  const { slug } = useParams<{ slug: string }>()
  const confirm = useConfirm()
  const mayEdit = useMayWrite('site:update')
  const wide = useIsWide()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [expandedIdx, setExpandedIdx] = useState<number | null>(0)
  const [previewOnPhone, setPreviewOnPhone] = useState(false)
  const [switching, setSwitching] = useState(false)
  /**
   * The page opened hidden with nothing live on it — the starting site holds back a page it had no facts for (an About
   * with no story). Publishing its first content shows it, as saving it used to (live test 2026-10-22: "About exists
   * but is Hidden"): the choice is ticked and there to clear, beside Publish.
   */
  const [showOnPublish, setShowOnPublish] = useState(false)

  const ed = useDraftEditor<PageContent>({
    row: null,
    toWorking,
    save: (v) => api.patch(`/api/site/pages/${slug}`, { title: v.title, sections: v.sections, metaTitle: v.metaTitle ?? null, metaDescription: v.metaDescription ?? null }),
    publish: (show) => api.post(`/api/site/pages/${slug}/publish`, show ? { show: true } : {}),
    discard: () => api.delete(`/api/site/pages/${slug}/draft`),
    autosave: mayEdit,
  })
  const drafts = useSiteDrafts()
  const settingsDraft = !!drafts.items?.some((i) => i.kind === 'settings')

  useEffect(() => {
    if (!slug) return
    setLoading(true)
    api.get(`/api/site/pages/${slug}`)
      .then((p: DraftRow) => {
        ed.adopt(p)
        setShowOnPublish(!p.isPublished && !hasSubstance(Array.isArray(p.sections) ? p.sections : []))
      })
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  const page = ed.value
  const row = ed.row
  const update = (patch: Partial<PageContent>) => ed.update((p) => ({ ...p, ...patch }))

  const updateSection = (i: number, next: Section) => {
    if (!page) return
    const nextSections = [...page.sections]
    nextSections[i] = next
    update({ sections: nextSections })
  }

  const moveSection = (i: number, dir: -1 | 1) => {
    if (!page) return
    const j = i + dir
    if (j < 0 || j >= page.sections.length) return
    const nextSections = [...page.sections]
    ;[nextSections[i], nextSections[j]] = [nextSections[j], nextSections[i]]
    update({ sections: nextSections })
    if (expandedIdx === i) setExpandedIdx(j)
    else if (expandedIdx === j) setExpandedIdx(i)
  }

  const removeSection = async (i: number) => {
    if (!page) return
    if (!(await confirm('It leaves the page when you publish.', { title: 'Remove this section?', confirmText: 'Remove' }))) return
    update({ sections: page.sections.filter((_, j) => j !== i) })
    if (expandedIdx === i) setExpandedIdx(null)
  }

  const addSection = (def: { type: string; variant: string; defaultData: Record<string, unknown> }) => {
    if (!page) return
    const newSection: Section = { type: def.type, variant: def.variant, data: { ...def.defaultData } }
    const nextSections = [...page.sections, newSection]
    update({ sections: nextSections })
    setExpandedIdx(nextSections.length - 1)
  }

  /** "Show on site": at once, on its own — it neither saves nor publishes the edits. */
  const setShown = async (shown: boolean) => {
    if (!shown && !(await confirm("Visitors can't open it, and it leaves the menu, until you show it again. Your edits are kept.", { title: 'Hide this page from your site?', confirmText: 'Hide page' }))) return
    setSwitching(true)
    ed.setError(null)
    try {
      const r: DraftRow = await api.patch(`/api/site/pages/${slug}`, { isPublished: shown })
      ed.setRow(r)
      if (shown) setShowOnPublish(false)
    } catch (e: any) {
      ed.setError(e.message)
    } finally {
      setSwitching(false)
    }
  }

  if (loading) return <div className="text-muted text-sm">Loading…</div>
  if (!page || !row) return <PageError message={loadError || 'Page not found'} />

  const publicHref = '/' + (row.slug === 'home' ? '' : row.slug)
  const shownOnSite = !!row.isPublished
  const preview = wide || previewOnPhone

  return (
    <div className="card overflow-hidden flex flex-col lg:h-[calc(100vh-7rem)]">
      {/* Toolbar */}
      <div className="border-b border-line px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3 shrink-0">
        <Link to="/crm/website/pages" className="text-muted hover:text-ink flex items-center gap-1.5 text-sm">
          <ArrowLeft className="w-4 h-4" />
          Pages
        </Link>
        <div className="hidden sm:block w-px h-5 bg-line" />
        <input
          type="text"
          value={page.title}
          onChange={(e) => update({ title: e.target.value })}
          readOnly={!mayEdit}
          aria-label="Page title"
          className="text-xl text-ink bg-transparent dark:bg-transparent border-0 focus:outline-none focus:ring-0 flex-1 min-w-[10rem] px-0"
          placeholder="Page title"
        />
        <DraftStatus isDirty={ed.isDirty} hasDraft={ed.hasDraft} saving={ed.saving} justPublished={ed.justPublished} />
        <PreviewToggle on={previewOnPhone} onChange={setPreviewOnPhone} />
      </div>
      <div className="border-b border-line px-4 sm:px-6 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 shrink-0 bg-paper">
        <label className="flex items-center gap-2 text-sm text-ink" title="Whether visitors can open this page at all. Separate from publishing your edits.">
          <input
            type="checkbox"
            role="switch"
            aria-checked={shownOnSite}
            checked={shownOnSite}
            disabled={!mayEdit || switching}
            onChange={(e) => setShown(e.target.checked)}
            className="rounded border-line"
          />
          Show on site
        </label>
        <span className="text-xs text-muted">
          {shownOnSite ? 'Visitors can open it at ' + publicHref + '.' : "Hidden: visitors can't open it, and it isn't in the menu."}
        </span>
        {mayEdit && (
          <div className="sm:ml-auto flex flex-wrap items-center gap-2">
            <PublishAllButton changed={ed.isDirty || ed.saving || ed.hasDraft} current={{ kind: 'page', slug: row.slug }} drafts={drafts} beforeOpen={ed.saveNow} onPublished={() => api.get(`/api/site/pages/${slug}`).then(ed.adopt)} />
            <DraftActions ed={ed} noun="page" offSite={!shownOnSite} show={showOnPublish} setShow={setShowOnPublish} showLabel="Also show it on the site" />
          </div>
        )}
        <PageError message={ed.error} className="w-full" />
      </div>

      {/* Two panes on a wide screen: the editor and the preview. On a phone, one or the other (the Preview button). */}
      <div className="flex-1 flex flex-col lg:flex-row lg:overflow-hidden min-h-0">
        <div className={`w-full lg:w-[480px] shrink-0 lg:border-r border-line lg:overflow-auto bg-paper p-4 sm:p-5 space-y-3 ${previewOnPhone ? 'hidden lg:block' : ''}`}>
          {page.sections.length === 0 && (
            <div className="text-sm text-muted bg-white dark:bg-slate-900 border border-line rounded-lg p-4 text-center">
              No sections yet.{mayEdit && ' Add one below.'}
            </div>
          )}
          {page.sections.map((section, i) => {
            const def = findSectionDef(section.type, section.variant)
            const isOpen = expandedIdx === i
            const name = def?.label || `${section.type}/${section.variant}`
            return (
              <div key={i} className="card overflow-hidden">
                <div className="px-4 py-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setExpandedIdx(isOpen ? null : i)}
                    aria-expanded={isOpen}
                    className="flex-1 text-left flex items-center gap-2 min-w-0"
                  >
                    <span className="text-xs font-mono text-muted shrink-0">{String(i + 1).padStart(2, '0')}</span>
                    <span className="font-semibold text-sm text-ink truncate">{name}</span>
                  </button>
                  {mayEdit && (
                    <>
                      <button type="button" onClick={() => moveSection(i, -1)} disabled={i === 0} className="btn-secondary btn-sm disabled:opacity-30" aria-label={`Move ${name} up`}>
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" onClick={() => moveSection(i, 1)} disabled={i === page.sections.length - 1} className="btn-secondary btn-sm disabled:opacity-30" aria-label={`Move ${name} down`}>
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" onClick={() => removeSection(i)} className="btn-secondary btn-sm text-red-700 dark:text-red-300" aria-label={`Remove ${name}`}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
                {isOpen && (
                  <fieldset disabled={!mayEdit} className="px-4 py-4 border-t border-line bg-paper min-w-0">
                    <VariantPicker
                      currentType={section.type}
                      currentVariant={section.variant}
                      onChange={(newVariant) => {
                        const targetDef = SECTION_DEFS.find(d => d.type === section.type && d.variant === newVariant)
                        if (!targetDef) return
                        // Keep what carries over (title, image…): the new variant's defaults under the section's own data.
                        const merged = { ...targetDef.defaultData, ...section.data } as Record<string, any>
                        updateSection(i, { ...section, variant: newVariant, data: merged })
                      }}
                    />
                    <SectionFormDispatcher
                      type={section.type}
                      variant={section.variant}
                      data={section.data}
                      onChange={(d) => updateSection(i, { ...section, data: d })}
                    />
                  </fieldset>
                )}
              </div>
            )
          })}

          {mayEdit && <AddSectionMenu onAdd={addSection} />}

          {/* SEO */}
          <fieldset disabled={!mayEdit} className="card card-padding mt-6 min-w-0">
            <div className="font-semibold text-sm text-ink mb-3">SEO (optional, overrides site defaults)</div>
            <div className="space-y-3">
              <div>
                <label htmlFor="page-meta-title" className="block text-xs font-semibold uppercase tracking-wider text-ink-soft mb-1.5">Meta title</label>
                <input
                  id="page-meta-title"
                  type="text"
                  value={page.metaTitle || ''}
                  onChange={(e) => update({ metaTitle: e.target.value || null })}
                  className="input"
                />
              </div>
              <div>
                <label htmlFor="page-meta-description" className="block text-xs font-semibold uppercase tracking-wider text-ink-soft mb-1.5">Meta description</label>
                <textarea
                  id="page-meta-description"
                  rows={2}
                  value={page.metaDescription || ''}
                  onChange={(e) => update({ metaDescription: e.target.value || null })}
                  className="input"
                />
              </div>
            </div>
          </fieldset>
        </div>

        {/* The preview: this page as it will look, drawn from what is in the editor now. */}
        {preview && (
          <LivePreview
            kind="page"
            slug={row.slug}
            data={mayEdit ? page : null}
            label={ed.isDirty || ed.hasDraft ? 'Preview of your changes' : 'Preview'}
            publicHref={shownOnSite ? publicHref : null}
            settingsDraft={settingsDraft}
            className={`border-t lg:border-t-0 border-line ${wide ? 'flex-1' : 'shrink-0 h-[calc(100svh-12rem)] min-h-[24rem]'}`}
          />
        )}
      </div>
    </div>
  )
}
