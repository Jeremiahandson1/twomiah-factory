// Cmd/Ctrl+K global search — button in the header (hidden below md), overlay rendered as its sibling so it
// never sits under a display:none ancestor (the old portal worked around exactly that — CC-09/VET-09).
import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X, User, Folder, Wrench, FileText, File, Users, HelpCircle, Loader2, Scissors, PawPrint, CalendarDays, Caravan } from 'lucide-react'
import type { ShellApi } from './types'

const TYPE_ICONS: Record<string, React.ElementType> = {
  contact: User, project: Folder, job: Wrench, quote: FileText, invoice: FileText, document: File, team: Users, rfi: HelpCircle,
  service: Scissors, patient: PawPrint, appointment: CalendarDays, event: CalendarDays, unit: Caravan,
}
const TYPE_COLORS: Record<string, string> = {
  contact: 'bg-blue-100 text-blue-700', project: 'bg-purple-100 text-purple-700', job: 'bg-orange-100 text-orange-700',
  quote: 'bg-green-100 text-green-700', invoice: 'bg-yellow-100 text-yellow-700', document: 'bg-gray-100 text-gray-700',
  team: 'bg-pink-100 text-pink-700', rfi: 'bg-red-100 text-red-700', service: 'bg-teal-100 text-teal-700',
  patient: 'bg-teal-100 text-teal-700', appointment: 'bg-indigo-100 text-indigo-700', event: 'bg-indigo-100 text-indigo-700', unit: 'bg-amber-100 text-amber-700',
}

interface SearchItem { id: string; type: string; name: string; description?: string; url: string }

export function GlobalSearch({ api }: { api: ShellApi }) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchItem[]>([])
  const [recentItems, setRecentItems] = useState<SearchItem[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setIsOpen(true) }
      if (e.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!isOpen) return
    inputRef.current?.focus()
    api.get('/api/search/recent').then((items: any) => setRecentItems(Array.isArray(items) ? items : [])).catch(() => {})
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!query || query.length < 2) { setResults([]); setSelectedIndex(0); return }
    const timer = setTimeout(async () => {
      setLoading(true)
      try { const res = await api.get('/api/search', { q: query }); setResults(res?.results || []); setSelectedIndex(0) }
      catch { setResults([]) } finally { setLoading(false) }
    }, 200)
    return () => clearTimeout(timer)
  }, [query]) // eslint-disable-line react-hooks/exhaustive-deps

  const select = useCallback((item: SearchItem) => { setIsOpen(false); setQuery(''); navigate(item.url) }, [navigate])
  const items = query.length >= 2 ? results : recentItems
  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, items.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[selectedIndex]) select(items[selectedIndex]) }
  }

  if (!isOpen) {
    return (
      <button type="button" onClick={() => setIsOpen(true)} className="hidden md:flex items-center gap-2 px-3 py-1.5 text-sm text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors dark:text-slate-400 dark:bg-slate-800" aria-label="Search (Ctrl+K)">
        <Search className="w-4 h-4" />
        <span className="hidden sm:inline">Search...</span>
        <kbd className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-white rounded border border-gray-300 dark:bg-slate-900 dark:border-slate-700"><span className="text-xs">⌘</span>K</kbd>
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" aria-label="Search">
      <div className="fixed inset-0 bg-black/50" onClick={() => setIsOpen(false)} />
      <div className="relative min-h-screen flex items-start justify-center pt-[15vh] px-4">
        <div className="relative w-full max-w-xl bg-white rounded-xl shadow-2xl overflow-hidden dark:bg-slate-900">
          <div className="flex items-center px-4 border-b border-gray-200 dark:border-slate-700">
            <Search className="w-5 h-5 text-gray-400" />
            <input ref={inputRef} type="text" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onInputKey} placeholder="Search contacts, jobs, invoices..." className="flex-1 px-3 py-4 text-lg outline-none bg-transparent text-gray-900 dark:text-slate-100 placeholder:text-gray-400" />
            {loading && <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />}
            {query && !loading && <button type="button" onClick={() => setQuery('')} className="p-1 hover:bg-gray-100 dark:hover:bg-slate-800 rounded" aria-label="Clear"><X className="w-4 h-4 text-gray-400" /></button>}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 && query.length >= 2 && !loading && <div className="px-4 py-8 text-center text-gray-500 dark:text-slate-400">No results for "{query}"</div>}
            {items.length === 0 && query.length < 2 && <div className="px-4 py-8 text-center text-gray-500 dark:text-slate-400">Start typing to search...</div>}
            {items.length > 0 && (
              <div className="py-2">
                {query.length < 2 && <div className="px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-slate-400">Recent</div>}
                {items.map((item, index) => {
                  const Icon = TYPE_ICONS[item.type] || File
                  return (
                    <button type="button" key={`${item.type}-${item.id}`} onClick={() => select(item)} onMouseEnter={() => setSelectedIndex(index)} className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${index === selectedIndex ? 'bg-orange-50 dark:bg-orange-900/20' : 'hover:bg-gray-50 dark:hover:bg-slate-800'}`}>
                      <div className={`p-2 rounded-lg ${TYPE_COLORS[item.type] || 'bg-gray-100 text-gray-700'}`}><Icon className="w-4 h-4" /></div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 truncate dark:text-slate-100">{item.name}</div>
                        {item.description && <div className="text-sm text-gray-500 truncate dark:text-slate-400">{item.description}</div>}
                      </div>
                      <div className="text-xs text-gray-400 capitalize">{item.type}</div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-t border-gray-200 text-xs text-gray-500 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-400">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 bg-white rounded border dark:bg-slate-900">↑</kbd><kbd className="px-1.5 py-0.5 bg-white rounded border dark:bg-slate-900">↓</kbd> navigate</span>
              <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 bg-white rounded border dark:bg-slate-900">↵</kbd> select</span>
            </div>
            <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 bg-white rounded border dark:bg-slate-900">esc</kbd> close</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default GlobalSearch
