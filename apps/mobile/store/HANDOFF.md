# Mobile App Ship Handoff — what you need to do

Code work is done. This file is the punch list of tasks that require your accounts, your assets, your wallet, or your signing approval.

## 1. Apple Developer Program

- [ ] Enroll: https://developer.apple.com/programs/ ($99/yr)
- [ ] Note your **Apple ID** (email used to enroll)
- [ ] Note your **Apple Team ID** (10-char string visible in Membership page)

Then in `apps/mobile/eas.json`, replace:
```
"appleId": "TODO_REPLACE_WITH_APPLE_ID@twomiah.com",
"appleTeamId": "TODO_APPLE_TEAM_ID"
```

## 2. App Store Connect — create the iOS app record

- [ ] Go to https://appstoreconnect.apple.com → My Apps → New App
- [ ] Bundle ID: `com.twomiah.crm` (must match `app.config.ts` generic variant)
- [ ] App name: `Twomiah CRM`
- [ ] Primary language: English (U.S.)
- [ ] Note the **ASC App ID** (numeric, in the URL after creating)

Then in `apps/mobile/eas.json`, replace:
```
"ascAppId": "TODO_APP_STORE_CONNECT_APP_ID"
```

## 3. Google Play Console

- [ ] Enroll: https://play.google.com/console/signup ($25 one-time)
- [ ] Create app: `Twomiah CRM`, package `com.twomiah.crm`
- [ ] In Settings → API access → create a service account
- [ ] Grant the service account "Release manager" role
- [ ] Download the JSON key, save it as `apps/mobile/google-play-service-account.json`
- [ ] (already gitignored — verify it does NOT appear in `git status`)

## 4. EAS account + project

- [ ] `npm install -g eas-cli` (or `bun add -g eas-cli`)
- [ ] `eas login`
- [ ] From `apps/mobile/`: `eas init` (creates EAS project, sets `EAS_PROJECT_ID`)
- [ ] Confirm `apps/mobile/app.config.ts` `extra.eas.projectId` resolves correctly (uses `process.env.EAS_PROJECT_ID`)

## 5. App icons & splash (required before any build)

Drop the following into `apps/mobile/assets/`:

- [ ] `icon.png` — 1024×1024, no transparency, no rounded corners (Apple adds them)
- [ ] `adaptive-icon.png` — 1024×1024, **safe zone is the inner 720×720** (Android crops aggressively)
- [ ] `splash.png` — 1284×2778 ideal, must work on `backgroundColor: "#1e40af"`
- [ ] `notification-icon.png` — 96×96, white silhouette on transparent background (Android requirement)

If you want per-variant artwork later (Twomiah Build, Twomiah Roofer), drop overrides into:
- `apps/mobile/assets/build/<filename>.png`
- `apps/mobile/assets/roofer/<filename>.png`

`app.config.ts` already falls back to the shared assets if the per-variant file is missing.

## 6. Store screenshots

Take with the actual app running. Required sizes:

**iOS:**
- 6.7" — iPhone 15 Pro Max (1290×2796)
- 6.5" — iPhone 11 Pro Max (1242×2688)
- 5.5" — iPhone 8 Plus (1242×2208)
- 12.9" iPad Pro (2048×2732)

**Google Play:**
- Phone: 1080×1920 (or any 16:9), 2–8 screenshots
- 7" tablet, 10" tablet (optional but improves placement)

Suggested screenshots (showcases multi-vertical):
1. Login screen (clearly branded, shows server URL field)
2. Roofing pipeline view
3. Field-service schedule
4. Homecare shifts + clock-in
5. Job detail with photos
6. Offline banner + queued actions

You can take these on a real device or in the iOS Simulator / Android emulator.

## 7. Privacy + Support URLs

Apple and Google require working URLs (linked, not "Under Construction"):

- [ ] Privacy policy at `https://twomiah.com/privacy`
- [ ] Support page at `https://twomiah.com/support` (an email link is enough)

Both must exist before submission. `apps/mobile/store/listing.md` references these.

## 8. Demo account for App Review

Apple's reviewers literally log into the app. They will reject without working credentials.

- [ ] Create a sandbox tenant via the factory (any vertical — roofing showcases the most)
- [ ] Add a test user to that tenant
- [ ] Provide in App Store Connect → App Review Information:
  - Server URL: `<demo-tenant>.onrender.com`
  - Email + password for the test user
- [ ] Rotate the password after each review cycle

## 9. Smoke test against all 4 vertical templates before submitting

Before `eas submit`, deploy a real tenant for each template and log in from a dev build:

- [ ] crm (contractor) tenant — confirm tabs are dashboard / jobs / contacts / quotes / alerts
- [ ] crm-fieldservice tenant — confirm tabs are dashboard / service-calls / schedule / contacts / alerts
- [ ] crm-homecare tenant — confirm tabs are shifts / clients / clock-in / messages / more
- [ ] crm-roof tenant — confirm tabs are pipeline / jobs / contacts / canvass / alerts

If any tenant shows the wrong tabs, check that backend's `/api/auth/me` returns `company.vertical` matching the template (already verified in code, but worth a runtime check).

## 10. Build + submit commands

Once 1–9 are done:

```bash
# from apps/mobile/
eas build --platform all --profile production
eas submit --platform all --profile production
```

For the branded variants (later, optional):
```bash
eas build --platform all --profile build-production    # Twomiah Build
eas build --platform all --profile roofer-production   # Twomiah Roofer
```
(Branded variants need their own ASC App IDs / Play listings — add separate submit profiles when ready.)

## 11. Post-submission

- [ ] iOS review usually takes 24–48 hrs first time
- [ ] Google Play review is typically ≤1 day for new apps
- [ ] Watch for rejection reasons in App Store Connect — most common: missing demo credentials, broken privacy URL, unclear what the app does without login
