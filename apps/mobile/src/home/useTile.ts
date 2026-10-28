/** The tile a list was opened from (route param `tile`): its definition and the request it makes. One lookup for every list screen. */
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useVertical } from '../vertical/VerticalContext'
import { tilesFor, type TileDef } from './tiles'

export function useTile(): { tile: TileDef | undefined; clear: () => void } {
  const { tile: id } = useLocalSearchParams<{ tile?: string }>()
  const { vertical } = useVertical()
  const router = useRouter()
  const tile = id ? tilesFor(vertical).find((t) => t.id === String(id)) : undefined
  return { tile, clear: () => router.setParams({ tile: undefined as any }) }
}

/** Where a tile's list lives. */
export function tileRoute(def: TileDef, vertical: string): { pathname: string; params: { tile: string } } {
  const params = { tile: def.id }
  switch (def.screen) {
    case 'new-leads': return { pathname: '/(details)/leads', params }
    case 'jobs': return { pathname: vertical === 'fieldservice' ? '/(tabs)/service-calls' : '/(tabs)/jobs', params }
    case 'quotes': return { pathname: '/(tabs)/quotes', params }
    case 'invoices': return { pathname: '/(details)/invoices', params }
    case 'projects': return { pathname: '/(details)/rows', params }
    default: return { pathname: '/(details)/rows', params }
  }
}
