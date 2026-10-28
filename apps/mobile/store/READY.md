# Phone app — ready to submit? What's done, what you must do

Branch `cloud/mobile-ready` (2026-10-28). Nothing was built or submitted; no store id, key or password was invented. Everything below
that says "checked" is a test or a command you can re-run; everything that needs a phone or your logins is in §3 and §4.

## 1. The one thing that would have stopped you: Expo SDK 52 is too old for both stores

- **Apple:** since 2026-04-28 App Store Connect refuses builds made with anything older than Xcode 26 / the iOS 26 SDK
  ([Apple](https://developer.apple.com/news/upcoming-requirements/)). EAS builds SDK 54 and later with Xcode 26 by default
  ([Expo](https://expo.dev/blog/app-store-connect-minimum-sdk-26)); SDK 52 does not.
- **Google:** since 2026-08-31 new apps must target Android 16 (API 36)
  ([Google Play](https://developer.android.com/google/play/requirements/target-sdk)) and support 16 KB memory pages, which needs React
  Native 0.77 or newer ([Expo](https://github.com/expo/fyi/blob/main/android-16kb-page-sizes.md)). SDK 52 is React Native 0.76, target API 34.

So the app is now on **Expo SDK 54** (React Native 0.81, React 19.1, target API 36 — read from the installed `react-native`). Expo's
latest is SDK 58 (2026-10-15); 54 is the oldest that meets both rules, so it is the smallest jump. Going further is your call; each
step is another round of device testing.

What the move touched: `expo-notifications` (two renamed calls), `react-native-worklets`, `expo-font` and `babel-preset-expo` declared
(they were found by luck before), the Reanimated plugin (the preset adds it), `tsconfig.json` (no longer pins `react` to its types).
**Checked:** `tsc` clean · `expo-doctor` 17 of 18 (the one left is bun's linked copies of the same version) · `expo export` builds the
Android (Hermes) and iOS bundles · the plugins' real Info.plist and manifest output (below) · every mobile test.
**Not checked: anything running.** React Native 0.81 and Reanimated 4 are new to this app: look at every screen on a real phone (§3).

## 2. What is done

| | |
|---|---|
| **Icons and splash** | Drawn from the Twomiah flame by `assets/source/build-icons.ts` (re-run it to change them): `icon.png` 1024² with no alpha, `adaptive-icon.png` with the mark inside the 720² safe zone, `splash.png` 1284×2778 on the app's blue `#1e40af`, `notification-icon.png` 96² solid white. Sizes, alpha, safe zone and colours are tested. A home-screen mock: `store/preview/icons-mock.png`. The flame's back flame is 65% opaque in the brand file, which reads brownish on blue — it is the brand mark as drawn. |
| **"Not available" screen** | Salons, restaurants, bars, stores and vets: signs in, then says "*<Business>* uses the website", says what the app is for, and a button opens `<their address>/login` (the CRM sign-in) in the browser; Sign out stays. Looked at in light and dark: `store/preview/no-phone-app-light.png`, `-dark.png`. Button text is readable on any brand colour (tested). |
| **Listing** | `store/listing.md`: name "Twomiah CRM", descriptions for the seven supported trades only, privacy and support URLs (both answer 200 today). Every feature named is a screen in the app; it does not claim EVV compliance, Sandata integration, or offline use beyond home-care clock-ins (which is all the app does offline). Limits and claims are tested. |
| **Permissions** | Checked by expanding the Expo plugins (`expo config --type introspect`), not just reading `app.config.ts`. iOS asks for **camera, photo library, location while using** — each with a reason written for this app. No microphone, no Face ID, no "Always" location text (the plugins add generic ones unless told not to). Android removes `RECORD_AUDIO` and `SYSTEM_ALERT_WINDOW`. Apple's privacy manifest and the encryption flag are set. |
| **Version** | 1.0.0; production builds are numbered by EAS (`appVersionSource: remote`, `autoIncrement`). |
| **eas.json** | Your three Apple values are still `TODO_…`; a test fails if someone fills them with anything that is not a real-looking id. The Play upload is an internal-track **draft**. |
| **Checked against the new system** | The app's own sign-in, token refresh, tab choice, download, push and caregiver-request code run over real HTTP against a real unified server for contractor, "Other", field service, landscaping, roofing, RV and home care (`apps/unified/tests/mobile-app-client.test.ts`, 63 tests): sign-in as owner and as the field seat, the right tabs for each, today's jobs / dashboard / pipeline, a contact made and edited, a job started / noted / completed, a photo uploaded and opened, the push token, a quote and its invoice opened as a one-time PDF link (and refused to a seat without quotes), a caregiver's clock-in and clock-out, a stalled request giving up. A second test checks that **every `/api` path in the app's source is a route the server has**. The older per-screen tests (`mobile-trades`, `mobile-homecare`, `mobile-rv`) still pass. |

### Bugs this found and fixed
1. **Opening on a hidden tab.** The tab bar never said which tab to open; Expo opened the first screen file, `dashboard`, which is hidden
   for roofing, home care and any seat without dashboard access. The app now opens on the trade's first tab the person can see.
2. **Sign-out left the phone subscribed.** The server keeps a push token against the person who registered it; the app never asked it to
   forget it, so a signed-out phone kept getting that person's alerts (a visit, a client's name). Sign-out now removes this phone's token.
3. The tab and permission rules were inline in React screens; they are now plain functions (`visibleTabs`, `permits`) the tests run.

### Decisions I made — change any of them
- **Background location is OUT of the first store version.** Google reviews it separately (a declaration form and a demo video) and Apple
  wants a convincing reason, for one opt-in switch that only a business with the GPS add-on can use. The code is all there and Twomiah Build
  still has it. To put it back: restore the text in `app.config.ts` (the comment shows it), bump `version`, and fill Google's background-
  location form with a short video of Alerts → Location. Until then those businesses get no phone location sharing; every other location use
  (clock-in position, canvass) is "while using".
- **Home-screen name is "Twomiah"** (short); the store name is "Twomiah CRM".
- **RV's Parts tab** shows a sample catalogue (and says so) until a dealer imports theirs. RV is closed for signups; use roofing or
  contractor for the review account, and no RV screenshot.

## 3. What I could not exercise without a real phone — please test these

Build a preview first (§4 step 8) and go through each on an iPhone and an Android phone:
1. Every tab of every trade renders and scrolls (new React Native 0.81, Reanimated 4, Expo Router 6): contractor, field service, roofing,
   landscaping, home care, RV, and the "not available" screen with a salon login.
2. **The app opens on the right tab** for roofing and home care (fix 1 above) — this is the change I am least able to prove without a device.
3. Android **edge-to-edge**: with target API 36 the app draws behind the status and navigation bars. Check the top and bottom of every screen.
4. Camera: taking a job photo; photo library: picking one; the upload completes; it appears in the job.
5. Location prompt text, and clock-in / clock-out for a caregiver at a client's address (GPS fix, the geofence message).
6. Push: allow notifications; assign a job to the test user from the web CRM; the alert arrives, **and tapping it opens the job**.
   Then sign out and confirm no further alerts arrive (fix 2).
7. The quote and invoice PDF button opens the file in Safari / Chrome.
8. Two-factor sign-in with an authenticator app; wrong password; airplane mode (the offline banner; a caregiver clock-in saved and sent later).
9. Light and dark mode; a tablet (iPad is declared supported).
10. The icon on a real home screen, the splash, and the Android notification icon in the status bar (must be a white flame, not a white square).

## 4. What you must do, in order

**Apple** (about a day for enrolment, then minutes)
1. Enrol at <https://developer.apple.com/programs/> ($99/yr). Note the **Apple ID email** and the **Team ID** (Membership page, 10 characters).
2. App Store Connect → My Apps → New App: iOS, name `Twomiah CRM`, language English (U.S.), bundle ID `com.twomiah.crm`, any SKU
   (say `twomiah-crm`). The bundle ID must exist first: register `com.twomiah.crm` under Certificates, Identifiers & Profiles →
   Identifiers (or let the first `eas build --platform ios` register it — it asks for your Apple login). Note the numeric **Apple ID of
   the app** (in the URL of the new app).
3. In `apps/mobile/eas.json` replace the three values under `submit.production.ios`:
   `"appleId": "<your Apple ID email>"`, `"ascAppId": "<the numeric app id>"`, `"appleTeamId": "<Team ID>"`.

**Google** (enrolment can take days: start now)
4. Enrol at <https://play.google.com/console/signup> ($25). Create the app: name `Twomiah CRM`, package `com.twomiah.crm`, free.
5. Setup → API access → create a service account, grant it **Release manager**, download its JSON key and save it as
   `apps/mobile/google-play-service-account.json` (already gitignored; `git status` must not show it).
   Expo's docs say Google's API accepts uploads only after one release exists, so the **first** build goes up by hand: download it from EAS and upload it in
   Play Console → Testing → Internal testing → Create release.

**Expo**
6. `npm i -g eas-cli`, then `eas login` as `jeremiahandson`. The store app's project (`twomiah-mobile`) already exists; its id is in
   `app.config.ts`. No variable is needed. (Twomiah Build, Roofer and Care are separate apps and are **not** part of this submission.)
7. `cd apps/mobile && bun install && npx expo-doctor` — expect everything but the "duplicate dependencies" line (see §1).
8. Build and install on your own phones first: `eas build --platform all --profile production`, then `eas submit --platform ios` /
   `--platform android` — these go to **TestFlight** and the Play **internal** track, not to the public. Install from there, do §3.
   (A quicker Android-only try: `eas build --platform android --profile preview` gives an installable file; iOS needs a TestFlight build.)

**The review account and screenshots**
9. Make a sandbox business (the way you make a test signup) in the **roofing** trade, and an owner-level user for the reviewers
   (e.g. `reviewer@twomiah.com`). Give it: three contacts, three jobs scheduled **today** (one assigned to a field user), one job with a
   photo, one quote with two lines, one lead in the pipeline. Make a second sandbox in **home care** with a caregiver who has a visit
   today at a client with an address (for the Today and Clock screenshots only). Rotate the password after each review.
10. Screenshots from the real app signed in to those: roofing Pipeline, a job with photos, Contacts, a quote, a caregiver's Today and
    Clock. Sizes in `listing.md`. Light mode; no notch overlays or device frames needed.

**Privacy and the forms**
11. **Add a phone-app paragraph to <https://twomiah.com/privacy>** (that site is a separate repo, so I did not touch it). Today it does
    not mention precise location, photos taken with the camera, or the phone's push token. Stores require the policy to cover what the
    app collects. Suggested wording: *"Phone app. If you use the Twomiah phone app, it uses your phone's camera and photo library to
    attach pictures to jobs and records, your location while you are using the app (to record where you clocked in or out, to log a
    canvass door, and to fill in an address), and a push-notification token so we can send you alerts. These go to your business's
    Twomiah account and are used only to provide the app. We do not use them for advertising or sell them."*
12. **Apple → App Privacy** (answer for the data the app handles, all "linked to the user", all "App functionality", none "tracking"):
    Contact info (name, email, phone), User content (photos, notes, messages), Precise location, Identifiers (device ID — the push token),
    Health & fitness (home care: caregivers record clients' vitals and medications — declare it). No analytics or advertising SDK is in the app.
    Export compliance: answered by the app already (`ITSAppUsesNonExemptEncryption: false`). Age rating: 4+.
13. **Google → Data safety**: the same data types, "collected", "not shared", encrypted in transit: yes. Data deletion: through the
    business or support@twomiah.com. Content rating questionnaire: business app, no objectionable content. Target audience: 18+.
    **Background location: not declared** (it is out of this version; if you restore it, Google needs its own form and a video).
14. **App Review Information** (Apple) and **App access** (Google): the sandbox URL, email and password from step 9, and these notes:
    *"Twomiah CRM is a companion app for businesses that already use Twomiah (twomiah.com). Accounts are created by a business's owner on
    the website; the app has no sign-up, no purchases and no subscriptions, so there is nothing to buy or to delete in the app. Sign in with
    the server address, email and password above. Businesses in salon, restaurant, bar, store and veterinary trades use the website instead;
    signing in with one of those shows a screen that says so and opens the website sign-in."*
15. Fill `listing.md`'s text into both consoles, upload the screenshots and the icon (`assets/icon.png` is the 1024² store icon), set the
    privacy URL `https://twomiah.com/privacy` and support URL `https://twomiah.com/support`, then submit for review from each console
    after the TestFlight / internal builds pass §3. (`eas submit` can also promote the build; review itself is started in the consoles.)

## 5. After approval
Fixes to screens and logic go out without a store review: `cd apps/mobile && eas update --channel production --message "what changed"`.
A new permission, a new native module or an Expo upgrade needs a new build and a version bump (see HANDOFF.md).

## 6. Not covered
Twomiah Build, Twomiah Roofer and Twomiah Care (separate apps with their own ids and artwork — HANDOFF.md §12 for Care) were not changed
beyond the SDK move and the shared permission clean-up, and have no store work in this branch.
