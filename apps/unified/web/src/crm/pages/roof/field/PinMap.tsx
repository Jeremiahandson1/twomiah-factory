// Roofing's pin map is the shared one now (@twomiah/tenant-ui maps/PinMap.tsx, parity tier 2 #8 — the lead map uses it too), with
// this app's API reader bound in so roofing's screens keep calling it as before.
import SharedPinMap, { ensureLeaflet, coord, type Pin } from '@twomiah/tenant-ui/src/maps/PinMap'
import { api } from '../../../../api'

export { ensureLeaflet, coord, type Pin }

export default function PinMap(props: Omit<Parameters<typeof SharedPinMap>[0], 'api'>) {
  return <SharedPinMap {...props} api={api} />
}
