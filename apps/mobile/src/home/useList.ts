/** One paged list from the server: rows, the whole count, refresh and load-more. The list screens share it. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { get } from '../api/client'

export function useList(url: string | null, pageSize = 25, pick?: (body: any) => any[]) {
  const [rows, setRows] = useState<any[]>([])
  const [total, setTotal] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const page = useRef(1)
  const more = useRef(false)

  const load = useCallback(async (p: number) => {
    if (!url) { setRows([]); setLoading(false); return }
    const sep = url.includes('?') ? '&' : '?'
    const res = await get(pick ? url : `${url}${sep}page=${p}&limit=${pageSize}`)
    if (!res.ok) { setError(res.error || 'Could not load this list'); setLoading(false); return }
    setError(null)
    const body = res.data
    const data: any[] = pick ? pick(body) : Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : []
    setRows((prev) => (p === 1 ? data : [...prev, ...data]))
    const t = pick ? undefined : body?.pagination?.total
    setTotal(typeof t === 'number' ? t : undefined)
    more.current = pick ? false : typeof t === 'number' ? p * pageSize < t : data.length === pageSize
    page.current = p
    setLoading(false)
  }, [url, pageSize])

  useEffect(() => { setLoading(true); load(1) }, [load])
  return { rows, total, loading, error, refresh: () => load(1), loadMore: () => { if (more.current) load(page.current + 1) } }
}
