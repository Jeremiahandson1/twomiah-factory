/** The tile a list was opened from (route param `tile`): its definition and the request it makes. One lookup for every list screen. */
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useVertical } from '../vertical/VerticalContext'
import { tilesFor, type TileDef } from './tiles'
export { tileRoute } from './tiles'

export function useTile(): { tile: TileDef | undefined; clear: () => void } {
  const { tile: id } = useLocalSearchParams<{ tile?: string }>()
  const { vertical } = useVertical()
  const router = useRouter()
  const tile = id ? tilesFor(vertical).find((t) => t.id === String(id)) : undefined
  return { tile, clear: () => router.setParams({ tile: undefined as any }) }
}

