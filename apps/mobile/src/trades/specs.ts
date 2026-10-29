/** Every trade screen spec, by id. The trade files add theirs here. */
import type { ScreenSpec } from './kit'
import { SALON } from './salon'

export const SPECS: ScreenSpec[] = [...SALON]
export const specFor = (id: string) => SPECS.find((s) => s.id === id)
