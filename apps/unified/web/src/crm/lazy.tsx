// The CRM's screens, each loaded when it is first opened. Out of the admin's first bundle, so a business with only a
// website never downloads the CRM, and nobody downloads every screen to open one.
import { lazy, Suspense, type ComponentType } from 'react'

const wrap = (L: ComponentType<any>): ComponentType<any> => {
  const Screen = (props: any) => <Suspense fallback={null}><L {...props} /></Suspense>
  return Screen
}

/** A page module's default export, loaded on first use. */
export const page = (load: () => Promise<{ default: ComponentType<any> }>) => wrap(lazy(load))

/** A named export of a page module, loaded on first use. */
export const named = <M,>(load: () => Promise<M>, name: keyof M) =>
  wrap(lazy(() => load().then((m) => ({ default: m[name] as unknown as ComponentType<any> }))))

type Screens = typeof import('./screens')
const loadScreens = () => import('./screens')
const made = new Map<string, ComponentType<any>>()

/** The wrappers in ./screens.tsx (Crm.Contacts …), all from one chunk, loaded when the first is opened. */
export const Crm = new Proxy({} as { [K in keyof Screens]: ComponentType<any> }, {
  get(_t, name: string) {
    if (!made.has(name)) made.set(name, named(loadScreens, name as keyof Screens))
    return made.get(name)
  },
})
