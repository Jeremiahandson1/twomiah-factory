# Bar 13 - Fill-level slider per bottle on the blind count

Feature id: `stock_fill_levels` (hidden, not ready). Tests: `apps/unified/tests/bar-menu-count-depth.test.ts`, `bar-fill-levels-depth.test.ts` (3); phone: `tests/mobile/bar-fill-levels.test.ts`.

Leader: Backbar bottle slider - https://www.getbackbar.com/support/how-to-use-bottle-slider-inventory ; Backbar scale weighing - https://www.getbackbar.com/support

| Leader capability | Ours | Mark |
|---|---|---|
| Slider per open bottle on the count | Fill slider per bottle on the web count screen | matches |
| Partial bottles add to the on-hand total | Level counted as a fraction of a bottle | matches |
| Blind count keeps expected hidden | Slider added to the blind count | matches |
| Phone count | Each open bottle on a real draggable slider (drag or tap anywhere on the bar, in steps of 5; -5/+5 beside it; adjustable to a screen reader; pure React Native, no native module), any number of them with add and remove | matches |
| Scale/weight integration | A stock item carries its empty bottle's weight and a full one's (both or neither, full heavier than empty); a count takes weights in grams beside fills and turns each into a fill by those weights, refusing weights for an item with none on file. On the web count a weight is typed or read straight from a Bluetooth scale (Web Bluetooth, the Bluetooth SIG Weight Scale service 0x181D / Weight Measurement 0x2A9D; Chrome or Edge on a computer or Android). On the phone weights are typed, one per bottle | matches on the web; on the phone, typed - a Bluetooth scale there is the owner's step (below) |

Owner's step (phone scale): reading a Bluetooth scale on the phone needs a native build with a Bluetooth module (`react-native-ble-plx`, and the Bluetooth permissions the Terminal plugin currently blocks switched back on for that purpose); the app's current builds have no Bluetooth. Until then the phone takes the weight typed.

Unverified: no Bluetooth scale was connected; the Weight Measurement parsing follows the Bluetooth SIG characteristic (flags bit 0 picks imperial; SI steps of 0.005 kg, imperial 0.01 lb). Not seen in a real browser or on a real phone.
