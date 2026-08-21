// Feature catalog for the self-serve Features page. Deliberately lists ONLY the
// feature ids that something in this app actually gates (AdsPage → 'paid_ads',
// EstimatorPage → 'instant_estimator'). Listing un-consumed ids would give
// owners toggles that do nothing — the same dead-UI problem as a broken editor.
// When a new hasFeature() gate is added to the app, add its id here too.
export const FEATURE_CATEGORIES = [
  {
    id: 'addons',
    name: 'Optional Add-ons',
    description: 'Extra tools you can switch on — every feature is included in your plan',
    features: [
      { id: 'paid_ads', name: 'Paid Ads Dashboard', description: 'Track ad spend and the leads your campaigns bring in' },
      // 'instant_estimator' removed 2026-08-20 — a clone artifact. It was the
      // ROOF estimator relabelled as a "care estimate", it does not work, and
      // home care has no estimator page to reach even if switched on.
    ],
  },
]
