// The CRM's screens, each loaded when it is first opened. Out of the admin's first bundle, so a business with only a
// website never downloads the CRM, and nobody downloads every screen to open one.
import { lazy, Suspense, type ComponentType } from 'react'
import { ScreenLoading } from '@twomiah/tenant-ui/src/ui/PageLoading'

// While a screen is fetched it says which one (the menu's name for it, else the name it was registered under) over a grey
// page-shaped skeleton. It was a blank screen (fallback null), which on a slow connection read as a broken page.
const wrap = (L: ComponentType<any>, name = ''): ComponentType<any> => {
  const Screen = (props: any) => <Suspense fallback={<ScreenLoading name={name} />}><L {...props} /></Suspense>
  return Screen
}

/** A page module's default export, loaded on first use. */
export const page = (load: () => Promise<{ default: ComponentType<any> }>, name = '') => wrap(lazy(load), name)

/** A named export of a page module, loaded on first use. */
export const named = <M,>(load: () => Promise<M>, name: keyof M, label = '') =>
  wrap(lazy(() => load().then((m) => ({ default: m[name] as unknown as ComponentType<any> }))), label)

type Screens = typeof import('./screens')
const loadScreens = () => import('./screens')
const made = new Map<string, ComponentType<any>>()

/** The wrappers in ./screens.tsx (Crm.Contacts …), all from one chunk, loaded when the first is opened. */
export const Crm = new Proxy({} as { [K in keyof Screens]: ComponentType<any> }, {
  get(_t, name: string) {
    // Crm.LienWaivers → "Lien Waivers", for a screen with no menu item of its own.
    if (!made.has(name)) made.set(name, named(loadScreens, name as keyof Screens, name.replace(/([a-z0-9])([A-Z])/g, '$1 $2')))
    return made.get(name)
  },
})
