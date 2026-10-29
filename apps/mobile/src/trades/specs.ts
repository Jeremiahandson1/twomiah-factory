/** Every trade screen spec, by id. */
import type { ScreenSpec } from './kit'
import { SALON } from './salon'
import { EVENTS } from './restaurant'
import { BAR } from './bar'

export const SPECS: ScreenSpec[] = [...SALON, ...EVENTS, ...BAR]
export const specFor = (id: string) => SPECS.find((s) => s.id === id)
