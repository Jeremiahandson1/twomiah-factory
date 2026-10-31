# Salon #13 — Patch test status

## Source (help-centre page actually read)

- Fresha — Record client patch tests: https://www.fresha.com/help-center/knowledge-base/clients/55-record-client-patch-tests (Fresha is the only leader the brief names for this). Vagaro, GlossGenius, Boulevard and Mindbody: no help-centre page on patch tests was reached; nothing below claims a match against them.

## What Fresha does, and where this stands

| Capability (Fresha) | Here | Status |
|---|---|---|
| A recorded test has a date and a status: Pending, Passed or Failed | Date and status Pending / Passed / Failed (row 22). A pending test is not a result: it changes nothing for the booking rule until it is passed or failed. A date with no result on the old single form (and everything recorded before) counts as passed | **Built** — `tests/salon-patch-history.test.ts` |
| A test is valid six months from its date, not changeable | Valid 180 days, the number the Book's warning already used. Not changeable | **Matches** |
| Who ran the test, a title and a description per test | Each test has who ran it (a team login, default the person recording it), a title (120) and a description (1,000) | **Built** — same test |
| Several tests kept in a client's history | A history per client (client chart › Patch tests): add, change a pending test's result, remove a wrong one (confirmed). The latest passed-or-failed test is mirrored onto the profile, which is what the booking rule has always read, so the rule is unchanged. The chart's old single "last patch test" form edits the latest test; it does not add to the history | **Built** — same test; the old form's tests in `tests/salon-patch-test.test.ts` still pass (one expectation changed: a date with no result now reads as an explicit pass) |
| Bookings are not blocked — reminders only; manual bookings show an alert | Online booking of a patch-test service is **refused** (the client is asked to call) when none is on record, it has run out, or it failed; the desk can still book it, but types a reason, kept on the appointment | **Beats** — only when the salon switches the rule on |
| Online bookers asked to confirm they hold a valid test | Not asked; the server checks the record instead | **Different, stricter** |
| (Owner's decision 2026-10-30) A client who needs a test is not simply turned away | The salon can name its patch-test appointment (Settings › The Book). A held client is then offered it, with a link to its booking page, books that, and books the colour once the test is on record as passed. With none named they are asked to call | **Beats** — only when named |
| Alert on a manual booking for a service that needs a test | The desk is stopped and asked for a reason; the Book's existing warning at check-in is unchanged | **Matches** |
| The appointment message tells the client they need a test | The online booking's confirmation email, its reminder email and the day-before reminder text carry one sentence when the service needs a test and the client holds no passing, in-date one (none on record / run out / did not pass); a client who holds a pass is told nothing. A booking made at the desk gets the day-before text only (the desk has no confirmation message to a client) | **Built** — same test (email note, text, three sentences) |
| Completing the patch-test appointment records the test and asks for the result | Completing the salon's named patch-test appointment in the Book records a test dated that day, run by the appointment's stylist, once per appointment (completing again adds none), and the screen asks Passed / Failed / Decide later; the result can be given on the same call | **Built** — same test |

## Notes for the owner

- The rule is a switch in Settings › The Book, **off by default**, so no live salon's online booking changes until its owner turns it on.
- A new client has no test on record, so with the rule on they cannot book a patch-test service online. If the salon has named its patch-test appointment they are offered that first; otherwise they are told to call. Completing the named patch-test appointment records the test as pending and asks how it went; "Decide later" leaves it pending on the chart, where its result can be set from the dropdown.

## Not seen

- The history panel on the client chart and the result prompt in the Book were typed and type-checked but **not seen in a real browser**. The phone app has no patch-test history screen (it still shows the single last test).
