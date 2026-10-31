# Bar 12 - Pre-authorised tabs on the counter reader

Feature id: `bar_tab_preauth` (hidden, not ready). Test: `apps/unified/tests/bar-card-tabs.test.ts` (8 tests).

Leader: Toast card pre-authorization - https://support.toasttab.com/en/article/Card-Pre-Authorization-Configuration-Device-Setup

| Leader capability | Ours | Mark |
|---|---|---|
| Hold on a card at the reader, tab opened | Server-driven reader, manual capture, $1 to $1,000 hold | matches |
| Capture on close with tip | Close with tip captures; higher than the hold uses incremental authorisation, a declined increase leaves the original hold | matches |
| Release on void | Release and lapse handling | matches |
| Card details on the tab | Brand, last four, cardholder | matches |
| Tip entered on the reader | Not built; the bartender enters the tip | not doing |
| Offline mode, saved card window | Not built | not doing |
| Phone takes no cards | Correct: counter reader only | by design |

The venue's own Stripe (every call carries the connected account). Unverified: only a fake Stripe and no physical reader were used.
