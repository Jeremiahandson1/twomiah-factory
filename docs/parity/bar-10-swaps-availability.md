# Bar 10 - Shift swaps and availability

Feature ids: `bar_availability`, `bar_shift_swaps` (hidden, not ready). Test: `apps/unified/tests/bar-shift-swaps.test.ts` (8 tests).

Leader: 7shifts availability - https://kb.7shifts.com/hc/en-us/articles/33383119814163 ; shift trading - https://kb.7shifts.com/hc/en-us/articles/4417514302995

| Leader capability | Ours | Mark |
|---|---|---|
| Staff set weekly availability, manager approves | Yes: mine, list, per-person decision | matches |
| Warning when a shift is outside availability | Flag on the schedule and a warning on the shift | matches |
| Swap / drop / pick-up with manager approval | Request, claim, accept/decline, cancel; manager approves | matches |
| Notifications | Email through the venue's mail | matches |
| One-time (dated) availability | Not built | not doing yet - weekly only |
| Setting to skip manager approval | Not built; manager approval is always required | not doing |
| Swap cancels itself when the schedule is republished or expires | Partly: a stale check refuses a swap whose shift changed; no expiry timer | partly |
| Phone screens | None; the web screens use the same routes | not yet - the phone has no swap or availability screen |
