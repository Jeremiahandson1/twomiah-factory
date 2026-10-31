/** Every trade screen spec, by id. */
import type { ScreenSpec } from './kit'
import { SALON } from './salon'
import { EVENTS } from './restaurant'
import { BAR } from './bar'
import { STORE } from './store'
import { VET } from './vet'
import { OFFICE } from './office'
import { LANDSCAPING } from './landscaping'

export const SPECS: ScreenSpec[] = [...SALON, ...EVENTS, ...BAR, ...STORE, ...VET, ...OFFICE, ...LANDSCAPING]
export const specFor = (id: string) => SPECS.find((s) => s.id === id)
